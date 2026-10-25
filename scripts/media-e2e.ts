// Media pipeline check: upload a large image (scaled copy, sizes, AVIF/WebP), set its focal point in
// the media library UI, and confirm the square thumbnail is re-cropped around it. Cleans up after.
//   npx tsx --env-file=.env scripts/media-e2e.ts
import { chromium } from 'playwright';
import sharp from 'sharp';
import { siteDb } from '../src/lib/db/site';
import { closeLocalBindings } from '../src/lib/local-bindings';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const out: Record<string, unknown> = {};
let id = 0;

// 3000x2000 grey image with a red disc at (80%, 20%).
const W = 3000, H = 2000;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#888"/><circle cx="${W * 0.8}" cy="${H * 0.2}" r="260" fill="#e00"/></svg>`;
const jpg = await sharp(Buffer.from(svg)).jpeg().toBuffer();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);
  await page.goto(`${origin}/admin/media/`);
  await page.setInputFiles('#upload input[type=file]', { name: 'e2e-focal-test.jpg', mimeType: 'image/jpeg', buffer: jpg });
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/admin/media') && r.request().method() === 'POST', { timeout: 120_000 }), page.click('#upload button')]);
  if (!res.ok()) throw new Error(`upload failed: ${res.status()} ${await res.text()}`);
  const { data: m } = await sb.from('media').select('*').like('path', '%e2e-focal-test%').order('id', { ascending: false }).limit(1).single();
  id = m!.id;
  out.upload = { path: m!.path, size: `${m!.width}x${m!.height}`, sizes: Object.keys(m!.sizes), formats: m!.formats, thumbFormats: m!.sizes.thumbnail?.formats };

  const redness = async (p: string) => {
    const { data } = await sb.storage.from('media').download(p);
    const { data: px, info } = await sharp(Buffer.from(await data!.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    // Where the disc lands when the square crop slides fully toward it: 70% across, 20% down.
    const i = (Math.floor(info.height * 0.2) * info.width + Math.floor(info.width * 0.7)) * info.channels;
    return px[i] - px[i + 1]; // red minus green
  };
  out.thumbRedAtDiscBefore = await redness(m!.sizes.thumbnail.path);

  // Set the focal point on the red disc in the detail panel.
  await page.goto(`${origin}/admin/media/`);
  await page.waitForSelector('body[data-media-ready]');
  await page.click(`[data-media="${id}"]`);
  const img = page.locator('.cursor-crosshair img');
  await img.waitFor();
  const box = (await img.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await page.click('button:has-text("Save")');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 60_000 });
  const { data: after } = await sb.from('media').select('*').eq('id', id).single();
  out.focal = after!.focal_point;
  out.thumbRedAtDiscAfter = await redness(after!.sizes.thumbnail.path);
  out.avifThumbExists = !!(await sb.storage.from('media').download(after!.sizes.thumbnail.formats.avif)).data;

  // A square-only focal point on the far left: the square thumbnail follows it, the main point stays.
  await page.click('button:has-text("Square")');
  await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.5);
  await page.click('button:has-text("Save")');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 60_000 });
  const { data: sq } = await sb.from('media').select('*').eq('id', id).single();
  out.cropFocals = sq!.crop_focals;
  out.mainFocalKept = JSON.stringify(sq!.focal_point) === JSON.stringify(after!.focal_point);
  out.thumbRedAtDiscWithSquarePoint = await redness(sq!.sizes.thumbnail.path);
  await page.screenshot({ path: 'reference/media-e2e-detail.png' });
  console.log(JSON.stringify(out, null, 1));
} finally {
  if (id) {
    const { data: m } = await sb.from('media').select('*').eq('id', id).single();
    const files = [m!.path, ...Object.values(m!.formats ?? {}), ...Object.values(m!.sizes ?? {}).flatMap((s: any) => [s.path, ...Object.values(s.formats ?? {})])] as string[];
    await sb.storage.from('media').remove([...new Set(files)]);
    await sb.from('media').delete().eq('id', id);
  }
  await browser.close();
}
await closeLocalBindings();

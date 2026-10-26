// The other copy's file calls during a sync (src/lib/sync-remote.ts): signed with the shared
// SYNC_SECRET, on the media and sync-backups folders only. Downloads answer the file's bytes with its
// type and X-Sync-File; the rest answer { data, error } as the storage calls do. Not found while this
// copy has no secret.
import type { APIRoute } from 'astro';
import { siteStorage } from '../../../lib/storage';
import { SYNC_FOLDERS, sha256, verified, type FileCall } from '../../../lib/sync-remote';

const refuse = (message: string, status = 400) => Response.json({ data: null, error: { message, statusCode: String(status) } }, { status });

export const POST: APIRoute = async ({ request }) => {
  const head = request.headers.get('x-sync-call') ?? '';
  const check = await verified('/api/sync/files', request.headers, head);
  if (!check.ok) return new Response(check.message, { status: check.status });
  let c: FileCall;
  try {
    c = JSON.parse(head);
  } catch {
    return refuse('Not a file call');
  }
  if (!SYNC_FOLDERS.includes(c.folder)) return refuse('Not a folder a sync uses');
  const folder = siteStorage().from(c.folder);
  const opts = (c.options ?? {}) as Record<string, any>;
  switch (c.op) {
    case 'upload': {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!c.path || c.sha !== sha256(bytes)) return refuse('The file is not the one signed');
      return Response.json(await folder.upload(c.path, bytes, { contentType: opts.contentType, cacheControl: opts.cacheControl, upsert: opts.upsert }));
    }
    case 'download': {
      if (!c.path) return refuse('No path');
      const { data, error } = await folder.download(c.path);
      if (error) return Response.json({ data: null, error }, { status: Number(error.statusCode) || 400 });
      return new Response(data, { headers: { 'Content-Type': data.type || 'application/octet-stream', 'X-Sync-File': '1' } });
    }
    case 'list':
      return Response.json(await folder.list(c.prefix ?? '', opts));
    case 'remove':
      return Response.json(await folder.remove(Array.isArray(c.paths) ? c.paths.map(String) : []));
    default:
      return refuse('Not a file call');
  }
};

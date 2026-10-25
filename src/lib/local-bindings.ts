// Node only (scripts): the local bindings astro dev uses (in .wrangler/state), through wrangler's
// platform proxy, for the local files (R2). It runs a workerd process: a script that used it calls
// closeLocalBindings() before it ends, or it keeps running.
type Proxy = { env: Record<string, unknown>; dispose(): Promise<void> };

let proxy: Promise<Proxy> | null = null;

export function localBindings(): Promise<Proxy> {
  const wrangler = 'wrangler';
  proxy ??= import(/* @vite-ignore */ wrangler).then((w: { getPlatformProxy(o: object): Promise<Proxy> }) => w.getPlatformProxy({ remoteBindings: false, envFiles: [] }));
  return proxy;
}

export async function closeLocalBindings(): Promise<void> {
  if (!proxy) return;
  const p = await proxy;
  proxy = null;
  await p.dispose();
}

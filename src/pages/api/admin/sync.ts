// Settings > Sync API (admins).
// GET: the other copy (if one is set up), the groups that can sync and whether each copy is protected.
// GET ?backups=<here|remote>: that copy's backups and snapshots, and what it keeps;
//   &file=<name>: download one; &preview=<name>: what restoring that snapshot would do.
// POST { action }:
//   protect { value }: protect this site from syncs into it, or not;
//   plan { direction, groups }: what a sync would add, change and skip;
//   diff { direction, group, key }: one row on both copies;
//   backup { direction, items: [{ group, added, changed }], save? }: check the target and (unless save
//     is false) save a backup of what the sync overwrites (the screen does this first, and stops if it fails);
//   apply { direction, groups, group, keys, backup? }: write one batch (the screen sends them in turn;
//     `backup`, the backup's name, records the rows the batch added, for a restore to delete);
//   snapshot { site }: back that copy up now (a snapshot of everything a sync covers);
//   retention { site, keep?, schedule? }: how many backups and snapshots that copy keeps, and its
//     snapshot schedule; older ones go now;
//   deleteBackup { site, path }; restoreBackup { site, path, deleteSince? }: starts the restore as a
//     job and answers { job }; GET ?restoreJob=<job> is its status and, when done, its result.
// Backups and snapshots hold rows, not stored images.
import type { APIRoute } from 'astro';
import { apply, backup, backupFile, backups, deleteBackup, diff, endpoints, isProtected, plan, queueRestore, remoteConfig, restoreJob, runRestore, setRetention, snapshotNow, snapshotPreview, syncGroups, type Direction, type Site } from '../../../lib/sync';
import { enqueue } from '../../../lib/jobs';
import { serviceClient } from '../../../lib/db/site';

const direction = (v: unknown): Direction => (v === 'pull' ? 'pull' : 'push');
const site = (v: unknown): Site => (v === 'remote' ? 'remote' : 'here');
const fail = (e: unknown) => new Response((e as Error).message, { status: 400 });

export const GET: APIRoute = async ({ url }) => {
  const remote = remoteConfig();
  try {
    const job = url.searchParams.get('restoreJob');
    if (job) return Response.json((await restoreJob(job)) ?? { status: 'error', error: 'That restore was not found.' }, { headers: { 'Cache-Control': 'private, no-store' } });
    const of = url.searchParams.get('backups');
    if (of) {
      const file = url.searchParams.get('file');
      const preview = url.searchParams.get('preview');
      if (preview) return Response.json(await snapshotPreview(site(of), preview));
      if (!file) return Response.json(await backups(site(of)));
      return new Response(await backupFile(site(of), file), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="sync-backup-${file}"` } });
    }
    const here = await isProtected(serviceClient());
    // A problem with the other copy (unreachable, or set to this site's own database) is shown in its
    // place; the rest of the tab still works.
    const there = remote ? await Promise.resolve().then(() => isProtected(endpoints('push').target)).catch((e: Error) => e.message) : null;
    return Response.json({ remote: remote?.name ?? null, groups: syncGroups().map(({ id, label, kind }) => ({ id, label, kind })), protected: { here, there } });
  } catch (e) {
    return fail(e);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'protect': {
        const { data: current, error: readError } = await locals.db.from('settings').select('value').eq('key', 'site').maybeSingle();
        if (readError) return fail(readError);
        const value = { ...(current?.value ?? {}), sync_protected: !!body.value || undefined };
        const { error } = await locals.db.from('settings').upsert({ key: 'site', value }, { onConflict: 'key' });
        return error ? fail(error) : Response.json({ protected: !!body.value });
      }
      case 'plan':
        return Response.json(await plan(direction(body.direction), (body.groups ?? []).map(String)));
      case 'diff':
        return Response.json(await diff(direction(body.direction), String(body.group), String(body.key)));
      case 'backup':
        return Response.json(await backup(direction(body.direction), (body.items ?? []).map((i: any) => ({ group: String(i.group), added: (i.added ?? []).map(String), changed: (i.changed ?? []).map(String) })), body.save !== false));
      case 'apply':
        return Response.json(await apply(direction(body.direction), (body.groups ?? []).map(String), String(body.group), (body.keys ?? []).map(String), body.backup ? String(body.backup) : undefined));
      case 'snapshot':
        return Response.json(await snapshotNow(site(body.site)));
      case 'retention':
        return Response.json(await setRetention(site(body.site), { keep: body.keep == null ? undefined : Number(body.keep), schedule: body.schedule }));
      case 'deleteBackup':
        await deleteBackup(site(body.site), String(body.path));
        return Response.json({ ok: true });
      case 'restoreBackup': {
        const job = await queueRestore(site(body.site), String(body.path), !!body.deleteSince);
        // The jobs queue runs it (up to 15 minutes; it clears the page cache when done, src/worker.ts).
        // Without one it runs here before the answer.
        const queued = await enqueue({ kind: 'restore', job }).catch(() => false);
        if (!queued) await runRestore(job);
        return Response.json({ job }, { status: 202 });
      }
    }
    return new Response('Unknown action.', { status: 400 });
  } catch (e) {
    return fail(e);
  }
};

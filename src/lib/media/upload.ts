// Sending a file to the media library (POST /api/admin/media), from the browser. Images go as a form;
// videos go as the request's body, with their name in X-File-Name, so the Worker streams them to the
// store without holding them in memory (it has 128 MB).
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
/** The largest video the site takes. Cloudflare refuses any request over 100 MB on its Free and Pro plans. */
export const VIDEO_MAX_MB = 200;

export function uploadMedia(file: File): Promise<Response> {
  if (VIDEO_TYPES.includes(file.type)) return fetch('/api/admin/media', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
  const body = new FormData();
  body.append('file', file);
  return fetch('/api/admin/media', { method: 'POST', body });
}

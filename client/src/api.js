<<<<<<< HEAD
export const api = async (path, o = {}) => {
  const t = localStorage.getItem('vt');
  const isForm = o.body instanceof FormData;
  const r = await fetch('/api' + path, {
=======
// In production the API lives on its own domain (set VITE_API_URL); in dev the Vite proxy handles /api.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
// Vercel rejects request bodies over 4.5 MB, so keep each upload under 4 MB in total.
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 4;

export const api = async (path, o = {}) => {
  const t = localStorage.getItem('vt');
  const isForm = o.body instanceof FormData;
  if (isForm) {
    const total = [...o.body.values()].reduce((n, v) => n + (v instanceof File ? v.size : 0), 0);
    if (total > MAX_UPLOAD_MB * 1024 * 1024)
      throw Object.assign(new Error(`Please upload at most ${MAX_UPLOAD_MB} MB at a time.`), { status: 413 });
  }
  const r = await fetch(BASE + '/api' + path, {
>>>>>>> origin/main
    ...o,
    headers: {
      ...(!isForm && { 'Content-Type': 'application/json' }),
      ...(t && { Authorization: 'Bearer ' + t }),
    },
    body: o.body && (isForm ? o.body : JSON.stringify(o.body)),
  });
  const d = await r.json().catch(() => ({}));
<<<<<<< HEAD
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
};
=======
  if (!r.ok) throw Object.assign(new Error(d.error || (r.status === 413 ? 'That upload is too large.' : 'Request failed')), { status: r.status });
  return d;
};
>>>>>>> origin/main

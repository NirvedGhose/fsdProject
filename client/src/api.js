export const api = async (path, o = {}) => {
  const t = localStorage.getItem('vt');
  const isForm = o.body instanceof FormData;
  const r = await fetch('/api' + path, {
    ...o,
    headers: {
      ...(!isForm && { 'Content-Type': 'application/json' }),
      ...(t && { Authorization: 'Bearer ' + t }),
    },
    body: o.body && (isForm ? o.body : JSON.stringify(o.body)),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
};
// fetch() wrappers that throw the server's error message.

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return r.json();
}
export const jsonPost = <T = any>(url: string, body: unknown): Promise<T> => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// localStorage, namespaced and failure-proof.

export const store = {
  get(k, d) { try { const v = localStorage.getItem('recplay:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('recplay:' + k, JSON.stringify(v)); } catch {} },
};

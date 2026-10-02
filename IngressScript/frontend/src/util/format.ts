// Formatting times, dates, durations and names.

export const fmt = s => {
  if (!isFinite(s)) s = 0;
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
export const fmtDur = s => {
  if (!s || !isFinite(s)) return '–';
  if (s < 60) return `${Math.round(s)}s`;
  const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
export const toDate = d => new Date(d + 'T00:00:00');
export const longDate = (d: string) => isNaN(+toDate(d)) ? d : toDate(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const shortDate = (d: string) => isNaN(+toDate(d)) ? d : toDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const monthName = (d: string) => isNaN(+toDate(d)) ? '' : toDate(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const clock = (hms, plus = 0) => {
  if (!hms) return null;
  const [h, m, s] = hms.split(':').map(Number);
  return clockFmt.format(new Date(2000, 0, 1, h, m, s + Math.floor(plus)));
};
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const initials = name => name.split(/\s+/).filter(Boolean).map(w => /^\d+$/.test(w) ? w : w[0]).join('').slice(0, 2).toUpperCase();
export const fromName = name => { const m = /^V\d{4}-\d{2}-\d{2}-(\d{2})-(\d{2})-(\d{2})/i.exec(name || ''); return m ? `${m[1]}:${m[2]}:${m[3]}` : null; };
export const fmtBytes = b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

// GitHub-style activity grid: one square per day, weeks as columns, shaded by recordings that day
// GitHub-style grid: one square per day, weeks across, days of the week down.
// counts: {YYYY-MM-DD: n}; info(date) -> {title, cls} for squares that have something; onClick(date)
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

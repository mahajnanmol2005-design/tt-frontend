export const C = {
  bg: '#080B14', surface: '#0F1422', card: '#161C2D',
  border: '#1E2640', primary: '#4F8EF7', primaryDark: '#2563EB',
  accent: '#F97316', success: '#22C55E', warning: '#EAB308',
  error: '#EF4444', text: '#F1F5F9', subtext: '#64748B', muted: '#334155',
  gold: '#F59E0B', silver: '#94A3B8', bronze: '#B45309',
};
export const rank2Color = (rank, total) => {
  if (!rank || !total) return C.subtext;
  const pct = 1 - (rank - 1) / Math.max(1, total - 1);
  if (pct >= 0.75) return C.gold;
  if (pct >= 0.50) return '#22C55E';
  if (pct >= 0.25) return C.primary;
  return C.error;
};
export const F = {
  black: { fontWeight: '900' }, bold: { fontWeight: '700' },
  semi: { fontWeight: '600' }, med: { fontWeight: '500' },
};

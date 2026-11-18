/** "11h 42m" / "8m" / "under a minute" until the given ISO time; null once passed. */
export function timeLeft(dueIso: string, now: number): string | null {
  const ms = Date.parse(dueIso) - now;
  if (ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return 'under a minute';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const dueFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Local date and time, e.g. "Nov 19, 4:48 AM". */
export function formatDueTime(iso: string): string {
  return dueFmt.format(new Date(iso));
}

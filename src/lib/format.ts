const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export function formatUSD(cents: number): string {
  return usd.format(cents / 100);
}

/** Splits $1,248,309.57 into ["$1,248,309", ".57"] for the large balance display. */
export function splitUSD(cents: number): [string, string] {
  const s = formatUSD(cents);
  const i = s.lastIndexOf('.');
  return [s.slice(0, i), s.slice(i)];
}

export function signedUSD(cents: number, sign: '+' | '−'): string {
  return `${sign}${formatUSD(cents)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

/** Parses a user-typed USD amount ("25,000.50") into cents, or null if invalid. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}

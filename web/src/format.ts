import { formatUnits, parseUnits, type Address } from 'viem';

/** Format a token amount in minor units for display, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const s = formatUnits(value, decimals);
  const [whole, frac = ''] = s.split('.');
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, '');
  const wholeGrouped = groupThousands(whole);
  if (!trimmed) {
    // Non-zero amounts below the displayed precision must not read as zero.
    return value !== 0n && frac.replace(/0+$/, '') ? `<${wholeGrouped}.${'0'.repeat(maxFraction - 1)}1` : wholeGrouped;
  }
  return `${wholeGrouped}.${trimmed}`;
}

function groupThousands(whole: string): string {
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Parse a user-entered decimal amount. Returns null when the input is not a valid amount. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [, frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  try {
    return parseUnits(s, decimals);
  } catch {
    return null;
  }
}

export function shortAddress(a: Address | string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Human-readable duration such as "2d 4h 10m" or "under a minute". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d === 0 && h === 0 && m === 0) return 'under a minute';
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function formatTimestamp(unixSeconds: number | bigint): string {
  const ms = Number(unixSeconds) * 1000;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

import { describe, expect, it } from 'vitest';
import { formatAmount, formatDuration, parseAmount, shortAddress } from '../src/format';

describe('formatAmount', () => {
  it('formats whole and fractional PCKT amounts with grouping', () => {
    expect(formatAmount(0n, 18)).toBe('0');
    expect(formatAmount(25n * 10n ** 18n, 18)).toBe('25');
    expect(formatAmount(1_234_567n * 10n ** 18n, 18)).toBe('1,234,567');
    expect(formatAmount(12_500_000_000_000_000_000n, 18)).toBe('12.5');
    expect(formatAmount(1_000_000_000n * 10n ** 18n, 18)).toBe('1,000,000,000');
  });
  it('never shows a non-zero amount as zero', () => {
    expect(formatAmount(1n, 18)).toBe('<0.0001');
    expect(formatAmount(123_456_789_012_345_678n, 18)).toBe('0.1234');
  });
});

describe('parseAmount', () => {
  it('parses decimals into minor units', () => {
    expect(parseAmount('25', 18)).toBe(25n * 10n ** 18n);
    expect(parseAmount('12.5', 18)).toBe(12_500_000_000_000_000_000n);
    expect(parseAmount(' 1,000 ', 18)).toBe(1000n * 10n ** 18n);
    expect(parseAmount('0', 18)).toBe(0n);
  });
  it('rejects malformed input and excess precision', () => {
    expect(parseAmount('', 18)).toBeNull();
    expect(parseAmount('.', 18)).toBeNull();
    expect(parseAmount('abc', 18)).toBeNull();
    expect(parseAmount('-5', 18)).toBeNull();
    expect(parseAmount('1e18', 18)).toBeNull();
    expect(parseAmount('0.0000000000000000001', 18)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders days, hours and minutes', () => {
    expect(formatDuration(0)).toBe('now');
    expect(formatDuration(30)).toBe('under a minute');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3_600 * 5 + 60 * 7)).toBe('5h 7m');
    expect(formatDuration(86_400 * 6 + 3_600 * 23 + 60 * 59)).toBe('6d 23h 59m');
    expect(formatDuration(86_400 * 2)).toBe('2d 0h 0m');
  });
});

describe('shortAddress', () => {
  it('keeps both ends of the address', () => {
    expect(shortAddress('0xf01d2097c9479becbb0a96a10a49a47300ad9683')).toBe('0xf01d…9683');
  });
});

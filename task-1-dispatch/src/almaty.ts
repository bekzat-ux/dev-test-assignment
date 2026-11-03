// @rev kc-31
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function almatyDate(createdAt: string): string | null {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

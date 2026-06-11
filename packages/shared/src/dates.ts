export type BusinessDate = string; // YYYY-MM-DD

export function toBusinessDate(d: Date): BusinessDate {
  return d.toISOString().slice(0, 10);
}

export function nowUtc(): Date {
  return new Date();
}

export function parseBusinessDate(s: BusinessDate): Date {
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error(`Invalid business date: ${s}`);
  return d;
}

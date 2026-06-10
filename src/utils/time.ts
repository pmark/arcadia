export function nowIso(): string {
  return new Date().toISOString();
}

export function localDateParts(date = new Date()): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    day: String(date.getDate()).padStart(2, "0")
  };
}

export function localDateStamp(date = new Date()): string {
  const { year, month, day } = localDateParts(date);
  return `${year}-${month}-${day}`;
}

export function formatReadableDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

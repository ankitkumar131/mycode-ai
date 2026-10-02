export function sum(values: number[]): number {
  return values.reduce((a: number, b: number) => a + b, 0);
}

export function firstOf<T>(items: T[]): T | undefined {
  return items.length ? items[0] : undefined;
}

export function pluck<T, K extends keyof T>(rows: T[], key: K): Array<T[K]> {
  return rows.map((r: T) => r[key]);
}

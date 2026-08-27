export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

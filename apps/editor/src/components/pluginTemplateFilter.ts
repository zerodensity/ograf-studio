/** All plugin template searches use the same case-insensitive, all-word substring matching. */
export function filterPluginTemplates<T extends { id: string; name: string; description?: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = `${item.name} ${item.id} ${item.description ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

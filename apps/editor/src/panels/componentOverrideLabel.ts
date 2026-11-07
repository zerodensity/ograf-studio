/** Human-readable names for component overrides, including removed inherited keyframes. */
export function componentOverrideLabel(
  path: string,
  effects: readonly { id: string; name: string }[],
) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'keyframes' && parts[1]?.startsWith('@')) return 'Removed keyframe';
  return parts
    .map((part) => {
      const value = part.replaceAll('~1', '/').replaceAll('~0', '~');
      if (value.startsWith('@'))
        return effects.find((effect) => effect.id === value.slice(1))?.name ?? 'Effect';
      return value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replaceAll('-', ' ')
        .replace(/^[a-z]/, (letter) => letter.toUpperCase());
    })
    .filter((part) => part !== 'Stack' && part !== 'Params')
    .join(' · ');
}

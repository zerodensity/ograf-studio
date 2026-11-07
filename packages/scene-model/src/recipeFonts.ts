import { RECIPE_ROBOTO_CONDENSED } from './generatedRecipeFonts';
import { walkElementContents } from './ticker';
import type { Composition, Layer } from './types';

function fontFamilies(value: string): string[] {
  return value.split(',').map((family) =>
    family
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .toLowerCase(),
  );
}

/** Embed the recipe's font before componentization, preserving user-supplied family resources. */
export function ensureRecipeFonts(composition: Composition, layers: readonly Layer[]): void {
  const family = RECIPE_ROBOTO_CONDENSED.fontFamily!.toLowerCase();
  const usesFamily = layers.some((layer) =>
    walkElementContents(layer.element).some(
      (element) =>
        element.type === 'text' &&
        [element.fontFamily, ...(element.runs ?? []).flatMap((run) => run.fontFamily ?? [])].some(
          (stack) => fontFamilies(stack).includes(family),
        ),
    ),
  );
  if (!usesFamily) return;
  if (
    composition.assets.some(
      (asset) =>
        asset.kind === 'font' &&
        (asset.fontStyle ?? 'normal') === 'normal' &&
        fontFamilies(asset.fontFamily || asset.name.replace(/\.[^.]+$/, '')).includes(family),
    )
  )
    return;

  const font = { ...RECIPE_ROBOTO_CONDENSED };
  let suffix = 2;
  while (composition.assets.some((asset) => asset.id === font.id))
    font.id = `${RECIPE_ROBOTO_CONDENSED.id}-${suffix++}`;
  composition.assets.push(font);
}

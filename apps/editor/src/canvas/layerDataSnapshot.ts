import type { LayerBinding, VisualRuleEffect } from '@ograf-editor/scene-model';
import type { TestValue } from '../state/testDataStore';

export const EMPTY_LAYER_RULE_EFFECT: VisualRuleEffect = { properties: {}, transitionFrames: {} };

/** Bindings only read their own fields; unrelated feed values must not invalidate their content. */
export function stableLayerBindingValues(
  previous: Record<string, TestValue>,
  bindings: readonly LayerBinding[],
  values: Record<string, TestValue>,
): Record<string, TestValue> {
  const ids = [...new Set(bindings.map((binding) => binding.fieldId))].filter((id) =>
    Object.hasOwn(values, id),
  );
  if (
    Object.keys(previous).length === ids.length &&
    ids.every((id) => Object.hasOwn(previous, id) && Object.is(previous[id], values[id]))
  )
    return previous;
  return Object.fromEntries(ids.map((id) => [id, values[id]!]));
}

function sameProperties(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]))
  );
}

/** Cross-object Rules still evaluate globally; only an actually changed result invalidates a node. */
export function stableLayerRuleEffect(
  previous: VisualRuleEffect,
  next: VisualRuleEffect | undefined,
): VisualRuleEffect {
  const resolved = next ?? EMPTY_LAYER_RULE_EFFECT;
  return previous === resolved ||
    (previous.visibility === resolved.visibility &&
      sameProperties(previous.properties, resolved.properties) &&
      sameProperties(previous.transitionFrames, resolved.transitionFrames))
    ? previous
    : resolved;
}

import { describe, expect, it } from 'vitest';
import { createLayerModifier, createTextLayer, modifierProperty } from '@ograf-editor/scene-model';
import { bindableProperties } from './dataBinding';
import { createNextBinding, nextBindingProperty } from './bindingFieldCreation';

describe('Modifier controls in the existing Properties binding workflow', () => {
  it('lists readable numeric targets with stable paths and seeds new fields from authored values', () => {
    const layer = createTextLayer();
    const modifier = createLayerModifier('max-text-width', { maxWidth: 725 });
    layer.modifiers = [modifier];
    const property = modifierProperty(modifier, 'maxWidth');
    const options = bindableProperties(layer.element, layer.effects, layer.modifiers);
    expect(options).toContainEqual({ value: property, label: 'Max Text Width · Maximum Width' });
    // Exhaust the unrelated controls to exercise the ordinary + Add Binding path, not just
    // the exact shortcut provided beside each modifier control.
    layer.bindings = options
      .filter((option) => !option.value.startsWith('modifiers.'))
      .map((option) => ({ fieldId: 'already-bound', targetProperty: option.value }));
    expect(nextBindingProperty(layer)?.value).toBe(property);
    const created = createNextBinding(layer, []);
    expect(created?.binding.targetProperty).toBe(property);
    expect(created?.field).toMatchObject({ type: 'number', defaultValue: 725 });
  });
});

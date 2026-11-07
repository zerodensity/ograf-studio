import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFieldDefinition, createTextLayer } from '@ograf-editor/scene-model';
import { inlineTextEditTarget } from './inlineTextEditing';

describe('inline text editing target', () => {
  it('edits authored text when content is unbound', () => {
    expect(inlineTextEditTarget(createTextLayer(), [])).toEqual({ type: 'authored' });
  });

  it('keeps inline authored editing available for a simple content binding', () => {
    const layer = createTextLayer(),
      field = createFieldDefinition('text', { key: 'headline', label: 'Headline' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    expect(inlineTextEditTarget(layer, [field])).toEqual({
      type: 'bound',
      fieldId: field.id,
      label: 'Headline',
    });
  });

  it('keeps nested and mapped text bindings editable', () => {
    const layer = createTextLayer(),
      field = createFieldDefinition('object', { key: 'player' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    expect(inlineTextEditTarget(layer, [field])).toMatchObject({
      type: 'bound',
      fieldId: field.id,
    });
    layer.bindings[0]!.valueMap = { player: 'Player name' };
    expect(inlineTextEditTarget(layer, [field])).toMatchObject({
      type: 'bound',
      fieldId: field.id,
    });
    layer.isLocked = true;
    expect(inlineTextEditTarget(layer, [field])).toBeNull();
  });
});

describe('authored text canvas styles', () => {
  it('keeps Typewriter spans outside the compact Studio UI typography', () => {
    const css = readFileSync(new URL('./LayerNode.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /#root \.layer-content-host \[data-ograf-text-flow\][\s\S]*font-family:\s*inherit;[\s\S]*font-size:\s*inherit;/,
    );
  });
});

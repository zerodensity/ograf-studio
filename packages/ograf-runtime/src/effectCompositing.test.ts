import { describe, expect, it } from 'vitest';
import { addEffect, createLayerOfKind, updateEffect } from '@ograf-editor/scene-model';
import { applyLayerEffectsFilter } from './effectCompositing';

function hostFixture() {
  let allocated = 0;
  class Node {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    children: Node[] = [];
    parentNode: Node | null = null;
    id = '';
    innerHTML = '';
    clientWidth = 100;
    clientHeight = 60;
    ownerDocument = {
      createElementNS: () => {
        allocated++;
        return new Node();
      },
    };
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    appendChild(node: Node) {
      node.remove();
      this.children.push(node);
      node.parentNode = this;
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
      this.parentNode = null;
    }
  }
  const host = new Node();
  host.style.width = '100px';
  host.style.height = '60px';
  return {
    host,
    allocated: () => allocated,
    apply: (effects: ReturnType<typeof createLayerOfKind>['effects']) =>
      applyLayerEffectsFilter(host as unknown as HTMLElement, effects),
  };
}
describe('effect filter lifecycle', () => {
  it('allocates nothing for bypass, reuses a graph, sizes its bounds, then removes it', () => {
    const fixture = hostFixture(),
      layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    const effect = addEffect(layer, 'blur');
    fixture.apply(layer.effects);
    expect(fixture.allocated()).toBe(0);
    expect(fixture.host.style.filter).toBe('none');
    updateEffect(layer, effect.id, { blendMode: 'screen', params: { radius: 8 } });
    fixture.apply(layer.effects);
    const svg = fixture.host.children[0]!,
      filter = svg.children[0]!;
    expect(filter.attributes.get('width')).toBe('150');
    fixture.host.style.width = '200px';
    fixture.apply(layer.effects);
    expect(filter.attributes.get('width')).toBe('250');
    expect(fixture.allocated()).toBe(2);
    updateEffect(layer, effect.id, { blendMode: 'normal' });
    fixture.apply(layer.effects);
    expect(fixture.host.style.filter).toBe('blur(8px)');
    expect(fixture.host.children).toHaveLength(0);
    updateEffect(layer, effect.id, { enabled: false });
    fixture.apply(layer.effects);
    expect(fixture.host.style.filter).toBe('none');
    expect(fixture.allocated()).toBe(2);
  });
});

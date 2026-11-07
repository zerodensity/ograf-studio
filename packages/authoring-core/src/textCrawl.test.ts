import { describe, expect, it } from 'vitest';
import { createProject, createTextLayer } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

describe('editable continuous text crawl', () => {
  it('merges partial settings, validates them, disables with null and restores through undo', () => {
    const project = createProject();
    const text = createTextLayer();
    project.compositions[0]!.layers.push(text);
    const session = new AuthoringSession(project);
    const edit = (patch: Record<string, unknown>) =>
      session.apply({
        expectedRevision: session.snapshot().revision,
        operations: [{ type: 'update_element', layerId: text.id, patch }],
      });
    const element = () =>
      session.snapshot().project.compositions[0]!.layers.find((layer) => layer.id === text.id)!
        .element;
    edit({ crawl: { speedPixelsPerSecond: 90 } });
    expect(element()).toMatchObject({
      crawl: { speedPixelsPerSecond: 90, gap: 72, direction: 'left' },
    });
    edit({ crawl: { direction: 'right' } });
    expect(element()).toMatchObject({
      crawl: { speedPixelsPerSecond: 90, gap: 72, direction: 'right' },
    });
    expect(() => edit({ crawl: { gap: -1 } })).toThrow();
    edit({ crawl: null });
    expect(element()).not.toHaveProperty('crawl');
    session.undo(session.snapshot().revision);
    expect(element()).toMatchObject({ crawl: { direction: 'right', speedPixelsPerSecond: 90 } });
  });
});

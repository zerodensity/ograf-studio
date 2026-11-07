import { describe, expect, it } from 'vitest';
import { createProject, createTextElement } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';
import { renderCompositionFrameSvg } from './renderFrame';

describe('native ticker authoring operations', () => {
  it('creates a native ticker and retains editable mixed content through updates', () => {
    const session = new AuthoringSession(createProject());
    const items = [
      {
        id: 'headline',
        width: 500,
        element: createTextElement({ content: 'أخبار · Breaking news' }),
      },
    ];
    session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'ticker',
          id: 'native-ticker',
          element: {
            items,
            textDirection: 'rtl',
            speedPixelsPerSecond: 89.5,
            entryFade: 40,
            exitFade: 50,
          },
        },
      ],
    });
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_element',
          layerId: 'native-ticker',
          patch: { direction: 'right', gap: 80 },
        },
      ],
    });
    const ticker = session
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.id === 'native-ticker')!.element;
    expect(ticker).toMatchObject({
      type: 'ticker',
      direction: 'right',
      gap: 80,
      items,
      entryFade: 40,
      exitFade: 50,
    });
    const preview = renderCompositionFrameSvg(session.snapshot().project, undefined, 0).svg;
    expect(preview).toContain('Breaking news');
    expect(preview).toContain('ticker-clip');
    expect(preview).toContain('ticker-fade');
    expect(preview).toContain('direction="rtl"');
    expect(preview).not.toContain('undefined');
  });
  it('rejects invalid native ticker updates atomically', () => {
    const session = new AuthoringSession(createProject());
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'ticker', id: 'native-ticker' }],
    });
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'update_element', layerId: 'native-ticker', patch: { speedPixelsPerSecond: -1 } },
        ],
      }),
    ).toThrow();
    expect(session.snapshot()).toEqual(before);
  });
  it('rejects an unsupported nested element while creating a ticker', () => {
    const session = new AuthoringSession(createProject());
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'ticker',
            element: { items: [{ id: 'invalid', width: 100, element: { type: 'chart' } }] },
          },
        ],
      }),
    ).toThrow();
    expect(session.snapshot().revision).toBe(0);
  });
});

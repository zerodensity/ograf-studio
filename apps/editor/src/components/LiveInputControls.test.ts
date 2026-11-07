import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LiveInputControls } from './LiveInputControls';

vi.mock('./WebcamPreviewControls', () => ({
  WebcamPreviewControls: ({
    disabled,
    onBeforeStart,
  }: {
    disabled: boolean;
    onBeforeStart: () => boolean;
  }) => createElement('button', { disabled, 'data-direct-route': !!onBeforeStart }, 'Start webcam'),
}));

const render = (props: Partial<Parameters<typeof LiveInputControls>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LiveInputControls, {
      inputNames: ['TextureInput1', 'TextureInput2'],
      initialName: 'TextureInput1',
      onUse: vi.fn(() => true),
      ...props,
    }),
  );

describe('live input and webcam source controls', () => {
  it('offers input and webcam actions for the same selected object without a target picker', () => {
    const html = render({ destination: 'Rectangle' });
    expect(html).toContain('Use input here</button>');
    expect(html).toContain('Use TextureInput1 on Rectangle.');
    expect(html).toContain('data-direct-route="true"');
    expect(html).toContain('Start webcam');
    expect(html).not.toContain('Paint layer');
    expect(html).not.toContain('Video target');
  });
  it('identifies an input already routed to the selected object', () => {
    const html = render({ destination: 'Rectangle', currentName: 'TextureInput1' });
    expect(html).toContain('disabled="">Using input here</button>');
    expect(html).toContain('TextureInput1 → Rectangle');
  });
  it('requires a selected destination before input or camera redirection', () => {
    const html = render({ disabled: true });
    expect(html).toContain('Select one object to use a live input.');
    expect(html).toContain('disabled="">Use input here</button>');
    expect(html).toContain('disabled="" data-direct-route="true">Start webcam</button>');
  });
});

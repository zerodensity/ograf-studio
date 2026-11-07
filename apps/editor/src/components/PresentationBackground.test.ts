import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationBackgroundSettings } from '../state/presentationBackgroundStore';
import { PresentationBackground } from './PresentationBackground';
import { WebcamPresentationBackground } from './WebcamPresentationBackground';

const fixture = vi.hoisted(() => ({
  settings: { mode: 'none', imageSource: '', imageName: '' } as PresentationBackgroundSettings,
  failedSource: null as string | null,
  getUserMedia: vi.fn(),
  program: { background: 'document', videoUrl: '' },
}));
vi.mock('../state/presentationBackgroundStore', () => ({
  usePresentationBackgroundStore: (select: (state: typeof fixture) => unknown) => select(fixture),
}));
vi.mock('../state/programMonitorStore', () => ({ useProgramMonitorStore: () => fixture.program }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: () => ({ current: null }),
  useEffect: () => undefined,
  useState: () => [
    fixture.failedSource,
    (source: string | null) => (fixture.failedSource = source),
  ],
}));
vi.mock('./WebcamPresentationBackground', () => ({
  WebcamPresentationBackground: () => createElement('div', { 'data-passive-webcam': true }),
}));

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<{ children?: ReactNode }>(value)) return [];
  return [
    value as ReactElement<Record<string, unknown>>,
    ...[value.props.children].flat().flatMap(nodes),
  ];
}
function render() {
  return renderToStaticMarkup(createElement(PresentationBackground));
}

beforeEach(() => {
  fixture.settings = { mode: 'none', imageSource: '', imageName: '' };
  fixture.failedSource = null;
  fixture.program = { background: 'document', videoUrl: '' };
  fixture.getUserMedia.mockClear();
});

describe('shared presentation background rendering', () => {
  it('renders nothing for None even if an image is retained', () => {
    fixture.settings.imageSource = 'data:image/png;base64,aW1hZ2U=';
    expect(render()).toBe('');
  });

  it('renders the existing looping sample video with passive local controls', () => {
    fixture.settings.mode = 'big-buck-bunny';
    const html = render();
    expect(html).toContain('big-buck-bunny-1080p-60fps-30s@master/video.mp4');
    for (const attribute of ['loop=""', 'muted=""', 'playsInline=""', 'tabindex="-1"'])
      expect(html).toContain(attribute);
    expect(html).not.toContain(' controls');
  });

  it('renders a local program video independently of the document background', () => {
    fixture.program = { background: 'video', videoUrl: 'blob:local-video' };
    expect(render()).toContain('src="blob:local-video"');
    fixture.program = { background: 'black', videoUrl: '' };
    expect(render()).toContain('program-background-black');
  });

  it('renders checker and black beds without the canvas style overriding their colors or pattern', () => {
    const canvasStyle = readFileSync(new URL('../canvas/Stage.css', import.meta.url), 'utf8');
    const canvasRule = canvasStyle.match(/\.canvas-presentation-background\s*\{([^}]*)\}/)?.[1];
    expect(canvasRule).toBeDefined();
    expect(canvasRule).not.toMatch(/\bbackground(?:-[a-z-]+)?\s*:/);
    fixture.program = { background: 'checker', videoUrl: '' };
    expect(render()).toContain('program-background-checker');
    expect(
      renderToStaticMarkup(
        createElement(PresentationBackground, { className: 'canvas-presentation-background' }),
      ),
    ).toContain('canvas-presentation-background program-background-checker');
    fixture.program = { background: 'black', videoUrl: '' };
    expect(render()).toContain('program-background-black');
    expect(
      renderToStaticMarkup(
        createElement(PresentationBackground, { className: 'canvas-presentation-background' }),
      ),
    ).toContain('canvas-presentation-background program-background-black');
  });

  it('uses a bundled offline studio loop when selected', () => {
    fixture.program = { background: 'sample-news', videoUrl: '' };
    expect(render()).toContain('program-samples/news-studio.mp4');
    expect(render()).not.toContain('https://');
  });

  it('uses the same still image for a URL or embedded file and reports only its own load error', () => {
    fixture.settings = {
      mode: 'still-image',
      imageSource: 'https://example.com/first.png',
      imageName: '',
    };
    const image = nodes(PresentationBackground({})).find((node) => node.type === 'img')!;
    (image.props.onError as () => void)();
    expect(render()).toContain('Image could not be loaded');
    fixture.settings.imageSource = 'data:image/png;base64,aW1hZ2U=';
    const html = render();
    expect(html).toContain('src="data:image/png;base64,aW1hZ2U="');
    expect(html).not.toContain('Image could not be loaded');
    const next = nodes(PresentationBackground({})).find((node) => node.type === 'img')!;
    (next.props.onLoad as () => void)();
    expect(fixture.failedSource).toBeNull();
  });

  it('leaves an empty image absent and delegates webcam to the existing passive consumer only', () => {
    fixture.settings.mode = 'still-image';
    expect(render()).toBe('');
    fixture.settings.mode = 'webcam';
    const element = PresentationBackground({ className: 'canvas-presentation-background' });
    expect(element?.type).toBe(WebcamPresentationBackground);
    expect(element?.props.className).toContain('canvas-presentation-background');
  });
});

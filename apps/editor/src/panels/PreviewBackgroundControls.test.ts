import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationBackgroundSettings } from '../state/presentationBackgroundStore';
import { PreviewBackgroundControls } from './PreviewBackgroundControls';
import { WebcamPreviewControls } from '../components/WebcamPreviewControls';

const fixture = vi.hoisted(() => ({
  ownerKey: 'set:markets' as string | null,
  settings: { mode: 'none', imageSource: '', imageName: '' } as PresentationBackgroundSettings,
  storageError: null as string | null,
  storageStatus: 'saved',
  error: null as unknown,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  update: vi.fn(),
}));
vi.mock('../state/presentationBackgroundStore', () => ({
  usePresentationBackgroundStore: Object.assign(
    (select: (state: typeof fixture) => unknown) => select(fixture),
    { getState: () => fixture },
  ),
}));
vi.mock('../state/programMonitorStore', () => ({
  useProgramMonitorStore: () => ({
    background: 'document',
    videoUrl: '',
    videoName: '',
    titleSafe: false,
    actionSafe: false,
    aspectGuide: 'none',
    setBackground: vi.fn(),
    setVideo: vi.fn(),
    setGuides: vi.fn(),
  }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (initial: unknown) => {
    const index = fixture.refIndex++;
    return (fixture.refs[index] ??= { current: initial });
  },
  useState: () => [fixture.error, (error: unknown) => (fixture.error = error)],
}));
vi.mock('../components/WebcamPreviewControls', () => ({
  WebcamPreviewControls: () => createElement('button', null, 'Start webcam'),
}));

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<{ children?: ReactNode }>(value)) return [];
  return [
    value as ReactElement<Record<string, unknown>>,
    ...[value.props.children].flat().flatMap(nodes),
  ];
}
function render() {
  fixture.refIndex = 0;
  return PreviewBackgroundControls();
}
function input(label: string) {
  return nodes(render()).find((element) => element.props['aria-label'] === label)!;
}
function change(label: string, value: unknown) {
  const element = input(label);
  (element.props.onChange as (event: unknown) => void)({ target: { value } });
}
function importFile(file: { name: string; size: number; type: string }) {
  const element = input('Choose presentation image');
  (element.props.onChange as (event: unknown) => void)({ target: { files: [file], value: '' } });
}

const readers: FakeReader[] = [];
class FakeReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL = vi.fn(() => {
    readers.push(this);
  });
}
const png = { name: 'studio.png', type: 'image/png', size: 400 };
async function finishRead(source = 'data:image/png;base64,aW1hZ2U=') {
  const reader = readers.at(-1)!;
  reader.result = source;
  reader.onload?.();
  await Promise.resolve();
}

beforeEach(() => {
  fixture.ownerKey = 'set:markets';
  fixture.settings = { mode: 'none', imageSource: '', imageName: '' };
  fixture.storageError = null;
  fixture.storageStatus = 'saved';
  fixture.error = null;
  fixture.refs = [];
  fixture.refIndex = 0;
  readers.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('FileReader', FakeReader);
  fixture.update.mockImplementation(
    (patch: Partial<PresentationBackgroundSettings>, expected: string) => {
      if (expected !== fixture.ownerKey) return false;
      fixture.settings = { ...fixture.settings, ...patch };
      return true;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('shared background controls', () => {
  it('shows the selected source controls without another source selector or program guides in compact mode', () => {
    fixture.settings.mode = 'webcam';
    fixture.refIndex = 0;
    const tree = PreviewBackgroundControls({ compact: true, initiallyOpen: true });
    expect(tree.props.open).toBe(true);
    expect(nodes(tree).some((item) => item.type === WebcamPreviewControls)).toBe(true);
    expect(nodes(tree).some((item) => item.props['aria-label'] === 'Presentation background')).toBe(
      false,
    );
    expect(nodes(tree).some((item) => item.props['aria-label'] === 'Program aspect guide')).toBe(
      false,
    );
    expect(renderToStaticMarkup(tree)).not.toContain('Program guides');
  });

  it('records explicit Start intent before capture and rejects an outdated document owner', () => {
    fixture.settings.mode = 'webcam';
    fixture.storageStatus = 'loading';
    const camera = nodes(render()).find((item) => item.type === WebcamPreviewControls)!;
    const beforeStart = camera.props.onBeforeStart as () => boolean;
    expect(beforeStart()).toBe(true);
    expect(fixture.update).toHaveBeenLastCalledWith({ mode: 'webcam' }, 'set:markets');
    fixture.ownerKey = 'set:other';
    expect(beforeStart()).toBe(false);
  });

  it('starts collapsed with all four modes and selecting webcam never starts capture', () => {
    const capture = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } });
    const tree = render();
    expect(tree.props.open).toBeUndefined();
    expect(
      nodes(input('Presentation background'))
        .filter((item) => item.type === 'option')
        .map((item) => item.props.value),
    ).toEqual([
      'none',
      'big-buck-bunny',
      'still-image',
      'webcam',
      'program:black',
      'program:checker',
      'program:video',
      'program:sample-news',
      'program:sample-entertainment',
    ]);
    change('Presentation background', 'webcam');
    expect(fixture.update).toHaveBeenLastCalledWith({ mode: 'webcam' }, 'set:markets');
    expect(capture).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(render())).toContain('Start webcam');
    change('Presentation background', 'none');
    expect(fixture.update).toHaveBeenLastCalledWith({ mode: 'none' }, 'set:markets');
  });

  it('changes URL and clears the previous embedded file name without touching the document', () => {
    fixture.settings = {
      mode: 'still-image',
      imageSource: 'data:image/png;base64,old',
      imageName: 'old.png',
    };
    expect(input('Presentation image URL').props.value).toBe('');
    change('Presentation image URL', 'https://example.com/new.png');
    expect(fixture.update).toHaveBeenLastCalledWith(
      { imageSource: 'https://example.com/new.png', imageName: '' },
      'set:markets',
    );
  });

  it('rejects non-images and files above 10 MiB before reading them', () => {
    fixture.settings.mode = 'still-image';
    importFile({ ...png, type: 'application/javascript' });
    expect(fixture.error).toMatchObject({ message: 'Choose a supported image file.' });
    importFile({ ...png, size: 10 * 1024 * 1024 + 1 });
    expect(fixture.error).toMatchObject({
      message: 'The presentation image must be 10 MB or smaller.',
    });
    expect(readers).toHaveLength(0);
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('imports a still image with its filename and contains FileReader failure', async () => {
    fixture.settings.mode = 'still-image';
    importFile(png);
    await finishRead();
    expect(fixture.update).toHaveBeenCalledWith(
      {
        mode: 'still-image',
        imageSource: 'data:image/png;base64,aW1hZ2U=',
        imageName: 'studio.png',
      },
      'set:markets',
    );
    importFile(png);
    readers.at(-1)!.onerror?.();
    await Promise.resolve();
    expect(fixture.error).toMatchObject({ message: 'Failed to read the image.' });
  });

  it('records the explicit image selection before reading, so pending hydration cannot replace it', async () => {
    fixture.settings.mode = 'still-image';
    fixture.storageStatus = 'loading';
    const inheritedSettings = fixture.settings;
    importFile(png);
    expect(readers).toHaveLength(1);
    expect(fixture.update).toHaveBeenCalledExactlyOnceWith({ mode: 'still-image' }, 'set:markets');
    expect(fixture.update.mock.invocationCallOrder[0]).toBeLessThan(
      readers[0]!.readAsDataURL.mock.invocationCallOrder[0]!,
    );
    expect(fixture.settings).not.toBe(inheritedSettings);
    await finishRead();
    expect(fixture.settings.imageName).toBe('studio.png');
    expect(fixture.settings.imageSource).toBe('data:image/png;base64,aW1hZ2U=');
  });

  it('guards a delayed import against switching documents or a newer background edit', async () => {
    fixture.settings.mode = 'still-image';
    importFile(png);
    fixture.ownerKey = 'set:other';
    await finishRead();
    expect(fixture.settings.imageSource).toBe('');
    expect(fixture.update).toHaveBeenLastCalledWith(expect.any(Object), 'set:markets');
    fixture.ownerKey = 'set:markets';
    fixture.update.mockClear();
    importFile(png);
    change('Presentation image URL', 'https://example.com/newer.png');
    fixture.update.mockClear();
    await finishRead();
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.settings.imageSource).toBe('https://example.com/newer.png');
  });

  it('ignores an older import after a newer selection, including another controls surface', async () => {
    fixture.settings.mode = 'still-image';
    importFile(png);
    const first = readers[0]!;
    importFile({ ...png, name: 'newer.png' });
    fixture.update.mockClear();
    first.result = 'data:image/png;base64,old';
    first.onload?.();
    await Promise.resolve();
    expect(fixture.update).not.toHaveBeenCalled();
    await finishRead('data:image/png;base64,new');
    expect(fixture.settings.imageName).toBe('newer.png');
    importFile(png);
    fixture.settings = { ...fixture.settings, mode: 'none' };
    fixture.update.mockClear();
    await finishRead();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('does not claim persisted settings when local storage failed', () => {
    fixture.storageStatus = 'session-only';
    fixture.storageError = 'Could not save the background locally.';
    const html = renderToStaticMarkup(render());
    expect(html).toContain('Could not save the background locally.');
    expect(html).not.toContain('Saved in this browser.');
  });
});

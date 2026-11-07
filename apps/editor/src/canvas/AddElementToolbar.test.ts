import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';

const fixture = vi.hoisted(() => ({
  composition: null as any,
  selection: [] as string[],
  backdrop: { mode: 'dark', color: '#30343b', showPresentation: true, setBackdrop: () => {} },
  presentation: {
    ownerKey: 'project:test',
    settings: { mode: 'none', imageSource: '', imageName: '' },
    update: () => true,
  },
  program: { background: 'document', setBackground: () => {} },
}));
vi.mock('../state/canvasBackdropStore', () => ({ useCanvasBackdropStore: () => fixture.backdrop }));
vi.mock('../state/presentationBackgroundStore', () => ({
  usePresentationBackgroundStore: () => fixture.presentation,
}));
vi.mock('../state/programMonitorStore', () => ({ useProgramMonitorStore: () => fixture.program }));
vi.mock('../state/projectStore', () => ({
  useActiveComposition: () => fixture.composition,
  useProjectStore: (selector: (state: any) => unknown) =>
    selector(new Proxy({}, { get: () => () => {} })),
}));
vi.mock('../state/selectionStore', () => ({
  useSelectionStore: (selector: (state: any) => unknown) =>
    selector({ selectedLayerIds: fixture.selection, select: () => {}, selectMany: () => {} }),
}));
vi.mock('../state/timelineStore', () => ({
  useTimelineStore: (selector: (state: any) => unknown) => selector({ currentFrame: 0 }),
}));
vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (callback: () => unknown) => callback(),
}));

import { AddElementToolbar } from './AddElementToolbar';

describe('add element toolbar', () => {
  beforeEach(() => {
    fixture.composition = createProject().compositions[0]!;
    fixture.selection = [];
    fixture.backdrop = {
      mode: 'dark',
      color: '#30343b',
      showPresentation: true,
      setBackdrop: () => {},
    };
    fixture.presentation = {
      ownerKey: 'project:test',
      settings: { mode: 'none', imageSource: '', imageName: '' },
      update: () => true,
    };
    fixture.program = { background: 'document', setBackground: () => {} };
  });

  it('does not show the Design and Animate view buttons', () => {
    const markup = renderToStaticMarkup(createElement(AddElementToolbar));
    expect(markup).not.toContain('canvas-view-toggle');
    expect(markup).not.toContain('Design on the first on-air Step');
    expect(markup).not.toContain('Animate at the playhead');
    expect(markup).toContain('Add broadcast recipe');
  });

  it('keeps canvas zoom out of the top toolbar', () => {
    const html = renderToStaticMarkup(createElement(AddElementToolbar));
    expect(html).not.toContain('aria-label="Canvas zoom"');
  });

  it('keeps a reserved action slot and offers local and shared presentation sources', () => {
    const render = () => renderToStaticMarkup(createElement(AddElementToolbar));
    const dark = render();
    expect(dark).toContain('canvas-backdrop-action-slot');
    for (const label of [
      'Dark checker',
      'Light checker',
      'Solid backdrop',
      'Big Buck Bunny',
      'Still image',
      'Webcam',
      'Local video',
    ])
      expect(dark).toContain(label);
    expect(dark).not.toContain('<optgroup');
    for (const label of [
      '>Black</option>',
      '>Checkerboard</option>',
      'News studio',
      'Entertainment studio',
    ])
      expect(dark).not.toContain(label);
    fixture.backdrop.mode = 'solid';
    fixture.backdrop.showPresentation = false;
    const solid = render();
    expect(solid).toContain('canvas-backdrop-action-slot');
    expect(solid).toContain('canvas-backdrop-color');
    fixture.backdrop.showPresentation = true;
    fixture.presentation.settings.mode = 'webcam';
    const webcam = render();
    expect(webcam).toContain('canvas-backdrop-action-slot');
    expect(webcam).toContain('Presentation background settings');
    expect(webcam).not.toContain('canvas-backdrop-color');
    fixture.program.background = 'checker';
    const following = render();
    expect(following).toContain('value="presentation:follow-preview" selected=""');
    expect(following).toContain('Follow preview');
    expect(following).not.toContain('>Checkerboard</option>');
    fixture.backdrop.showPresentation = false;
    const localWithSavedPreview = render();
    expect(localWithSavedPreview).toContain('value="presentation:follow-preview"');
    expect(localWithSavedPreview).not.toContain('value="presentation:follow-preview" selected=""');
  });

  it('keeps add buttons in the same order and position when a layer is selected', () => {
    const layer = createLayerOfKind('text');
    fixture.composition.layers.push(layer);
    const empty = renderToStaticMarkup(createElement(AddElementToolbar));
    fixture.selection = [layer.id];
    const selected = renderToStaticMarkup(createElement(AddElementToolbar));
    const tools = (html: string) =>
      [...html.matchAll(/aria-label="(Add [^"]+)"/g)].map((match) => match[1]);
    expect(tools(selected)).toEqual(tools(empty));
    expect(empty.indexOf('aria-label="Add Text"')).toBe(selected.indexOf('aria-label="Add Text"'));
    expect(empty).toMatch(/<button[^>]*disabled[^>]*>Repeat…<\/button>/);
  });
});

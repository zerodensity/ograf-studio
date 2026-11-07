import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramGuidesView } from '../components/ProgramGuides';
import { useProgramMonitorStore } from './programMonitorStore';
import { createProject } from '@ograf-editor/scene-model';
import { buildExportArtifacts } from './exportPackage';

describe('program monitor preferences', () => {
  afterEach(() => {
    useProgramMonitorStore.setState({
      background: 'document',
      videoUrl: '',
      videoName: '',
      titleSafe: false,
      actionSafe: false,
      aspectGuide: 'none',
      fpsOverlay: true,
    });
    vi.restoreAllMocks();
  });
  it('draws safe-area and aspect guides without adding graphic content', () => {
    useProgramMonitorStore
      .getState()
      .setGuides({ titleSafe: true, actionSafe: true, aspectGuide: '4:3' });
    const html = renderToStaticMarkup(
      createElement(ProgramGuidesView, {
        width: 1920,
        height: 1080,
        ...useProgramMonitorStore.getState(),
      }),
    );
    expect(html).toContain('Program monitor guides');
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html).toContain('x="240"');
  });
  it('releases a previous video URL when another local video is selected', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const first = new File(['a'], 'first.mp4', { type: 'video/mp4' });
    const second = new File(['b'], 'second.mp4', { type: 'video/mp4' });
    useProgramMonitorStore.getState().setVideo(first);
    useProgramMonitorStore.getState().setVideo(second);
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:first');
    expect(useProgramMonitorStore.getState()).toMatchObject({
      background: 'video',
      videoName: 'second.mp4',
      videoUrl: 'blob:second',
    });
  });
  it('keeps monitor backgrounds and guides out of generated OGraf artifacts', () => {
    const project = createProject();
    const before = buildExportArtifacts(project, project.compositions[0]!);
    useProgramMonitorStore.getState().setBackground('sample-news');
    useProgramMonitorStore.getState().setGuides({ titleSafe: true, aspectGuide: '4:3' });
    useProgramMonitorStore.getState().setFpsOverlay(false);
    const after = buildExportArtifacts(project, project.compositions[0]!);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('program-samples');
  });

  it('enables FPS chrome by default and toggles it without changing program guides', () => {
    expect(useProgramMonitorStore.getState().fpsOverlay).toBe(true);
    useProgramMonitorStore.getState().setFpsOverlay(false);
    expect(useProgramMonitorStore.getState()).toMatchObject({
      fpsOverlay: false,
      titleSafe: false,
      actionSafe: false,
      aspectGuide: 'none',
    });
    useProgramMonitorStore.getState().setFpsOverlay(true);
    expect(useProgramMonitorStore.getState().fpsOverlay).toBe(true);
  });
});

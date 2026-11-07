import { afterAll, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useImportReportStore } from './importReportStore';
import { openStartupImportedGraphic } from './startupImport';
import { createProjectSet } from './projectSet';

vi.stubGlobal('window', { clearTimeout });
afterAll(() => vi.unstubAllGlobals());

describe('start screen graphic import', () => {
  it('opens the recovered project and surfaces its loss report', () => {
    const previous = createProject();
    useProjectStore.getState().loadProject(previous);
    useProjectSetStore.getState().setProjectSet(createProjectSet('Previous', previous));
    useSelectionStore.getState().select('old-layer');
    const project = createProject({ name: 'Recovered' });
    const report = {
      project,
      mode: 'manifest-only' as const,
      manifestFileName: 'graphic.ograf.json',
      warnings: ['Opaque script could not be recovered.'],
    };
    openStartupImportedGraphic(report);
    expect(useProjectStore.getState().project.name).toBe('Recovered');
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useSelectionStore.getState().selectedLayerId).toBeNull();
    expect(useImportReportStore.getState().report).toBe(report);
  });
});

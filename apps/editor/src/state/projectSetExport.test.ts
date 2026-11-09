import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldDefinition, createProject } from '@ograf-editor/scene-model';
import {
  getExportProfile,
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_LICENSE_TEXT,
} from '@ograf-editor/codegen';
import type { ExportArtifacts } from './ografCompatibility';

const mocks = vi.hoisted(() => ({
  createPackage: vi.fn(),
  createCoordinatedPackage: vi.fn(),
  createCoordinatedHtml: vi.fn(),
  saveBlob: vi.fn(),
  chooseWriter: vi.fn(),
}));

vi.mock('./exportPackage', () => ({
  createCertifiedProjectPackage: mocks.createPackage,
}));

vi.mock('./coordinatedExport', () => ({
  createCertifiedCoordinatedPackage: mocks.createCoordinatedPackage,
  createCertifiedCoordinatedHtml: mocks.createCoordinatedHtml,
}));

vi.mock('./certifiedArtifactSave', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./certifiedArtifactSave')>()),
  chooseCertifiedArtifactWriter: mocks.chooseWriter,
}));

// These tests cover the export transaction; history capture is not involved in exporting.
vi.mock('./historyStore', () => ({
  resetHistory: vi.fn(),
  runDiscreteHistoryStep: (change: () => void) => change(),
}));

vi.mock('./fileIO', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fileIO')>();
  return { ...actual, saveBlobToFile: mocks.saveBlob };
});

import { addProjectSetTemplate, createProjectSet } from './projectSet';
import {
  exportProjectSetAsZip,
  getCertifiedCoordinatedSaveSnapshot,
  retryCertifiedCoordinatedSave,
  subscribeCertifiedCoordinatedSave,
} from './projectSetExport';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import { useTransitionLogicDraftStore } from './transitionLogicDraftStore';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { exportFailure } from './certifiedArtifactSave';

function coordinatedFixture() {
  const set = createProjectSet('Evening News', createProject({ name: 'Correspondent' }));
  set.transitionLogic = createDefaultTransitionLogic(set);
  return set;
}

describe('template-set batch export', () => {
  beforeEach(() => {
    mocks.createPackage.mockReset();
    mocks.createCoordinatedPackage.mockReset();
    mocks.createCoordinatedHtml.mockReset();
    mocks.saveBlob.mockReset();
    mocks.chooseWriter.mockReset();
    mocks.chooseWriter.mockImplementation(
      async (name: string) => (blob: Blob) =>
        mocks.saveBlob(blob, name, [
          {
            description: 'Coordinated OGraf package',
            accept: { 'application/zip': ['.ograf.zip'] },
          },
        ]),
    );
    useTransitionLogicDraftStore.setState({ drafts: {} });
    useProjectSetStore.getState().clearProjectSet();
    mocks.saveBlob.mockResolvedValue('downloaded');
    mocks.createPackage.mockImplementation(async (project, composition) => ({
      artifacts: { transitionDescriptor: { templates: [] } } as unknown as ExportArtifacts,
      compatibility: { valid: true, errors: [], checks: [] },
      blob: new Blob([JSON.stringify({ project: project.name, composition: composition.name })]),
    }));
    mocks.createCoordinatedPackage.mockImplementation(async (set) => ({
      artifacts: {
        transitionDescriptor: { templates: set.templates },
        manifest: { name: set.name },
        mainJs: 'export default class {}',
        resources: [],
      } as unknown as ExportArtifacts,
      compatibility: { valid: true, errors: [], checks: [] },
      blob: new Blob(['coordinated package']),
    }));
  });

  it('exports one standalone package per resolved template and includes an index', async () => {
    const first = createProject({ name: 'News' });
    const second = createProject({ name: 'Sports' });
    const firstComposition = first.compositions[0]!;
    const secondComposition = second.compositions[0]!;
    const firstField = createFieldDefinition('text', {
      id: 'news-headline',
      key: 'headline',
      label: 'Headline',
      defaultValue: 'Local news',
    });
    const secondField = createFieldDefinition('text', {
      id: 'sports-title',
      key: 'title',
      label: 'Title',
      defaultValue: 'Local sports',
    });
    firstComposition.dataFields.push(firstField);
    secondComposition.dataFields.push(secondField);

    let set = createProjectSet('Evening', first);
    const newsId = set.templates[0]!.id;
    set = addProjectSetTemplate(set, second);
    const sportsId = set.templates[1]!.id;
    set.controls.push({
      field: { ...firstField, id: 'shared-headline' },
      value: 'Shared headline',
      bindings: [
        {
          templateId: newsId,
          compositionId: firstComposition.id,
          fieldId: firstField.id,
          inherit: true,
        },
        {
          templateId: sportsId,
          compositionId: secondComposition.id,
          fieldId: secondField.id,
          inherit: true,
        },
      ],
    });

    const result = await exportProjectSetAsZip(set);
    expect(result.mode).toBe('independent');
    expect(result.saveResult).toBe('downloaded');
    expect(result.templates).toHaveLength(2);
    expect(mocks.createPackage).toHaveBeenCalledTimes(2);
    expect(mocks.createPackage.mock.calls[0]![0].compositions[0]!.dataFields[0]!.defaultValue).toBe(
      'Shared headline',
    );
    expect(mocks.createPackage.mock.calls[1]![0].compositions[0]!.dataFields[0]!.defaultValue).toBe(
      'Shared headline',
    );

    const blob = mocks.saveBlob.mock.calls[0]![0] as Blob;
    const outer = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await outer.file(STUDIO_RUNTIME_LICENSE_PATH)!.async('string')).toBe(
      STUDIO_RUNTIME_LICENSE_TEXT,
    );
    const index = JSON.parse(await outer.file('set-export.json')!.async('string')) as {
      studioRuntimeLicense: string;
      templates: Array<{ name: string; packagePath: string }>;
    };
    expect(index.studioRuntimeLicense).toBe(STUDIO_RUNTIME_LICENSE_PATH);
    expect(index.templates.map((item) => item.name)).toEqual(['News', 'Sports']);
    for (const template of index.templates) expect(outer.file(template.packagePath)).not.toBeNull();
  });

  it('does not save a partial bundle when one template fails certification', async () => {
    const set = createProjectSet('Evening', createProject({ name: 'News' }));
    mocks.createPackage.mockRejectedValueOnce(new Error('Compatibility failed'));

    await expect(exportProjectSetAsZip(set)).rejects.toThrow(
      'Template "News" could not be certified',
    );
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('prepares an independent bundle before offering to save the certified archive', async () => {
    const set = addProjectSetTemplate(
      createProjectSet('Evening', createProject({ name: 'News' })),
      createProject({ name: 'Sports' }),
    );
    const ownerWindow = { closed: false } as Window;
    const stages: string[] = [];
    const result = await exportProjectSetAsZip(set, undefined, {
      ownerWindow,
      prepareOnly: true,
      onProgress: (stage) => stages.push(stage),
    });
    expect(result).toMatchObject({
      mode: 'independent',
      saveResult: 'prepared',
      files: [{ format: 'zip', fileName: 'Evening.ograf-set.zip', saveResult: 'prepared' }],
    });
    expect(stages).toEqual(['template 1 of 2', 'template 2 of 2', 'packaging', 'ready']);
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      fileName: 'Evening.ograf-set.zip',
      templateCount: 2,
      ownerWindow,
      needsSave: true,
    });

    set.name = 'Later source edit';
    await expect(retryCertifiedCoordinatedSave()).resolves.toMatchObject({
      fileName: 'Evening.ograf-set.zip',
      saveResult: 'downloaded',
    });
    expect(mocks.chooseWriter).toHaveBeenCalledExactlyOnceWith('Evening.ograf-set.zip', {
      ownerWindow,
      fileTypes: [
        {
          description: 'OGraf template set export',
          accept: { 'application/zip': ['.ograf-set.zip'] },
        },
      ],
    });
    expect(mocks.createPackage).toHaveBeenCalledTimes(2);
    const blob = mocks.saveBlob.mock.calls[0]![0] as Blob;
    const outer = await JSZip.loadAsync(await blob.arrayBuffer());
    const index = JSON.parse(await outer.file('set-export.json')!.async('string'));
    expect(index).toMatchObject({ name: 'Evening', templates: result.templates });
  });

  it('routes applied Transition Logic to one coordinated package and forwards the profile', async () => {
    const set = coordinatedFixture();
    const profile = getExportProfile('non-realtime');
    const result = await exportProjectSetAsZip(set, profile);

    expect(mocks.createPackage).not.toHaveBeenCalled();
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledExactlyOnceWith(set, profile);
    expect(mocks.createCoordinatedPackage.mock.calls[0]![0]).not.toBe(set);
    expect(result).toMatchObject({
      mode: 'coordinated',
      fileName: 'Evening-News-non-realtime.ograf.zip',
      saveResult: 'downloaded',
      certifications: [],
      compatibility: { valid: true },
      templates: [{ id: set.templates[0]!.id, packagePath: 'Evening-News-non-realtime.ograf.zip' }],
    });
    expect(mocks.saveBlob).toHaveBeenCalledWith(expect.any(Blob), result.fileName, [
      { description: 'Coordinated OGraf package', accept: { 'application/zip': ['.ograf.zip'] } },
    ]);
  });

  it('saves a coordinated HTML export through the HTML-only build and writer', async () => {
    const set = coordinatedFixture();
    const blob = new Blob(['<!doctype html>'], { type: 'text/html' });
    mocks.createCoordinatedHtml.mockResolvedValueOnce({
      artifacts: { transitionDescriptor: { templates: set.templates } },
      compatibility: { valid: true, errors: [], checks: [] },
      blob,
      fileName: 'Evening News.html',
    });

    const result = await exportProjectSetAsZip(set, undefined, { format: 'html' });
    expect(mocks.createCoordinatedPackage).not.toHaveBeenCalled();
    expect(mocks.chooseWriter).toHaveBeenCalledExactlyOnceWith('Evening News.html', {
      format: 'html',
    });
    expect(mocks.saveBlob.mock.calls[0]![0]).toBe(blob);
    expect(result.files).toEqual([
      { format: 'html', fileName: 'Evening News.html', saveResult: 'downloaded' },
    ]);
  });

  it('prepares a coordinated ZIP without opening the writer when requested', async () => {
    const ownerWindow = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: true } },
    } as unknown as Window;
    await expect(
      exportProjectSetAsZip(coordinatedFixture(), undefined, { ownerWindow, prepareOnly: true }),
    ).resolves.toMatchObject({ mode: 'coordinated', saveResult: 'prepared' });
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      fileName: 'Evening-News.ograf.zip',
      ownerWindow,
      needsSave: true,
    });
  });

  it('saves both files from one certified build with a fresh gesture per file', async () => {
    const result = await exportProjectSetAsZip(coordinatedFixture(), undefined, { format: 'both' });
    expect(result.saveResult).toBe('prepared');
    expect(result.files.map(({ format }) => format)).toEqual(['zip', 'html']);
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      format: 'zip',
      pendingFileCount: 2,
    });

    await expect(retryCertifiedCoordinatedSave()).resolves.toMatchObject({ format: 'zip' });
    const pendingHtml = getCertifiedCoordinatedSaveSnapshot();
    expect(pendingHtml).toMatchObject({ format: 'html', pendingFileCount: 1 });

    mocks.chooseWriter.mockRejectedValueOnce(
      exportFailure(new DOMException('Cancelled', 'AbortError'), 'picker'),
    );
    await expect(retryCertifiedCoordinatedSave()).rejects.toMatchObject({
      outcome: 'user-cancelled',
    });
    expect(mocks.saveBlob).toHaveBeenCalledOnce();
    expect(getCertifiedCoordinatedSaveSnapshot()).toBe(pendingHtml);

    await expect(retryCertifiedCoordinatedSave()).resolves.toMatchObject({ format: 'html' });
    const html = mocks.saveBlob.mock.calls[1]![0] as Blob;
    expect(await html.text()).toContain('<!doctype html>');
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
    expect(mocks.createCoordinatedHtml).not.toHaveBeenCalled();
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      needsSave: false,
      pendingFileCount: 0,
    });
  });

  it.each(['enable', 'modify', 'remove'] as const)(
    'blocks an unapplied %s draft before packaging or saving',
    async (change) => {
      const set = coordinatedFixture();
      const applied = change === 'enable' ? undefined : set.transitionLogic;
      if (change === 'enable') delete set.transitionLogic;
      const drafts = useTransitionLogicDraftStore.getState();
      drafts.sync(set.id, applied);
      if (change === 'remove') drafts.replace(set.id, null);
      else if (change === 'enable') drafts.replace(set.id, createDefaultTransitionLogic(set));
      else
        drafts.edit(set.id, (definition) => {
          definition.name = 'Unapplied';
        });

      await expect(exportProjectSetAsZip(set)).rejects.toThrow('unapplied edits');
      expect(mocks.createPackage).not.toHaveBeenCalled();
      expect(mocks.createCoordinatedPackage).not.toHaveBeenCalled();
      expect(mocks.saveBlob).not.toHaveBeenCalled();
      drafts.reset(set.id, set.transitionLogic);
      await expect(exportProjectSetAsZip(set)).resolves.toMatchObject({
        mode: change === 'enable' ? 'independent' : 'coordinated',
      });
    },
  );

  it('does not block another set when an unrelated set has a dirty draft', async () => {
    const unrelated = coordinatedFixture();
    const drafts = useTransitionLogicDraftStore.getState();
    drafts.sync(unrelated.id, unrelated.transitionLogic);
    drafts.replace(unrelated.id, null);
    await expect(exportProjectSetAsZip(coordinatedFixture())).resolves.toMatchObject({
      mode: 'coordinated',
    });
  });

  it('captures unsaved active-template edits once without changing the source or editor session', async () => {
    const set = coordinatedFixture();
    const template = set.templates[0]!;
    const edited = structuredClone(template.project);
    edited.name = 'Correspondent edited';
    edited.compositions[0]!.name = 'Unsaved artwork';
    useProjectSetStore.setState({ projectSet: set, activeTemplateId: template.id });
    useProjectStore.setState({ project: edited });
    const before = structuredClone(set);
    let release!: () => void;
    mocks.createCoordinatedPackage.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        artifacts: { transitionDescriptor: { templates: set.templates } },
        blob: new Blob(['package']),
        compatibility: { valid: true, errors: [], checks: [] },
      };
    });
    const pending = exportProjectSetAsZip(set);
    await Promise.resolve();
    const captured = mocks.createCoordinatedPackage.mock.calls[0]![0] as typeof set;
    expect(captured.templates[0]!.project.compositions[0]!.name).toBe('Unsaved artwork');
    expect(captured.templates[0]!.project).not.toBe(edited);
    const next = structuredClone(edited);
    next.compositions[0]!.name = 'Newer artwork';
    useProjectStore.setState({ project: next });
    release();
    await pending;

    expect(captured.templates[0]!.project.compositions[0]!.name).toBe('Unsaved artwork');
    expect(set).toEqual(before);
    expect(useProjectSetStore.getState().projectSet).toBe(set);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(template.id);
    expect(useProjectStore.getState().project).toBe(next);
  });

  it('ignores the current editor project when exporting an unrelated set', async () => {
    const active = coordinatedFixture();
    const other = coordinatedFixture();
    useProjectSetStore.setState({ projectSet: active, activeTemplateId: active.templates[0]!.id });
    useProjectStore.setState({
      project: { ...active.templates[0]!.project, name: 'Unrelated edits' },
    });
    await exportProjectSetAsZip(other);
    expect(mocks.createCoordinatedPackage.mock.calls[0]![0]).toEqual(other);
  });

  it('blocks concurrent exports and releases the lock after certification fails', async () => {
    let fail!: (reason: Error) => void;
    mocks.createCoordinatedPackage.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const set = coordinatedFixture();
    const pending = exportProjectSetAsZip(set);
    await Promise.resolve();
    await expect(exportProjectSetAsZip(set)).rejects.toThrow('already in progress');
    fail(new Error('Certification failed'));
    await expect(pending).rejects.toThrow('Certification failed');
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    await expect(exportProjectSetAsZip(set)).resolves.toMatchObject({ mode: 'coordinated' });
  });

  it.each(['coordinated', 'independent'] as const)(
    'cancels %s preparation without staging a file and permits another export after cleanup',
    async (mode) => {
      const set = coordinatedFixture();
      if (mode === 'independent') delete set.transitionLogic;
      const compile = mode === 'coordinated' ? mocks.createCoordinatedPackage : mocks.createPackage;
      const stagedBefore = getCertifiedCoordinatedSaveSnapshot();
      const controller = new AbortController();
      const reason = new DOMException('Export cancelled', 'AbortError');
      let finish!: () => void;
      compile.mockImplementationOnce(async () => {
        // Simulate a non-interruptible operation that finishes after the user cancels.
        await new Promise<void>((resolve) => (finish = resolve));
        return {
          artifacts: { transitionDescriptor: { templates: set.templates } },
          blob: new Blob(['late certified output']),
          compatibility: { valid: true, errors: [], checks: [] },
        };
      });

      const pending = exportProjectSetAsZip(set, undefined, {
        prepareOnly: true,
        signal: controller.signal,
      });
      expect(compile.mock.calls[0]!.at(-1)).toMatchObject({ signal: controller.signal });
      controller.abort(reason);
      await expect(exportProjectSetAsZip(set)).rejects.toThrow('already in progress');
      finish();
      await expect(pending).rejects.toBe(reason);
      expect(getCertifiedCoordinatedSaveSnapshot()).toBe(stagedBefore);
      expect(mocks.chooseWriter).not.toHaveBeenCalled();
      expect(mocks.saveBlob).not.toHaveBeenCalled();

      await expect(
        exportProjectSetAsZip(set, undefined, { prepareOnly: true }),
      ).resolves.toMatchObject({
        mode,
        saveResult: 'prepared',
      });
    },
  );

  it('does not start another independent template after preparation is cancelled', async () => {
    const set = addProjectSetTemplate(
      createProjectSet('Evening', createProject({ name: 'News' })),
      createProject({ name: 'Sports' }),
    );
    const controller = new AbortController();
    const reason = new DOMException('Export cancelled', 'AbortError');
    await expect(
      exportProjectSetAsZip(set, undefined, {
        signal: controller.signal,
        onProgress: (stage) => {
          if (stage === 'template 2 of 2') controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(mocks.createPackage).toHaveBeenCalledOnce();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('reports picker cancellation and permits another export', async () => {
    const set = coordinatedFixture();
    mocks.saveBlob.mockResolvedValueOnce('cancelled');
    await expect(exportProjectSetAsZip(set)).resolves.toMatchObject({ saveResult: 'cancelled' });
    await expect(exportProjectSetAsZip(set)).resolves.toMatchObject({ saveResult: 'downloaded' });
  });

  it('retries the same certified blob after a write failure without compiling newer artwork', async () => {
    const set = coordinatedFixture();
    mocks.saveBlob.mockRejectedValueOnce(new Error('write-failed: disk unavailable'));
    await expect(exportProjectSetAsZip(set)).rejects.toThrow('write-failed');
    const blob = mocks.saveBlob.mock.calls[0]![0];
    set.name = 'Newer source';
    await expect(retryCertifiedCoordinatedSave()).resolves.toMatchObject({
      fileName: 'Evening-News.ograf.zip',
    });
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
    expect(mocks.saveBlob.mock.calls[1]![0]).toBe(blob);
  });

  it('rejects an empty set before any compiler or file writer is called', async () => {
    const set = coordinatedFixture();
    set.templates = [];
    await expect(exportProjectSetAsZip(set)).rejects.toThrow('Insert a template');
    expect(mocks.createPackage).not.toHaveBeenCalled();
    expect(mocks.createCoordinatedPackage).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('does not open a destination while compilation and certification are pending', async () => {
    const set = coordinatedFixture();
    let finish!: () => void;
    mocks.createCoordinatedPackage.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (finish = resolve));
      return {
        artifacts: { transitionDescriptor: { templates: set.templates } },
        blob: new Blob(['complete certified package']),
        compatibility: { valid: true, errors: [], checks: [] },
      };
    });
    const pending = exportProjectSetAsZip(set);
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    finish();
    await expect(pending).resolves.toMatchObject({ saveResult: 'downloaded' });
    expect(mocks.chooseWriter).toHaveBeenCalledOnce();
  });

  it('rejects an empty generated package without creating a placeholder destination', async () => {
    const set = coordinatedFixture();
    mocks.createCoordinatedPackage.mockResolvedValueOnce({
      artifacts: { transitionDescriptor: { templates: set.templates } },
      blob: new Blob([]),
      compatibility: { valid: true, errors: [], checks: [] },
    });
    await expect(exportProjectSetAsZip(set)).rejects.toMatchObject({
      stage: 'packaging',
      outcome: 'packaging-failed',
      message: expect.stringContaining('No destination file was opened'),
    });
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('retains the complete package for a fresh Save click after user activation expires', async () => {
    const owner = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: false } },
      closed: false,
    } as unknown as Window;
    const set = coordinatedFixture();
    const progress = vi.fn();
    const prepared = await exportProjectSetAsZip(set, undefined, {
      ownerWindow: owner,
      onProgress: progress,
    });
    expect(prepared).toMatchObject({ saveResult: 'prepared', fileName: 'Evening-News.ograf.zip' });
    expect(progress).toHaveBeenCalledWith('ready');
    expect(mocks.chooseWriter).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    set.name = 'Source edited after preparation';
    await expect(retryCertifiedCoordinatedSave()).resolves.toMatchObject({
      saveResult: 'downloaded',
      fileName: prepared.fileName,
    });
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
    expect(mocks.chooseWriter).toHaveBeenCalledWith(prepared.fileName, { ownerWindow: owner });
    const written = mocks.saveBlob.mock.calls[0]![0] as Blob;
    expect(await written.text()).toBe('coordinated package');
  });

  it('lets an explicit Download click use the cached bytes in its chosen owner window', async () => {
    const originalOwner = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: false } },
      closed: false,
    } as unknown as Window;
    await exportProjectSetAsZip(coordinatedFixture(), undefined, { ownerWindow: originalOwner });
    const retryOwner = { closed: false } as Window;
    await retryCertifiedCoordinatedSave({ ownerWindow: retryOwner, downloadOnly: true });
    expect(mocks.chooseWriter).toHaveBeenCalledExactlyOnceWith('Evening-News.ograf.zip', {
      ownerWindow: retryOwner,
      downloadOnly: true,
    });
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
  });

  it('does not require a picker gesture for an explicitly requested download', async () => {
    const owner = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: false } },
    } as unknown as Window;
    await expect(
      exportProjectSetAsZip(coordinatedFixture(), undefined, {
        downloadOnly: true,
        ownerWindow: owner,
      }),
    ).resolves.toMatchObject({ saveResult: 'downloaded' });
    expect(mocks.chooseWriter).toHaveBeenCalledOnce();
  });

  it('keeps prepared bytes when a browser without activation introspection rejects the picker', async () => {
    mocks.chooseWriter.mockRejectedValueOnce(
      exportFailure(new DOMException('User activation required', 'SecurityError'), 'picker'),
    );
    await expect(exportProjectSetAsZip(coordinatedFixture())).resolves.toMatchObject({
      saveResult: 'prepared',
    });
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    await retryCertifiedCoordinatedSave();
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
    expect(mocks.saveBlob).toHaveBeenCalledOnce();
  });

  it('preserves picker cancellation without opening a writer or discarding the certified bytes', async () => {
    mocks.chooseWriter.mockRejectedValueOnce(
      exportFailure(new DOMException('Cancelled', 'AbortError'), 'picker'),
    );
    await expect(exportProjectSetAsZip(coordinatedFixture())).rejects.toMatchObject({
      outcome: 'user-cancelled',
      stage: 'picker',
    });
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    await retryCertifiedCoordinatedSave();
    expect(mocks.createCoordinatedPackage).toHaveBeenCalledOnce();
    expect(mocks.saveBlob).toHaveBeenCalledOnce();
  });

  it('publishes stable metadata for prepared packages and clears the prompt after an exact-byte save', async () => {
    const owner = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: false } },
    } as unknown as Window;
    const beforeRevision = getCertifiedCoordinatedSaveSnapshot()?.promptRevision ?? 0;
    const listener = vi.fn();
    const unsubscribe = subscribeCertifiedCoordinatedSave(listener);
    await exportProjectSetAsZip(coordinatedFixture(), undefined, { ownerWindow: owner });
    const prepared = getCertifiedCoordinatedSaveSnapshot();
    expect(prepared).toMatchObject({
      fileName: 'Evening-News.ograf.zip',
      byteLength: new Blob(['coordinated package']).size,
      templateCount: 1,
      ownerWindow: owner,
      promptRevision: beforeRevision + 1,
      needsSave: true,
    });
    expect(prepared).not.toHaveProperty('blob');
    expect(getCertifiedCoordinatedSaveSnapshot()).toBe(prepared);
    expect(listener).toHaveBeenCalledTimes(2);
    await retryCertifiedCoordinatedSave({ downloadOnly: true });
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      promptRevision: prepared!.promptRevision,
      needsSave: false,
    });
    const count = listener.mock.calls.length;
    unsubscribe();
    await exportProjectSetAsZip(coordinatedFixture());
    expect(listener).toHaveBeenCalledTimes(count);
  });

  it('does not create a new Save prompt after a successful direct export or Save again', async () => {
    const beforeRevision = getCertifiedCoordinatedSaveSnapshot()?.promptRevision ?? 0;
    await exportProjectSetAsZip(coordinatedFixture());
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      promptRevision: beforeRevision,
      needsSave: false,
    });
    await retryCertifiedCoordinatedSave();
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      promptRevision: beforeRevision,
      needsSave: false,
    });
  });

  it('keeps the ready prompt available after a failed Save and notifies for a newly prepared export', async () => {
    const owner = {
      showSaveFilePicker: vi.fn(),
      navigator: { userActivation: { isActive: false } },
    } as unknown as Window;
    await exportProjectSetAsZip(coordinatedFixture(), undefined, { ownerWindow: owner });
    const prepared = getCertifiedCoordinatedSaveSnapshot()!;
    mocks.saveBlob.mockRejectedValueOnce(new Error('Write failed'));
    await expect(retryCertifiedCoordinatedSave()).rejects.toThrow('Write failed');
    expect(getCertifiedCoordinatedSaveSnapshot()).toBe(prepared);
    await exportProjectSetAsZip(coordinatedFixture(), undefined, { ownerWindow: owner });
    expect(getCertifiedCoordinatedSaveSnapshot()).toMatchObject({
      promptRevision: prepared.promptRevision + 1,
      needsSave: true,
    });
  });
});

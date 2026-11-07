import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExportProfile, getOfflinePreviewFileName } from '@ograf-editor/codegen';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';

const mocks = vi.hoisted(() => ({ certify: vi.fn(), thumbnail: vi.fn() }));
vi.mock('./ografCompatibility', () => ({ certifyExportArtifacts: mocks.certify }));
// This assembly test isolates browser thumbnail rendering, not the certification/package gate.
vi.mock('./coordinatedThumbnail', () => ({ createCoordinatedThumbnail: mocks.thumbnail }));

import {
  buildCoordinatedProjectSetArtifacts,
  createCertifiedCoordinatedPackage,
} from './coordinatedExport';

describe('coordinated news package assembly', () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  beforeEach(() => {
    mocks.certify.mockReset();
    mocks.certify.mockResolvedValue({ valid: true, errors: [], checks: [] });
    mocks.thumbnail.mockReset();
    mocks.thumbnail.mockResolvedValue(new Blob([png], { type: 'image/png' }));
  });

  it('compiles the news templates and shared scene without mutating the editable set', () => {
    const set = createTransitionLogicNewsExample(1_760_000_000_000);
    const before = structuredClone(set);
    const artifacts = buildCoordinatedProjectSetArtifacts(set);
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.valid).toBe(true);
    expect(artifacts.transitionDescriptor).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 50,
      definition: set.transitionLogic,
    });
    expect(artifacts.transitionDescriptor!.templates.map((template) => template.id)).toEqual(
      set.templates.map((template) => template.id),
    );
    expect(artifacts.transitionDescriptor!.sharedInstances.map((instance) => instance.id)).toEqual(
      set.transitionLogic!.sharedInstances.map((instance) => instance.id),
    );
    expect(artifacts.mainJs).toContain('exportedTransitionDescriptor');
    expect(set).toEqual(before);
  });

  it('does not embed authoring-only rundown rows in coordinated artifacts', () => {
    const set = createTransitionLogicNewsExample(1_760_000_000_000);
    const before = buildCoordinatedProjectSetArtifacts(set);
    const composition = set.templates[0]!.project.compositions[0]!;
    composition.testRundowns = [
      {
        id: 'private',
        name: 'Private rehearsal',
        rows: [
          { id: 'row', values: { [composition.dataFields[0]!.id]: 'PRIVATE-ROW-DO-NOT-EXPORT' } },
        ],
      },
    ];
    const after = buildCoordinatedProjectSetArtifacts(set);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('PRIVATE-ROW-DO-NOT-EXPORT');
  });

  it('adds the offline preview while preserving the files accepted by certification', async () => {
    const set = createTransitionLogicNewsExample(1_760_000_000_000);
    const packaged = await createCertifiedCoordinatedPackage(set);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.certify).toHaveBeenCalledExactlyOnceWith(packaged.artifacts);
    const thumbnailPath = packaged.artifacts.manifest.thumbnails![0]!.file;
    expect(packaged.artifacts.resources).toContainEqual({
      path: thumbnailPath,
      data: Buffer.from(png).toString('base64'),
      base64: true,
    });
    const zip = await JSZip.loadAsync(await packaged.blob.arrayBuffer());
    const files = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name);
    expect(files.sort()).toEqual(
      [
        packaged.artifacts.manifestFileName,
        'main.js',
        getOfflinePreviewFileName(packaged.artifacts),
        ...packaged.artifacts.resources.map((resource) => resource.path),
      ].sort(),
    );
    expect(await zip.file('main.js')!.async('string')).toBe(packaged.artifacts.mainJs);
    expect(
      await zip.file(getOfflinePreviewFileName(packaged.artifacts))!.async('string'),
    ).toContain('<!doctype html>');
    expect(await zip.file(thumbnailPath)!.async('uint8array')).toEqual(png);
    expect(
      JSON.parse(await zip.file(packaged.artifacts.manifestFileName)!.async('string')),
    ).toEqual(packaged.artifacts.manifest);
    for (const resource of packaged.artifacts.resources) {
      expect(await zip.file(resource.path)!.async(resource.base64 ? 'base64' : 'string')).toBe(
        resource.data,
      );
    }
    expect(packaged.compatibility.valid).toBe(true);
  });

  it('applies an output profile to the compiled package without rewriting the project identity', () => {
    const set = createTransitionLogicNewsExample(1_760_000_000_000);
    const before = structuredClone(set);
    const artifacts = buildCoordinatedProjectSetArtifacts(set, getExportProfile('non-realtime'));
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.manifest).toMatchObject({
      id: `${set.id}-nrt`,
      supportsRealTime: false,
      supportsNonRealTime: true,
    });
    expect(set).toEqual(before);
  });

  it('includes an offline preview for non-realtime-only coordinated exports', async () => {
    const packaged = await createCertifiedCoordinatedPackage(
      createTransitionLogicNewsExample(),
      getExportProfile('non-realtime'),
    );
    const zip = await JSZip.loadAsync(await packaged.blob.arrayBuffer());
    expect(packaged.artifacts.manifest.supportsRealTime).toBe(false);
    expect(packaged.artifacts.manifest.supportsNonRealTime).toBe(true);
    expect(
      await zip.file(getOfflinePreviewFileName(packaged.artifacts))!.async('string'),
    ).toContain('<!doctype html>');
    expect(await zip.file('main.js')!.async('string')).toBe(packaged.artifacts.mainJs);
    expect(
      JSON.parse(await zip.file(packaged.artifacts.manifestFileName)!.async('string')),
    ).toEqual(packaged.artifacts.manifest);
  });

  it('rejects failed certification instead of producing a downloadable archive', async () => {
    mocks.certify.mockResolvedValue({
      valid: false,
      errors: ['Offline replay mismatch'],
      checks: [],
    });
    await expect(
      createCertifiedCoordinatedPackage(createTransitionLogicNewsExample()),
    ).rejects.toThrow(
      'Coordinated export blocked by OGraf compatibility gate: Offline replay mismatch',
    );
    expect(mocks.certify).toHaveBeenCalledTimes(1);
  });

  it('rejects thumbnail rendering failure before certification or packaging', async () => {
    mocks.thumbnail.mockRejectedValue(new Error('Thumbnail render failed'));
    const progress = vi.fn();
    await expect(
      createCertifiedCoordinatedPackage(createTransitionLogicNewsExample(), undefined, {
        onProgress: progress,
      }),
    ).rejects.toThrow('thumbnail-failed (thumbnail): Thumbnail render failed');
    expect(mocks.certify).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalledWith('packaging');
  });

  it('rejects unapplied definitions and missing templates before certification', async () => {
    const set = createTransitionLogicNewsExample();
    const withoutDefinition = structuredClone(set);
    delete withoutDefinition.transitionLogic;
    await expect(createCertifiedCoordinatedPackage(withoutDefinition)).rejects.toThrow(
      'Set up and apply playout transitions',
    );
    set.templates = [];
    await expect(createCertifiedCoordinatedPackage(set)).rejects.toThrow('Insert a template');
    expect(mocks.certify).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { getExportProfile, projectForExportProfile } from './exportProfiles';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { discoveryModuleErrors } from './discovery';
import { validateManifest } from '@ograf-editor/validation';

describe('export profiles', () => {
  it.each([
    ['realtime', true, false, '-rt'],
    ['non-realtime', false, true, '-nrt'],
    ['dual', true, true, ''],
  ] as const)('derives %s output without mutating source', (id, realtime, nonRealtime, suffix) => {
    const source = createProject({
      id: 'news',
      supportsRealTime: false,
      supportsNonRealTime: true,
    });
    const output = projectForExportProfile(source, getExportProfile(id));
    expect(output).not.toBe(source);
    expect(output.id).toBe(`news${suffix}`);
    expect(output.supportsRealTime).toBe(realtime);
    expect(output.supportsNonRealTime).toBe(nonRealtime);
    expect(source).toMatchObject({
      id: 'news',
      supportsRealTime: false,
      supportsNonRealTime: true,
    });
    const artifacts = buildExportArtifactsWithRuntime(
      source,
      source.compositions[0]!,
      'class GraphicElement {}',
      getExportProfile(id),
    );
    expect(artifacts.valid, artifacts.errors.join('\n')).toBe(true);
    expect(artifacts.manifest.v_ografDiscovery).toEqual({ version: 1, kind: 'graphic' });
    expect(artifacts.manifest).not.toHaveProperty('v_ografTransitionLogic');
    expect(validateManifest(JSON.parse(JSON.stringify(artifacts.manifest))).valid).toBe(true);
    expect(discoveryModuleErrors(artifacts.manifest, class Graphic {})).toEqual([]);
  });
});

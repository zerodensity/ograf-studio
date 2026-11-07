import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createAsset,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import {
  ES_MODULE_LEXER_LICENSE,
  NOBLE_HASHES_LICENSE,
  RUNTIME_DEPENDENCY_LICENSES,
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_LICENSE_TEXT,
  STUDIO_RUNTIME_NOTICE,
} from './runtimeLicenses';

describe('bundled runtime dependency notices', () => {
  it('keeps the bundled Studio license byte-for-byte identical to the repository LICENSE', () => {
    const source = readFileSync(new URL('../../../LICENSE', import.meta.url));
    expect(Buffer.from(STUDIO_RUNTIME_LICENSE_TEXT, 'utf8')).toEqual(source);
  });

  it.each([
    STUDIO_RUNTIME_LICENSE_PATH,
    'LICENSES/ograf-studio-agpl-3.0.txt',
    'licenses/OGRAF-STUDIO-AGPL-3.0.txt/other.txt',
    'licenses',
  ])('refuses an asset that collides with the Studio license path: %s', (packagePath) => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.assets.push(
      createAsset({
        id: 'collision',
        name: 'collision',
        mimeType: 'text/plain',
        dataUri: 'data:text/plain,unrelated',
        packagePath,
      }),
    );
    expect(() =>
      buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}'),
    ).toThrow(/conflicts with the Studio runtime license path/);
  });

  it('retains exact installed upstream MIT notices including original UTF-8 punctuation', () => {
    expect(NOBLE_HASHES_LICENSE).toBe(
      readFileSync(new URL('../../../node_modules/@noble/hashes/LICENSE', import.meta.url), 'utf8'),
    );
    expect(ES_MODULE_LEXER_LICENSE).toBe(
      readFileSync(
        new URL('../../../node_modules/es-module-lexer/LICENSE', import.meta.url),
        'utf8',
      ),
    );
  });

  it.each(['no-chart', 'unassigned-chart', 'external-chart'] as const)(
    'distributes both mandatory notices in a %s export',
    (kind) => {
      const project = createProject();
      const composition = project.compositions[0]!;
      if (kind !== 'no-chart') {
        const layer = createChartLayer();
        layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
        if (kind === 'external-chart') {
          const plugin = createRendererPluginSnapshot({
            manifest: {
              schemaVersion: 1,
              apiVersion: 1,
              kind: 'chart',
              id: 'test.chart',
              version: '1.0.0',
              name: 'External',
              presets: ['bar'],
              license: 'MIT',
            },
            source: 'export default {};',
            licenseText: 'External provider notice',
          });
          if (layer.element.type !== 'chart') throw new Error('Expected chart');
          layer.element.provider = {
            id: plugin.manifest.id,
            version: plugin.manifest.version,
            sha256: plugin.sha256,
          };
          composition.rendererPlugins = [plugin];
        }
        composition.layers.push(layer);
      }
      const artifacts = buildExportArtifactsWithRuntime(
        project,
        composition,
        'class GraphicElement {}',
      );
      expect(
        artifacts.resources.filter((resource) => resource.path === STUDIO_RUNTIME_LICENSE_PATH),
      ).toEqual([
        {
          path: STUDIO_RUNTIME_LICENSE_PATH,
          data: STUDIO_RUNTIME_LICENSE_TEXT,
          base64: false,
          mimeType: 'text/plain',
        },
      ]);
      expect(artifacts.mainJs.startsWith(STUDIO_RUNTIME_NOTICE)).toBe(true);
      if (kind === 'unassigned-chart') {
        expect(artifacts.valid).toBe(false);
        expect(artifacts.errors.join(' ')).toContain('no assigned renderer provider');
      } else expect(artifacts.errors).toEqual([]);
      expect(
        artifacts.resources.some((resource) => resource.path === 'licenses/chartjs-LICENSE.txt'),
      ).toBe(false);
      for (const [path, data] of Object.entries(RUNTIME_DEPENDENCY_LICENSES)) {
        expect(artifacts.resources).toContainEqual({
          path,
          data,
          base64: false,
          mimeType: 'text/plain',
        });
        expect(artifacts.resources.filter((resource) => resource.path === path)).toHaveLength(1);
      }
      if (kind === 'external-chart')
        expect(
          artifacts.resources.some((resource) => resource.data === 'External provider notice'),
        ).toBe(true);
    },
  );
});

import { describe, expect, it } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createChartLayer,
  createComposition,
  createProject,
  createRendererPluginSnapshot,
  type Layer,
  type RendererPluginManifest,
  type RendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  type StudioPluginSnapshot,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  resolveShaderPackPresetPaint,
} from '@ograf-editor/scene-model';
import { rendererPluginReference } from '../state/pluginSettingsStore';
import {
  applicationComponents,
  applicationProjectUsage,
  installedApplicationGroups,
} from './configurationApplications';
import { ApplicationBundleDetails, ApplicationComponents } from './ApplicationBundleDetails';

function snapshot(
  options: {
    id?: string;
    version?: string;
    library?: RendererPluginManifest['library'] | null;
    licenseText?: string;
    source?: string;
  } = {},
): RendererPluginSnapshot {
  const library =
    options.library === null
      ? undefined
      : (options.library ?? {
          name: 'Chart.js',
          version: '4.5.1',
        });
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: options.id ?? 'ograf.chartjs',
      name: 'Studio chart adapter',
      version: options.version ?? '1.0.1',
      author: 'Studio Publisher',
      license: 'AGPL-3.0-only',
      presets: ['bar', 'line'],
      ...(library ? { library } : {}),
    },
    source: options.source ?? 'export default {apiVersion:1,create(){}};',
    licenseText: options.licenseText ?? 'Studio adapter:\nAGPL-3.0-only',
  });
}

function entry(plugin: StudioPluginSnapshot, installedAt: string, enabled = true, trusted = true) {
  return { snapshot: plugin, installedAt, enabled, trusted };
}

function chart(plugin: RendererPluginSnapshot): Layer {
  const layer = createChartLayer();
  if (layer.element.type !== 'chart') throw new Error('Expected chart.');
  layer.element.provider = rendererPluginReference(plugin);
  return layer;
}

describe('application adapter and library attribution', () => {
  it('separates declared adapter and engine versions, publishers and licenses', () => {
    const plugin = snapshot({
      library: {
        name: 'Chart.js',
        version: '4.5.1',
        license: 'MIT',
        author: 'Chart.js Contributors',
        homepage: 'https://www.chartjs.org/',
      },
    });
    expect(applicationComponents(plugin)).toMatchObject({
      name: 'Chart.js',
      adapter: {
        name: 'Studio chart adapter',
        version: '1.0.1',
        publisher: 'Studio Publisher',
        license: 'AGPL-3.0-only',
      },
      library: {
        name: 'Chart.js',
        version: '4.5.1',
        publisher: 'Chart.js Contributors',
        license: 'MIT',
        licenseOrigin: 'declared',
        homepage: 'https://www.chartjs.org/',
      },
    });
  });

  it('prefers an explicit library license declaration over inferred bundled notice', () => {
    const plugin = snapshot({
      library: { name: 'Chart.js', version: '4.5.1', license: 'BSD-3-Clause' },
      licenseText: 'Chart.js:\nThe MIT License (MIT)\nCopyright contributors',
    });
    expect(applicationComponents(plugin).library).toMatchObject({
      license: 'BSD-3-Clause',
      licenseOrigin: 'declared',
    });
  });

  it.each(['\n', '\r\n'])('infers MIT only from an exact named Chart.js notice (%j)', (newline) => {
    const plugin = snapshot({
      licenseText: `Studio adapter:${newline}AGPL-3.0-only${newline}${newline}Chart.js:${newline}The MIT License (MIT)${newline}Copyright contributors`,
    });
    expect(applicationComponents(plugin)).toMatchObject({
      adapter: { license: 'AGPL-3.0-only' },
      library: { license: 'MIT', licenseOrigin: 'bundled notice', publisher: 'Not declared' },
    });
  });

  it.each([
    ['Other engine', 'Chart.js:\nThe MIT License (MIT)\n'],
    ['Chart.js fork', 'Chart.js:\nThe MIT License (MIT)\n'],
    ['Chart.js', 'Studio adapter:\nThe MIT License (MIT)\n'],
    ['Chart.js', 'Chart.js: The MIT License (MIT)\n'],
    ['Chart.js', 'Chart.js:\nLicensed under MIT\n'],
  ])('does not infer a library license from an ambiguous notice for %s', (name, licenseText) => {
    const plugin = snapshot({ library: { name, version: '4.5.1' }, licenseText });
    expect(applicationComponents(plugin).library).toMatchObject({
      license: 'Unknown',
      licenseOrigin: 'unknown',
      publisher: 'Not declared',
    });
  });

  it('does not copy the adapter license or publisher when the library declaration is absent', () => {
    const info = applicationComponents(snapshot({ library: null }));
    expect(info.name).toBe('Studio chart adapter');
    expect(info.library).toMatchObject({
      name: 'Unknown',
      version: 'Unknown',
      license: 'Unknown',
      publisher: 'Not declared',
      licenseOrigin: 'unknown',
    });
  });
});

const motionPack = () =>
  createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'example.motion',
      version: '1.0.0',
      name: 'Motion presets',
      author: 'Preset Artist',
      license: 'MIT',
    },
    presets: [
      {
        id: 'fade',
        name: 'Fade',
        tracks: {
          in: [
            {
              property: 'opacity',
              mode: 'factor',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
    licenseText: 'MIT preset data',
  });
describe('animation packs in shared configuration', () => {
  it('puts pack name/version on the left and declarations/validation in a separate compact column', () => {
    const pack = motionPack();
    const before = structuredClone(pack);
    const markup = renderToStaticMarkup(createElement(ApplicationComponents, { snapshot: pack }));
    const sections = [...markup.matchAll(/<section\b[^>]*>(.*?)<\/section>/g)].map(
      (match) => match[0]!,
    );
    expect(sections).toHaveLength(2);
    expect(markup).toContain('application-components is-preset-pack');
    expect(markup).not.toContain('is-animation-pack');
    expect(sections[0]).toContain('application-component-identity');
    expect(sections[0]).toContain('Animation preset pack');
    expect(sections[0]).toContain('Motion presets');
    expect(sections[0]).toContain('application-component-version">1.0.0');
    expect(sections[0]).not.toMatch(/Publisher:|License:|Validated JSON/);
    expect(sections[1]).toContain('application-component-metadata');
    expect(sections[1]).toContain('Publisher: Preset Artist');
    expect(sections[1]).toContain('License: MIT');
    expect(sections[1]).toContain('application-component-validation');
    expect(sections[1]).toContain('Validated JSON data');
    expect(sections[1]).toContain('no JavaScript execution');
    expect(pack).toEqual(before);
  });
  it('renders data attribution without an external library or JavaScript trust claim', () => {
    const pack = motionPack();
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ApplicationComponents, { snapshot: pack }),
        createElement(ApplicationBundleDetails, { snapshot: pack }),
      ),
    );
    expect(markup).toContain('Animation preset pack');
    expect(markup).toContain('Preset Artist');
    expect(markup).toContain('no JavaScript execution');
    expect(markup).not.toContain('Underlying library');
    expect(markup).not.toContain('Trust &amp; Install');
    expect(markup).not.toContain(pack.licenseText);
  });
  it('groups both kinds and counts animation links once per object across IN and OUT', () => {
    const pack = motionPack(),
      chartPlugin = snapshot();
    expect(
      installedApplicationGroups(
        [entry(pack, '2026-10-01'), entry(chartPlugin, '2026-10-02')],
        null,
      )
        .map((group) => group.kind)
        .sort(),
    ).toEqual(['animation-presets', 'chart']);
    const project = createProject(),
      layer = createChartLayer();
    const application = {
      reference: rendererPluginReference(pack),
      presetId: 'fade',
      durationFrames: 10,
      parameters: {},
    };
    layer.animationPresets = { in: application, out: application };
    project.compositions[0]!.layers = [layer];
    project.compositions[0]!.components = [
      { id: 'saved', name: 'Saved', dataFields: [], layers: [structuredClone(layer)] },
    ];
    expect(applicationProjectUsage(project, rendererPluginReference(pack))).toMatchObject({
      objects: 1,
      componentObjects: 1,
    });
  });
});

it('describes GPU shader packs without previewing their code or claiming an external library', () => {
  const pack = createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'example.shaders',
      version: '1.0.0',
      name: 'Shaders',
      author: 'Shader Artist',
      license: 'CC0-1.0',
    },
    shaders: [
      { id: '01', name: 'One', targets: ['fill', 'outline', 'effect'], paint: createShaderPaint() },
    ],
    licenseText: 'CC0 fixture',
  });
  const markup = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(ApplicationComponents, { snapshot: pack }),
      createElement(ApplicationBundleDetails, { snapshot: pack }),
    ),
  );
  expect(markup).toContain('Shader pack');
  expect(markup).toContain('GPU load');
  expect(markup).toContain('fill: 1');
  expect(markup).toContain('outline: 1');
  expect(markup).toContain('effect: 1');
  expect(markup).not.toContain('Underlying library');
  expect(markup).not.toContain(pack.shaders[0]!.paint.fragmentSource);
  expect(markup).not.toContain(pack.licenseText);
  const columns = [...markup.matchAll(/<section\b[^>]*>(.*?)<\/section>/g)].map(
    (match) => match[0]!,
  );
  expect(columns).toHaveLength(2);
  expect(columns[0]).toContain('application-component-identity');
  expect(columns[0]).toContain('Shader pack');
  expect(columns[0]).toContain('application-component-version">1.0.0');
  expect(columns[0]).not.toMatch(/Publisher:|License:|GLSL programs/);
  expect(columns[1]).toContain('application-component-metadata');
  expect(columns[1]).toContain('Publisher: Shader Artist');
  expect(columns[1]).toContain('License: CC0-1.0');
  expect(columns[1]).toContain('application-component-validation');
  expect(columns[1]).toContain('GLSL programs');
  expect(columns[1]).toContain('GPU after explicit use');
  const project = createProject(),
    layer = createChartLayer();
  const rect = project.compositions[0]!.layers;
  const source = createShaderPaint();
  const copied = resolveShaderPackPresetPaint(pack, '01', 'fill');
  layer.effects.stack = [
    { id: 'copy', name: 'Copied', type: 'shader', enabled: true, shader: copied, params: {} },
  ];
  rect.push(layer);
  expect(applicationProjectUsage(project, rendererPluginReference(pack)).objects).toBe(1);
  expect(source.packProvenance).toBeUndefined();
});

describe('installed application groups', () => {
  it('keeps all versions in one application, including disabled and untrusted versions', () => {
    const first = snapshot({ version: '1.0.1' });
    const second = snapshot({ version: '1.0.2' });
    const third = snapshot({ version: '1.0.3' });
    const installed = [
      entry(first, '2026-10-01T00:00:00Z'),
      entry(second, '2026-10-02T00:00:00Z', false),
      entry(third, '2026-10-03T00:00:00Z', true, false),
    ];
    const before = structuredClone(installed);
    const groups = installedApplicationGroups(installed, rendererPluginReference(first));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'ograf.chartjs',
      name: 'Chart.js',
      preferred: installed[0],
    });
    expect(groups[0]!.versions).toEqual([installed[2], installed[1], installed[0]]);
    expect(installed).toEqual(before);
  });

  it('selects the exact default hash even when another bundle has the same version', () => {
    const selected = snapshot();
    const revised = snapshot({ source: selected.source + '// different bytes' });
    const groups = installedApplicationGroups(
      [entry(selected, '2026-10-01T00:00:00Z'), entry(revised, '2026-10-02T00:00:00Z')],
      rendererPluginReference(selected),
    );
    expect(groups[0]!.preferred.snapshot.sha256).toBe(selected.sha256);
    expect(groups[0]!.versions).toHaveLength(2);
  });
});

describe('application references in current templates', () => {
  it('counts exact authored references in guides, collection prototypes and saved components', () => {
    const selected = snapshot();
    const otherBytes = snapshot({ source: selected.source + '// other exact provider' });
    const project = createProject();
    const main = project.compositions[0]!;
    const hidden = chart(selected);
    hidden.isVisible = false;
    const guide = chart(selected);
    guide.isGuide = true;
    const prototype = chart(selected);
    main.layers = [hidden, guide, prototype, chart(otherBytes)];
    main.components = [
      {
        id: 'saved',
        name: 'Saved card',
        dataFields: [],
        layers: [chart(selected), chart(selected), chart(otherBytes)],
      },
    ];
    main.runtimeCollections = [
      {
        id: 'collection',
        name: 'Rows',
        fieldId: 'rows',
        prototypeLayerIds: [prototype.id],
        offsetPerItem: { x: 0, y: 100 },
        capacity: 100,
        overflow: 'truncate',
      },
    ];
    const secondary = createComposition({ name: 'Secondary', layers: [chart(selected)] });
    project.compositions.push(secondary, createComposition({ name: 'Unused' }));
    expect(applicationProjectUsage(project, rendererPluginReference(selected))).toEqual({
      objects: 4,
      componentObjects: 2,
      compositions: ['Main', 'Secondary'],
    });
    expect(applicationProjectUsage(project, rendererPluginReference(otherBytes))).toEqual({
      objects: 1,
      componentObjects: 1,
      compositions: ['Main'],
    });
  });
});

describe('application bundle review text', () => {
  it('renders concise component declarations without exposing bundled source or full notices', () => {
    const plugin = snapshot({
      library: {
        name: 'Chart.js',
        version: '4.5.1',
        license: 'MIT',
        author: 'Chart.js Contributors',
        homepage: 'https://www.chartjs.org/',
      },
    });
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ApplicationComponents, { snapshot: plugin }),
        createElement(ApplicationBundleDetails, { snapshot: plugin }),
      ),
    );
    expect(markup).toContain('Studio adapter (integration code)');
    expect(markup).toContain('Underlying library');
    expect(markup).toContain('AGPL-3.0-only');
    expect(markup).toContain('MIT');
    expect(markup).toContain('Publisher: Chart.js Contributors');
    expect(markup).toContain('href="https://www.chartjs.org/"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('Bundled code (adapter + library)');
    expect(markup).not.toContain('Full bundled license notices');
    expect(markup).not.toContain(plugin.source);
    expect(markup).not.toContain(plugin.licenseText);
    expect(markup).toContain('bar, line');
    expect(markup).toContain(plugin.sha256);
    expect(markup).toContain('not independently verified provenance');
    expect(markup).not.toMatch(/unmodified|upstream verified|verified upstream/i);
    const sections = [...markup.matchAll(/<section\b[^>]*>(.*?)<\/section>/g)].map(
      (match) => match[0]!,
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('application-component-adapter');
    expect(sections[0]).toContain('Publisher: Studio Publisher');
    expect(sections[0]).toContain('AGPL-3.0-only');
    expect(sections[0]).not.toContain('Chart.js Contributors');
    expect(sections[1]).toContain('application-component-library');
    expect(sections[1]).toContain('Publisher: Chart.js Contributors');
    expect(sections[1]).toContain('License: MIT');
    expect(sections[1]).not.toContain('AGPL-3.0-only');
    expect(sections.every((section) => section.includes('application-component-meta-line'))).toBe(
      true,
    );
  });

  it('shows unknown library details without applying the adapter license to it', () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationComponents, { snapshot: snapshot({ library: null }) }),
    );
    const librarySection = markup.slice(markup.indexOf('Underlying library'));
    expect(librarySection).toContain('Unknown');
    expect(librarySection).toContain('Not declared');
    expect(librarySection).not.toContain('AGPL-3.0-only');
  });
});

import { describe, expect, it } from 'vitest';
import {
  createRendererPluginSnapshot,
  rendererPluginDigest,
  type RendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  createShaderPackPluginSnapshot,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import {
  comparePluginVersions,
  rendererPluginUpdatePlan,
  studioPluginUpdatePlan,
} from './pluginApplicationUpdates';

function snapshot(
  version = '1.0.1',
  library = { name: 'Chart.js', version: '4.5.1' },
  source = 'export default {apiVersion:1,create(){}};',
): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'ograf.chartjs',
      name: 'Chart renderer',
      version,
      library,
      presets: ['bar', 'line'],
      license: 'MIT',
    },
    source,
    licenseText: 'MIT test fixture',
  });
}

function changed(
  current: RendererPluginSnapshot,
  patch: Partial<RendererPluginSnapshot['manifest']> = {},
  source = current.source,
) {
  return createRendererPluginSnapshot({
    manifest: { ...current.manifest, ...patch },
    source,
    licenseText: current.licenseText,
  });
}

describe('renderer application update review', () => {
  it('shows separate adapter and library versions and their exact installation identities', () => {
    const current = snapshot();
    const candidate = snapshot(
      '1.0.2',
      { name: 'Chart.js', version: '4.5.2' },
      current.source + '// new bundle',
    );
    const before = structuredClone({ current, candidate });
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      current: {
        adapterId: 'ograf.chartjs',
        adapterVersion: '1.0.1',
        libraryName: 'Chart.js',
        libraryVersion: '4.5.1',
        sha256: current.sha256,
      },
      candidate: { adapterVersion: '1.0.2', libraryVersion: '4.5.2', sha256: candidate.sha256 },
      adapterVersionChanged: true,
      adapterVersionChange: 'upgrade',
      libraryVersionChange: 'upgrade',
      libraryChanged: true,
      libraryNameChanged: false,
      rendererSourceChanged: true,
      compatiblePresets: true,
      downgrade: false,
      warnings: [],
    });
    expect(plan.current.key).not.toBe(plan.candidate.key);
    expect({ current, candidate }).toEqual(before);
  });

  it('identifies an adapter-only update while the declared engine remains unchanged', () => {
    const current = snapshot();
    const candidate = changed(
      current,
      { version: '1.0.2' },
      current.source + '// adapter correction',
    );
    expect(rendererPluginUpdatePlan(current, candidate)).toMatchObject({
      adapterChanged: true,
      adapterVersionChanged: true,
      adapterVersionChange: 'upgrade',
      libraryChanged: false,
      libraryVersionChange: 'same',
      rendererSourceChanged: true,
    });
  });

  it('permits a different engine under the same adapter ID but warns about output compatibility', () => {
    const current = snapshot();
    const candidate = snapshot('1.0.2', { name: 'Another charts library', version: '1.0.0' });
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      libraryNameChanged: true,
      libraryChanged: true,
      libraryVersionChange: 'unknown',
      downgrade: false,
    });
    expect(plan.warnings).toContainEqual(expect.stringMatching(/rendering library changes/));
  });

  it('rejects a different adapter ID and already-installed exact bytes', () => {
    const current = snapshot();
    expect(() =>
      rendererPluginUpdatePlan(current, changed(current, { id: 'other.renderer' })),
    ).toThrow(/same adapter ID/);
    expect(() => rendererPluginUpdatePlan(current, structuredClone(current))).toThrow(
      /already installed/,
    );
  });

  it('checks snapshot integrity, API and kind before accepting review input', () => {
    const current = snapshot();
    const candidate = changed(current, { version: '1.0.2' });
    expect(() =>
      rendererPluginUpdatePlan(current, { ...candidate, source: candidate.source + '// altered' }),
    ).toThrow(/integrity/);
    const wrongAPI = { ...candidate, manifest: { ...candidate.manifest, apiVersion: 2 as 1 } };
    wrongAPI.sha256 = rendererPluginDigest(wrongAPI);
    expect(() => rendererPluginUpdatePlan(current, wrongAPI)).toThrow(/apiVersion|API/);
    const wrongKind = {
      ...candidate,
      manifest: { ...candidate.manifest, kind: 'text' as 'chart' },
    };
    wrongKind.sha256 = rendererPluginDigest(wrongKind);
    expect(() => rendererPluginUpdatePlan(current, wrongKind)).toThrow(/kind/);
  });

  it('flags changed bytes under the same adapter version rather than upgrading templates', () => {
    const current = snapshot();
    const candidate = changed(current, {}, current.source + '// revised same-version bytes');
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      adapterVersionChange: 'same',
      adapterVersionChanged: false,
      sameAdapterVersionChangedBytes: true,
      rendererSourceChanged: true,
    });
    expect(plan.warnings).toContainEqual(
      expect.stringMatching(/version is unchanged.*hash differs/),
    );
    expect(current.sha256).not.toBe(candidate.sha256);
  });

  it('flags removed chart capabilities without changing or rejecting pinned templates', () => {
    const current = snapshot();
    const plan = rendererPluginUpdatePlan(
      current,
      changed(current, { version: '1.0.2', presets: ['line', 'pie'] }),
    );
    expect(plan).toMatchObject({
      addedPresets: ['pie'],
      removedPresets: ['bar'],
      compatiblePresets: false,
    });
    expect(plan.warnings).toContainEqual(
      expect.stringMatching(/no longer supports: bar.*remain pinned/),
    );
    expect(current.manifest.presets).toEqual(['bar', 'line']);
  });

  it('reviews adapter and engine downgrades, including prereleases, without banning them', () => {
    const current = snapshot('1.0.2');
    const candidate = snapshot('1.0.2-rc.1', { name: 'Chart.js', version: '4.4.9' });
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      adapterVersionChange: 'downgrade',
      libraryVersionChange: 'downgrade',
      downgrade: true,
    });
    expect(plan.warnings).toContainEqual(expect.stringMatching(/downgrade/));
  });

  it('preserves build metadata in exact identities without treating it as newer precedence', () => {
    const current = snapshot('1.0.1+first');
    const candidate = snapshot('1.0.1+second');
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      adapterVersionChanged: true,
      adapterVersionChange: 'same',
      downgrade: false,
    });
    expect(plan.current.key).not.toBe(plan.candidate.key);
    expect(plan.warnings).toContainEqual(expect.stringMatching(/build metadata/));
  });

  it('uses manual review for accepted legacy adapter versions and non-semantic library versions', () => {
    const current = snapshot('1.0.1-01', { name: 'Chart.js', version: 'development' });
    const candidate = snapshot('1.0.2', { name: 'Chart.js', version: 'next' });
    const plan = rendererPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      adapterVersionChange: 'unknown',
      libraryVersionChange: 'unknown',
      downgrade: false,
    });
    expect(plan.warnings.filter((warning) => warning.includes('version manually'))).toHaveLength(2);
  });
});

function presetPack(version = '1.0.0') {
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'example.motion',
      version,
      name: 'Motion',
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
    licenseText: 'MIT data pack',
  });
}
describe('animation pack update planning', () => {
  it('warns when an existing preset narrows targets or loses an animation side', () => {
    const current = presetPack();
    const candidate = createAnimationPresetPluginSnapshot({
      ...current,
      manifest: { ...current.manifest, version: '1.0.1' },
      presets: [{ ...current.presets[0]!, targetKinds: ['text'] }],
    });
    const plan = studioPluginUpdatePlan(current, candidate);
    expect(plan.compatiblePresets).toBe(false);
    expect(plan.warnings).toContainEqual(expect.stringMatching(/capabilities narrow.*fade/));
  });
  it('compares exact data versions and removed presets without a library or executable code', () => {
    const current = presetPack(),
      candidate = createAnimationPresetPluginSnapshot({
        ...current,
        manifest: { ...current.manifest, version: '1.0.1' },
        presets: [{ ...current.presets[0]!, id: 'new-fade' }],
      });
    expect(studioPluginUpdatePlan(current, candidate)).toMatchObject({
      kind: 'animation-presets',
      presetDataChanged: true,
      rendererSourceChanged: false,
      libraryChanged: false,
      current: { libraryName: null },
      candidate: { libraryName: null },
      removedPresets: ['fade'],
      addedPresets: ['new-fade'],
      compatiblePresets: false,
    });
    expect(studioPluginUpdatePlan(current, candidate).warnings).toContainEqual(
      expect.stringMatching(/baked animation keys remain unchanged/),
    );
  });
  it('rejects cross-kind updates and identifies changed same-version recipe bytes', () => {
    const current = presetPack();
    expect(() => studioPluginUpdatePlan(current, snapshot())).toThrow(/kind/);
    const candidate = createAnimationPresetPluginSnapshot({
      ...current,
      presets: [{ ...current.presets[0]!, name: 'New label' }],
    });
    expect(studioPluginUpdatePlan(current, candidate)).toMatchObject({
      sameAdapterVersionChangedBytes: true,
      presetDataChanged: true,
    });
    expect(() => studioPluginUpdatePlan(current, current)).toThrow(/already installed/);
  });
});

describe('shader pack update review', () => {
  const pack = () =>
    createShaderPackPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'shader-pack',
        id: 'example.shaders',
        version: '1.0.0',
        name: 'Shaders',
        license: 'CC0-1.0',
      },
      shaders: [
        { id: '01', name: 'One', targets: ['fill', 'effect'], paint: createShaderPaint() },
        { id: '02', name: 'Two', targets: ['fill'], paint: createShaderPaint() },
      ],
      licenseText: 'CC0 fixture',
    });
  it('flags removed shaders and narrower targets without changing copied code', () => {
    const current = pack(),
      candidate = createShaderPackPluginSnapshot({
        ...current,
        manifest: { ...current.manifest, version: '1.0.1' },
        shaders: [{ ...current.shaders[0]!, targets: ['fill'] }],
      });
    const plan = studioPluginUpdatePlan(current, candidate);
    expect(plan).toMatchObject({
      kind: 'shader-pack',
      shaderDataChanged: true,
      rendererSourceChanged: false,
      removedPresets: ['02'],
      compatiblePresets: false,
    });
    expect(plan.warnings).toContainEqual(expect.stringMatching(/targets narrow.*01/));
    expect(plan.warnings).toContainEqual(
      expect.stringMatching(/copied paints and effects remain unchanged/),
    );
    expect(current.shaders).toHaveLength(2);
  });
  it('rejects cross-kind identity changes and flags same-version shader edits', () => {
    const current = pack();
    expect(() => studioPluginUpdatePlan(current, presetPack())).toThrow(/kind/);
    const candidate = createShaderPackPluginSnapshot({
      ...current,
      shaders: [{ ...current.shaders[0]!, name: 'Renamed' }, current.shaders[1]!],
    });
    expect(studioPluginUpdatePlan(current, candidate).sameAdapterVersionChangedBytes).toBe(true);
  });
});

describe('SemVer precedence for plugin update review', () => {
  it('orders the standard numeric/alphabetic prerelease sequence before release', () => {
    const versions = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let index = 1; index < versions.length; index++) {
      expect(comparePluginVersions(versions[index - 1]!, versions[index]!)).toBe(-1);
      expect(comparePluginVersions(versions[index]!, versions[index - 1]!)).toBe(1);
    }
  });

  it('compares numeric identifiers without floating-point precision loss', () => {
    expect(comparePluginVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBe(1);
    expect(comparePluginVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBe(1);
  });

  it('ignores build precedence while preserving case-sensitive and hyphenated prereleases', () => {
    expect(comparePluginVersions('1.0.0+build.001', '1.0.0+build.2')).toBe(0);
    expect(comparePluginVersions('1.0.0-beta-1', '1.0.0-beta-2')).toBe(-1);
    expect(comparePluginVersions('1.0.0-Beta', '1.0.0-beta')).toBe(-1);
    expect(comparePluginVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
  });

  it.each(['1.0', '01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+'])(
    'rejects non-semantic comparator input %s',
    (version) => {
      expect(() => comparePluginVersions(version, '1.0.0')).toThrow(/non-semantic/);
    },
  );
});

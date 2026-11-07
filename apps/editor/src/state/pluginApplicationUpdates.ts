import {
  rendererPluginKey,
  validateRendererPluginSnapshot,
  validateStudioPluginSnapshot,
  isRendererPluginSnapshot,
  isAnimationPresetPluginSnapshot,
  isShaderPackPluginSnapshot,
  type RendererPluginSnapshot,
  type StudioPluginSnapshot,
  type ShaderPackPluginSnapshot,
} from '@ograf-editor/scene-model';

export type PluginVersionChange = 'upgrade' | 'downgrade' | 'same' | 'unknown';

export interface RendererPluginUpdateSummary {
  adapterId: string;
  adapterVersion: string;
  libraryName: string | null;
  libraryVersion: string | null;
  sha256: string;
  key: string;
}

export interface RendererPluginUpdatePlan {
  kind: StudioPluginSnapshot['manifest']['kind'];
  presetDataChanged: boolean;
  shaderDataChanged: boolean;
  current: RendererPluginUpdateSummary;
  candidate: RendererPluginUpdateSummary;
  adapterVersionChange: PluginVersionChange;
  libraryVersionChange: PluginVersionChange;
  adapterVersionChanged: boolean;
  /** Declared adapter version changed; bundle bytes cannot identify which source component changed. */
  adapterChanged: boolean;
  rendererSourceChanged: boolean;
  libraryChanged: boolean;
  libraryNameChanged: boolean;
  libraryVersionChanged: boolean;
  licenseChanged: boolean;
  sameAdapterVersionChangedBytes: boolean;
  downgrade: boolean;
  addedPresets: string[];
  removedPresets: string[];
  compatiblePresets: boolean;
  warnings: string[];
}

interface SemanticVersion {
  numeric: bigint[];
  prerelease: string[];
}

function semanticVersion(value: string): SemanticVersion {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (!match) throw new Error(`Cannot compare non-semantic version "${value}".`);
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part)))
    throw new Error(`Cannot compare non-semantic version "${value}".`);
  return { numeric: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease };
}

/** SemVer precedence is case-sensitive; build metadata does not affect precedence. */
export function comparePluginVersions(left: string, right: string): -1 | 0 | 1 {
  const a = semanticVersion(left),
    b = semanticVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.numeric[index]! < b.numeric[index]!) return -1;
    if (a.numeric[index]! > b.numeric[index]!) return 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length !== 0) return 1;
  if (a.prerelease.length !== 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const partA = a.prerelease[index],
      partB = b.prerelease[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    if (partA === partB) continue;
    const numericA = /^\d+$/.test(partA),
      numericB = /^\d+$/.test(partB);
    if (numericA && numericB) return BigInt(partA) < BigInt(partB) ? -1 : 1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return partA < partB ? -1 : 1;
  }
  return 0;
}

function versionChange(current: string | null, candidate: string | null): PluginVersionChange {
  if (current === null || candidate === null) return 'unknown';
  try {
    const order = comparePluginVersions(current, candidate);
    return order < 0 ? 'upgrade' : order > 0 ? 'downgrade' : 'same';
  } catch {
    return 'unknown';
  }
}

function summary(snapshot: RendererPluginSnapshot): RendererPluginUpdateSummary {
  return {
    adapterId: snapshot.manifest.id,
    adapterVersion: snapshot.manifest.version,
    libraryName: snapshot.manifest.library?.name ?? null,
    libraryVersion: snapshot.manifest.library?.version ?? null,
    sha256: snapshot.sha256,
    key: rendererPluginKey({
      id: snapshot.manifest.id,
      version: snapshot.manifest.version,
      sha256: snapshot.sha256,
    }),
  };
}

export type StudioPluginUpdatePlan = RendererPluginUpdatePlan;

export function studioPluginUpdatePlan(
  current: StudioPluginSnapshot,
  candidate: StudioPluginSnapshot,
): StudioPluginUpdatePlan {
  if (current.manifest.kind !== candidate.manifest.kind)
    throw new Error('A plugin update cannot change its kind.');
  if (isRendererPluginSnapshot(current) && isRendererPluginSnapshot(candidate))
    return rendererPluginUpdatePlan(current, candidate);
  if (isShaderPackPluginSnapshot(current) && isShaderPackPluginSnapshot(candidate))
    return shaderPackUpdatePlan(current, candidate);
  if (!isAnimationPresetPluginSnapshot(current) || !isAnimationPresetPluginSnapshot(candidate))
    throw new Error('Unsupported plugin update kind.');
  for (const [label, snapshot] of [
    ['Current', current],
    ['Candidate', candidate],
  ] as const) {
    const errors = validateStudioPluginSnapshot(snapshot);
    if (errors.length) throw new Error(`${label} plugin failed validation: ${errors.join(' ')}`);
  }
  if (current.manifest.id !== candidate.manifest.id)
    throw new Error('An update must have the same plugin ID.');
  const info = (snapshot: typeof current): RendererPluginUpdateSummary => ({
    adapterId: snapshot.manifest.id,
    adapterVersion: snapshot.manifest.version,
    libraryName: null,
    libraryVersion: null,
    sha256: snapshot.sha256,
    key: rendererPluginKey({
      id: snapshot.manifest.id,
      version: snapshot.manifest.version,
      sha256: snapshot.sha256,
    }),
  });
  const before = info(current),
    after = info(candidate);
  if (before.key === after.key) throw new Error('These exact plugin bytes are already installed.');
  const adapterVersionChanged = before.adapterVersion !== after.adapterVersion;
  const adapterVersionChange = versionChange(before.adapterVersion, after.adapterVersion);
  const downgrade = adapterVersionChange === 'downgrade';
  const sameAdapterVersionChangedBytes =
    !adapterVersionChanged && current.sha256 !== candidate.sha256;
  const removedPresets = current.presets
    .map((preset) => preset.id)
    .filter((id) => !candidate.presets.some((preset) => preset.id === id));
  const addedPresets = candidate.presets
    .map((preset) => preset.id)
    .filter((id) => !current.presets.some((preset) => preset.id === id));
  const warnings: string[] = [];
  const narrowerPresets = current.presets
    .filter((preset) => {
      const next = candidate.presets.find((entry) => entry.id === preset.id);
      if (!next) return false;
      return (
        (preset.tracks.in && !next.tracks.in) ||
        (preset.tracks.out && !next.tracks.out) ||
        (next.targetKinds &&
          (!preset.targetKinds ||
            preset.targetKinds.some((kind) => !next.targetKinds!.includes(kind))))
      );
    })
    .map((preset) => preset.id);
  if (narrowerPresets.length)
    warnings.push(
      `Preset target or IN/OUT capabilities narrow for: ${narrowerPresets.join(', ')}. Previously baked animation keys remain unchanged.`,
    );
  if (removedPresets.length)
    warnings.push(
      `The update removes presets: ${removedPresets.join(', ')}. Previously baked animation keys remain unchanged.`,
    );
  if (sameAdapterVersionChangedBytes)
    warnings.push(
      'The pack version is unchanged, but its hash differs. Review it as a separate installation.',
    );
  if (downgrade)
    warnings.push(
      'The candidate declares an older preset pack version. Review this downgrade before installing.',
    );
  if (adapterVersionChange === 'unknown')
    warnings.push('The pack version cannot be ordered reliably. Review its version manually.');
  if (adapterVersionChange === 'same' && adapterVersionChanged)
    warnings.push('Only build metadata changed; semantic version precedence is unchanged.');
  return {
    kind: 'animation-presets',
    shaderDataChanged: false,
    presetDataChanged: JSON.stringify(current.presets) !== JSON.stringify(candidate.presets),
    current: before,
    candidate: after,
    adapterVersionChange,
    libraryVersionChange: 'unknown',
    adapterVersionChanged,
    adapterChanged: adapterVersionChanged,
    rendererSourceChanged: false,
    libraryChanged: false,
    libraryNameChanged: false,
    libraryVersionChanged: false,
    licenseChanged:
      current.licenseText !== candidate.licenseText ||
      current.manifest.license !== candidate.manifest.license,
    sameAdapterVersionChangedBytes,
    downgrade,
    addedPresets,
    removedPresets,
    compatiblePresets: removedPresets.length === 0 && narrowerPresets.length === 0,
    warnings,
  };
}

/** Review data only: this function never installs code, grants trust, or retargets a template. */
export function rendererPluginUpdatePlan(
  current: RendererPluginSnapshot,
  candidate: RendererPluginSnapshot,
): RendererPluginUpdatePlan {
  for (const [label, snapshot] of [
    ['Current', current],
    ['Candidate', candidate],
  ] as const) {
    const errors = validateRendererPluginSnapshot(snapshot);
    if (errors.length) throw new Error(`${label} plugin failed validation: ${errors.join(' ')}`);
  }
  if (current.manifest.id !== candidate.manifest.id)
    throw new Error('An update must have the same adapter ID as the selected plugin.');
  if (
    current.manifest.apiVersion !== candidate.manifest.apiVersion ||
    current.manifest.kind !== candidate.manifest.kind
  )
    throw new Error('An update must use the same renderer API version and kind.');
  const before = summary(current),
    after = summary(candidate);
  if (before.key === after.key) throw new Error('These exact plugin bytes are already installed.');

  const adapterVersionChange = versionChange(before.adapterVersion, after.adapterVersion);
  const adapterVersionChanged = before.adapterVersion !== after.adapterVersion;
  const libraryNameChanged = before.libraryName !== after.libraryName;
  const libraryVersionChanged = before.libraryVersion !== after.libraryVersion;
  const libraryVersionChange = libraryNameChanged
    ? 'unknown'
    : versionChange(before.libraryVersion, after.libraryVersion);
  const removedPresets = current.manifest.presets.filter(
    (preset) => !candidate.manifest.presets.includes(preset),
  );
  const addedPresets = candidate.manifest.presets.filter(
    (preset) => !current.manifest.presets.includes(preset),
  );
  const sameAdapterVersionChangedBytes =
    !adapterVersionChanged && current.sha256 !== candidate.sha256;
  const downgrade = adapterVersionChange === 'downgrade' || libraryVersionChange === 'downgrade';
  const warnings: string[] = [];
  if (libraryNameChanged)
    warnings.push(
      'The rendering library changes. Review output compatibility before choosing this provider for an existing template.',
    );
  if (removedPresets.length)
    warnings.push(
      `The update no longer supports: ${removedPresets.join(', ')}. Existing templates remain pinned to their current provider.`,
    );
  if (sameAdapterVersionChangedBytes)
    warnings.push(
      'The adapter version is unchanged, but the bundle hash differs. Review these exact bytes as a separate installation.',
    );
  if (adapterVersionChange === 'same' && adapterVersionChanged)
    warnings.push('Only adapter build metadata changed; semantic version precedence is unchanged.');
  if (downgrade)
    warnings.push(
      'The candidate declares an older adapter or library version. This is a downgrade; review it before installing.',
    );
  if (adapterVersionChange === 'unknown')
    warnings.push('The adapter version cannot be ordered reliably. Review its version manually.');
  if (!libraryNameChanged && libraryVersionChanged && libraryVersionChange === 'unknown')
    warnings.push('The library version cannot be ordered reliably. Review its version manually.');
  return {
    kind: 'chart',
    shaderDataChanged: false,
    presetDataChanged: false,
    current: before,
    candidate: after,
    adapterVersionChange,
    libraryVersionChange,
    adapterVersionChanged,
    adapterChanged: adapterVersionChanged,
    rendererSourceChanged: current.source !== candidate.source,
    libraryChanged: libraryNameChanged || libraryVersionChanged,
    libraryNameChanged,
    libraryVersionChanged,
    licenseChanged:
      current.licenseText !== candidate.licenseText ||
      current.manifest.license !== candidate.manifest.license,
    sameAdapterVersionChangedBytes,
    downgrade,
    addedPresets,
    removedPresets,
    compatiblePresets: removedPresets.length === 0,
    warnings,
  };
}

function shaderPackUpdatePlan(
  current: ShaderPackPluginSnapshot,
  candidate: ShaderPackPluginSnapshot,
): StudioPluginUpdatePlan {
  for (const [label, snapshot] of [
    ['Current', current],
    ['Candidate', candidate],
  ] as const) {
    const errors = validateStudioPluginSnapshot(snapshot);
    if (errors.length) throw new Error(`${label} plugin failed validation: ${errors.join(' ')}`);
  }
  if (current.manifest.id !== candidate.manifest.id)
    throw new Error('An update must have the same plugin ID.');
  const info = (snapshot: ShaderPackPluginSnapshot): RendererPluginUpdateSummary => ({
    adapterId: snapshot.manifest.id,
    adapterVersion: snapshot.manifest.version,
    libraryName: null,
    libraryVersion: null,
    sha256: snapshot.sha256,
    key: rendererPluginKey({
      id: snapshot.manifest.id,
      version: snapshot.manifest.version,
      sha256: snapshot.sha256,
    }),
  });
  const before = info(current),
    after = info(candidate);
  if (before.key === after.key) throw new Error('These exact plugin bytes are already installed.');
  const adapterVersionChanged = before.adapterVersion !== after.adapterVersion;
  const adapterVersionChange = versionChange(before.adapterVersion, after.adapterVersion);
  const downgrade = adapterVersionChange === 'downgrade';
  const sameAdapterVersionChangedBytes =
    !adapterVersionChanged && current.sha256 !== candidate.sha256;
  const removedPresets = current.shaders
    .filter((shader) => !candidate.shaders.some((next) => next.id === shader.id))
    .map((shader) => shader.id);
  const addedPresets = candidate.shaders
    .filter((shader) => !current.shaders.some((previous) => previous.id === shader.id))
    .map((shader) => shader.id);
  const narrowed = current.shaders
    .filter((shader) => {
      const next = candidate.shaders.find((entry) => entry.id === shader.id);
      return next && shader.targets.some((target) => !next.targets.includes(target));
    })
    .map((shader) => shader.id);
  const warnings: string[] = [];
  if (removedPresets.length)
    warnings.push(
      `The update removes shaders: ${removedPresets.join(', ')}. Previously copied paints and effects remain unchanged.`,
    );
  if (narrowed.length)
    warnings.push(
      `Shader targets narrow for: ${narrowed.join(', ')}. Previously copied paints and effects remain unchanged.`,
    );
  if (sameAdapterVersionChangedBytes)
    warnings.push(
      'The pack version is unchanged, but its hash differs. Review the exact shader code as a separate installation.',
    );
  if (downgrade)
    warnings.push(
      'The candidate declares an older shader pack version. Review this downgrade before installing.',
    );
  if (adapterVersionChange === 'unknown')
    warnings.push('The pack version cannot be ordered reliably. Review its version manually.');
  return {
    kind: 'shader-pack',
    shaderDataChanged: JSON.stringify(current.shaders) !== JSON.stringify(candidate.shaders),
    presetDataChanged: false,
    current: before,
    candidate: after,
    adapterVersionChange,
    libraryVersionChange: 'unknown',
    adapterVersionChanged,
    adapterChanged: adapterVersionChanged,
    rendererSourceChanged: false,
    libraryChanged: false,
    libraryNameChanged: false,
    libraryVersionChanged: false,
    licenseChanged:
      current.licenseText !== candidate.licenseText ||
      current.manifest.license !== candidate.manifest.license,
    sameAdapterVersionChangedBytes,
    downgrade,
    addedPresets,
    removedPresets,
    compatiblePresets: !removedPresets.length && !narrowed.length,
    warnings,
  };
}

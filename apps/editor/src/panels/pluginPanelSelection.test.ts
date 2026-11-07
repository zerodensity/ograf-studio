import { afterEach, describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createRendererPluginSnapshot,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  rendererPluginKey,
  studioPluginReference,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { useTemplateSetSettingsStore } from '../state/templateSetSettingsStore';
import { useProjectStore } from '../state/projectStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import {
  PLUGIN_CATEGORIES,
  pluginGroupsForCategory,
  pluginPanelGroups,
  pluginPanelVersion,
  requestedPluginGroup,
} from './pluginPanelSelection';

const chart = (version = '1.0.0') =>
  createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'example.charts',
      version,
      name: 'Charts',
      license: 'MIT',
      presets: ['bar'],
    },
    source: 'export default {apiVersion:1,create(){}};',
    licenseText: 'MIT',
  });
const shaders = () =>
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
    shaders: [{ id: 'waves', name: 'Waves', targets: ['fill'], paint: createShaderPaint() }],
    licenseText: 'CC0-1.0',
  });
const installed = (snapshot: StudioPluginSnapshot, enabled = true, trusted = true) => ({
  snapshot,
  enabled,
  trusted,
  installedAt: '2026-10-05T10:00:00Z',
});
const animation = () =>
  createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'example.motion',
      version: '1.0.0',
      name: 'Motion presets',
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
              mode: 'absolute',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
    licenseText: 'MIT',
  });

describe('plugin category browsing', () => {
  it('lists the three fixed user-facing categories in order even with an empty catalog', () => {
    expect(PLUGIN_CATEGORIES).toEqual([
      { kind: 'animation-presets', label: 'Animation' },
      { kind: 'chart', label: 'Chart' },
      { kind: 'shader-pack', label: 'Shader' },
    ]);
    expect(PLUGIN_CATEGORIES.map(({ kind }) => pluginGroupsForCategory([], kind).length)).toEqual([
      0, 0, 0,
    ]);
  });
  it('counts plugin groups rather than versions and retains disabled, untrusted and project-only entries', () => {
    const first = chart(),
      second = chart('1.0.1'),
      pack = shaders(),
      motion = animation();
    const groups = pluginPanelGroups(
      [installed(first, false), installed(second, true, false), installed(motion, false, false)],
      [pack],
      null,
    );
    expect(
      PLUGIN_CATEGORIES.map(({ kind }) => pluginGroupsForCategory(groups, kind).length),
    ).toEqual([1, 1, 1]);
    const chartGroups = pluginGroupsForCategory(groups, 'chart');
    expect(chartGroups[0]!.versions).toHaveLength(2);
    expect(chartGroups[0]!.versions.some((entry) => !entry.enabled)).toBe(true);
    expect(chartGroups[0]!.versions.some((entry) => !entry.trusted)).toBe(true);
    expect(pluginGroupsForCategory(groups, 'shader-pack')[0]!.preferred).toMatchObject({
      installedAt: '',
      enabled: false,
      trusted: false,
    });
  });
  it('matches every query word case-insensitively across display name and ID without falling across kinds', () => {
    const groups = pluginPanelGroups(
      [installed(chart()), installed(shaders()), installed(animation())],
      [],
      null,
    );
    const motion = groups.find((group) => group.kind === 'animation-presets')!;
    expect(
      pluginGroupsForCategory(groups, 'animation-presets', '  PRESETS\tEXAMPLE.MOTION  '),
    ).toEqual([motion]);
    expect(pluginGroupsForCategory(groups, 'animation-presets', 'motion absent')).toEqual([]);
    expect(pluginGroupsForCategory(groups, 'chart', 'shader')).toEqual([]);
    expect(pluginGroupsForCategory(groups, 'shader-pack', '  ')).toHaveLength(1);
    expect(pluginGroupsForCategory(groups, 'shader-pack', 'EXAMPLE')).toHaveLength(1);
  });
  it('keeps empty categories empty and filtering does not alter catalog, project or settings data', () => {
    const entries = [installed(shaders(), false, false)];
    const required = [chart()];
    const groups = pluginPanelGroups(entries, required, null);
    const before = JSON.stringify({ groups, entries, required });
    const project = useProjectStore.getState().project;
    const settings = useRendererPluginSettingsStore.getState();
    expect(pluginGroupsForCategory(groups, 'animation-presets')).toEqual([]);
    expect(
      requestedPluginGroup(pluginGroupsForCategory(groups, 'animation-presets'), {
        id: required[0]!.manifest.id,
        kind: 'chart',
      }),
    ).toBeUndefined();
    const result = pluginGroupsForCategory(groups, 'shader-pack', 'shaders');
    expect(result[0]).toBe(groups.find((group) => group.kind === 'shader-pack'));
    expect(JSON.stringify({ groups, entries, required })).toBe(before);
    expect(useProjectStore.getState().project).toBe(project);
    expect(useRendererPluginSettingsStore.getState()).toBe(settings);
  });
});

describe('dockable plugin browser selections', () => {
  it('keeps disabled installations manageable and missing project bundles untrusted', () => {
    const engine = chart(),
      pack = shaders();
    const entries = [installed(engine, false)];
    const before = JSON.stringify(entries);
    const groups = pluginPanelGroups(entries, [pack, pack], null);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.id === engine.manifest.id)!.preferred.enabled).toBe(false);
    expect(groups.find((group) => group.id === pack.manifest.id)!.versions).toEqual([
      { snapshot: pack, installedAt: '', enabled: false, trusted: false },
    ]);
    expect(JSON.stringify(entries)).toBe(before);
  });
  it('does not duplicate an already installed exact project pin', () => {
    const engine = chart();
    expect(pluginPanelGroups([installed(engine)], [engine], null)[0]!.versions).toHaveLength(1);
  });
  it('matches toolbar requests by id and kind, not by display name', () => {
    const engine = chart(),
      pack = shaders();
    pack.manifest.name = engine.manifest.name;
    const groups = pluginPanelGroups([installed(engine), installed(pack)], [], null);
    expect(requestedPluginGroup(groups, { id: pack.manifest.id, kind: 'shader-pack' })?.kind).toBe(
      'shader-pack',
    );
    expect(requestedPluginGroup(groups, { id: pack.manifest.id, kind: 'chart' })).toBeUndefined();
    expect(requestedPluginGroup(groups, null)).toBeUndefined();
  });
  it('selects exact bytes within the application and rejects another application key', () => {
    const first = chart(),
      updated = chart('1.0.1'),
      pack = shaders();
    const groups = pluginPanelGroups(
      [installed(first), installed(updated), installed(pack)],
      [],
      null,
    );
    const group = groups.find((candidate) => candidate.id === first.manifest.id)!;
    const key = rendererPluginKey(studioPluginReference(first));
    expect(pluginPanelVersion(group, key).snapshot.sha256).toBe(first.sha256);
    expect(pluginPanelVersion(group, rendererPluginKey(studioPluginReference(pack)))).toBe(
      group.preferred,
    );
  });
});

afterEach(() => {
  useConfigurationRequestStore.setState({
    requestId: 0,
    selection: null,
    view: 'templates',
    category: 'animation-presets',
    versionKeys: {},
    settingsRequestId: 0,
    settingsSelection: null,
    settingsVersionKey: undefined,
    settingsAddRequestId: 0,
  });
  usePaneRequestStore.setState({ request: null, resetRequest: 0 });
  useTemplateSetSettingsStore.setState({ open: false, scope: 'template-set', section: 'output' });
});
describe('plugin shortcuts route browsing and management to their respective shared UI', () => {
  it('passes explicit plugin identity and reveals the docked templates view', () => {
    useConfigurationRequestStore.getState().open('example.shaders', 'shader-pack');
    expect(useConfigurationRequestStore.getState()).toMatchObject({
      selection: { id: 'example.shaders', kind: 'shader-pack' },
      view: 'templates',
      category: 'shader-pack',
    });
    expect(usePaneRequestStore.getState().request?.pane).toBe('plugins');
  });
  it('management requests reopen Studio plugin preferences without revealing the browser pane', () => {
    useConfigurationRequestStore.getState().open();
    const first = useConfigurationRequestStore.getState().settingsRequestId;
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      open: true,
      scope: 'studio',
      section: 'plugins',
    });
    useTemplateSetSettingsStore.getState().close();
    useConfigurationRequestStore.getState().open();
    expect(usePaneRequestStore.getState().request).toBeNull();
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      open: true,
      scope: 'studio',
      section: 'plugins',
    });
    expect(useConfigurationRequestStore.getState()).toMatchObject({
      settingsRequestId: first + 1,
      settingsSelection: null,
      view: 'templates',
    });
  });
  it('targets the exact plugin version in settings while preserving the browser selection', () => {
    useConfigurationRequestStore.setState({
      selection: { id: 'example.shaders', kind: 'shader-pack' },
      versionKeys: { 'example.shaders:shader-pack': 'exact-version-key' },
    });
    useConfigurationRequestStore
      .getState()
      .openSettings('example.shaders', 'shader-pack', 'exact-version-key');
    useTemplateSetSettingsStore.getState().close();
    useConfigurationRequestStore
      .getState()
      .openSettings('example.shaders', 'shader-pack', 'exact-version-key');
    expect(useConfigurationRequestStore.getState()).toMatchObject({
      selection: { id: 'example.shaders', kind: 'shader-pack' },
      view: 'templates',
      versionKeys: { 'example.shaders:shader-pack': 'exact-version-key' },
      settingsRequestId: 2,
      settingsSelection: { id: 'example.shaders', kind: 'shader-pack' },
      settingsVersionKey: 'exact-version-key',
    });
    expect(usePaneRequestStore.getState().request).toBeNull();
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      open: true,
      scope: 'studio',
      section: 'plugins',
    });
  });
});

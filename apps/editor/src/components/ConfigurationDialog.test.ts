import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  createChartLayer,
  createProject,
  createRendererPluginSnapshot,
  rendererPluginKey,
  type Project,
} from '@ograf-editor/scene-model';
import { ConfigurationDialog } from './ConfigurationDialog';

const state = vi.hoisted(() => ({
  project: null as unknown,
  settings: null as unknown,
  document: { body: {} },
}));
vi.mock('../layout/EditorWindow', () => ({
  useEditorWindow: () => ({ document: state.document }),
  isDomElement: () => false,
}));
vi.mock('../state/projectStore', () => ({
  useProjectStore: (select: (state: { project: Project }) => unknown) =>
    select({ project: state.project as Project }),
}));
vi.mock('../state/pluginSettingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/pluginSettingsStore')>();
  return {
    ...actual,
    useRendererPluginSettingsStore: Object.assign(() => state.settings, {
      getState: () => state.settings,
    }),
  };
});

function plugin(id: string, version: string, name: string) {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id,
      version,
      name,
      presets: ['bar'],
      license: 'MIT',
    },
    source: 'export default {apiVersion:1,create(){}};',
    licenseText: 'MIT fixture',
  });
}
const alpha1 = plugin('test.alpha', '1.0.0', 'Alpha version one');
const alpha2 = plugin('test.alpha', '2.0.0', 'Alpha version two');
const beta = plugin('test.beta', '1.0.0', 'Other application');
const reference = (snapshot: typeof alpha1) => ({
  id: snapshot.manifest.id,
  version: snapshot.manifest.version,
  sha256: snapshot.sha256,
});

beforeEach(() => {
  state.project = createProject();
  state.settings = {
    installed: [alpha1, alpha2, beta].map((snapshot, index) => ({
      snapshot,
      enabled: true,
      trusted: true,
      installedAt: `2026-10-0${index + 1}`,
    })),
    defaultProvider: null,
    loading: false,
    error: '',
    initialize: vi.fn(async () => {}),
    install: vi.fn(),
    setEnabled: vi.fn(),
    remove: vi.fn(),
    setDefaultProvider: vi.fn(),
  };
});

describe('embedded selected plugin management', () => {
  it('renders only the selected identity and exact version as a pane region', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigurationDialog, {
        embedded: true,
        selectedPlugin: { id: 'test.alpha', kind: 'chart' },
        selectedVersionKey: rendererPluginKey(reference(alpha1)),
      }),
    );
    expect(html).toContain('configuration-embedded');
    expect(html).toContain('role="region"');
    expect(html).toContain('Plugin settings');
    expect(html).toContain('Alpha version one');
    expect(html).not.toContain('Alpha version two');
    expect(html).not.toContain('Other application');
    expect(html).not.toContain('configuration-backdrop');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('Plugin settings pages');
    expect(html).not.toContain('Installed version for');
    expect(html).not.toContain('Add plugin…');
    expect(html).toContain('Enabled');
    expect(html).toContain('Update…');
    expect(html).toContain('Remove…');
  });

  it('does not substitute another installed version when the selected pin requires restoration', () => {
    const required = plugin('test.alpha', '3.0.0', 'Required project version');
    const project = createProject();
    const layer = createChartLayer();
    if (layer.element.type !== 'chart') throw Error('Expected chart');
    layer.element.provider = reference(required);
    project.compositions[0]!.layers = [layer];
    project.compositions[0]!.rendererPlugins = [required];
    state.project = project;
    const html = renderToStaticMarkup(
      createElement(ConfigurationDialog, {
        embedded: true,
        selectedPlugin: { id: 'test.alpha', kind: 'chart' },
        selectedVersionKey: rendererPluginKey(reference(required)),
      }),
    );
    expect(html).toContain('Required project version');
    expect(html).toContain('Review saved bundle');
    expect(html).not.toContain('Alpha version one');
    expect(html).not.toContain('Alpha version two');
    expect(html).not.toContain('Update…');
    expect(html).not.toContain('Remove…');
  });

  it('keeps unrelated groups out of an empty selection', () => {
    const html = renderToStaticMarkup(createElement(ConfigurationDialog, { embedded: true }));
    expect(html).toContain('Select a plugin');
    expect(html).not.toContain('Alpha version');
    expect(html).not.toContain('Other application');
  });
});

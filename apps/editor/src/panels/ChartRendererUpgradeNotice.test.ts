import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createChartLayer,
  createProject,
  createRendererPluginSnapshot,
  studioPluginReference,
} from '@ograf-editor/scene-model';

const fixture = vi.hoisted(() => ({
  project: null as any,
  installed: [] as any[],
  set: null as any,
  activeTemplateId: null as string | null,
  upgrade: vi.fn(),
}));
vi.mock('../state/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ project: fixture.project }),
    { getState: () => ({ upgradeChartRenderer: fixture.upgrade }) },
  ),
}));
vi.mock('../state/projectSetStore', () => ({
  useProjectSetStore: (selector: (state: any) => unknown) =>
    selector({ projectSet: fixture.set, activeTemplateId: fixture.activeTemplateId }),
}));
vi.mock('../state/pluginSettingsStore', () => ({
  useRendererPluginSettingsStore: (selector: (state: any) => unknown) =>
    selector({ installed: fixture.installed }),
  isInstalledChartPlugin: (entry: any) => entry.snapshot.manifest.kind === 'chart',
}));
vi.mock('../state/historyStore', () => ({
  runDiscreteHistoryStep: (callback: () => void) => callback(),
}));
vi.mock('../state/configurationRequestStore', () => ({
  useConfigurationRequestStore: { getState: () => ({ openSettings: vi.fn() }) },
}));
import { ChartRendererUpgradeNotice } from './ChartRendererUpgradeNotice';

const plugin = (version: string, source: string, presets: Array<'bar' | 'line'> = ['bar']) =>
  createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      name: 'Chart',
      version,
      license: 'MIT',
      presets,
    },
    source,
    licenseText: 'MIT',
  });
const saved = plugin('1.3.1', 'export default {};');
const replacement = plugin('1.3.1', 'export default { apiVersion: 1 };');
const entry = (snapshot: typeof saved, trusted = true, enabled = true) => ({
  snapshot,
  trusted,
  enabled,
  installedAt: '',
});

beforeEach(() => {
  fixture.project = createProject();
  const chart = createChartLayer();
  if (chart.element.type !== 'chart') throw new Error('Expected chart');
  chart.element.provider = studioPluginReference(saved);
  fixture.project.compositions[0].layers.push(chart);
  fixture.project.compositions[0].rendererPlugins = [saved];
  fixture.installed = [];
  fixture.set = null;
  fixture.activeTemplateId = null;
  fixture.upgrade.mockClear();
});

describe('chart renderer update notice', () => {
  it('explains a same-version different build and requires an explicit action', () => {
    fixture.installed = [entry(replacement)];
    const html = renderToStaticMarkup(createElement(ChartRendererUpgradeNotice));
    expect(html).toContain('Saved chart renderer is unavailable');
    expect(html).toContain('a different installed build');
    expect(html).toContain(saved.sha256.slice(0, 8));
    expect(html).toContain(replacement.sha256.slice(0, 8));
    expect(html).toContain('Use this renderer for the template');
    expect(html).toContain('Review saved renderer instead');
    expect(fixture.upgrade).not.toHaveBeenCalled();
  });

  it('explains unavailable renderers when there is no trusted compatible update', () => {
    fixture.installed = [entry(replacement, false)];
    const html = renderToStaticMarkup(createElement(ChartRendererUpgradeNotice));
    expect(html).toContain('no compatible enabled update is available');
    expect(html).toContain('Review saved renderer');
    expect(html).not.toContain('Use this renderer for the template');
  });

  it('shows incompatibility and disables the action without changing a chart preset', () => {
    fixture.installed = [entry(plugin('2.0.0', 'export default {};', ['line']))];
    const html = renderToStaticMarkup(createElement(ChartRendererUpgradeNotice));
    expect(html).toContain('chart type not supported');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Use this renderer for the template/);
    expect(fixture.upgrade).not.toHaveBeenCalled();
  });

  it('identifies a blocked renderer in another template without changing the selected template', () => {
    const otherProject = structuredClone(fixture.project);
    fixture.project = createProject();
    fixture.set = { templates: [{ id: 'other', name: 'Sports', project: otherProject }] };
    fixture.activeTemplateId = 'current';
    const html = renderToStaticMarkup(createElement(ChartRendererUpgradeNotice));
    expect(html).toContain('Another template has an unavailable chart renderer');
    expect(html).toContain('Sports uses test.chart 1.3.1');
    expect(html).toContain('Select that template in the Templates pane');
    expect(fixture.upgrade).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('@ograf-editor/ograf-runtime', () => ({ createShaderRenderer: vi.fn() }));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createRendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  createShaderPackPluginSnapshot,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import {
  rendererPluginReference,
  type InstalledRendererPlugin,
} from '../state/pluginSettingsStore';
import { groupPluginTools, safePluginIcon } from './pluginTools';
import { PluginToolButtons } from './PluginsToolbar';

function installed(
  id: string,
  version: string,
  installedAt: string,
  enabled = true,
  trusted = true,
): InstalledRendererPlugin {
  return {
    snapshot: createRendererPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'chart',
        id,
        version,
        name: id === 'test.alpha' ? 'Alpha Charts' : 'Beta Charts',
        presets: ['bar', 'pie'],
        license: 'MIT',
      },
      source: 'export default {apiVersion:1,create(){}};',
      licenseText: 'MIT',
    }),
    installedAt,
    enabled,
    trusted,
  };
}

describe('Plugins toolbar provider grouping', () => {
  it('shows one tool per enabled trusted id, grouping versions and excluding unavailable code', () => {
    const alphaOld = installed('test.alpha', '1.0.0', '2026-10-04T10:00:00Z');
    const alphaNew = installed('test.alpha', '2.0.0', '2026-10-04T11:00:00Z');
    const beta = installed('test.beta', '1.0.0', '2026-10-04T12:00:00Z');
    const disabled = installed('test.disabled', '1.0.0', '2026-10-04T13:00:00Z', false);
    const untrusted = installed('test.untrusted', '1.0.0', '2026-10-04T14:00:00Z', true, false);
    const groups = groupPluginTools([alphaOld, alphaNew, beta, disabled, untrusted], null);
    expect(groups.map((group) => group.id)).toEqual(['test.alpha', 'test.beta']);
    expect(groups[0]!.versions.map((entry) => entry.snapshot.manifest.version)).toEqual([
      '2.0.0',
      '1.0.0',
    ]);
    expect(groups[0]!.preferred).toBe(alphaNew);
    const markup = renderToStaticMarkup(
      createElement(PluginToolButtons, { groups, onOpen: () => {} }),
    );
    expect(markup).not.toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('aria-expanded');
    expect(markup.match(/title="Open [^"]+ in Plugins"/g)).toHaveLength(2);
    expect(markup).not.toContain('built-in');
    expect(markup.match(/aria-label="Add chart with Alpha Charts"/g)).toHaveLength(1);
    expect(markup).not.toContain('test.disabled');
    expect(markup).not.toContain('test.untrusted');
    expect(markup).not.toContain('plugins-manage-button');
    expect(markup).not.toContain('Manage plugins');
    expect(markup.match(/<svg\b/g)).toHaveLength(2);
  });

  it('shows an empty managed toolbar without a built-in chart when no plugin is enabled', () => {
    const markup = renderToStaticMarkup(
      createElement(PluginToolButtons, { groups: [], onOpen: () => {} }),
    );
    expect(markup).toContain('No plugins enabled');
    expect(markup).toContain('Use Plugins → Add plugin.');
    expect(markup).not.toContain('plugins-manage-button');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('built-in');
  });

  it('keeps animation packs in their own apply gallery without chart-default substitution', () => {
    const make = (version: string) =>
      createAnimationPresetPluginSnapshot({
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          kind: 'animation-presets',
          id: 'test.motion',
          version,
          name: 'Motion pack',
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
    const old = {
      snapshot: make('1.0.0'),
      installedAt: '2026-10-04T10:00:00Z',
      enabled: true,
      trusted: true,
    };
    const next = {
      snapshot: make('1.0.1'),
      installedAt: '2026-10-04T11:00:00Z',
      enabled: true,
      trusted: true,
    };
    const chart = installed('test.alpha', '1.0.0', '2026-10-04T12:00:00Z');
    const groups = groupPluginTools([old, next, chart], rendererPluginReference(chart.snapshot));
    const group = groups.find((entry) => entry.id === 'test.motion')!;
    expect(group.kind).toBe('animation-presets');
    expect(group.versions).toHaveLength(2);
    expect(group.preferred).toBe(next);
    const markup = renderToStaticMarkup(
      createElement(PluginToolButtons, { groups, onOpen: () => {} }),
    );
    expect(markup.match(/aria-label="Apply animation from Motion pack"/g)).toHaveLength(1);
    expect(markup).toContain('Add chart with Alpha Charts');
    expect(markup).not.toContain('Add chart with Motion pack');
  });

  it('prefers the exact global default only within its own provider id', () => {
    const old = installed('test.alpha', '1.0.0', '2026-10-04T10:00:00Z');
    const recent = installed('test.alpha', '2.0.0', '2026-10-04T11:00:00Z');
    const other = installed('test.beta', '1.0.0', '2026-10-04T12:00:00Z');
    expect(
      groupPluginTools([old, recent, other], rendererPluginReference(old.snapshot))[0]!.preferred,
    ).toBe(old);
    expect(
      groupPluginTools([old, recent, other], rendererPluginReference(other.snapshot))[0]!.preferred,
    ).toBe(recent);
    expect(
      groupPluginTools(
        [{ ...old, enabled: false }, recent],
        rendererPluginReference(old.snapshot),
      )[0]!.preferred,
    ).toBe(recent);
  });

  it('groups shader-pack versions into a shader gallery, not chart or animation creation', () => {
    const make = (version: string, installedAt: string) => ({
      snapshot: createShaderPackPluginSnapshot({
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          kind: 'shader-pack',
          id: 'test.shaders',
          version,
          name: 'Shader pack',
          license: 'CC0-1.0',
        },
        shaders: [{ id: 'waves', name: 'Waves', targets: ['fill'], paint: createShaderPaint() }],
        licenseText: 'CC0-1.0',
      }),
      installedAt,
      enabled: true,
      trusted: true,
    });
    const old = make('1.0.0', '2026-10-05T10:00:00Z');
    const next = make('1.0.1', '2026-10-05T11:00:00Z');
    const chart = installed('test.alpha', '1.0.0', '2026-10-05T12:00:00Z');
    const groups = groupPluginTools(
      [old, next, { ...old, enabled: false }, { ...old, trusted: false }, chart],
      rendererPluginReference(chart.snapshot),
    );
    const shaders = groups.find((group) => group.id === 'test.shaders')!;
    expect(shaders.kind).toBe('shader-pack');
    expect(shaders.versions).toHaveLength(2);
    expect(shaders.preferred).toBe(next);
    const markup = renderToStaticMarkup(
      createElement(PluginToolButtons, { groups, onOpen: () => {} }),
    );
    expect(markup.match(/aria-label="Apply shader from Shader pack"/g)).toHaveLength(1);
    expect(markup).not.toContain('Add chart with Shader pack');
    expect(markup).not.toContain('Apply animation from Shader pack');
  });

  it('never exposes remote, SVG or executable icons as image sources', () => {
    expect(safePluginIcon('https://example.test/icon.png')).toBeUndefined();
    expect(safePluginIcon('javascript:alert(1)')).toBeUndefined();
    expect(safePluginIcon('data:image/svg+xml;base64,PHN2Zy8+')).toBeUndefined();
    expect(safePluginIcon(`data:image/png;base64,${'A'.repeat(44_000)}`)).toBeUndefined();
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQIW2P4z8AAAAMBAQAY8Q0AAAAASUVORK5CYII=';
    expect(safePluginIcon(png)).toBe(png);
    const record = installed('test.alpha', '1.0.0', '2026-10-04T10:00:00Z');
    record.snapshot.manifest.icon = png;
    const markup = renderToStaticMarkup(
      createElement(PluginToolButtons, {
        groups: groupPluginTools([record], null),
        onOpen: () => {},
      }),
    );
    expect(markup).toContain(`src="${png}"`);
    expect(markup).not.toContain('<script');
  });
});

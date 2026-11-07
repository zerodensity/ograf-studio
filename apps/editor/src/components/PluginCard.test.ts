import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createShaderPackPluginSnapshot,
  createShaderPaint,
  rendererPluginKey,
  studioPluginReference,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import { pluginPanelGroups } from '../panels/pluginPanelSelection';
import { PluginCard } from './PluginCard';

function pack(suffix = '') {
  return createShaderPackPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'shader-pack',
      id: 'example.card',
      version: '1.0.0',
      name: 'Test shader pack',
      license: 'CC0-1.0',
    },
    shaders: [
      {
        id: 'flow',
        name: 'Gradient Flow',
        targets: ['fill'],
        paint: createShaderPaint({
          fragmentSource: `void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }\n${suffix}`,
        }),
      },
    ],
    licenseText: 'Fixture notice',
  });
}
const installed = (snapshot: StudioPluginSnapshot, enabled = true, trusted = true) => ({
  snapshot,
  enabled,
  trusted,
  installedAt: '2026-10-05T12:00:00Z',
});
const key = (snapshot: StudioPluginSnapshot) => rendererPluginKey(studioPluginReference(snapshot));

describe('plugin card version selector', () => {
  it('adds a dedicated settings gear to each manageable card without nesting controls or running actions', () => {
    const group = pluginPanelGroups([installed(pack())], [], null)[0]!;
    const onManage = vi.fn();
    for (const selected of [true, false]) {
      const markup = renderToStaticMarkup(
        createElement(PluginCard, {
          group,
          selected,
          onSelect: () => {},
          onSelectVersion: () => {},
          onManage,
        }),
      );
      expect(markup.match(/<button\b/g)).toHaveLength(2);
      expect(markup).toContain('class="plugins-panel-plugin-settings"');
      expect(markup).toContain('aria-label="Settings for Test shader pack"');
      expect(markup).toContain('<svg');
      const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!;
      for (const button of buttons) expect(button).not.toContain('<select');
      expect(onManage).not.toHaveBeenCalled();
    }
  });
  it('puts one accessible selected-version control beside, never inside, the selection button', () => {
    const entries = [installed(pack())];
    const before = structuredClone(entries);
    const group = pluginPanelGroups(entries, [], null)[0]!;
    const onSelect = vi.fn(),
      onSelectVersion = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(PluginCard, { group, selected: true, onSelect, onSelectVersion }),
    );
    const button = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/)![0];
    expect(markup.match(/<article\b/g)).toHaveLength(1);
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup.match(/<select\b/g)).toHaveLength(1);
    expect(button).toContain('aria-pressed="true"');
    expect(button).not.toContain('<select');
    expect(markup.indexOf('</button>')).toBeLessThan(markup.indexOf('<select'));
    expect(markup).toContain('aria-label="Active version for Test shader pack"');
    expect(markup).not.toContain('plugins-panel-status');
    expect(entries).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSelectVersion).not.toHaveBeenCalled();
  });

  it('keeps an inactive card as a selection button without a duplicate selector or status', () => {
    const group = pluginPanelGroups([installed(pack())], [], null)[0]!;
    const markup = renderToStaticMarkup(
      createElement(PluginCard, {
        group,
        selected: false,
        onSelect: () => {},
        onSelectVersion: () => {},
      }),
    );
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('plugins-panel-status');
    expect(markup).not.toContain('is-selected');
  });

  it('retains exact hash identities and disambiguates equal version labels by SHA suffix', () => {
    const first = pack('// first bytes'),
      second = pack('// different bytes');
    const entries = [installed(first), installed(second)];
    const before = structuredClone(entries);
    const group = pluginPanelGroups(entries, [], null)[0]!;
    const markup = renderToStaticMarkup(
      createElement(PluginCard, {
        group,
        selected: true,
        versionKey: key(second),
        onSelect: () => {},
        onSelectVersion: () => {},
      }),
    );
    expect(markup.match(/<option\b/g)).toHaveLength(2);
    expect(markup.match(/selected=""/g)).toHaveLength(1);
    expect(markup).toContain(
      `<option value="${key(second)}" selected="">1.0.0 · ${second.sha256.slice(0, 8)}</option>`,
    );
    expect(markup).toContain(
      `<option value="${key(first)}">1.0.0 · ${first.sha256.slice(0, 8)}</option>`,
    );
    expect(first.sha256).not.toBe(second.sha256);
    expect(entries).toEqual(before);
  });

  it.each([
    [false, true, 'Disabled'],
    [true, false, 'Needs review'],
    [false, false, 'Needs review'],
    [true, true, null],
  ] as const)(
    'reflects enable/review flags without modifying them (%s, %s)',
    (enabled, trusted, label) => {
      const entries = [installed(pack(), enabled, trusted)];
      const before = structuredClone(entries);
      const group = pluginPanelGroups(entries, [], null)[0]!;
      const onSelect = vi.fn(),
        onSelectVersion = vi.fn();
      const markup = renderToStaticMarkup(
        createElement(PluginCard, { group, selected: true, onSelect, onSelectVersion }),
      );
      if (label) expect(markup).toContain(`>${label}</span>`);
      else expect(markup).not.toContain('plugins-panel-status');
      expect(markup).not.toContain('plugins-panel-status is-active');
      expect(markup).not.toContain('>Active</span>');
      expect(markup).toContain(
        `<option value="${key(entries[0]!.snapshot)}" selected="">1.0.0</option>`,
      );
      expect(entries).toEqual(before);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onSelectVersion).not.toHaveBeenCalled();
    },
  );

  it('does not borrow an exact version from another plugin when a remembered key is unavailable', () => {
    const current = pack();
    const other = createShaderPackPluginSnapshot({
      manifest: { ...current.manifest, id: 'example.other' },
      shaders: current.shaders,
      licenseText: current.licenseText,
    });
    const groups = pluginPanelGroups([installed(current), installed(other)], [], null);
    const group = groups.find((entry) => entry.id === current.manifest.id)!;
    const markup = renderToStaticMarkup(
      createElement(PluginCard, {
        group,
        selected: true,
        versionKey: key(other),
        onSelect: () => {},
        onSelectVersion: () => {},
      }),
    );
    expect(markup).toContain(`<option value="${key(current)}" selected="">1.0.0</option>`);
    expect(markup).not.toContain(key(other));
  });
});

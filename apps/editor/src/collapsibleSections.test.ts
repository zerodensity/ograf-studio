import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('dock pane disclosure sections', () => {
  it.each([
    ['./panels/LayerListPanel.tsx', 'layers'],
    ['./panels/AgentChatPanel.tsx', 'assistant'],
    ['./panels/BrandKitPanel.tsx', 'brand-kit'],
    ['./panels/DataPanel.tsx', 'data'],
    ['./panels/InspectorPanel.tsx', 'properties'],
    ['./panels/CompositionSettings.tsx', 'properties'],
    ['./panels/EffectStackEditor.tsx', 'properties'],
    ['./panels/SingleTemplatePreviewExportPanel.tsx', 'preview'],
    ['./panels/TimelinePanel.tsx', 'timeline'],
  ])('%s exposes remembered collapsible groups', (path, prefix) => {
    const text = source(path);
    expect(text).toContain('CollapsibleSection');
    if (path.endsWith('CompositionSettings.tsx')) {
      expect(text).toContain("mode === 'settings' ? 'settings.template' : 'properties'");
      expect(text).toContain("sectionId={sectionId('composition')}");
    } else expect(text).toContain(`sectionId="${prefix}.`);
  });

  it('routes the Preview & Export dock pane to its remembered single-template sections', () => {
    const wrapper = source('./panels/PreviewExportPanel.tsx');
    const panel = source('./panels/SingleTemplatePreviewExportPanel.tsx');
    expect(wrapper).toContain("from './SingleTemplatePreviewExportPanel'");
    expect(wrapper).toContain('return <SingleTemplatePreviewExportPanel />');
    for (const id of ['playback', 'broadcast-qa', 'export'])
      expect(panel).toContain(`sectionId="preview.${id}"`);
  });

  it('retains the existing native disclosure tree in Resources', () => {
    const text = source('./panels/ResourceTreeComponents.tsx');
    expect(text.match(/<details/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('<summary>');
  });

  it('uses an accessible shared summary with remembered state', () => {
    const component = source('./components/CollapsibleSection.tsx');
    const css = source('./components/CollapsibleSection.css');
    expect(component).toContain('<summary');
    expect(component).toContain('event.preventDefault()');
    expect(component).toContain('localStorage.setItem');
    expect(css).toContain("content: '▸';");
    expect(css).toContain("content: '▾';");
    expect(css).toContain(':focus-visible');
  });

  it('indents effect disclosures beneath the collapsible stack header', () => {
    const css = source('./panels/EffectStackEditor.css');
    expect(css).toMatch(
      /\.effect-stack-list\s*\{[^}]*margin-left: 10px;[^}]*padding-left: 4px;[^}]*border-left:/s,
    );
  });
});

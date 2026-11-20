import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COMPOSITION_PRESETS } from '../panels/compositionPresets';
import {
  resolveStartupSettings,
  STARTUP_FRAME_RATES,
  STARTUP_SIZES,
  startupRateLabel,
} from './startupSettings';

const fixture = vi.hoisted(() => ({
  kind: 'startup' as 'startup' | 'new-template' | 'new-set' | 'set-template' | 'second-template',
}));

vi.mock('./useMovableDialog', () => ({
  useMovableDialog: () => ({ dialogProps: {}, handleProps: {} }),
}));
vi.mock('../state/buildInfo', () => ({
  STUDIO_VERSION: '0.23.0-test',
  STUDIO_BUILD_DATE: '2026-11-02',
  STUDIO_BUILD_REVISION: '1234abcd',
}));
vi.mock('../state/startupScreenStore', () => ({
  useStartupScreenStore: (
    selector: (state: { visible: boolean; request: { kind: typeof fixture.kind } }) => unknown,
  ) => selector({ visible: true, request: { kind: fixture.kind } }),
}));

import { StartupScreen } from './StartupScreen';

describe('startup settings', () => {
  beforeEach(() => {
    fixture.kind = 'startup';
  });

  it('offers only standard preset rates and sizes, with exact NTSC timing', () => {
    for (const preset of COMPOSITION_PRESETS) {
      expect(STARTUP_FRAME_RATES).toContain(preset.frameRate);
      expect(STARTUP_SIZES).toContainEqual({ width: preset.width, height: preset.height });
    }
    expect(STARTUP_FRAME_RATES).toEqual([50, 60_000 / 1_001]);
    expect(startupRateLabel(60_000 / 1_001)).toBe('59.94');
    expect(resolveStartupSettings('1920', '1080', String(60_000 / 1_001))?.frameRate).toBe(
      60_000 / 1_001,
    );
  });

  it('renders the shared preset choices and both Custom entries', () => {
    const markup = renderToStaticMarkup(createElement(StartupScreen));
    for (const label of ['50 fps', '59.94 fps']) expect(markup).toContain(label);
    for (const label of ['23.976 fps', '24 fps', '25 fps', '29.97 fps', '30 fps', '60 fps'])
      expect(markup).not.toContain(`>${label}</option>`);
    expect(markup.match(/value="custom"/g)).toHaveLength(2);
    expect(markup).toContain('1920 × 1080');
    expect(markup).toContain('3840 × 2160');
    expect(markup).not.toContain('· 9:16');
  });

  it('lists only the two standard sizes while retaining arbitrary custom dimensions', () => {
    expect(STARTUP_SIZES).toEqual([
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ]);
    expect(resolveStartupSettings('1080', '1920', '25')).toEqual({
      width: 1080,
      height: 1920,
      frameRate: 25,
    });
  });

  it.each(['startup', 'new-template', 'new-set', 'set-template', 'second-template'] as const)(
    'shows Studio branding, build details and the public GitHub link for %s',
    (kind) => {
      fixture.kind = kind;
      const markup = renderToStaticMarkup(createElement(StartupScreen));
      expect(markup).toContain('class="ograf-logo ograf-logo-section"');
      expect(markup).toContain('Version 0.23.0-test');
      expect(markup).toContain('Build 1234abcd');
      expect(markup).toContain('dateTime="2026-11-02"');
      expect(markup).toContain('href="https://github.com/zerodensity/ograf-studio"');
      expect(markup).toContain('rel="noopener noreferrer"');
    },
  );

  it('renders new-set as the template set settings dialog, without the explorer', () => {
    fixture.kind = 'new-set';
    const markup = renderToStaticMarkup(createElement(StartupScreen));
    expect(markup).toContain('<h1 id="startup-title">New template set</h1>');
    expect(markup).toContain('class="startup-screen-header"');
    expect(markup).toContain('class="startup-screen-grip"');
    expect(markup).toContain('aria-label="Close without creating"');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('Create set from current template');
    expect(markup).not.toContain('project-explorer');
  });

  it.each([
    ['startup', 'Start creating', true],
    ['new-template', 'New template', true],
    ['set-template', 'New template', false],
    ['second-template', 'New template', false],
  ] as const)(
    'renders %s as the project explorer with the choices that request allows',
    (kind, title, offersExamples) => {
      fixture.kind = kind;
      const markup = renderToStaticMarkup(createElement(StartupScreen));
      expect(markup).toContain(`<h1 id="project-explorer-title">${title}</h1>`);
      expect(markup).toContain(
        kind === 'startup'
          ? 'aria-label="Close welcome screen"'
          : 'aria-label="Close without creating"',
      );
      // Opening another document belongs to the first window only; the rest create in place.
      for (const choice of ['Open file…', 'Import .ograf.zip…', 'Recent', 'Don’t show on startup'])
        expect(markup.includes(choice)).toBe(kind === 'startup');
      expect(markup).toContain('Create blank project');
      expect(markup).toContain('data-explorer-card="blank"');
      for (const recipe of ['lower-third', 'bug', 'ticker', 'scoreboard', 'clock', 'countdown'])
        expect(markup).toContain(`data-explorer-card="recipe-${recipe}"`);
      // Adding a template to an open set starts from a blank or a recipe, never an example.
      expect(markup.includes('Search recipes and examples…')).toBe(offersExamples);
      expect(markup.includes('<span>Examples</span>')).toBe(offersExamples);
      expect(markup.includes('<span>Online</span>')).toBe(offersExamples);
    },
  );

  it('accepts custom dimensions and arbitrary positive fractional fps without rounding', () => {
    expect(resolveStartupSettings('1080', '1920', '47.952')).toEqual({
      width: 1080,
      height: 1920,
      frameRate: 47.952,
    });
    expect(resolveStartupSettings('4096', '2160', '120')).toEqual({
      width: 4096,
      height: 2160,
      frameRate: 120,
    });
  });

  it.each([
    ['', '1080', '25'],
    ['0', '1080', '25'],
    ['1920.5', '1080', '25'],
    ['1920', '-1', '25'],
    ['1920', '1080', ''],
    ['1920', '1080', '0'],
    ['1920', '1080', 'Infinity'],
    ['1920', '1080', 'not-a-rate'],
  ])('rejects invalid drafts %s × %s at %s fps', (width, height, fps) => {
    expect(resolveStartupSettings(width, height, fps)).toBeNull();
  });
});

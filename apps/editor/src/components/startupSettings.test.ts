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

  it.each([
    ['startup', 'Start creating', false, true, true],
    ['new-template', 'New template', true, false, true],
    ['new-set', 'New template set', true, false, false],
    ['set-template', 'New template', true, false, true],
    ['second-template', 'New template', true, false, true],
  ] as const)(
    'renders %s with the appropriate creation, cancel and open choices',
    (kind, title, cancellable, canOpen, hasRecipes) => {
      fixture.kind = kind;
      const markup = renderToStaticMarkup(createElement(StartupScreen));
      expect(markup).toContain(`<h1 id="startup-title">${title}</h1>`);
      expect(markup).toContain('class="startup-screen-header"');
      expect(markup).toContain('class="startup-screen-grip"');
      expect(markup).not.toContain('startup-screen-drag-label');
      expect(markup).toContain(
        kind === 'startup'
          ? 'aria-label="Close welcome screen"'
          : 'aria-label="Close without creating"',
      );
      expect(markup).toContain('>×</span> Close</button>');
      expect(markup.includes('>Cancel</button>')).toBe(cancellable);
      expect(markup.includes('Open .ogs or template set…')).toBe(canOpen);
      expect(markup.includes('Import .ograf.zip…')).toBe(canOpen);
      expect(markup.includes('New from a recipe')).toBe(hasRecipes);
      expect(markup.includes('Don’t show on startup')).toBe(kind === 'startup');
      expect(markup).toContain(
        kind === 'new-set' ? 'Create set from current template' : 'Blank template',
      );
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

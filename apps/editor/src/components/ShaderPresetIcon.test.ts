import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShaderPresetIcon } from './ShaderPresetIcon';

const NAMES = [
  'Gradient Flow',
  'Shine Sweep',
  'Breaking Stripes',
  'Bokeh Lights',
  'Flow Lines',
  'Data Grid',
  'Light Rays',
  'Glass Panel',
  'Edge Glow',
  'Drifting Clouds',
  'Aurora Curtains',
  'Warp Stars',
  'Sunset Sea',
  'Water Caustics',
  'Hex Pulse',
  'Energy Orb',
  'Ink Smoke',
  'Lens Flare',
  'Neon Tunnel',
  'Signal Glitch',
];
const render = (name: string, id?: string) =>
  renderToStaticMarkup(createElement(ShaderPresetIcon, { name, id }));

describe('inert shader preset symbols', () => {
  it('gives every News preset a different lightweight glyph without shader/image execution', () => {
    const shapes = NAMES.map((name) => {
      const markup = render(name);
      expect(markup).toContain('viewBox="0 0 64 40"');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('focusable="false"');
      expect(markup).toContain('currentColor');
      expect(markup).not.toMatch(
        /<canvas|<image|<img|<script|<animate|foreignObject|href=|data:image|mainImage|thumbnail|license/i,
      );
      expect(markup).not.toContain('data-shader-icon="generic"');
      return markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
    });
    expect(new Set(shapes).size).toBe(20);
  });

  it('uses normalized numbered names or IDs without reading GLSL', () => {
    expect(render(' 01 · GRADIENT flow ')).toBe(render('Gradient Flow'));
    expect(render('A custom label', '20-signal-glitch')).toBe(render('Signal Glitch'));
    expect(render('Unrecognized', '13-sunset-sea.glsl')).toBe(render('Sunset Sea'));
    expect(render('Bokeh_Lights')).toBe(render('Bokeh Lights'));
    expect(render('EnergyOrb')).toBe(render('Energy Orb'));
  });

  it('uses a neutral generic glyph for arbitrary third-party names, without exposing raw text as SVG', () => {
    const generic = render('Unknown preset', 'plugin.custom');
    expect(generic).toContain('data-shader-icon="generic"');
    expect(render('<script>alert(1)</script>', 'constructor')).toBe(generic);
    expect(render('A different third-party preset', '__proto__')).toBe(generic);
    expect(render('Gradient Flow', '20-signal-glitch')).toBe(render('Gradient Flow'));
  });
});

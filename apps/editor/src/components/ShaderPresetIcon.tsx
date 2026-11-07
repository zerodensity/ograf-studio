interface Glyph {
  paths?: readonly string[];
  fills?: readonly string[];
  circles?: readonly [x: number, y: number, radius: number, opacity?: number][];
  frames?: readonly [x: number, y: number, width: number, height: number, radius?: number][];
}

/** Original symbolic glyphs, not rendered shader thumbnails or source-derived previews. */
const GLYPHS: Record<string, Glyph> = {
  gradientflow: {
    paths: ['M3 13C16 1 24 30 38 15S53 11 61 7', 'M3 27C18 14 25 38 39 25S53 22 61 18'],
    fills: ['M3 18C16 6 24 35 38 20S53 16 61 12V17C48 19 46 32 36 28S14 13 3 23Z'],
  },
  shinesweep: {
    frames: [[6, 8, 51, 25, 3]],
    fills: ['M19 8h8l14 25h-8Z'],
    paths: ['m48 4 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z'],
  },
  breakingstripes: {
    fills: ['M4 32 16 6h7L11 32Z', 'M20 32 32 6h7L27 32Z', 'M36 32 48 6h7L43 32Z'],
    paths: ['M3 4h58M3 35h58'],
  },
  bokehlights: {
    circles: [
      [13, 12, 7, 0.3],
      [32, 21, 10, 0.45],
      [49, 10, 5, 0.7],
      [52, 31, 6, 0.25],
      [12, 32, 3, 0.7],
    ],
  },
  flowlines: {
    paths: ['M8 36C46 33 2 10 23 3', 'M25 37C55 28 19 10 38 3', 'M43 37C67 24 40 14 53 4'],
  },
  datagrid: {
    frames: [[9, 5, 46, 30, 1]],
    paths: ['M9 15h46M9 25h46M24 5v30M40 5v30'],
    fills: ['M25 16h14v8H25Z', 'M10 6h13v8H10Z'],
  },
  lightrays: {
    circles: [[32, 34, 3, 1]],
    paths: ['M27 29 7 13M29 26 20 4M32 25V3M35 26 44 4M37 29 57 13M24 33 4 29M40 33l20-4'],
  },
  glasspanel: {
    frames: [
      [7, 11, 39, 24, 3],
      [18, 5, 39, 24, 3],
    ],
    fills: ['M19 6h14l23 22H42Z'],
    paths: ['M25 10h13M25 14h8'],
  },
  edgeglow: {
    frames: [
      [10, 6, 44, 28, 4],
      [14, 10, 36, 20, 2],
    ],
    paths: ['M4 14V3h13M47 3h13v11M4 26v11h13M47 37h13V26'],
  },
  driftingclouds: {
    fills: ['M12 29a7 7 0 0 1 0-14 10 10 0 0 1 19-3 8 8 0 0 1 13 7 5 5 0 0 1 0 10Z'],
    paths: ['M39 9h17M46 15h14M10 34h27'],
  },
  auroracurtains: {
    fills: ['M10 4c12 3-7 21 7 32h7C10 24 32 11 17 4Z', 'M31 4c12 4-8 20 4 32h7C27 22 50 10 38 4Z'],
    paths: ['M5 34q26-7 54 0', 'M48 4c9 10-7 19 6 29'],
  },
  warpstars: {
    paths: ['M26 16 8 5M28 22 5 30M38 16 57 5M37 24 56 35M32 12V3M32 28v9M41 20h20M23 20H3'],
    fills: ['m32 14 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z'],
  },
  sunsetsea: {
    paths: ['M19 21a13 13 0 0 1 26 0M4 22h56M5 29q8-5 16 0t16 0 16 0M12 35h39'],
    fills: ['M22 21a10 10 0 0 1 20 0Z'],
  },
  watercaustics: {
    paths: [
      'M3 12C14 28 19 2 31 17S49 1 61 13',
      'M2 29C15 12 18 38 33 23S47 36 62 25',
      'M15 3c13 10-11 18 2 34',
      'M44 3c-13 11 13 19-1 34',
    ],
  },
  hexpulse: {
    paths: [
      'm32 3 18 9v16L32 37 14 28V12Z',
      'm32 11 10 5v8l-10 5-10-5v-8Z',
      'M14 12l8 4M50 12l-8 4M32 3v8M32 29v8M14 28l8-4M50 28l-8-4',
    ],
  },
  energyorb: {
    circles: [
      [32, 20, 12, 0.18],
      [32, 20, 5, 0.6],
    ],
    paths: ['M22 10c18-12 31 6 21 18S14 29 22 10Z', 'M8 26c-5-10 37-24 49-13S22 43 8 26Z'],
  },
  inksmoke: {
    paths: [
      'M11 35C-1 18 34 28 22 13s12-12 18-8',
      'M26 36c-19-14 21-11 9-26',
      'M39 36c25-13-13-18 12-29',
      'M8 31c5-4 14-5 18 0',
    ],
  },
  lensflare: {
    paths: ['M3 18h57M21 3v30m-7-22 7 7 7-7m-14 14 7-7 7 7'],
    circles: [
      [21, 18, 3, 1],
      [37, 24, 4, 0.25],
      [53, 31, 7, 0.2],
    ],
  },
  neontunnel: {
    paths: [
      'M8 4h48l6 8v16l-6 8H8l-6-8V12Z',
      'M18 10h28l5 5v10l-5 5H18l-5-5V15Z',
      'M27 16h10l3 3v3l-3 3H27l-3-3v-3Z',
      'M2 12l11 3m38 0 11-3M2 28l11-3m38 0 11 3',
    ],
  },
  signalglitch: {
    paths: ['M4 9h20v5h19V8h17M4 22h15v-5h18v10h23M4 33h25v-5h16v6h15'],
    fills: ['M8 4h12v3H8Z', 'M43 17h17v3H43Z', 'M7 26h9v3H7Z'],
  },
  generic: {
    frames: [[6, 5, 52, 30, 3]],
    paths: ['m19 13-7 7 7 7m26-14 7 7-7 7M25 24q7-10 14-2'],
  },
};

function familyKey(value: string): string {
  return value
    .trim()
    .replace(/\.glsl$/i, '')
    .replace(/^\d+[\s._:·/-]*/, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function ShaderPresetIcon({ name, id }: { name: string; id?: string }) {
  const nameKey = familyKey(name);
  const idKey = familyKey(id ?? '');
  const family = Object.hasOwn(GLYPHS, nameKey)
    ? nameKey
    : Object.hasOwn(GLYPHS, idKey)
      ? idKey
      : 'generic';
  const glyph = GLYPHS[family]!;
  return (
    <svg
      className="shader-preset-icon"
      data-shader-icon={family}
      viewBox="0 0 64 40"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--accent, #5bc8fa)' }}
    >
      {glyph.frames?.map(([x, y, width, height, radius], index) => (
        <rect key={`frame-${index}`} x={x} y={y} width={width} height={height} rx={radius ?? 0} />
      ))}
      {glyph.fills?.map((d, index) => (
        <path key={`fill-${index}`} d={d} fill="currentColor" fillOpacity="0.35" stroke="none" />
      ))}
      {glyph.paths?.map((d, index) => (
        <path key={`path-${index}`} d={d} />
      ))}
      {glyph.circles?.map(([cx, cy, r, opacity], index) => (
        <circle
          key={`circle-${index}`}
          cx={cx}
          cy={cy}
          r={r}
          fill="currentColor"
          fillOpacity={opacity ?? 0.35}
        />
      ))}
    </svg>
  );
}

/** Author the editable AXIS Markets set through a running Studio MCP endpoint. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTextElement } from '../../packages/scene-model/src/factory.ts';
import { createShaderPaint } from '../../packages/scene-model/src/shader.ts';
import { getLayerTransformAtFrame } from '../../packages/scene-model/src/layerAnimation.ts';
import {
  createPublicMarketsProvider,
  publicMarketFieldKeys,
} from '../../apps/editor/src/data/publicMarkets.ts';

const endpoint = process.env.OGRAF_MCP_URL ?? 'http://127.0.0.1:5242/mcp';
const feedUrl = process.env.AXIS_FEED_URL;
const statePath = process.env.AXIS_BUILD_STATE ?? '.axis-build-state.json';
const originalPrompt = process.env.AXIS_ORIGINAL_PROMPT;
if (!originalPrompt?.trim())
  throw new Error('Set AXIS_ORIGINAL_PROMPT to the original user request.');
async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(600000),
  });
  const body = await response.text();
  const data = body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .at(-1);
  const rpc = JSON.parse(data ? data.slice(6) : body);
  if (rpc.error) throw Error(JSON.stringify(rpc.error));
  const raw = rpc.result.content.find((c: any) => c.type === 'text')?.text;
  let result = rpc.result.structuredContent;
  if (result === undefined) {
    try {
      result = JSON.parse(raw);
    } catch {
      throw Error(raw);
    }
  }
  if (rpc.result.isError) throw Error(JSON.stringify(result));
  return result;
}
async function project() {
  let last = await call('ograf_get_project');
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const next = await call('ograf_get_project');
    const caps = await call('ograf_get_capabilities', { sections: ['editor'] });
    if (next.revision === last.revision && caps.editor?.responsive) return next;
    last = next;
  }
  throw Error('Studio is still updating; resume after it settles.');
}
async function apply(operations: any[], reason: string) {
  const s = await project();
  const r = await call('ograf_apply_operations', {
    expectedRevision: s.revision,
    operations,
    reason,
  });
  if (r.validation?.valid === false) throw Error(JSON.stringify(r.validation));
  return r;
}
async function setOperation(operation: any) {
  await project();
  const s = await call('ograf_get_template_set');
  return call('ograf_update_template_set', {
    expectedRevision: s.revision,
    operation,
    confirm: true,
  });
}
let state: any;
try {
  state = JSON.parse(await readFile(statePath, 'utf8'));
} catch {
  state = { templates: {} };
}
async function checkpoint() {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}
const font = 'Roboto Condensed, Arial Narrow, Arial, sans-serif';
// Every independently operated panel retains the same 16 px outer gutter.
const panelGap = 16;
const primaryTickerY = 988;
const tickerHeight = 52;
const fxTickerY = primaryTickerY - tickerHeight - panelGap;
const watchY = primaryTickerY - 68 - panelGap;
const watchCardWidth = (1792 - panelGap * 2) / 3;
const headlineY = primaryTickerY - 118 - panelGap;
const boardY = 142 + panelGap;
const boardBottom = primaryTickerY - panelGap;
const palette = {
  navy: '#081521',
  panel: '#102637',
  cyan: '#56e2ed',
  white: '#f3f7f5',
  muted: '#9eb3c1',
  gold: '#f3c678',
  up: '#46e2aa',
  down: '#ff6e78',
};
const nativeFeed = createPublicMarketsProvider();
const feed = feedUrl ? await (await fetch(feedUrl)).json() : await nativeFeed.fetchSnapshot();
nativeFeed.dispose();
feed.cryptoStatus = 'SAVED SNAPSHOT';
async function attachNativeConnection() {
  const snapshot = await project();
  const composition = snapshot.project.compositions[0];
  const keys = new Set(publicMarketFieldKeys());
  const mappings = composition.dataFields
    .filter((field: any) => keys.has(field.key))
    .map((field: any) => ({ fieldId: field.id, sourcePath: field.key }));
  if (!mappings.length) return;
  const connection = {
    name: 'AXIS · Coinbase + ECB',
    source: 'public-markets',
    format: 'json',
    target: 'both',
    refreshMs: 5000,
    missing: 'keep-last',
    enabled: true,
    mappings,
  };
  const existing = composition.dataConnections.find((entry: any) => entry.name === connection.name);
  await apply(
    [
      existing
        ? { type: 'update_data_connection', connectionId: existing.id, patch: connection }
        : { type: 'add_data_connection', connection },
    ],
    'Connect this template to native public market data',
  );
}
const workspace = (await (await fetch(new URL('/health', endpoint))).json()).workspaceRoot;
await mkdir(resolve(workspace, 'AXIS Markets/assets'), { recursive: true });
await copyFile(
  new URL(
    '../../packages/scene-model/assets/fonts/roboto-condensed/RobotoCondensed.ttf',
    import.meta.url,
  ),
  resolve(workspace, 'AXIS Markets/assets/RobotoCondensed.ttf'),
);
const license = await readFile(
  new URL('../../packages/scene-model/assets/fonts/roboto-condensed/OFL.txt', import.meta.url),
  'utf8',
);
if (!state.started) {
  const old = await project();
  await writeFile(
    resolve(workspace, 'AXIS Markets/previous-session-backup.json'),
    JSON.stringify(old),
  );
  await call('ograf_reset_project', {
    expectedRevision: old.revision,
    confirm: true,
    originalPrompt,
  });
  await setOperation({ type: 'create', name: 'AXIS Markets · Live Economy' });
  await setOperation({
    type: 'set_defaults',
    patch: {
      width: 1920,
      height: 1080,
      frameRate: 50,
      backgroundColor: 'transparent',
      supportsRealTime: true,
      supportsNonRealTime: true,
      updateTransitionFrames: 10,
    },
  });
  await setOperation({
    type: 'set_brand_kit',
    brandKit: {
      name: 'AXIS · Global Economy',
      tokens: Object.entries(palette).map(([key, value]) => ({
        id: `axis-${key}`,
        key: `axis.${key}`,
        name: key,
        type: 'color',
        value,
        description: 'AXIS Markets palette',
      })),
    },
  });
  state.started = true;
  await checkpoint();
}
const gradient = (a: string, b: string) => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: a, opacity: 1 },
    { offset: 1, color: b, opacity: 1 },
  ],
});
const glass = createShaderPaint({
  name: 'AXIS / Market glass',
  fragmentSource: `void mainImage(out vec4 c,in vec2 p){ vec2 uv=p/iResolution.xy; vec2 q=vec2(uv.x*iResolution.x/iResolution.y,uv.y); float line=1.-smoothstep(.005,.014,abs(fract(q.x*.8+q.y*.15)-.5)); float sweep=pow(max(0.,1.-abs(uv.x-fract(iTime*.045))*6.),4.); vec3 ink=mix(vec3(.031,.071,.11),vec3(.06,.15,.20),uv.x); ink+=vec3(.05,.22,.25)*line*.16+vec3(.11,.25,.28)*sweep*.15; c=vec4(ink,.97);}`,
  parameters: {},
});
let ops: any[] = [];
let authored: { name: string; y: number }[] = [];
function rect(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: any,
  radius = 0,
) {
  ops.push({
    type: 'add_layer',
    kind: 'rectangle',
    name,
    transform: { x, y, width, height },
    element: { fill, borderRadius: radius, strokeWidth: 0 },
  });
  authored.push({ name, y });
}
function text(
  name: string,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 32,
  color = palette.white,
  weight = 600,
  align = 'left',
) {
  const { direction: _direction, ...element } = createTextElement({
    content,
    fontFamily: font,
    fontSize: size,
    minFontSize: size * 0.85,
    fontWeight: weight,
    color,
    textAlign: align as any,
    verticalAlign: 'middle',
    autoFit: 'shrink-to-fit',
    overflowPolicy: 'clip',
    lineHeight: 1,
    letterSpacing: 0,
  });
  ops.push({ type: 'add_layer', kind: 'text', name, transform: { x, y, width, height }, element });
  authored.push({ name, y });
}
function field(key: string, value: any, target: string, property = 'content', type = 'text') {
  ops.push({
    type: 'add_data_field',
    fieldType: type,
    key,
    label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    defaultValue: value,
  });
  const existing = ops.find((op) => op.type === 'set_layer_bindings' && op.layerName === target);
  if (existing) existing.bindings.push({ fieldKey: key, targetProperty: property });
  else
    ops.push({
      type: 'set_layer_bindings',
      layerName: target,
      bindings: [{ fieldKey: key, targetProperty: property }],
    });
}
function schema(key: string, v: any): any {
  if (Array.isArray(v))
    return { key, fieldType: 'array', items: schema('item', v[0] ?? ''), defaultValue: v };
  if (v && typeof v === 'object')
    return {
      key,
      fieldType: 'object',
      properties: Object.entries(v).map(([k, x]) => schema(k, x)),
      defaultValue: v,
    };
  return {
    key,
    fieldType: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text',
    defaultValue: v ?? '',
  };
}
function ticker(key: string, y: number, label: string, light = false) {
  rect(
    'Ticker rail',
    288,
    y,
    1568,
    52,
    light ? gradient('#f0f6f5', '#d5e2e8') : gradient('#132c3b', '#0b1d2a'),
    3,
  );
  rect('Ticker category', 288, y, 220, 52, light ? palette.cyan : '#1d4657', 3);
  text('Category', label, 306, y, 184, 30, 20, light ? palette.navy : palette.cyan, 800);
  const items = JSON.parse(
    JSON.stringify(feed[key], (_key, value) => (value === null ? undefined : value)),
  );
  if (light)
    for (const item of items) {
      item.element.color = palette.navy;
      item.element.runs = item.element.runs.map((r: any) => ({
        ...r,
        color:
          r.color === '#46e2aa'
            ? '#08734d'
            : r.color === '#ff6e78'
              ? '#b5293b'
              : r.color?.toLowerCase() === '#f3f7f5' ||
                  r.color?.toLowerCase() === '#eef4fb' ||
                  r.color?.toLowerCase() === '#ffffff'
                ? palette.navy
                : r.color,
      }));
    }
  ops.push({
    type: 'add_layer',
    kind: 'ticker',
    name: 'Continuous quote feed',
    transform: { x: 520, y, width: 1320, height: 52 },
    element: {
      items,
      speedPixelsPerSecond: light ? 108 : 86,
      gap: 24,
      direction: 'left',
      textDirection: 'ltr',
      updatePolicy: 'immediate',
      entryFade: 36,
      exitFade: 48,
      fadeSoftness: 0.9,
    },
  });
  authored.push({ name: 'Continuous quote feed', y });
  ops.push({
    type: 'add_data_field',
    ...schema(key, items),
    label: light ? 'Digital assets feed' : 'FX reference feed',
  });
  ops.push({
    type: 'set_layer_binding',
    layerName: 'Continuous quote feed',
    binding: { fieldKey: key, targetProperty: 'items' },
  });
  text(
    'Source',
    light ? feed.cryptoStatus : feed.fxStatus,
    306,
    y + 32,
    184,
    18,
    12,
    light ? palette.navy : palette.muted,
    500,
  );
  field(light ? 'cryptoStatus' : 'fxStatus', light ? feed.cryptoStatus : feed.fxStatus, 'Source');
}
const definitions = [
  {
    id: 'identity',
    name: '01 · AXIS Identity & UTC',
    build() {
      rect('Network plate', 64, 988, 208, 52, palette.cyan, 3);
      text('AXIS wordmark', 'AXIS', 84, 988, 102, 52, 38, palette.navy, 900);
      text('Network', 'MARKETS', 184, 991, 72, 46, 16, palette.navy, 700);
      rect('Clock panel', 1600, 56, 256, 86, gradient('#0b1d2a', '#143847'), 4);
      rect('Clock accent', 1600, 56, 4, 86, palette.cyan);
      text('UTC label', 'GLOBAL DESK  /  UTC', 1620, 62, 216, 22, 16, palette.cyan, 700);
      ops.push({
        type: 'add_layer',
        kind: 'clock',
        name: 'UTC clock',
        transform: { x: 1620, y: 88, width: 216, height: 46 },
        element: {
          fontFamily: font,
          fontSize: 36,
          fontWeight: 700,
          color: palette.white,
          textAlign: 'right',
          verticalAlign: 'middle',
          clock: {
            mode: 'clock',
            source: 'automatic',
            format: 'hh:mm:ss',
            hourCycle: '24',
            timeZone: 'UTC',
          },
        },
      });
      authored.push({ name: 'UTC clock', y: 88 });
      text('Feed status', feed.cryptoStatus, 64, 60, 900, 26, 18, palette.muted, 600);
      field('cryptoStatus', feed.cryptoStatus, 'Feed status');
      rect('Status line', 64, 96, 68, 3, palette.cyan);
    },
  },
  {
    id: 'crypto',
    name: '02 · Digital Assets Ticker',
    build() {
      ticker('cryptoItems', 988, 'DIGITAL ASSETS', true);
    },
  },
  {
    id: 'fx',
    name: '03 · FX Reference Ticker',
    build() {
      ticker('fxItems', fxTickerY, 'FX REFERENCE');
    },
  },
  {
    id: 'strip',
    name: '04 · Market Watch',
    shared: true,
    build() {
      for (const [i, symbol] of ['btc', 'eth', 'sol'].entries()) {
        const x = 64 + i * (watchCardWidth + panelGap);
        rect(`${symbol} card`, x, watchY, watchCardWidth, 68, gradient('#102a3a', '#0a1c2a'), 4);
        rect(`${symbol} rule`, x, watchY, 3, 68, palette.cyan);
        text(
          `${symbol} symbol`,
          symbol.toUpperCase() + ' / USD',
          x + 20,
          watchY + 6,
          140,
          24,
          20,
          palette.muted,
          700,
        );
        text(
          `${symbol} value`,
          feed[symbol + 'Price'],
          x + 162,
          watchY + 3,
          230,
          54,
          36,
          palette.white,
          800,
          'right',
        );
        field(symbol + 'Price', feed[symbol + 'Price'], `${symbol} value`);
        text(
          `${symbol} change`,
          feed[symbol + 'Change'],
          x + 412,
          watchY + 2,
          156,
          56,
          28,
          feed[symbol + 'Color'],
          700,
          'right',
        );
        field(symbol + 'Change', feed[symbol + 'Change'], `${symbol} change`);
        field(symbol + 'Color', feed[symbol + 'Color'], `${symbol} change`, 'color', 'color');
      }
      text('Strip source', feed.cryptoStatus, 84, watchY + 42, 142, 18, 13, palette.muted, 500);
      field('cryptoStatus', feed.cryptoStatus, 'Strip source');
      ops.find(
        (op) => op.type === 'set_layer_bindings' && op.layerName === 'Strip source',
      ).bindings[0].valueMap = {
        'LIVE · COINBASE · 24H CHANGE': 'COINBASE / LIVE',
        'STALE · LAST QUOTES': 'LAST QUOTES / STALE',
        'CONNECTING · COINBASE': 'CONNECTING',
        'SAVED SNAPSHOT': 'SAVED QUOTES',
        'FEED DISCONNECTED · LAST QUOTES': 'FEED OFFLINE',
      };
    },
  },
  {
    id: 'headline',
    name: '05 · Market Brief',
    shared: true,
    build() {
      rect('Headline glass', 64, headlineY, 1240, 118, glass, 4);
      rect('Editorial rule', 64, headlineY, 5, 118, palette.cyan);
      text('Section', 'THE MARKET BRIEF', 88, headlineY + 10, 650, 25, 20, palette.cyan, 700);
      field('section', 'THE MARKET BRIEF', 'Section');
      text(
        'Headline',
        'Global markets. One clear perspective.',
        88,
        headlineY + 40,
        1190,
        54,
        43,
        palette.white,
        800,
      );
      field('headline', 'Global markets. One clear perspective.', 'Headline');
      text(
        'Context',
        'Digital assets live  •  FX at the latest ECB reference',
        88,
        headlineY + 94,
        1190,
        18,
        18,
        palette.muted,
        500,
      );
      field('context', 'Digital assets live  •  FX at the latest ECB reference', 'Context');
    },
  },
  {
    id: 'alert',
    name: '06 · Market Alert',
    shared: true,
    build() {
      rect('Alert glass', 64, headlineY, 1240, 118, glass, 4);
      rect('Alert edge', 64, headlineY, 5, 118, palette.gold);
      rect('Alert tag', 88, headlineY + 12, 190, 25, palette.gold, 2);
      text('Alert label', 'MARKET ALERT', 100, headlineY + 12, 166, 25, 19, palette.navy, 800);
      text(
        'Headline',
        'Digital assets / volatility watch',
        88,
        headlineY + 43,
        1190,
        48,
        42,
        palette.white,
        800,
      );
      field('headline', 'Digital assets / volatility watch', 'Headline');
      text(
        'Context',
        '24-hour moves across major USD spot markets',
        88,
        headlineY + 94,
        1190,
        18,
        17,
        palette.gold,
        600,
      );
      field('context', '24-hour moves across major USD spot markets', 'Context');
    },
  },
  {
    id: 'board',
    name: '07 · Market Pulse Board',
    build() {
      rect('Board glass', 1320, boardY, 536, boardBottom - boardY, glass, 5);
      rect('Board top rule', 1320, boardY, 536, 4, palette.cyan);
      text(
        'Board eyebrow',
        'AXIS / MARKET INTELLIGENCE',
        1344,
        176,
        488,
        25,
        18,
        palette.cyan,
        600,
      );
      text('Board title', 'MARKET PULSE', 1344, 209, 488, 44, 39, palette.white, 800);
      text(
        'Board columns',
        'DIGITAL ASSET              USD           24H',
        1344,
        262,
        488,
        24,
        16,
        palette.muted,
        600,
      );
      for (let i = 1; i <= 6; i++) {
        const y = 313 + (i - 1) * 69;
        rect(`Row ${i}`, 1332, y, 512, 64, i % 2 ? '#13304180' : '#0b1b2780', 2);
        text(`Symbol ${i}`, feed[`mover${i}Symbol`], 1346, y + 4, 105, 55, 25, palette.white, 700);
        field(`mover${i}Symbol`, feed[`mover${i}Symbol`], `Symbol ${i}`);
        text(
          `Price ${i}`,
          feed[`mover${i}Price`],
          1450,
          y + 4,
          208,
          55,
          27,
          palette.white,
          600,
          'right',
        );
        field(`mover${i}Price`, feed[`mover${i}Price`], `Price ${i}`);
        text(
          `Change ${i}`,
          feed[`mover${i}Change`],
          1668,
          y + 4,
          164,
          55,
          24,
          feed[`mover${i}Color`],
          700,
          'right',
        );
        field(`mover${i}Change`, feed[`mover${i}Change`], `Change ${i}`);
        field(`mover${i}Color`, feed[`mover${i}Color`], `Change ${i}`, 'color', 'color');
      }
      text(
        'Board source',
        feed.cryptoStatus,
        1344,
        boardBottom - 53,
        488,
        23,
        17,
        palette.muted,
        500,
      );
      field('cryptoStatus', feed.cryptoStatus, 'Board source');
      text('Board time', feed.asOf, 1344, boardBottom - 28, 488, 18, 15, palette.muted, 500);
      field('asOf', feed.asOf, 'Board time');
    },
  },
];
function checkpointLayer(layer: any) {
  const { y, height } = getLayerTransformAtFrame(layer, 30);
  return { id: layer.id, name: layer.name, y, height };
}
for (const def of definitions) {
  if (state.templates[def.id]?.done) continue;
  if (!state.templates[def.id]) {
    if (Object.keys(state.templates).length)
      await setOperation({ type: 'new_template', originalPrompt });
    const s = await call('ograf_get_template_set');
    state.templates[def.id] = { templateId: s.activeTemplateId };
    await checkpoint();
    await setOperation({ type: 'rename_template', templateId: s.activeTemplateId, name: def.name });
  }
  if (
    (await call('ograf_get_template_set')).activeTemplateId !== state.templates[def.id].templateId
  )
    await setOperation({
      type: 'activate_template',
      templateId: state.templates[def.id].templateId,
    });
  const p = await project();
  if (p.project.compositions[0].layers.length) {
    if (!['crypto', 'fx'].includes(def.id))
      throw Error(`Partial template ${def.id}: inspect before resuming`);
    const key = def.id === 'crypto' ? 'cryptoItems' : 'fxItems';
    const items = JSON.parse(
      JSON.stringify(feed[key], (_key, value) => (value === null ? undefined : value)),
    );
    await apply(
      [{ type: 'update_data_field', fieldKey: key, ...schema(key, items) }],
      `Repair optional quote schema values`,
    );
    const c = (await project()).project.compositions[0];
    await attachNativeConnection();
    const component = await apply(
      [
        {
          type: 'save_component',
          scope: 'set',
          layerIds: c.layers.map((l: any) => l.id),
          name: `AXIS / ${def.id}`,
        },
      ],
      `Save reusable ${def.id} asset`,
    );
    state.templates[def.id] = {
      ...state.templates[def.id],
      done: true,
      compositionId: c.id,
      layers: c.layers.map(checkpointLayer),
      component: component.summary?.componentInstances?.[0],
    };
    await checkpoint();
    continue;
  }
  await apply(
    [
      {
        type: 'set_project_metadata',
        name: `AXIS Markets / ${def.name}`,
        description:
          'Public Coinbase quotes and ECB reference FX. Independently controlled broadcast graphics.',
        thumbnailFrame: 30,
      },
      {
        type: 'set_composition',
        frameRate: 50,
        width: 1920,
        height: 1080,
        backgroundColor: 'transparent',
        updateTransitionFrames: 10,
      },
      { type: 'retime_animation_phase', phase: 'in', targetFrames: 30 },
      { type: 'retime_animation_phase', phase: 'out', targetFrames: 24 },
    ],
    'Set AXIS template format and lifecycle',
  );
  const f = await project();
  await call('ograf_import_asset', {
    expectedRevision: f.revision,
    path: 'AXIS Markets/assets/RobotoCondensed.ttf',
    mimeType: 'font/ttf',
    fontFamily: 'Roboto Condensed',
    fontWeight: '100 900',
    fontStyle: 'normal',
    licenseName: 'SIL Open Font License 1.1',
    licenseText: license,
  });
  ops = [];
  authored = [];
  def.build();
  for (const layer of ops.filter((operation) => operation.type === 'add_layer')) {
    const property = layer.kind === 'text' ? 'color' : 'fill';
    const value = layer.element?.[property];
    const token = Object.entries(palette).find(([, color]) => color === value);
    const hasData = ops.some(
      (operation) =>
        operation.type === 'set_layer_bindings' &&
        operation.layerName === layer.name &&
        operation.bindings.some((binding: any) => binding.targetProperty === property),
    );
    if (token && !hasData)
      ops.push({
        type: 'bind_design_token',
        layerName: layer.name,
        tokenId: `axis-${token[0]}`,
        targetProperty: property,
      });
  }
  for (const [i, l] of authored.entries()) {
    const delay = Math.min(8, (i % 4) * 2);
    ops.push({
      type: 'set_property_track',
      layerName: l.name,
      property: 'opacity',
      keys: [
        { frame: 0, value: 0 },
        { frame: delay, value: 0 },
        { frame: 24 + delay, value: 1, easing: 'cubic-out' },
        { frame: 30, value: 1 },
        { frame: 54, value: 0, easing: 'cubic-in' },
      ].filter((k, j, a) => a.findLastIndex((x) => x.frame === k.frame) === j),
    });
    ops.push({
      type: 'set_property_track',
      layerName: l.name,
      property: 'y',
      keys: [
        { frame: 0, value: l.y + 18 },
        { frame: 30, value: l.y, easing: 'cubic-out' },
        { frame: 54, value: l.y + 10, easing: 'cubic-in' },
      ],
    });
  }
  ops.unshift(
    {
      type: 'set_composition',
      frameRate: 50,
      width: 1920,
      height: 1080,
      backgroundColor: 'transparent',
      updateTransitionFrames: 10,
    },
    { type: 'retime_animation_phase', phase: 'in', targetFrames: 30 },
    { type: 'retime_animation_phase', phase: 'out', targetFrames: 24 },
  );
  await apply(ops, `Author ${def.name}`);
  const finished = await project();
  const c = finished.project.compositions[0];
  await attachNativeConnection();
  const component = await apply(
    [
      {
        type: 'save_component',
        scope: 'set',
        layerIds: c.layers.map((l: any) => l.id),
        name: `AXIS / ${def.id}`,
      },
    ],
    `Save reusable ${def.id} asset`,
  );
  state.templates[def.id] = {
    ...state.templates[def.id],
    done: true,
    compositionId: c.id,
    layers: c.layers.map(checkpointLayer),
    component: component.summary?.componentInstances?.[0],
  };
  await checkpoint();
  console.log(`Authored ${def.name}`);
}
console.log(JSON.stringify({ statePath, templates: Object.keys(state.templates) }));

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  patchDevtoolLayerLoads,
  patchDevtoolRendererLoads,
  patchDevtoolReloadRequests,
} from './configureDevtoolLoadLifecycle.mjs';
import {
  clearLayerGraphic,
  loadLayerGraphic,
} from './integrations/ograf-devtool/graphicLoadLifecycle.js';

const upstream = JSON.parse(
  await readFile(
    new URL('./integrations/ograf-devtool/loadLifecycle.upstream.json', import.meta.url),
    'utf8',
  ),
);
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settings = { width: 1920, height: 1080, realtime: true };
function environment() {
  const elements = [];
  const host = {
    children: [],
    appendChild(element) {
      this.children.push(element);
      element.parent = this;
    },
    set innerHTML(value) {
      assert.equal(value, '');
      this.children = [];
    },
  };
  const document = {
    createElement(name) {
      const element = {
        name,
        style: {},
        calls: [],
        disposeCount: 0,
        setAttribute() {},
        load(params) {
          this.calls.push(params);
          return this.loadResult;
        },
        dispose() {
          this.disposeCount++;
          return this.disposeResult;
        },
        remove() {
          if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this);
        },
      };
      elements.push(element);
      return element;
    },
  };
  const layer = { currentGraphic: null, shadowRoot: host, customControllers: [] };
  globalThis.document = document;
  return { elements, host, document, layer };
}
const module = (name) => ({ elementName: name, customControllers: [name] });

test('upstream deferred disposal reproduces duplicate hosts and deletes the newer host', async () => {
  const env = environment();
  const context = {
    document: env.document,
    console: { log() {}, error() {} },
    ResourceProvider: { loadGraphicModule: async (path) => module(path) },
  };
  runInNewContext(`class Layer { ${upstream.layer} } this.Layer = Layer`, context);
  const layer = new context.Layer();
  layer.shadowRoot = env.host;
  await layer.loadGraphic(settings, 'first', {});
  const disposal = deferred();
  env.elements[0].disposeResult = disposal.promise;
  await layer.loadGraphic(settings, 'second', {});
  assert.equal(env.host.children.length, 2, 'the reported duplicate is a real upstream host race');
  disposal.resolve();
  await tick();
  assert.equal(env.host.children.length, 0, 'the stale disposer clears the replacement');
  assert.equal(layer.currentGraphic, null);
});

test('newest import wins; a stale import does not create a graphic instance', async () => {
  const { layer, host, elements } = environment();
  const firstModule = deferred();
  const first = loadLayerGraphic(layer, settings, 'first', {}, () => firstModule.promise);
  const second = loadLayerGraphic(layer, settings, 'second', { version: 2 }, async () =>
    module('second'),
  );
  assert.equal(await second, true);
  firstModule.resolve(module('first'));
  assert.equal(await first, false);
  assert.deepEqual(
    elements.map((e) => e.name),
    ['second'],
  );
  assert.equal(host.children.length, 1);
  assert.equal(layer.currentGraphic.elementName, 'second');
  assert.deepEqual(elements[0].calls[0], {
    renderType: 'realtime',
    data: { version: 2 },
    renderCharacteristics: {
      resolution: { width: 1920, height: 1080 },
      _environment: 'OGraf DevTool',
    },
  });
});

test('delayed disposal cannot clear a replacement or its controllers', async () => {
  const { layer, host, elements } = environment();
  await loadLayerGraphic(layer, settings, 'first', {}, async () => module('first'));
  const disposal = deferred();
  elements[0].disposeResult = disposal.promise;
  const clear = clearLayerGraphic(layer);
  await loadLayerGraphic(layer, { ...settings, width: 1600 }, 'second', {}, async () =>
    module('second'),
  );
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].name, 'second');
  disposal.resolve();
  await clear;
  assert.equal(host.children.length, 1);
  assert.equal(layer.currentGraphic.elementName, 'second');
  assert.deepEqual(layer.customControllers, ['second']);
  assert.equal(elements[0].disposeCount, 1);
  assert.equal(elements[1].disposeCount, 0);
});

test('canceling an in-flight load detaches immediately and disposes exactly once after load completes', async () => {
  const { layer, host, elements, document } = environment();
  const loading = deferred();
  const create = document.createElement;
  document.createElement = (name) => {
    const element = create(name);
    if (name === 'first') element.loadResult = loading.promise;
    return element;
  };
  const first = loadLayerGraphic(layer, settings, 'first', {}, async () => module('first'));
  await tick();
  assert.equal(elements[0].calls.length, 1);
  const clear = clearLayerGraphic(layer);
  assert.equal(host.children.length, 0);
  assert.equal(elements[0].disposeCount, 0);
  await loadLayerGraphic(layer, settings, 'second', {}, async () => module('second'));
  loading.resolve();
  await clear;
  assert.equal(await first, false);
  assert.equal(elements[0].disposeCount, 1);
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].name, 'second');
});

test('clear invalidates pending imports and stale import failures do not fail the new instance', async () => {
  const { layer, elements } = environment();
  const pending = deferred();
  const first = loadLayerGraphic(layer, settings, 'first', {}, () => pending.promise);
  await clearLayerGraphic(layer);
  pending.resolve(module('first'));
  assert.equal(await first, false);
  assert.equal(elements.length, 0);
  const rejected = deferred();
  const old = loadLayerGraphic(layer, settings, 'old', {}, () => rejected.promise);
  await loadLayerGraphic(layer, settings, 'new', {}, async () => module('new'));
  rejected.reject(new Error('canceled old import'));
  assert.equal(await old, false);
  assert.equal(layer.currentGraphic.elementName, 'new');
});

test('failed current loads clean up and retain real errors', async () => {
  const { layer, host, elements, document } = environment();
  const error = new Error('actual graphic load failure');
  const create = document.createElement;
  document.createElement = (name) => {
    const element = create(name);
    element.loadResult = Promise.reject(error);
    return element;
  };
  await assert.rejects(
    loadLayerGraphic(layer, settings, 'bad', {}, async () => module('bad')),
    error,
  );
  assert.equal(layer.currentGraphic, null);
  assert.equal(host.children.length, 0);
  assert.equal(elements[0].disposeCount, 1);
});

test('a superseded load rejection is disposed without failing the replacement', async () => {
  const { layer, host, elements, document } = environment();
  const loading = deferred();
  const create = document.createElement;
  document.createElement = (name) => {
    const element = create(name);
    if (name === 'old') element.loadResult = loading.promise;
    return element;
  };
  const old = loadLayerGraphic(layer, settings, 'old', {}, async () => module('old'));
  await tick();
  await loadLayerGraphic(layer, { ...settings, realtime: false }, 'new', {}, async () =>
    module('new'),
  );
  loading.reject(new Error('superseded instance failed'));
  assert.equal(await old, false);
  assert.equal(elements[0].disposeCount, 1);
  assert.equal(elements[1].calls[0].renderType, 'non-realtime');
  assert.equal(host.children[0].name, 'new');
});

test('an old non-realtime seek cannot consume or reset the replacement seek queue', async () => {
  const { document, host } = environment();
  const context = {
    document,
    console: { log() {}, error() {} },
    clearLayerGraphic,
    loadLayerGraphic,
    ResourceProvider: { loadGraphicModule: async (path) => module(path) },
  };
  const source = patchDevtoolLayerLoads(
    upstream.layer + '\n' + upstream.seek + '\n' + upstream.schedule,
  ).replace(/^import .*\n/gm, '');
  runInNewContext(
    `class Layer { async _handleError(_,fn) { return fn(); } ${source} } this.Layer = Layer`,
    context,
  );
  const layer = new context.Layer();
  layer.shadowRoot = host;
  await layer.loadGraphic(settings, 'old', {});
  const oldSeek = deferred();
  layer.currentGraphic.element.goToTime = () => oldSeek.promise;
  const old = layer.goToTime(1);
  await layer.loadGraphic(settings, 'new', {});
  const newSeek = deferred();
  const positions = [];
  layer.currentGraphic.element.goToTime = ({ timestamp }) => {
    positions.push(timestamp);
    return positions.length === 1 ? newSeek.promise : Promise.resolve();
  };
  const current = layer.goToTime(2);
  const pending = layer.goToTime(3);
  oldSeek.resolve();
  await old;
  assert.equal(layer.isSeeking, true);
  assert.equal(layer.pendingGoToTime, 3);
  newSeek.resolve();
  await current;
  await pending;
  assert.deepEqual(positions, [2, 3]);
  assert.equal(layer.isSeeking, false);
});

function rendererClass() {
  const source = patchDevtoolRendererLoads(
    `${upstream.rendererLoad}\n\tgetCustomControllers() { return this.layer.customControllers || [] }\n${upstream.rendererClear}\n\tasync updateAction(params = {}) {}`,
  );
  const context = {
    ResourceProvider: { graphicPath: (folder, main) => `${folder}/${main}` },
    console,
  };
  runInNewContext(
    `class Renderer { constructor(layer) { this.layer = layer; this.data = {}; this.graphic = { path: 'fixture', main: 'main.js' }; } _runAction(_,__,fn) { return fn(); } ${source} } this.Renderer = Renderer`,
    context,
  );
  return context.Renderer;
}

function scheduleLayer(patched = true) {
  const env = environment();
  const context = {
    document: env.document,
    console: { log() {}, error() {} },
    clearLayerGraphic,
    loadLayerGraphic,
    ResourceProvider: { loadGraphicModule: async (path) => module(path) },
  };
  const original = upstream.layer + '\n' + upstream.seek + '\n' + upstream.schedule;
  const source = (patched ? patchDevtoolLayerLoads(original) : original).replace(
    /^import .*\n/gm,
    '',
  );
  runInNewContext(
    `class Layer { async _handleError(_,fn) { return fn(); } ${source} } this.Layer = Layer`,
    context,
  );
  const layer = new context.Layer();
  layer.shadowRoot = env.host;
  return layer;
}

test('schedule changes invalidate cached timestamps so reloading at a nonzero playhead paints', async () => {
  for (const patched of [false, true]) {
    const layer = scheduleLayer(patched);
    await layer.loadGraphic({ ...settings, realtime: false }, 'fixture', {});
    let scheduled = false;
    const frames = [];
    layer.currentGraphic.element.goToTime = async () => frames.push(scheduled ? 'on' : 'off');
    layer.currentGraphic.element.setActionsSchedule = async ({ schedule }) => {
      assert.equal(schedule.length, 1, 'Initial Data remains a host concern');
      scheduled = true;
    };
    await layer.goToTime(14000);
    await layer.setActionsSchedule([
      { timestamp: 0, action: { type: 'initialData', params: { data: {} } } },
      { timestamp: 0, action: { type: 'playAction', params: {} } },
    ]);
    await layer.goToTime(14000);
    assert.deepEqual(frames, patched ? ['off', 'on'] : ['off']);
  }
});

test('a schedule edit while an old sample is pending replays the same timestamp after it settles', async () => {
  const layer = scheduleLayer();
  await layer.loadGraphic({ ...settings, realtime: false }, 'fixture', {});
  const firstFrame = deferred();
  const frames = [];
  layer.currentGraphic.element.goToTime = async ({ timestamp }) => {
    frames.push(timestamp);
    if (frames.length === 1) await firstFrame.promise;
  };
  layer.currentGraphic.element.setActionsSchedule = async () => {};
  const first = layer.goToTime(14000);
  await layer.setActionsSchedule([{ timestamp: 0, action: { type: 'playAction', params: {} } }]);
  const current = layer.goToTime(14000);
  firstFrame.resolve();
  await first;
  await current;
  assert.deepEqual(frames, [14000, 14000]);
  assert.equal(layer.isSeeking, false);
});

test('an old schedule completion cannot invalidate the replacement instance timestamp cache', async () => {
  const layer = scheduleLayer();
  await layer.loadGraphic({ ...settings, realtime: false }, 'old', {});
  const scheduled = deferred();
  layer.currentGraphic.element.setActionsSchedule = () => scheduled.promise;
  const old = layer.setActionsSchedule([]);
  await layer.loadGraphic({ ...settings, realtime: false }, 'new', {});
  const frames = [];
  layer.currentGraphic.element.goToTime = async ({ timestamp }) => frames.push(timestamp);
  await layer.goToTime(14000);
  scheduled.resolve();
  await old;
  assert.equal(layer.lastGoToTime, 14000);
  await layer.goToTime(14000);
  assert.deepEqual(frames, [14000]);
});

test('a rejected schedule preserves its real error and the previously valid sample cache', async () => {
  const layer = scheduleLayer();
  await layer.loadGraphic({ ...settings, realtime: false }, 'fixture', {});
  layer.lastGoToTime = 14000;
  layer.currentGraphic.element.setActionsSchedule = async () => {
    throw new Error('Invalid schedule');
  };
  await assert.rejects(layer.setActionsSchedule([]), /Invalid schedule/);
  assert.equal(layer.lastGoToTime, 14000);
});

test('renderer does not drop rapid loads and stale clear/load completions do not overwrite its state', async () => {
  const first = deferred();
  const second = deferred();
  const cleared = deferred();
  const calls = [];
  const layer = {
    customControllers: ['latest'],
    clearGraphic: () => cleared.promise,
    loadGraphic(options, path, data) {
      calls.push({ options, path, data });
      return calls.length === 1 ? first.promise : second.promise;
    },
  };
  const Renderer = rendererClass();
  const renderer = new Renderer(layer);
  const old = renderer.loadGraphic(settings, { version: 1 });
  const clear = renderer.clearGraphic();
  const current = renderer.loadGraphic({ ...settings, width: 1600 }, { version: 2 });
  assert.equal(calls.length, 2);
  second.resolve(true);
  await current;
  assert.equal(renderer.graphicState, 'post-load');
  first.resolve(true);
  cleared.resolve();
  assert.equal(await old, false);
  assert.equal(await clear, false);
  assert.equal(renderer.graphicState, 'post-load');
  assert.deepEqual(
    calls.map((c) => c.data.version),
    [1, 2],
  );
  assert.equal(calls[1].options.width, 1600);
});

test('stale manifest responses cannot trigger an older reload and settings are captured per request', async () => {
  const first = deferred(),
    second = deferred();
  const manifests = [first, second];
  const loads = [];
  const renderer = {
    async clearGraphic() {},
    setGraphic(value) {
      this.graphic = value;
    },
    setData() {},
    async loadGraphic(options) {
      loads.push(options);
      return [];
    },
    getCustomControllers() {
      return [];
    },
  };
  const context = {
    React: { useCallback: (fn) => fn, useRef: () => ({ current: 0 }), useEffect() {} },
    rendererRef: { current: renderer },
    settingsRef: { current: { width: 1920, height: 1080 } },
    issueTracker: {
      clear() {},
      addError: (error) => {
        throw error;
      },
    },
    graphic: {},
    scheduleRef: { current: [] },
    reloadGraphicManifest: () => manifests.shift().promise,
    getDefaultDataFromSchema: () => ({}),
    setCustomControllers() {},
    setRealtimeData() {},
    setGraphicReloadKey() {},
    setIsReloading() {},
  };
  const source = patchDevtoolReloadRequests(
    upstream.manifest + '\n' + upstream.reload + '\n' + upstream.trigger,
  );
  const reloadOnly = source.slice(
    source.indexOf('\tconst reloadRequestRef'),
    source.indexOf('\n\tconst triggerReloadGraphic'),
  );
  runInNewContext(reloadOnly + '\nthis.reload = reloadGraphic', context);
  const old = context.reload();
  await tick();
  context.settingsRef.current = { width: 1600, height: 900 };
  const current = context.reload();
  await tick();
  context.settingsRef.current.width = 1280;
  second.resolve({ main: 'new.js' });
  assert.equal(await current, true);
  first.resolve({ main: 'old.js' });
  assert.equal(await old, false);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].width, 1600);
  assert.equal(renderer.graphic.manifest.main, 'new.js');
});

test('a superseded manifest fetch cannot publish stale schema or action metadata', async () => {
  const response = deferred();
  const published = [];
  const context = {
    React: { useCallback: (fn) => fn, useRef: () => ({ current: 0 }), useEffect() {} },
    graphic: { path: 'main.ograf.json' },
    graphicResourcePath: (path) => path,
    fetch: async () => ({ json: () => response.promise }),
    setGraphicManifest: (update) => published.push(update(null)),
  };
  const source = patchDevtoolReloadRequests(upstream.manifest + upstream.reload + upstream.trigger);
  runInNewContext(
    source.slice(0, source.indexOf('\n\tconst reloadRequestRef')) +
      '\nthis.reload = reloadGraphicManifest',
    context,
  );
  const pending = context.reload(() => false);
  response.resolve({ main: 'old.js' });
  await pending;
  assert.equal(published.length, 0);
  await context.reload();
  assert.equal(published.length, 1, 'initial standalone manifest loading still publishes normally');
});

test('patches are repeatable, preserve CRLF and fail closed on changed lifecycle source', () => {
  for (const [transform, source] of [
    [patchDevtoolLayerLoads, upstream.layer + upstream.seek + upstream.schedule],
    [patchDevtoolRendererLoads, upstream.rendererLoad + upstream.rendererClear],
    [patchDevtoolReloadRequests, upstream.manifest + upstream.reload + upstream.trigger],
  ]) {
    const patched = transform(source);
    assert.equal(transform(patched), patched);
    assert.equal(transform(source.replaceAll('\n', '\r\n')).includes('\r\n'), true);
    assert.throws(
      () => transform(source.replace('async ', 'async /* upstream changed */ ')),
      /Review before applying/,
    );
  }
});

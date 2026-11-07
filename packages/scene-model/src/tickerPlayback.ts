import type { TickerElement, TickerItem } from './types';
import { sha256 } from '@noble/hashes/sha2.js';
import { normalizeTicker, getTickerLayout, sampleTicker } from './ticker';

export const MAX_TICKER_PLAYBACK_INSTANCES = 2048;

/** A version is content plus its inherited shaping context, never an item ID alone. */
export function tickerItemRevision(
  item: TickerItem,
  textDirection: TickerElement['textDirection'],
) {
  return [...sha256(new TextEncoder().encode(JSON.stringify([item, textDirection])))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export interface TickerPlaybackInstance {
  key: string;
  item: TickerItem;
  revision: string;
  textDirection: TickerElement['textDirection'];
  /** Immutable entry distance and gap protect the geometry of an admitted pass. */
  entry: number;
  gapAfter: number;
  admitted: boolean;
  generation: number;
  entered: boolean;
  x: number;
  worldX: number;
  width: number;
}
export interface TickerPlaybackCandidate {
  key: string;
  item: TickerItem;
  revision: string;
  textDirection: TickerElement['textDirection'];
}
export interface TickerPlaybackPending {
  changed: number;
  inserted: number;
  removed: number;
  total: number;
}
export interface TickerPlaybackSample {
  instances: TickerPlaybackInstance[];
  candidates: TickerPlaybackCandidate[];
  pending: TickerPlaybackPending;
  travel: number;
  translation: number;
  offset: number;
  period: number;
}
export interface TickerPlaybackOptions {
  /** Prepare well before the item can reach the viewport. Defaults to two seconds, at least 128 px. */
  preparationLeadPixels?: number;
  /** Freeze a ready pass before entry. Defaults to half a second, at least 64 px. */
  admissionLeadPixels?: number;
}
export interface TickerPlaybackSampleOptions {
  isReady?: (item: TickerItem, revision: string, key: string) => boolean;
}
interface Pass {
  key: string;
  item: TickerItem;
  revision: string;
  textDirection: TickerElement['textDirection'];
  entry: number;
  gapAfter: number;
  admitted: boolean;
  generation: number;
}
interface Pending {
  type: 'changed' | 'inserted' | 'removed';
  revision?: string;
  generation: number;
}
interface UpdateEvent {
  time: number;
  element: TickerElement;
  width: number;
}
interface Core {
  element: TickerElement;
  width: number;
  anchorTime: number;
  anchorTravel: number;
  lastTime: number;
  preparedThrough: number;
  passes: Pass[];
  serial: number;
  generation: number;
  cursor: number;
  nextEntry: number;
  previous: Map<string, TickerPlaybackCandidate>;
  versions: Map<string, TickerPlaybackCandidate>;
  pending: Map<string, Pending>;
}
/** Mutable transport state; source element/item snapshots are cloned at the public boundary. */
export interface TickerPlaybackState {
  initial: TickerElement;
  initialWidth: number;
  initialTime: number;
  events: UpdateEvent[];
  options: TickerPlaybackOptions;
  core: Core;
  readiness?: TickerPlaybackSampleOptions['isReady'];
  decisions: Map<string, TickerPlaybackCandidate | null>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const finiteTime = (time: number) => Math.max(0, Number.isFinite(time) ? time : 0);
function flowItems(element: TickerElement) {
  return element.direction === 'right' ? [...element.items].reverse() : element.items;
}
function periodOf(element: TickerElement) {
  return element.items.reduce((total, item) => total + item.width + element.gap, 0);
}
function travelAt(core: Core, time: number) {
  return core.anchorTravel + ((time - core.anchorTime) * core.element.speedPixelsPerSecond) / 1000;
}
function lead(state: TickerPlaybackState, preparation: boolean) {
  const speed = state.core.element.speedPixelsPerSecond;
  return preparation
    ? Math.max(128, state.options.preparationLeadPixels ?? speed * 2)
    : Math.max(0, state.options.admissionLeadPixels ?? Math.max(64, speed * 0.5));
}
function candidate(item: TickerItem, element: TickerElement, key: string): TickerPlaybackCandidate {
  return {
    key,
    item,
    revision: tickerItemRevision(item, element.textDirection),
    textDirection: element.textDirection,
  };
}
function position(core: Core, pass: Pass, travel: number) {
  return core.element.direction === 'right'
    ? travel - pass.entry - pass.item.width
    : core.width + pass.entry - travel;
}
function makeCore(element: TickerElement, width: number, time: number): Core {
  const period = periodOf(element);
  const passes: Pass[] = [];
  const offset = sampleTicker(element, width, time).offset;
  // The old compositor represents rightward phase zero as -period rather than zero.
  const initialOffset = element.direction === 'right' && Object.is(offset, -0) ? -period : offset;
  const layout = getTickerLayout(element, 1);
  const maximum = Math.max(0, ...element.items.map((item) => item.width));
  const minCycle = period > 0 ? Math.floor((-maximum - initialOffset) / period) - 1 : 0;
  const maxCycle = period > 0 ? Math.ceil((width + maximum - initialOffset) / period) + 1 : -1;
  for (let cycle = minCycle; cycle <= maxCycle; cycle++) {
    for (let index = 0; index < element.items.length; index++) {
      const item = element.items[index]!;
      const x = cycle * period + layout[index]!.x + initialOffset;
      const entry = element.direction === 'right' ? -x - item.width : x - width;
      if (entry + item.width + width <= 0 || entry > 0) continue;
      const version = candidate(item, element, `initial:${cycle}:${item.id}`);
      passes.push({ ...version, entry, gapAfter: element.gap, admitted: true, generation: 0 });
      if (passes.length > MAX_TICKER_PLAYBACK_INSTANCES)
        throw Error(
          `Ticker requires more than ${MAX_TICKER_PLAYBACK_INSTANCES} prepared instances.`,
        );
    }
  }
  passes.sort((a, b) => a.entry - b.entry);
  const last = passes.at(-1);
  const order = flowItems(element);
  const anchorIndex = last ? order.findIndex((item) => item.id === last.item.id) : -1;
  return {
    element,
    width,
    anchorTime: time,
    anchorTravel: 0,
    lastTime: time,
    preparedThrough: time,
    passes,
    serial: 0,
    generation: 0,
    cursor: order.length ? (anchorIndex + 1) % order.length : 0,
    nextEntry: last ? last.entry + last.item.width + last.gapAfter : 0,
    previous: new Map(element.items.map((item) => [item.id, candidate(item, element, '')])),
    versions: new Map(element.items.map((item) => [item.id, candidate(item, element, '')])),
    pending: new Map(),
  };
}
export function createTickerPlayback(
  ticker: TickerElement,
  viewportWidth: number,
  elapsedMs = 0,
  options: TickerPlaybackOptions = {},
): TickerPlaybackState {
  const element = clone(normalizeTicker(ticker));
  const time = finiteTime(elapsedMs);
  const width = Math.max(0, viewportWidth);
  return {
    initial: element,
    initialWidth: width,
    initialTime: time,
    events: [],
    options: { ...options },
    core: makeCore(element, width, time),
    decisions: new Map(),
  };
}
/** Copy transport/history without attempting to clone the renderer's readiness callback. */
export function cloneTickerPlayback(state: TickerPlaybackState): TickerPlaybackState {
  return {
    ...state,
    initial: clone(state.initial),
    events: clone(state.events),
    options: { ...state.options },
    core: {
      ...state.core,
      element: clone(state.core.element),
      passes: clone(state.core.passes),
      previous: new Map([...state.core.previous].map(([id, value]) => [id, clone(value)])),
      versions: new Map([...state.core.versions].map(([id, value]) => [id, clone(value)])),
      pending: new Map([...state.core.pending].map(([id, value]) => [id, { ...value }])),
    },
    decisions: new Map(
      [...state.decisions].map(([key, value]) => [key, value ? clone(value) : null]),
    ),
  };
}
/** Prepare these physical pass copies before sampling; this never admits or replaces a pass. */
export function peekTickerPlaybackCandidates(
  state: TickerPlaybackState,
  elapsedMs?: number,
): TickerPlaybackCandidate[] {
  const core = state.core;
  const time = elapsedMs === undefined ? core.lastTime : finiteTime(elapsedMs);
  const unappliedEvent = state.events.some(
    (event) => event.time > core.lastTime && event.time <= time,
  );
  // A forward seek that crosses scheduled source events must first replay those events.
  // Ordinary realtime playback has no unapplied source event and can prepare directly.
  if (time >= core.lastTime && !unappliedEvent) prepareWindow(state, time);
  else append(state, travelAt(core, core.lastTime) + core.width + lead(state, true));
  return core.passes.map(({ key, item, revision, textDirection }) => ({
    key,
    item,
    revision,
    textDirection,
  }));
}
/** Geometry comes from the sampled outer layer pose, not a feed edit or new source version. */
export function resizeTickerPlayback(
  state: TickerPlaybackState,
  viewportWidth: number,
  elapsedMs: number,
): void {
  const time = finiteTime(elapsedMs);
  if (time < Math.max(state.core.lastTime, state.core.preparedThrough))
    sampleTickerPlayback(state, time);
  advance(state, time, state.readiness);
  const core = state.core;
  const width = Math.max(0, viewportWidth);
  const delta = width - core.width;
  if (!delta) return;
  if (core.element.direction === 'left') {
    for (const pass of core.passes) pass.entry -= delta;
    core.nextEntry -= delta;
  }
  core.width = width;
  append(state, travelAt(core, time) + width + lead(state, true));
}
function append(state: TickerPlaybackState, horizon: number) {
  const core = state.core;
  const order = flowItems(core.element);
  if (!order.length) return;
  while (core.nextEntry <= horizon) {
    if (core.passes.length >= MAX_TICKER_PLAYBACK_INSTANCES)
      throw Error(`Ticker requires more than ${MAX_TICKER_PLAYBACK_INSTANCES} prepared instances.`);
    const item = order[core.cursor]!;
    const key = `pass:${core.serial++}`;
    const version = { ...core.versions.get(item.id)!, key };
    core.passes.push({
      ...version,
      entry: core.nextEntry,
      gapAfter: core.element.gap,
      admitted: false,
      generation: core.generation,
    });
    core.nextEntry += item.width + core.element.gap;
    core.cursor = (core.cursor + 1) % order.length;
  }
}
function advance(
  state: TickerPlaybackState,
  time: number,
  readiness?: TickerPlaybackSampleOptions['isReady'],
) {
  const core = state.core;
  const travel = prepareWindow(state, time);
  const order = flowItems(core.element);
  const admission = travel + lead(state, false);
  let attempts = 0;
  for (let index = 0; index < core.passes.length; index++) {
    const pass = core.passes[index]!;
    if (pass.admitted || pass.entry > admission) continue;
    const decisionKey = `${pass.key}:${pass.revision}`;
    let selected = state.decisions.get(decisionKey);
    if (!state.decisions.has(decisionKey)) {
      const ready = !readiness || readiness(pass.item, pass.revision, pass.key);
      selected = ready
        ? {
            key: pass.key,
            item: pass.item,
            revision: pass.revision,
            textDirection: pass.textDirection,
          }
        : (core.previous.get(pass.item.id) ?? null);
      if (selected && readiness && !ready && !readiness(selected.item, selected.revision, pass.key))
        selected = null;
      // Healthy playback does not accumulate one history entry for every repeated pass.
      // Retain only exceptional choices so backward seeks preserve prior readiness decisions.
      if (!ready) state.decisions.set(decisionKey, selected ?? null);
    }
    if (!selected) {
      // An unready insertion consumes no feed space; try the following source at this boundary.
      const shift = pass.item.width + pass.gapAfter;
      core.passes.splice(index--, 1);
      for (let later = index + 1; later < core.passes.length; later++)
        core.passes[later]!.entry -= shift;
      core.nextEntry -= shift;
      if (++attempts > Math.max(1, order.length) * 2) break;
      continue;
    }
    const shift = selected.item.width - pass.item.width;
    pass.item = selected.item;
    pass.revision = selected.revision;
    pass.textDirection = selected.textDirection;
    pass.admitted = true;
    if (shift) {
      for (let later = index + 1; later < core.passes.length; later++)
        core.passes[later]!.entry += shift;
      core.nextEntry += shift;
    }
    core.previous.set(pass.item.id, selected);
  }
  // Pending is semantic operator feedback, not a count of every repeated DOM copy.
  for (const [id, pending] of core.pending) {
    if (pending.type === 'removed') {
      if (!core.passes.some((pass) => pass.admitted && pass.item.id === id))
        core.pending.delete(id);
    } else if (
      core.passes.some(
        (pass) =>
          pass.admitted &&
          pass.entry <= travel &&
          pass.item.id === id &&
          pass.revision === pending.revision &&
          pass.generation >= pending.generation,
      )
    ) {
      core.pending.delete(id);
    }
  }
  core.lastTime = time;
}
function prepareWindow(state: TickerPlaybackState, time: number) {
  const core = state.core;
  const travel = travelAt(core, time);
  core.passes = core.passes.filter((pass) => pass.entry + pass.item.width + core.width > travel);
  const order = flowItems(core.element);
  const period = periodOf(core.element);
  // Long offline seeks need only the local output window, not every pass since Start.
  if (period > 0 && core.nextEntry + period < travel - core.width) {
    const cycles = Math.floor((travel - core.width - core.nextEntry) / period);
    core.nextEntry += cycles * period;
    core.serial += cycles * order.length;
  }
  append(state, travel + core.width + lead(state, true));
  core.preparedThrough = time;
  return travel;
}
function applyUpdate(
  state: TickerPlaybackState,
  element: TickerElement,
  width: number,
  time: number,
) {
  const core = state.core;
  advance(state, time, state.readiness);
  const travel = travelAt(core, time);
  const previousElement = core.element;
  const feedChanged =
    JSON.stringify(previousElement.items) !== JSON.stringify(element.items) ||
    previousElement.textDirection !== element.textDirection ||
    previousElement.gap !== element.gap ||
    previousElement.direction !== element.direction ||
    core.width !== width;
  if (!feedChanged) {
    // A transport speed or stationary fade/background adjustment must not retire prepared
    // future copies or change their admission order. Anchor distance before changing speed.
    core.element = element;
    core.anchorTravel = travel;
    core.anchorTime = time;
    return;
  }
  core.generation++;
  const oldItems = new Map(previousElement.items.map((item) => [item.id, item]));
  const desiredIds = new Set(element.items.map((item) => item.id));
  for (const item of element.items) {
    const before = oldItems.get(item.id);
    const revision = tickerItemRevision(item, element.textDirection);
    if (!before)
      core.pending.set(item.id, { type: 'inserted', revision, generation: core.generation });
    else if (
      tickerItemRevision(before, previousElement.textDirection) !== revision ||
      previousElement.gap !== element.gap ||
      previousElement.items.indexOf(before) !== element.items.indexOf(item)
    )
      core.pending.set(item.id, { type: 'changed', revision, generation: core.generation });
  }
  for (const item of previousElement.items)
    if (!desiredIds.has(item.id))
      core.pending.set(item.id, { type: 'removed', generation: core.generation });
  // Preserve only admitted passes. Their content, dimensions and preceding gaps are immutable.
  core.passes = core.passes.filter((pass) => pass.admitted);
  for (let index = 0; index < core.passes.length; index++) {
    const pass = core.passes[index]!;
    if (desiredIds.has(pass.item.id) || pass.entry <= travel) continue;
    // A prepared copy that has not entered is safe to remove. Close only its offscreen
    // space; on-screen passes retain both their positions and their immutable snapshots.
    const shift = pass.item.width + pass.gapAfter;
    core.passes.splice(index--, 1);
    for (let later = index + 1; later < core.passes.length; later++)
      core.passes[later]!.entry -= shift;
  }
  const directionChanged = element.direction !== previousElement.direction;
  if (directionChanged) {
    for (const pass of core.passes) {
      const x = position(core, pass, travel);
      pass.entry =
        element.direction === 'right' ? travel - x - pass.item.width : travel + x - width;
    }
    core.passes.sort((a, b) => a.entry - b.entry);
  } else if (width !== core.width && element.direction === 'left') {
    for (const pass of core.passes) pass.entry -= width - core.width;
  }
  core.element = element;
  core.versions = new Map(element.items.map((item) => [item.id, candidate(item, element, '')]));
  core.width = width;
  core.anchorTravel = travel;
  core.anchorTime = time;
  const order = flowItems(element);
  const last = core.passes.at(-1);
  const anchorIndex = last ? order.findIndex((item) => item.id === last.item.id) : -1;
  core.cursor = order.length ? (anchorIndex + 1) % order.length : 0;
  core.nextEntry = Math.max(travel, last ? last.entry + last.item.width + last.gapAfter : travel);
  append(state, travel + width + lead(state, true));
}
export function updateTickerPlayback(
  state: TickerPlaybackState,
  ticker: TickerElement,
  viewportWidth: number,
  elapsedMs: number,
): void {
  const element = clone(normalizeTicker(ticker));
  const width = Math.max(0, viewportWidth);
  const time = finiteTime(elapsedMs);
  if (JSON.stringify(element) === JSON.stringify(state.core.element) && width === state.core.width)
    return;
  if (time < Math.max(state.core.lastTime, state.core.preparedThrough))
    sampleTickerPlayback(state, time);
  state.events = state.events.filter((event) => event.time <= time);
  state.events.push({ time, element, width });
  applyUpdate(state, element, width, time);
}
export function sampleTickerPlayback(
  state: TickerPlaybackState,
  elapsedMs: number,
  options: TickerPlaybackSampleOptions = {},
): TickerPlaybackSample {
  const time = finiteTime(elapsedMs);
  if (options.isReady) state.readiness = options.isReady;
  if (time < Math.max(state.core.lastTime, state.core.preparedThrough)) {
    state.core = makeCore(state.initial, state.initialWidth, state.initialTime);
    for (const event of state.events) {
      if (event.time > time) break;
      applyUpdate(state, event.element, event.width, event.time);
    }
  } else {
    // A backward seek followed by forward playback must replay future source events too.
    for (const event of state.events) {
      if (event.time > state.core.lastTime && event.time <= time)
        applyUpdate(state, event.element, event.width, event.time);
    }
  }
  advance(state, time, state.readiness);
  const core = state.core;
  const travel = travelAt(core, time);
  const translation = (core.element.direction === 'right' ? 1 : -1) * travel;
  const instances = core.passes.map((pass) => {
    const x = position(core, pass, travel);
    return {
      ...pass,
      x,
      // Derive the invariant position directly: subtracting sampled travel again introduces
      // floating-point drift and rewrites every cell's CSS left on otherwise unchanged frames.
      worldX:
        core.element.direction === 'right'
          ? -pass.entry - pass.item.width
          : core.width + pass.entry,
      width: pass.item.width,
      entered: pass.entry <= travel,
    };
  });
  const candidates: TickerPlaybackCandidate[] = instances.map(
    ({ key, item, revision, textDirection }) => ({ key, item, revision, textDirection }),
  );
  const pending: TickerPlaybackPending = {
    changed: 0,
    inserted: 0,
    removed: 0,
    total: core.pending.size,
  };
  for (const item of core.pending.values()) pending[item.type]++;
  return {
    instances,
    candidates,
    pending,
    travel,
    translation,
    offset: translation,
    period: periodOf(core.element),
  };
}

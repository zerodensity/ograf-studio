import { create } from 'zustand';
import {
  isGradientPaint,
  validatePaint,
  type FieldDefinition,
  type FieldValue,
  type PresenterDefinition,
} from '@ograf-editor/scene-model';
import {
  currentTemplatePreviewDocument,
  templatePreviewDocumentSnapshot,
  type PresenterDocumentSnapshot,
  type ResolvedPresenterEntry,
} from './presenterDocument';
import { createPresenterRuntime, type PresenterRuntime } from './presenterRuntime';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { resolveProjectSetTemplate } from './projectSet';
import {
  assertStudioRendererPluginsAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

export interface PresenterState {
  sessionId: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  warning: string | null;
  sourceId: string | null;
  sourceName: string | null;
  sourceChanged: boolean;
  width: number;
  height: number;
  mode: 'independent' | 'coordinated';
  definition: PresenterDefinition | null;
  entries: ResolvedPresenterEntry[];
  selectedEntryId: string | null;
  selectedIndex: number;
  onAir: boolean;
  activeStep: number | undefined;
  stepCount: number;
  fields: FieldDefinition[];
  data: Record<string, FieldValue>;
}

const emptyState: PresenterState = {
  sessionId: null,
  loading: false,
  busy: false,
  error: null,
  warning: null,
  sourceId: null,
  sourceName: null,
  sourceChanged: false,
  width: 1920,
  height: 1080,
  mode: 'independent',
  definition: null,
  entries: [],
  selectedEntryId: null,
  selectedIndex: -1,
  onAir: false,
  activeStep: undefined,
  stepCount: 0,
  fields: [],
  data: {},
};
export const usePresenterStore = create<PresenterState>(() => ({ ...emptyState }));
let runtime: PresenterRuntime | null = null;
let frozenSource: PresenterDocumentSnapshot | null = null;
let generation = 0;
let loadAbort: AbortController | null = null;
let sourceStamp = '';
let viewport: { container: HTMLElement; token: symbol } | null = null;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
const entryData = new Map<string, Record<string, FieldValue>>();

function sourceFingerprint(source: PresenterDocumentSnapshot): string {
  if (source.projectSet) {
    const set = source.projectSet;
    // Authoring selection materializes inherited settings into the selected child. Compare
    // resolved sources and canonical empty metadata so simply selecting another template is clean.
    return JSON.stringify({
      id: source.id,
      name: source.name,
      definition: source.definition,
      settings: set.settings,
      brandKit: set.brandKit,
      controls: set.controls,
      assetSlots: set.assetSlots,
      assets: set.assets,
      componentAssets: set.componentAssets,
      transitionLogic: set.transitionLogic,
      templates: set.templates.map((template) => ({
        id: template.id,
        name: template.name,
        project: { ...resolveProjectSetTemplate(set, template.id), presenter: undefined },
        inheritSettings: template.inheritSettings !== false,
        settingsOverrides: template.settingsOverrides ?? [],
        brandKitOverrides: template.brandKitOverrides ?? [],
        typographyOverrides: template.typographyOverrides ?? [],
        backgroundOverrides: template.backgroundOverrides ?? [],
        backgroundOverridden: template.backgroundOverridden === true,
      })),
    });
  }
  return JSON.stringify({
    id: source.id,
    project: { ...source.project, presenter: undefined },
    definition: source.definition,
  });
}
function refreshSourceChanged() {
  if (!runtime) return;
  try {
    usePresenterStore.setState({
      sourceChanged: sourceFingerprint(currentTemplatePreviewDocument()) !== sourceStamp,
    });
  } catch {
    usePresenterStore.setState({ sourceChanged: true });
  }
}
function scheduleSourceChanged() {
  if (!runtime) return;
  if (changeTimer !== undefined) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = undefined;
    refreshSourceChanged();
  }, 200);
}
function eligibleIndices(): number[] {
  return usePresenterStore
    .getState()
    .entries.flatMap((entry, index) => (entry.available ? [index] : []));
}
function nextIndex(delta: number): number | undefined {
  const state = usePresenterStore.getState();
  const indices = eligibleIndices();
  if (!indices.length) return undefined;
  if (state.selectedIndex < 0) return delta > 0 ? indices[0] : indices.at(-1);
  const position = indices.indexOf(state.selectedIndex);
  const target = position + delta;
  return indices[target];
}

/** A single retained node moves between docked, detached and fullscreen viewports. */
export function attachPresenterViewport(container: HTMLElement): () => void {
  const token = Symbol('presenter-viewport');
  viewport = { container, token };
  runtime?.attach(container);
  return () => {
    if (viewport?.token !== token) return;
    viewport = null;
    runtime?.park();
  };
}

/** Explicit load/reload freezes the preview without changing authoring or live playout. */
export async function loadPresenter(source = currentTemplatePreviewDocument()): Promise<void> {
  const snapshot = structuredClone(
    templatePreviewDocumentSnapshot(source.project, source.projectSet),
  );
  const ticket = ++generation;
  loadAbort?.abort();
  const abort = new AbortController();
  loadAbort = abort;
  usePresenterStore.setState({ loading: true, busy: false, error: null });
  let next: PresenterRuntime | null = null;
  try {
    next = await createPresenterRuntime(snapshot, {
      document: viewport?.container.ownerDocument,
      signal: abort.signal,
    });
    if (ticket !== generation) throw new Error('Preview loading was cancelled.');
    assertStudioRendererPluginsAllowed(next.plugins);
    const previous = runtime;
    runtime = next;
    frozenSource = snapshot;
    sourceStamp = sourceFingerprint(snapshot);
    entryData.clear();
    const first = snapshot.entries.find((entry) => entry.available)!;
    const info = next.entryInfo(first);
    usePresenterStore.setState({
      ...emptyState,
      sessionId: crypto.randomUUID(),
      sourceId: source.id,
      sourceName: source.name,
      mode: next.mode,
      warning: next.warning,
      definition: snapshot.definition,
      entries: snapshot.entries,
      width: info.width,
      height: info.height,
    });
    previous?.park();
    if (viewport?.container.isConnected && !viewport.container.ownerDocument.defaultView?.closed)
      next.attach(viewport.container);
    else next.park();
    refreshSourceChanged();
    if (previous) await previous.dispose();
  } catch (cause) {
    if (next && next !== runtime) await next.dispose();
    if (ticket === generation)
      usePresenterStore.setState({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    throw cause;
  } finally {
    if (loadAbort === abort) loadAbort = null;
  }
}

async function command(action: (target: PresenterRuntime) => Promise<void>): Promise<void> {
  const state = usePresenterStore.getState();
  if (!runtime) throw new Error('Load a template preview first.');
  if (state.busy || state.loading)
    throw new Error('Wait for the current preview action to finish.');
  const target = runtime;
  const ticket = generation;
  usePresenterStore.setState({ busy: true, error: null });
  try {
    await action(target);
  } catch (cause) {
    if (ticket === generation)
      usePresenterStore.setState({
        error: cause instanceof Error ? cause.message : String(cause),
      });
    throw cause;
  } finally {
    if (ticket === generation) {
      usePresenterStore.setState({ busy: false });
    }
  }
}

export async function navigatePresenter(indexOrId: number | string): Promise<void> {
  const state = usePresenterStore.getState();
  const index =
    typeof indexOrId === 'number'
      ? indexOrId
      : state.entries.findIndex((entry) => entry.id === indexOrId);
  const entry = state.entries[index];
  if (!entry || !entry.available)
    throw new Error(entry?.problem || 'Choose an available template.');
  const ticket = generation;
  return command(async (target) => {
    const info = target.entryInfo(entry);
    const data = entryData.get(entry.id) ?? info.data;
    entryData.set(entry.id, structuredClone(data));
    const step = await target.cue(index, entryData, () => {
      if (ticket !== generation || runtime !== target) return;
      usePresenterStore.setState({
        selectedEntryId: entry.id,
        selectedIndex: index,
        width: info.width,
        height: info.height,
        fields: info.fields,
        data: structuredClone(data),
        stepCount: info.stepCount,
        activeStep: undefined,
        onAir: true,
      });
    });
    if (ticket !== generation || runtime !== target) return;
    usePresenterStore.setState({
      selectedEntryId: entry.id,
      selectedIndex: index,
      width: info.width,
      height: info.height,
      fields: info.fields,
      data: structuredClone(data),
      stepCount: info.stepCount,
      activeStep: step,
      onAir: step !== undefined,
    });
  });
}
export async function nextPresenter(): Promise<void> {
  const index = nextIndex(1);
  if (index !== undefined) return navigatePresenter(index);
}
export async function previousPresenter(): Promise<void> {
  const index = nextIndex(-1);
  if (index !== undefined) return navigatePresenter(index);
}
export async function restartPresenter(): Promise<void> {
  const index = eligibleIndices()[0];
  if (index !== undefined) return navigatePresenter(index);
}
export async function stopPresenter(): Promise<void> {
  const ticket = generation;
  return command(async (target) => {
    await target.stop();
    if (ticket === generation) usePresenterStore.setState({ onAir: false, activeStep: undefined });
  });
}
export async function unloadPresenter(): Promise<void> {
  ++generation;
  loadAbort?.abort();
  loadAbort = null;
  const previous = runtime;
  runtime = null;
  frozenSource = null;
  sourceStamp = '';
  entryData.clear();
  usePresenterStore.setState({ ...emptyState });
  if (previous) await previous.dispose();
}

function normalizeField(field: FieldDefinition, value: FieldValue): FieldValue {
  const invalid = () => new Error(`Enter a valid value for “${field.label || field.key}”.`);
  if (['number', 'integer', 'duration-ms', 'percentage'].includes(field.type)) {
    if (typeof value === 'string' && value.trim()) value = Number(value);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (['integer', 'duration-ms'].includes(field.type) && !Number.isInteger(value)) ||
      (field.type === 'duration-ms' && value < 0)
    )
      throw invalid();
  } else if (field.type === 'boolean') {
    if (value === 'true' || value === 'false') value = value === 'true';
    if (typeof value !== 'boolean') throw invalid();
  } else if (field.type === 'gradient') {
    if (!isGradientPaint(value) || validatePaint(value).length) throw invalid();
  } else if (field.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const record = value as Record<string, FieldValue>;
    value = Object.fromEntries(
      Object.entries(record).map(([key, child]) => {
        const property = field.properties.find((item) => item.key === key);
        if (!property) throw invalid();
        return [key, normalizeField(property, child)];
      }),
    );
    if (
      field.properties.some((property) => property.required && !Object.hasOwn(record, property.key))
    )
      throw invalid();
  } else if (field.type === 'array' || field.type === 'select-multiple') {
    if (!Array.isArray(value)) throw invalid();
    if (field.type === 'select-multiple') {
      if (!value.every((item) => field.options.some((option) => option.value === item)))
        throw invalid();
    } else if (field.items) value = value.map((item) => normalizeField(field.items!, item));
  } else if (
    typeof value !== 'string' ||
    (field.type === 'select' && !field.options.some((option) => option.value === value))
  )
    throw invalid();
  const c = field.constraints;
  if (
    typeof value === 'number' &&
    ((c.minimum !== undefined && value < c.minimum) ||
      (c.maximum !== undefined && value > c.maximum))
  )
    throw invalid();
  if (
    typeof value === 'string' &&
    ((c.minLength !== undefined && value.length < c.minLength) ||
      (c.maxLength !== undefined && value.length > c.maxLength) ||
      (c.pattern && !new RegExp(c.pattern).test(value)))
  )
    throw invalid();
  if (
    Array.isArray(value) &&
    ((c.minItems !== undefined && value.length < c.minItems) ||
      (c.maxItems !== undefined && value.length > c.maxItems))
  )
    throw invalid();
  return value;
}
export async function updatePresenterData(patch: Record<string, FieldValue>): Promise<void> {
  const state = usePresenterStore.getState();
  const entry = state.entries[state.selectedIndex];
  if (!entry) throw new Error('Select a template before updating its data.');
  const values = { ...state.data };
  for (const [key, value] of Object.entries(patch)) {
    const field = state.fields.find((field) => field.key === key);
    if (!field) throw new Error(`Unknown template data field “${key}”.`);
    values[key] = normalizeField(field, value);
  }
  if (!state.onAir && !state.busy && !state.loading) {
    entryData.set(entry.id, structuredClone(values));
    usePresenterStore.setState({ data: values });
    return;
  }
  const ticket = generation;
  return command(async (target) => {
    await target.update(entry, values);
    if (ticket !== generation) return;
    entryData.set(entry.id, structuredClone(values));
    usePresenterStore.setState({ data: values });
  });
}
async function stepPresenter(delta: number): Promise<void> {
  const ticket = generation;
  return command(async (target) => {
    const step = await target.step(delta);
    if (ticket === generation)
      usePresenterStore.setState({ activeStep: step, onAir: step !== undefined });
  });
}
export const presenterNextStep = () => stepPresenter(1);
export const presenterPreviousStep = () => stepPresenter(-1);
/** Returns a copy for exports and inspection without exposing the running source to mutation. */
export function loadedPresenterDocument(): PresenterDocumentSnapshot | null {
  return frozenSource ? structuredClone(frozenSource) : null;
}

const subscriptions = [
  useProjectSetStore.subscribe(scheduleSourceChanged),
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project) scheduleSourceChanged();
  }),
  useRendererPluginSettingsStore.subscribe((state, previous) => {
    if (state.revision === previous.revision || !runtime) return;
    try {
      assertStudioRendererPluginsAllowed(runtime.plugins);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      void unloadPresenter().catch(() => undefined);
      usePresenterStore.setState({ error });
    }
  }),
];
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    if (changeTimer !== undefined) clearTimeout(changeTimer);
    void unloadPresenter();
  });

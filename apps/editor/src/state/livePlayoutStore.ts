import { create } from 'zustand';
import {
  livePlayoutOperationSchema,
  livePlayoutRequestSchema,
  MAX_PLAYOUT_REQUEST_BYTES,
  type LivePlayoutOperation,
} from '@ograf-editor/agent-tools/playout';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';
import {
  createCoordinatedPreviewRuntime,
  runCoordinatedPreviewCommand,
  type CoordinatedPreviewRuntime,
  type CoordinatedPreviewTemplate,
} from './coordinatedPreviewRuntime';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';
import {
  transitionLogicDraftChanged,
  useTransitionLogicDraftStore,
} from './transitionLogicDraftStore';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';

export type { LivePlayoutOperation } from '@ograf-editor/agent-tools/playout';
export interface LivePlayoutCommandStatus {
  requestId: string;
  operation: LivePlayoutOperation['type'];
  slotId?: string;
  status: 'running' | 'completed' | 'failed';
  error: string | null;
}
export interface LivePlayoutState {
  sessionId: string | null;
  revision: string;
  loading: boolean;
  sourceSetId: string | null;
  sourceSetName: string | null;
  sourceChanged: boolean;
  error: string | null;
  width: number;
  height: number;
  definition: TransitionLogicDefinition | null;
  templates: CoordinatedPreviewTemplate[];
  snapshot: CoordinatedPlayoutSnapshot | null;
  recentCommands: LivePlayoutCommandStatus[];
}
const epoch = crypto.randomUUID();
let revision = 0;
export const useLivePlayoutStore = create<LivePlayoutState>(() => ({
  sessionId: null,
  revision: `${epoch}:0`,
  loading: false,
  sourceSetId: null,
  sourceSetName: null,
  sourceChanged: false,
  error: null,
  width: 1920,
  height: 1080,
  definition: null,
  templates: [],
  snapshot: null,
  recentCommands: [],
}));
let runtime: CoordinatedPreviewRuntime | null = null;
let unsubscribeRuntime = () => {};
let loadGeneration = 0;
let loadAbort: AbortController | null = null;
let sourceStamp = '';
let viewport: { container: HTMLElement; token: symbol } | null = null;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
interface CommandEntry {
  fingerprint: string;
  status: LivePlayoutCommandStatus;
  completion: Promise<void>;
}
const commands = new Map<string, CommandEntry>();
// Keep lightweight tombstones after detailed receipts expire; a retry must never become a take.
const seenRequestIds = new Set<string>();

function publishCommands() {
  useLivePlayoutStore.setState({
    recentCommands: [...commands.values()]
      .slice(-32)
      .reverse()
      .map((entry) => ({ ...entry.status })),
  });
}
function bumpRevision() {
  useLivePlayoutStore.setState({ revision: `${epoch}:${++revision}` });
}
function currentSource(): ProjectSetDocument {
  const set = useProjectSetStore.getState().projectSet;
  if (!set?.transitionLogic)
    throw new Error(
      'Open a template set and apply its playout transitions before loading playout.',
    );
  const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
  if (draft && transitionLogicDraftChanged(draft))
    throw new Error(
      'Playout transitions have unapplied edits. Apply or Revert the draft before loading playout.',
    );
  return structuredClone(transitionLogicEditorSetSnapshot(set));
}
function sourceFingerprint(set: ProjectSetDocument): string {
  // Exclude editing selection; switching a template cannot change or invalidate program output.
  return JSON.stringify({
    id: set.id,
    name: set.name,
    definition: set.transitionLogic,
    templates: set.templates.map((template) => ({
      id: template.id,
      name: template.name,
      project: resolveProjectSetTemplate(set, template.id),
    })),
    componentAssets: set.componentAssets,
  });
}
function refreshSourceChanged() {
  if (!runtime) return;
  try {
    useLivePlayoutStore.setState({
      sourceChanged: sourceFingerprint(currentSource()) !== sourceStamp,
    });
  } catch {
    useLivePlayoutStore.setState({ sourceChanged: true });
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

/** The same node survives tab changes, panel closure, fullscreen and detached documents. */
export function attachLivePlayoutViewport(container: HTMLElement): () => void {
  const token = Symbol('live-viewport');
  viewport = { container, token };
  runtime?.attach(container);
  return () => {
    if (viewport?.token !== token) return;
    viewport = null;
    runtime?.park();
  };
}

async function loadSource(source: ProjectSetDocument): Promise<void> {
  const generation = ++loadGeneration;
  const abort = new AbortController();
  loadAbort = abort;
  const stamp = sourceFingerprint(source);
  useLivePlayoutStore.setState({ loading: true, error: null });
  let next: CoordinatedPreviewRuntime | null = null;
  try {
    next = await createCoordinatedPreviewRuntime(source, { signal: abort.signal });
    if (generation !== loadGeneration) throw new Error('Playout loading was cancelled.');
    const previous = runtime;
    unsubscribeRuntime();
    runtime = next;
    sourceStamp = stamp;
    useLivePlayoutStore.setState({
      sessionId: crypto.randomUUID(),
      loading: false,
      sourceSetId: source.id,
      sourceSetName: source.name,
      width: next.descriptor.width,
      height: next.descriptor.height,
      definition: next.definition,
      templates: next.templates,
      snapshot: next.graphic.getPlayoutSnapshot(),
      error: null,
    });
    bumpRevision();
    const active = next;
    unsubscribeRuntime = next.graphic.subscribePlayout((snapshot) => {
      if (runtime === active) useLivePlayoutStore.setState({ snapshot });
    });
    if (viewport?.container.isConnected && !viewport.container.ownerDocument.defaultView?.closed)
      next.attach(viewport.container);
    else next.park();
    refreshSourceChanged();
    if (previous) await previous.dispose();
  } catch (cause) {
    if (next && next !== runtime) await next.dispose();
    if (generation === loadGeneration) useLivePlayoutStore.setState({ loading: false });
    throw cause;
  } finally {
    if (loadAbort === abort) loadAbort = null;
  }
}

async function unloadSource(): Promise<void> {
  ++loadGeneration;
  loadAbort?.abort();
  loadAbort = null;
  const previous = runtime;
  runtime = null;
  unsubscribeRuntime();
  unsubscribeRuntime = () => {};
  sourceStamp = '';
  useLivePlayoutStore.setState({
    sessionId: null,
    loading: false,
    sourceSetId: null,
    sourceSetName: null,
    sourceChanged: false,
    error: null,
    definition: null,
    templates: [],
    snapshot: null,
  });
  if (previous) await previous.dispose();
}

function admitCommand(input: unknown, requestId: string, expectedRevision?: string): CommandEntry {
  const operation = livePlayoutOperationSchema.parse(input);
  const fingerprint = JSON.stringify(operation);
  const previous = commands.get(requestId);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('This requestId was already used for a different playout command.');
    return previous;
  }
  if (seenRequestIds.has(requestId))
    throw new Error(
      'This playout request was already processed and its detailed receipt has expired. Read the current playout state; this request will not execute again.',
    );
  const state = useLivePlayoutStore.getState();
  if (expectedRevision !== undefined && expectedRevision !== state.revision)
    throw new Error(
      `Playout revision conflict. Read ograf_get_playout and retry with a new requestId. Current revision: ${state.revision}`,
    );
  if (
    operation.type !== 'clear' &&
    operation.type !== 'unload' &&
    [...commands.values()].filter((entry) => entry.status.status === 'running').length >= 64
  )
    throw new Error(
      'Too many playout commands are pending. Wait for existing requests or clear a slot.',
    );
  if (operation.type === 'load' && state.loading)
    throw new Error('A template set is already loading. Wait or unload to cancel it.');
  if (operation.type !== 'load' && operation.type !== 'unload' && !runtime)
    throw new Error('Load the template set into live playout first.');
  const source = operation.type === 'load' ? currentSource() : null;
  const target = runtime;
  const sessionId = state.sessionId;
  const admissionGeneration = loadGeneration;
  bumpRevision();
  useLivePlayoutStore.setState({ error: null });
  const entry: CommandEntry = {
    fingerprint,
    completion: Promise.resolve(),
    status: {
      requestId,
      operation: operation.type,
      ...('slotId' in operation && operation.slotId ? { slotId: operation.slotId } : {}),
      status: 'running',
      error: null,
    },
  };
  commands.set(requestId, entry);
  seenRequestIds.add(requestId);
  while (commands.size > 256) {
    const oldest = [...commands].find(([, item]) => item.status.status !== 'running');
    if (!oldest) break;
    commands.delete(oldest[0]);
  }
  publishCommands();
  entry.completion = (async () => {
    try {
      if (operation.type === 'load') await loadSource(source!);
      else if (operation.type === 'unload') await unloadSource();
      else await runCoordinatedPreviewCommand(target!, operation);
      entry.status.status = 'completed';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      entry.status.status = 'failed';
      entry.status.error = message;
      const expectedGeneration =
        admissionGeneration + (operation.type === 'load' || operation.type === 'unload' ? 1 : 0);
      if (
        loadGeneration === expectedGeneration &&
        useLivePlayoutStore.getState().sessionId === sessionId
      )
        useLivePlayoutStore.setState({ error: message });
      throw cause;
    } finally {
      publishCommands();
    }
  })();
  void entry.completion.catch(() => undefined);
  return entry;
}

export function runLivePlayoutCommand(operation: LivePlayoutOperation): Promise<void> {
  try {
    return admitCommand(operation, crypto.randomUUID()).completion;
  } catch (cause) {
    useLivePlayoutStore.setState({ error: cause instanceof Error ? cause.message : String(cause) });
    return Promise.reject(cause);
  }
}
export function loadLivePlayout(): Promise<void> {
  return runLivePlayoutCommand({ type: 'load' });
}
export function unloadLivePlayout(): Promise<void> {
  return runLivePlayoutCommand({ type: 'unload' });
}

function publicSnapshot(): Record<string, unknown> {
  const state = useLivePlayoutStore.getState();
  let snapshot: unknown = state.snapshot;
  let dataOmitted = false;
  if (snapshot && JSON.stringify(snapshot).length > 96 * 1024) {
    dataOmitted = true;
    snapshot = JSON.parse(
      JSON.stringify(snapshot, (key, value: unknown) => (key === 'data' ? undefined : value)),
    );
  }
  return {
    available: true,
    sessionId: state.sessionId,
    revision: state.revision,
    loading: state.loading,
    sourceSetId: state.sourceSetId,
    sourceSetName: state.sourceSetName,
    openSetId: useProjectSetStore.getState().projectSet?.id ?? null,
    sourceChanged: state.sourceChanged,
    error: state.error,
    width: state.width,
    height: state.height,
    snapshot,
    tickerUpdates: structuredClone(runtime?.graphic.getTickerUpdates?.() ?? []),
    dataOmitted,
    states:
      state.definition?.states.map(({ id, name, slotId, templateId }) => ({
        id,
        name,
        slotId,
        templateId,
      })) ?? [],
    templates: state.templates.map((template) => ({
      id: template.id,
      name: template.name,
      customActions: template.customActions,
      fields: template.dataFields.map((field) => ({
        key: field.key,
        type: field.type,
        label: field.label,
      })),
    })),
    recentCommands: state.recentCommands,
  };
}

/** Admit commands promptly so remote Clear is never queued behind animation or resource loading. */
export async function handleLivePlayoutRequest(input: unknown): Promise<Record<string, unknown>> {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_PLAYOUT_REQUEST_BYTES)
    throw new Error('Playout request is too large.');
  const request = livePlayoutRequestSchema.parse(input);
  if (request.target === 'preview')
    throw new Error('Preview requests must use the visible preview bridge.');
  if (request.action === 'read') return publicSnapshot();
  const entry = admitCommand(request.operation, request.requestId, request.expectedRevision);
  return { ...publicSnapshot(), request: { ...entry.status }, accepted: true };
}

const subscriptions = [
  useProjectSetStore.subscribe(scheduleSourceChanged),
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project) scheduleSourceChanged();
  }),
  useTransitionLogicDraftStore.subscribe(scheduleSourceChanged),
];
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const unsubscribe of subscriptions) unsubscribe();
    if (changeTimer !== undefined) clearTimeout(changeTimer);
    void unloadSource();
  });

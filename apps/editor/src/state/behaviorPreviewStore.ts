import { create } from 'zustand';
import type { CoordinatedPlayoutSnapshot, ReturnPayload } from '@ograf-editor/ograf-types';
import {
  compositionWithShaderParameterFields,
  type Composition,
  type FieldDefinition,
  type FieldValue,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import {
  createCoordinatedPreviewRuntime,
  runCoordinatedPreviewCommand,
  type CoordinatedPreviewRuntime,
} from './coordinatedPreviewRuntime';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { usePaneRequestStore } from './paneRequestStore';
import { isPreviewPresentationFullscreen } from './previewPresentationStore';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';
import { useTransitionLogicDraftStore } from './transitionLogicDraftStore';
import {
  resolvePreviewDataRecord,
  resolveRuntimePreviewDataRecord,
  resolveStatePresetPreviewData,
} from './previewData';
import { useTestDataStore } from './testDataStore';
import {
  acknowledgePreviewSlotFields,
  cachedPreviewSlotRuntimeData,
  forgetPreviewSlotObserved,
  observePreviewSlotValues,
  previewSlotComposition,
  previewSlotDataKey,
  stagePreviewSlotField,
  usePreviewSlotDataStore,
} from './previewSlotDataStore';
import {
  assertStudioRendererPluginsAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

export interface BehaviorPreviewRequest {
  projectSet: ProjectSetDocument;
  definition: TransitionLogicDefinition;
  stateId: string;
  phase: 'in' | 'out' | 'update';
  /** States which are already visible before the behavior starts; one state per other slot. */
  contextStateIds?: string[];
  /** Current preview form values to retain when a template becomes the trigger or context. */
  dataByTemplateId?: Record<string, Record<string, FieldValue>>;
  /** Prepare an Off output for the existing Play button; loading never needs to take to air. */
  autoplay?: boolean;
  label?: string;
}

export interface BehaviorPreviewState {
  requestId: string | null;
  sourceSetId: string | null;
  sourceTemplateId: string | null;
  stateId: string | null;
  label: string;
  loading: boolean;
  busy: boolean;
  /** Structural actions disable field editing; ordinary updates must not interrupt typing. */
  structuralBusy: boolean;
  error: string | null;
  sourceChanged: boolean;
  width: number;
  height: number;
  frameRate: number;
  dataFields: FieldDefinition[];
  data: Record<string, FieldValue>;
  /** Runtime acknowledgements refresh the form without echoing local Rules writes as updates. */
  dataSyncRevision: number;
  dataSyncSignature: string;
  /** The compiled session definition; editing the source does not change running controls. */
  definition: TransitionLogicDefinition | null;
  snapshot: CoordinatedPlayoutSnapshot | null;
  onAir: boolean;
  currentStep: number | undefined;
  /** Authored actions from each lane's currently on-air template, never the editor selection. */
  templateActions: Record<string, Array<{ id: string; name: string }>>;
}

const emptyState = (): BehaviorPreviewState => ({
  requestId: null,
  sourceSetId: null,
  sourceTemplateId: null,
  stateId: null,
  label: '',
  loading: false,
  busy: false,
  structuralBusy: false,
  error: null,
  sourceChanged: false,
  width: 1920,
  height: 1080,
  frameRate: 50,
  dataFields: [],
  data: {},
  dataSyncRevision: 0,
  dataSyncSignature: '',
  definition: null,
  snapshot: null,
  onAir: false,
  currentStep: undefined,
  templateActions: {},
});

/** An isolated design preview. This store never loads, clears or commands live/MCP output. */
export const useBehaviorPreviewStore = create<BehaviorPreviewState>(emptyState);

interface Session {
  id: string;
  request: BehaviorPreviewRequest;
  source: ProjectSetDocument;
  sourceStamp: string;
  slotId: string;
  composition: Composition;
  abort: AbortController;
  runtime: CoordinatedPreviewRuntime | null;
  unsubscribe: () => void;
  pendingCommands: number;
  pendingStructuralCommands: number;
  prepared: boolean;
  resumeOnAttach: boolean;
  disposed: boolean;
  observedSignatures: Map<string, string>;
}

let current: Session | null = null;
/** A replacement is compiled offscreen before the working output is released. */
let preparing: Session | null = null;
let preparingBackup: { state: BehaviorPreviewState; context: typeof requestContext } | null = null;
let requestContext: {
  request: BehaviorPreviewRequest;
  setId: string;
  templateId: string | null;
  projectId: string;
} | null = null;
let viewport: { container: HTMLElement; token: symbol } | null = null;
let changeTimer: ReturnType<typeof setTimeout> | undefined;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function successful(result: ReturnPayload): void {
  if (result.statusCode >= 400)
    throw new Error(result.statusMessage || 'The behavior could not be previewed.');
}

function active(session: Session): boolean {
  return (current === session || preparing === session) && !session.disposed;
}

function sourceFingerprint(source: ProjectSetDocument): string {
  // Compare the same resolved graphics used by the compiler, excluding editorial selection
  // and unrelated workspace/presenter metadata.
  return JSON.stringify({
    id: source.id,
    name: source.name,
    definition: source.transitionLogic,
    templates: source.templates.map((template) => {
      const project = resolveProjectSetTemplate(source, template.id);
      return {
        id: template.id,
        name: template.name,
        project: {
          ...project,
          // Native connection configuration is applied live by the application service. It is
          // not compiled artwork; fields, bindings, Rules and every other property still are.
          compositions: project.compositions.map((composition) => ({
            ...composition,
            dataConnections: undefined,
          })),
        },
      };
    }),
    componentAssets: source.componentAssets,
  });
}

function snapshotFor(request: BehaviorPreviewRequest): ProjectSetDocument {
  return structuredClone({
    ...transitionLogicEditorSetSnapshot(request.projectSet),
    transitionLogic: request.definition,
  });
}

/** Convert only intentionally edited fields; passing full defaults can erase state presets. */
function resolvedSlotDraft(
  composition: Composition,
  key: string,
): Record<string, FieldValue> | undefined {
  const draft = usePreviewSlotDataStore.getState().drafts[key];
  if (!draft) return undefined;
  const resolved = resolvePreviewDataRecord(composition, draft);
  const patch = Object.fromEntries(
    Object.keys(draft)
      .filter((field) => Object.hasOwn(resolved, field))
      .map((field) => [field, resolved[field]!]),
  );
  return Object.keys(patch).length ? patch : undefined;
}

function publishSnapshot(session: Session, snapshot: CoordinatedPlayoutSnapshot): void {
  if (!active(session) || (preparing && preparing !== session)) return;
  const definition = session.runtime?.definition;
  if (definition)
    for (const [slotId, entry] of Object.entries(snapshot.slots)) {
      const selection = entry.incoming ?? entry.current;
      if (!selection || (entry.transition && !entry.incoming)) continue;
      const state = definition.states.find(
        (candidate) => candidate.id === selection.stateId && candidate.slotId === slotId,
      );
      if (!state) continue;
      const key = previewSlotDataKey(
        session.source.id,
        definition.id,
        slotId,
        state.id,
        state.templateId,
      );
      const signature = JSON.stringify(selection.data);
      const unchanged = session.observedSignatures.get(key) === signature;
      const draft = usePreviewSlotDataStore.getState().drafts[key];
      // An identical snapshot may still acknowledge a staged value after an Out / Take.
      if (unchanged && !draft) continue;
      const source = previewSlotComposition(session.source, definition, state.id);
      if (!source) continue;
      const values = cachedPreviewSlotRuntimeData(source.composition, state.id, selection.data);
      if (!unchanged) observePreviewSlotValues(key, values);
      if (draft) {
        const resolved = resolvePreviewDataRecord(source.composition, draft);
        const acknowledged = Object.fromEntries(
          Object.entries(draft).filter(
            ([field]) =>
              Object.hasOwn(values, field) &&
              JSON.stringify(values[field]) === JSON.stringify(resolved[field]),
          ),
        );
        if (Object.keys(acknowledged).length) acknowledgePreviewSlotFields(key, acknowledged);
      }
      session.observedSignatures.set(key, signature);
    }
  const slot = snapshot.slots[session.slotId];
  const selection = slot?.incoming ?? slot?.current ?? slot?.outgoing;
  // The main transport and data form belong to the author's selected template. Per-slot
  // controls may put another template in that slot without changing authoring selection.
  const onAir = selection?.stateId === session.request.stateId;
  const activeSelection = slot?.incoming ?? slot?.current;
  const formData =
    activeSelection?.stateId === session.request.stateId && !(slot?.transition && !slot.incoming)
      ? resolveRuntimePreviewDataRecord(session.composition, activeSelection.data)
      : null;
  const signature = formData ? JSON.stringify(formData) : null;
  const formChanged =
    signature !== null && signature !== useBehaviorPreviewStore.getState().dataSyncSignature;
  useBehaviorPreviewStore.setState({
    snapshot,
    onAir,
    currentStep: onAir ? 0 : undefined,
    ...(formChanged
      ? {
          data: formData!,
          dataSyncSignature: signature!,
          dataSyncRevision: useBehaviorPreviewStore.getState().dataSyncRevision + 1,
        }
      : {}),
    templateActions: Object.fromEntries(
      Object.entries(snapshot.slots).map(([slotId, value]) => {
        const activeSelection = value.incoming ?? value.current;
        const state = session.runtime?.definition.states.find(
          (candidate) => candidate.id === activeSelection?.stateId,
        );
        const actions =
          session.runtime?.descriptor.templates.find(
            (candidate) => candidate.id === state?.templateId,
          )?.descriptor.customActions ?? [];
        return [slotId, actions.map(({ id, name }) => ({ id, name }))];
      }),
    ),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  });
}

function release(session: Session): void {
  session.disposed = true;
  session.abort.abort();
  session.unsubscribe();
  // Dispose cancels pending resource loads and transition waiters immediately.
  void session.runtime?.dispose().catch(() => undefined);
  session.runtime = null;
}

function visibleViewport(container: HTMLElement): boolean {
  const view = container.ownerDocument.defaultView;
  if (!container.isConnected || !view || view.closed) return false;
  const rect = container.getBoundingClientRect();
  return (
    rect.width > 0 && rect.height > 0 && view.getComputedStyle(container).visibility === 'visible'
  );
}

/** A reveal request is asynchronous: never play a short behavior entirely in a parked node. */
async function waitForVisibleViewport(session: Session): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paintFrame: number | undefined;
    let paintWindow: Window | null = null;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (paintFrame !== undefined) paintWindow?.cancelAnimationFrame(paintFrame);
      session.abort.signal.removeEventListener('abort', cancelled);
    };
    const cancelled = () => {
      cleanup();
      reject(new Error('Behavior preview was cancelled.'));
    };
    const ready = () => {
      if (!active(session)) {
        cancelled();
        return;
      }
      const target = viewport;
      if (!target || !visibleViewport(target.container)) {
        timer = setTimeout(ready, 50);
        return;
      }
      session.runtime!.attach(target.container);
      paintWindow = target.container.ownerDocument.defaultView;
      // Let the newly revealed pane paint the initial layout before the requested IN/OUT.
      paintFrame = paintWindow!.requestAnimationFrame(() => {
        paintFrame = paintWindow!.requestAnimationFrame(() => {
          if (viewport?.token !== target.token || !visibleViewport(target.container)) {
            ready();
            return;
          }
          cleanup();
          resolve();
        });
      });
    };
    session.abort.signal.addEventListener('abort', cancelled, { once: true });
    ready();
  });
}

/** The same output node moves with the existing preview viewport, including fullscreen. */
export function attachBehaviorPreviewViewport(container: HTMLElement): () => void {
  const token = Symbol('behavior-preview-viewport');
  viewport = { container, token };
  if (current?.prepared && current.runtime) {
    current.runtime.attach(container);
    if (current.resumeOnAttach) {
      current.resumeOnAttach = false;
      current.runtime.graphic.resumePlayout();
    }
  }
  return () => {
    if (viewport?.token !== token) return;
    viewport = null;
    if (current?.runtime) {
      current.resumeOnAttach = !current.runtime.graphic.getPlayoutSnapshot().paused;
      current.runtime.graphic.pausePlayout();
      current.runtime.park();
    }
  };
}

export function clearBehaviorPreview(): void {
  const previous = current;
  const candidate = preparing;
  current = null;
  preparing = null;
  preparingBackup = null;
  requestContext = null;
  if (changeTimer !== undefined) clearTimeout(changeTimer);
  changeTimer = undefined;
  if (previous) release(previous);
  if (candidate && candidate !== previous) release(candidate);
  // Last on-air data belongs to the disposed runtime. It must not appear as the next
  // session's preset; intentional staged edits remain available for the next Take.
  if (previous) forgetPreviewSlotObserved(previous.source.id);
  if (candidate && candidate !== previous && candidate.source.id !== previous?.source.id)
    forgetPreviewSlotObserved(candidate.source.id);
  useBehaviorPreviewStore.setState(emptyState(), true);
}

/** Rules which command other lanes require the private coordinated player, including in fullscreen. */
export function hasRulePlayoutActions(composition: Composition): boolean {
  return [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ].some((layer) =>
    layer.visualRules?.some(
      (rule) => rule.enabled && rule.actions.some((action) => action.type === 'playout'),
    ),
  );
}

/** Opens only an isolated design preview; this never changes the live/MCP session. */
export async function requestRulePlayoutPreview(
  options: {
    autoplay?: boolean;
    data?: Record<string, FieldValue>;
  } = {},
): Promise<void> {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  if (!projectSet || !activeTemplateId)
    throw new Error(
      'Add this template to a template set and configure its lane in Transitions to preview playout rules.',
    );
  const draft = useTransitionLogicDraftStore.getState().drafts[projectSet.id];
  const definition = draft ? draft.definition : projectSet.transitionLogic;
  const state = definition?.states.find((candidate) => candidate.templateId === activeTemplateId);
  if (!definition || !state)
    throw new Error(
      'Assign this template to a lane in Transitions to preview its Take, Update, Out or Clear rules.',
    );
  await requestBehaviorPreview({
    projectSet,
    definition,
    stateId: state.id,
    phase: 'in',
    ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
    ...(options.data ? { dataByTemplateId: { [activeTemplateId]: options.data } } : {}),
  });
}

function requireSession(): Session & { runtime: CoordinatedPreviewRuntime } {
  if (!current?.runtime || current.disposed || useBehaviorPreviewStore.getState().loading)
    throw new Error('Wait for the behavior preview to finish loading.');
  return current as Session & { runtime: CoordinatedPreviewRuntime };
}

async function command(
  session: Session & { runtime: CoordinatedPreviewRuntime },
  operation: Parameters<typeof runCoordinatedPreviewCommand>[1],
  options: { blockControls?: boolean } = {},
): Promise<void> {
  if (!active(session)) return;
  const blockControls = options.blockControls !== false;
  session.pendingCommands += 1;
  if (blockControls) session.pendingStructuralCommands += 1;
  useBehaviorPreviewStore.setState({
    busy: true,
    structuralBusy: session.pendingStructuralCommands > 0,
    error: null,
  });
  session.runtime.graphic.resumePlayout();
  try {
    await runCoordinatedPreviewCommand(session.runtime, operation);
  } catch (cause) {
    if (!active(session)) return;
    useBehaviorPreviewStore.setState({ error: message(cause) });
    throw cause;
  } finally {
    session.pendingCommands -= 1;
    if (blockControls) session.pendingStructuralCommands -= 1;
    if (active(session))
      useBehaviorPreviewStore.setState({
        busy: session.pendingCommands > 0,
        structuralBusy: session.pendingStructuralCommands > 0,
      });
  }
}

/** Start from an immutable draft and unsaved source snapshot, using the exported coordinator. */
export async function requestBehaviorPreview(request: BehaviorPreviewRequest): Promise<void> {
  if (preparing) {
    release(preparing);
    preparing = null;
    if (preparingBackup) {
      useBehaviorPreviewStore.setState(
        {
          ...preparingBackup.state,
          busy: (current?.pendingCommands ?? 0) > 0,
          structuralBusy: (current?.pendingStructuralCommands ?? 0) > 0,
        },
        true,
      );
      requestContext = preparingBackup.context;
      preparingBackup = null;
    }
    if (current?.prepared && current.runtime && viewport)
      current.runtime.attach(viewport.container);
  }
  const previous = current;
  const previousState = useBehaviorPreviewStore.getState();
  const previousContext = requestContext;
  preparingBackup = { state: previousState, context: previousContext };
  const id = crypto.randomUUID();
  const selection = useProjectSetStore.getState();
  requestContext = {
    request: structuredClone(request),
    setId: request.projectSet.id,
    templateId: selection.activeTemplateId,
    projectId: useProjectStore.getState().project.id,
  };
  // Keep the working output visible while preparing an immutable replacement. A rejected
  // source is reported as a failed command; it never destroys the current graphics.
  useBehaviorPreviewStore.setState({
    requestId: id,
    sourceSetId: request.projectSet.id,
    stateId: request.stateId,
    label: request.label ?? `Previewing ${request.phase}`,
    loading: true,
  });
  if (!isPreviewPresentationFullscreen()) usePaneRequestStore.getState().reveal('export');
  let session: Session | null = null;
  try {
    const source = snapshotFor(request);
    const definition = source.transitionLogic!;
    const state = definition.states.find((item) => item.id === request.stateId);
    if (!state) throw new Error('This behavior no longer has a template state. Select it again.');
    const project = resolveProjectSetTemplate(source, state.templateId);
    const main = project.compositions.find((item) => item.id === project.mainCompositionId);
    if (!main) throw new Error('The selected template has no main composition.');
    const composition = compositionWithShaderParameterFields(main);
    const testValues =
      selection.projectSet?.id === source.id && selection.activeTemplateId === state.templateId
        ? useTestDataStore.getState().values
        : {};
    const initialData = resolveStatePresetPreviewData(
      composition,
      state.dataDefaults,
      request.dataByTemplateId?.[state.templateId],
      testValues,
    );
    const stateKey = previewSlotDataKey(
      source.id,
      definition.id,
      state.slotId,
      state.id,
      state.templateId,
    );
    const data = { ...initialData, ...resolvedSlotDraft(composition, stateKey) };
    const occupiedSlots = new Set<string>([state.slotId]);
    const context = [...new Set(request.contextStateIds ?? [])].map((stateId) => {
      const item = definition.states.find((candidate) => candidate.id === stateId);
      if (!item) throw new Error('A context template was removed. Select the behavior again.');
      if (occupiedSlots.has(item.slotId))
        throw new Error('Choose only one context template per other output slot.');
      occupiedSlots.add(item.slotId);
      const contextProject = resolveProjectSetTemplate(source, item.templateId);
      const contextMain = contextProject.compositions.find(
        (candidate) => candidate.id === contextProject.mainCompositionId,
      );
      if (!contextMain)
        throw new Error(`The context template “${item.name}” has no main composition.`);
      const contextComposition = compositionWithShaderParameterFields(contextMain);
      const contextKey = previewSlotDataKey(
        source.id,
        definition.id,
        item.slotId,
        item.id,
        item.templateId,
      );
      return {
        state: item,
        data: {
          ...resolveStatePresetPreviewData(
            contextComposition,
            item.dataDefaults,
            request.dataByTemplateId?.[item.templateId],
          ),
          ...resolvedSlotDraft(contextComposition, contextKey),
        },
      };
    });
    session = {
      id,
      request: structuredClone(request),
      source,
      sourceStamp: sourceFingerprint(source),
      slotId: state.slotId,
      composition,
      abort: new AbortController(),
      runtime: null,
      unsubscribe: () => {},
      pendingCommands: 0,
      pendingStructuralCommands: 0,
      prepared: false,
      resumeOnAttach: false,
      disposed: false,
      observedSignatures: new Map(),
    };
    preparing = session;
    useBehaviorPreviewStore.setState({
      sourceTemplateId: state.templateId,
      label:
        request.label ??
        `${state.name} ${request.phase === 'in' ? 'enters' : request.phase === 'out' ? 'leaves' : 'updates'}`,
      width: composition.width,
      height: composition.height,
      frameRate: composition.frameRate,
      dataFields: structuredClone(composition.dataFields),
      data,
      dataSyncSignature: '',
      dataSyncRevision: 0,
    });
    const runtime = await createCoordinatedPreviewRuntime(source, {
      signal: session.abort.signal,
    });
    if (!active(session)) {
      await runtime.dispose();
      return;
    }
    session.runtime = runtime;
    runtime.graphic.pausePlayout();
    // Contexts are seeded offscreen at their settled poses, rather than making the designer
    // wait through unrelated IN animations before the requested behavior can be seen.
    for (const item of context) {
      successful(
        await runtime.graphic.customAction({
          id: 'transition.take',
          payload: { slotId: item.state.slotId, stateId: item.state.id, data: item.data },
          skipAnimation: true,
        }),
      );
      if (!active(session)) return;
    }
    if (request.phase !== 'in') {
      successful(
        await runtime.graphic.customAction({
          id: 'transition.take',
          payload: { slotId: state.slotId, stateId: state.id, data },
          skipAnimation: true,
        }),
      );
      if (!active(session)) return;
    }
    // Compiling the module does not fetch the selected state's media. Complete its exact
    // resource preparation while the existing output is still visible and recoverable.
    if (request.phase === 'in') {
      successful(
        await runtime.graphic.prepareSlot({ slotId: state.slotId, stateId: state.id, data }),
      );
      if (!active(session)) return;
    }
    const mountedSession = session;
    session.unsubscribe = runtime.graphic.subscribePlayout((snapshot) =>
      publishSnapshot(mountedSession, snapshot),
    );
    publishSnapshot(session, runtime.graphic.getPlayoutSnapshot());
    session.prepared = true;
    useBehaviorPreviewStore.setState({
      width: runtime.descriptor.width,
      height: runtime.descriptor.height,
      frameRate: runtime.descriptor.frameRate,
      definition: structuredClone(runtime.definition),
    });
    await waitForVisibleViewport(session);
    if (!active(session)) return;
    current = session;
    preparing = null;
    preparingBackup = null;
    forgetPreviewSlotObserved(source.id);
    session.observedSignatures.clear();
    publishSnapshot(session, runtime.graphic.getPlayoutSnapshot());
    if (previous && previous !== session) release(previous);
    useBehaviorPreviewStore.setState({
      loading: false,
      busy: session.pendingCommands > 0,
      structuralBusy: session.pendingStructuralCommands > 0,
    });
    // Replaying replaces the snapshot behind the stale-source indicator. Recompare after
    // commit rather than inheriting the old flag or ignoring edits made during preparation.
    sourceChanged();
    if (request.autoplay === false) return;
    await command(
      session as Session & { runtime: CoordinatedPreviewRuntime },
      request.phase === 'out'
        ? { type: 'out', slotId: state.slotId }
        : request.phase === 'in'
          ? { type: 'take', slotId: state.slotId }
          : { type: 'take', slotId: state.slotId, stateId: state.id, data },
    );
  } catch (cause) {
    if (useBehaviorPreviewStore.getState().requestId !== id) return;
    preparingBackup = null;
    if (session && current === session && session.prepared) {
      // A runtime command failed after a successful load. Retain its authoritative output,
      // snapshot and controls so the designer can retry, take another lane or clear it.
      useBehaviorPreviewStore.setState({
        loading: false,
        busy: session.pendingCommands > 0,
        structuralBusy: session.pendingStructuralCommands > 0,
        error: message(cause),
      });
      throw cause;
    }
    if (session) {
      release(session);
      if (preparing === session) preparing = null;
    }
    if (previous && current === previous && !previous.disposed) {
      requestContext = previousContext;
      if (viewport && previous.runtime) previous.runtime.attach(viewport.container);
      useBehaviorPreviewStore.setState(
        {
          ...previousState,
          busy: previous.pendingCommands > 0,
          structuralBusy: previous.pendingStructuralCommands > 0,
          error: message(cause),
        },
        true,
      );
      if (previous.runtime)
        publishSnapshot(previous, previous.runtime.graphic.getPlayoutSnapshot());
    } else
      useBehaviorPreviewStore.setState({
        loading: false,
        busy: false,
        structuralBusy: false,
        onAir: false,
        currentStep: undefined,
        definition: null,
        snapshot: null,
        templateActions: {},
        error: message(cause),
      });
    throw cause;
  }
}

export async function takeBehaviorPreview(): Promise<void> {
  const session = requireSession();
  await command(session, {
    type: 'take',
    slotId: session.slotId,
    stateId: session.request.stateId,
    data: useBehaviorPreviewStore.getState().data,
  });
}

export async function outBehaviorPreview(): Promise<void> {
  const session = requireSession();
  const slot = session.runtime.graphic.getPlayoutSnapshot().slots[session.slotId];
  const selection = slot?.incoming ?? slot?.current ?? slot?.outgoing;
  if (selection?.stateId !== session.request.stateId) return;
  await command(session, { type: 'out', slotId: session.slotId });
}

function rejectSlotCommand(session: Session, reason: string): never {
  if (active(session)) useBehaviorPreviewStore.setState({ error: reason });
  throw new Error(reason);
}

/** Per-slot controls operate only this isolated preview, retaining the selected data form. */
export async function takeBehaviorPreviewSlot(slotId: string, stateId: string): Promise<void> {
  const session = requireSession();
  const state = session.runtime.definition.states.find((item) => item.id === stateId);
  if (!state || state.slotId !== slotId)
    rejectSlotCommand(session, 'This template state does not belong to the preview output slot.');
  const template = session.runtime.descriptor.templates.find(
    (item) => item.id === state.templateId,
  );
  if (!template) rejectSlotCommand(session, 'This template is not available in the preview.');
  const resolved = previewSlotComposition(session.source, session.runtime.definition, stateId);
  if (!resolved) rejectSlotCommand(session, 'This template is not available in the preview.');
  const key = previewSlotDataKey(
    session.source.id,
    session.runtime.definition.id,
    slotId,
    stateId,
    state.templateId,
  );
  const draft = resolvedSlotDraft(resolved.composition, key);
  const data =
    slotId === session.slotId && stateId === session.request.stateId
      ? { ...useBehaviorPreviewStore.getState().data, ...draft }
      : draft;
  await command(session, {
    type: 'take',
    slotId,
    stateId,
    ...(data === undefined ? {} : { data: structuredClone(data) }),
  });
}

export async function outBehaviorPreviewSlot(slotId: string): Promise<void> {
  const session = requireSession();
  if (!session.runtime.definition.slots.some((item) => item.id === slotId))
    rejectSlotCommand(session, 'This output slot is not available in the preview.');
  await command(session, { type: 'out', slotId });
}

/** Clear output immediately without disposing controls, data or the frozen source session. */
export async function clearBehaviorPreviewOutput(): Promise<void> {
  const session = requireSession();
  await command(session, { type: 'clear' });
}

export async function controlBehaviorPreviewLoop(
  slotId: string,
  groupId: string,
  action: 'pause' | 'resume' | 'next',
): Promise<void> {
  await command(requireSession(), { type: 'loop', slotId, groupId, action });
}

/** Run the public scoped action on this preview's current lane; live output is untouched. */
export async function runBehaviorPreviewTemplateAction(
  slotId: string,
  actionId: string,
): Promise<void> {
  await command(requireSession(), { type: 'template-action', slotId, actionId });
}

/** External feeds update the visible preview through its existing coordinator, without taking
 * graphics, restarting its clock, resuming paused playback or editing the source document. */
export async function updateBehaviorPreviewSlot(
  slotId: string,
  data: Record<string, unknown>,
  stateId?: string,
  mode: 'in-place' | 'transition' = 'in-place',
): Promise<void> {
  const session = requireSession();
  await runCoordinatedPreviewCommand(session.runtime, {
    type: 'update',
    slotId,
    mode,
    ...(stateId === undefined ? {} : { stateId }),
    data,
  });
}

interface PendingSlotEdit {
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
const pendingSlotEdits = new Map<string, PendingSlotEdit>();
const slotEditQueues = new Map<string, Promise<void>>();

/** Stage by state, then apply on-air operator edits with the normal authored update timing. */
export function editBehaviorPreviewSlotField(
  source: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  stateId: string,
  fieldKey: string,
  value: FieldValue,
): Promise<void> {
  const running =
    current?.prepared &&
    current.runtime &&
    !current.disposed &&
    current.source.id === source.id &&
    current.runtime.definition.id === definition.id
      ? (current as Session & { runtime: CoordinatedPreviewRuntime })
      : null;
  const effectiveSource = running?.source ?? source;
  const effectiveDefinition = running?.runtime.definition ?? definition;
  const contract = previewSlotComposition(effectiveSource, effectiveDefinition, stateId);
  if (!contract || !contract.composition.dataFields.some((field) => field.key === fieldKey))
    return Promise.reject(new Error('This field is no longer available in the preview template.'));
  const state = contract.state;
  const key = previewSlotDataKey(
    effectiveSource.id,
    effectiveDefinition.id,
    state.slotId,
    state.id,
    state.templateId,
  );
  stagePreviewSlotField(key, fieldKey, value);
  if (!running || useBehaviorPreviewStore.getState().loading) return Promise.resolve();
  const visible = running.runtime.graphic.getPlayoutSnapshot().slots[state.slotId];
  if (
    (visible?.incoming ?? visible?.current)?.stateId !== stateId ||
    (visible?.transition && !visible.incoming)
  )
    return Promise.resolve();
  const queueKey = `${running.id}:${key}`;
  let pending = pendingSlotEdits.get(queueKey);
  if (!pending) {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending = {
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      promise,
      resolve,
      reject,
    };
    pendingSlotEdits.set(queueKey, pending);
  } else clearTimeout(pending.timer);
  const request = pending;
  request.timer = setTimeout(() => {
    pendingSlotEdits.delete(queueKey);
    const previous = slotEditQueues.get(queueKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        if (current !== running || !active(running) || useBehaviorPreviewStore.getState().loading)
          return;
        const slot = running.runtime.graphic.getPlayoutSnapshot().slots[state.slotId];
        if (
          (slot?.incoming ?? slot?.current)?.stateId !== state.id ||
          (slot?.transition && !slot.incoming)
        )
          return;
        const patch = resolvedSlotDraft(contract.composition, key);
        if (!patch) return;
        try {
          await command(
            running,
            { type: 'update', slotId: state.slotId, stateId: state.id, data: patch },
            { blockControls: false },
          );
        } catch (cause) {
          const latest = running.runtime.graphic.getPlayoutSnapshot().slots[state.slotId];
          if (
            (latest?.incoming ?? latest?.current)?.stateId !== state.id ||
            (latest?.transition && !latest.incoming)
          )
            return;
          throw cause;
        }
        if (active(running)) {
          running.observedSignatures.delete(key);
          publishSnapshot(running, running.runtime.graphic.getPlayoutSnapshot());
        }
      });
    slotEditQueues.set(queueKey, task);
    void task.then(request.resolve, request.reject).finally(() => {
      if (slotEditQueues.get(queueKey) === task) slotEditQueues.delete(queueKey);
    });
  }, 150);
  return request.promise;
}

/** Snapshot of the visible coordinated preview; deliberately separate from MCP live output. */
export function readBehaviorPreviewPlayout(): Record<string, unknown> {
  const state = useBehaviorPreviewStore.getState();
  const runtime = current?.runtime;
  return {
    available: true,
    target: 'preview',
    sessionId: state.requestId,
    loading: state.loading,
    sourceSetId: state.sourceSetId,
    sourceChanged: state.sourceChanged,
    error: state.error,
    width: state.width,
    height: state.height,
    snapshot: runtime?.graphic.getPlayoutSnapshot() ?? state.snapshot,
    tickerUpdates: structuredClone(runtime?.graphic.getTickerUpdates?.() ?? []),
    states:
      state.definition?.states.map(({ id, name, slotId, templateId }) => ({
        id,
        name,
        slotId,
        templateId,
      })) ?? [],
    templates:
      runtime?.templates.map((template) => ({
        id: template.id,
        name: template.name,
        fields: template.dataFields.map(({ key, type, label }) => ({ key, type, label })),
      })) ?? [],
  };
}

/** Frozen authoring contracts for routing native feeds; consumers must never mutate this source. */
export function behaviorPreviewDataSource(): {
  sessionId: string;
  source: ProjectSetDocument;
} | null {
  return current?.runtime && !current.disposed && current.prepared
    ? { sessionId: current.id, source: current.source }
    : null;
}

/** The original compact data fields edit only the selected behavior's template. */
export async function updateBehaviorPreview(values: Record<string, FieldValue>): Promise<void> {
  const session = requireSession();
  const data = resolvePreviewDataRecord(session.composition, {
    ...useBehaviorPreviewStore.getState().data,
    ...values,
  });
  useBehaviorPreviewStore.setState({ data });
  const slot = session.runtime.graphic.getPlayoutSnapshot().slots[session.slotId];
  const selected = slot?.incoming ?? slot?.current;
  // During OUT the remaining visible pixels are an outgoing snapshot. Keep edits for the
  // next IN rather than attempting to update a state which is already leaving.
  if (
    !selected ||
    selected.stateId !== session.request.stateId ||
    (slot?.transition && !slot.incoming)
  )
    return;
  await command(session, {
    type: 'update',
    slotId: session.slotId,
    stateId: session.request.stateId,
    data,
  });
}

export function pauseBehaviorPreview(): void {
  current?.runtime?.graphic.pausePlayout();
}

export function resumeBehaviorPreview(): void {
  current?.runtime?.graphic.resumePlayout();
}

/** Refresh an explicitly requested preview; edits never silently change a running demonstration. */
export async function replayBehaviorPreview(): Promise<void> {
  if (!requestContext) throw new Error('Select a behavior to preview first.');
  const request = requestContext.request;
  const latest = useProjectSetStore.getState().projectSet;
  const draft = latest && useTransitionLogicDraftStore.getState().drafts[latest.id];
  if (latest?.id === request.projectSet.id && draft && !draft.definition)
    throw new Error(
      'Playout transitions were removed from this draft. Select another template or restore the draft before previewing.',
    );
  await requestBehaviorPreview(
    latest?.id === request.projectSet.id
      ? {
          ...request,
          autoplay: true,
          projectSet: latest,
          definition: draft?.definition ?? latest.transitionLogic ?? request.definition,
        }
      : { ...request, autoplay: true },
  );
}

function sourceChanged(): void {
  if (!requestContext) return;
  const selection = useProjectSetStore.getState();
  if (
    selection.projectSet?.id !== requestContext.setId ||
    selection.activeTemplateId !== requestContext.templateId ||
    useProjectStore.getState().project.id !== requestContext.projectId
  ) {
    clearBehaviorPreview();
    return;
  }
  if (!current) return;
  if (changeTimer !== undefined) clearTimeout(changeTimer);
  const session = current;
  changeTimer = setTimeout(() => {
    changeTimer = undefined;
    if (!active(session)) return;
    const set = useProjectSetStore.getState().projectSet;
    if (!set) return;
    const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
    const source = {
      ...transitionLogicEditorSetSnapshot(set),
      transitionLogic: draft ? (draft.definition ?? undefined) : set.transitionLogic,
    };
    useBehaviorPreviewStore.setState({
      sourceChanged: sourceFingerprint(source) !== session.sourceStamp,
    });
  }, 150);
}

const subscriptions = [
  useProjectSetStore.subscribe(sourceChanged),
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project) sourceChanged();
  }),
  useTransitionLogicDraftStore.subscribe(sourceChanged),
  useRendererPluginSettingsStore.subscribe((state, previous) => {
    const session = current;
    if (!session?.runtime || state.revision === previous.revision) return;
    try {
      assertStudioRendererPluginsAllowed(
        [
          ...session.runtime.descriptor.templates,
          ...session.runtime.descriptor.sharedInstances,
        ].flatMap((source) => source.descriptor.rendererPlugins ?? []),
      );
    } catch (cause) {
      release(session);
      current = null;
      useBehaviorPreviewStore.setState({
        loading: false,
        busy: false,
        structuralBusy: false,
        onAir: false,
        currentStep: undefined,
        definition: null,
        snapshot: null,
        error: message(cause),
      });
    }
  }),
];

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const unsubscribe of subscriptions) unsubscribe();
    clearBehaviorPreview();
  });

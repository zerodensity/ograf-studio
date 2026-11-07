import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { CoordinatedPlayoutSnapshot, ReturnPayload } from '@ograf-editor/ograf-types';
import type { CoordinatedPreviewRuntime } from './coordinatedPreviewRuntime';
import { createProjectSet, type ProjectSetDocument } from './projectSet';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { usePaneRequestStore } from './paneRequestStore';
import { registerPreviewPresentation } from './previewPresentationStore';
import { useTestDataStore } from './testDataStore';
import {
  previewSlotDataKey,
  resolvePreviewSlotForm,
  stagePreviewSlotField,
  usePreviewSlotDataStore,
} from './previewSlotDataStore';

const runtimeMocks = vi.hoisted(() => ({ create: vi.fn(), command: vi.fn() }));
vi.mock('./coordinatedPreviewRuntime', () => ({
  createCoordinatedPreviewRuntime: runtimeMocks.create,
  runCoordinatedPreviewCommand: runtimeMocks.command,
}));

vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const preview = await import('./behaviorPreviewStore');
const ok: ReturnPayload = { statusCode: 200, statusMessage: 'OK' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

interface FakeViewport {
  element: HTMLElement;
  child: string | null;
  visible: boolean;
}

function fakeViewport(): FakeViewport {
  const result: FakeViewport = { element: null!, child: null, visible: true };
  result.element = {
    isConnected: true,
    getBoundingClientRect: () => ({ width: result.visible ? 800 : 0, height: 450 }),
    ownerDocument: Object.assign(new EventTarget(), {
      defaultView: {
        closed: false,
        getComputedStyle: () => ({ visibility: 'visible' }),
        requestAnimationFrame: (callback: () => void) => {
          queueMicrotask(callback);
          return 1;
        },
        cancelAnimationFrame: () => {},
      },
    }),
    replaceChildren: (node: { id: string }) => {
      result.child = node.id;
    },
  } as unknown as HTMLElement;
  return result;
}

function fixture() {
  const project = createProject({ name: 'Preview fixture' });
  project.compositions[0]!.dataFields.push(
    createFieldDefinition('text', {
      id: 'preview-headline',
      key: 'headline',
      defaultValue: 'Initial headline',
    }),
  );
  const set = createProjectSet('Preview set', project);
  set.transitionLogic = createDefaultTransitionLogic(set);
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  useProjectStore.getState().loadProject(project);
  return {
    set,
    request: {
      projectSet: set,
      definition: set.transitionLogic,
      stateId: set.transitionLogic.states[0]!.id,
      phase: 'in' as const,
    },
  };
}

function fakeRuntime(set: ProjectSetDocument, id: string) {
  const definition = set.transitionLogic as TransitionLogicDefinition;
  const state = definition.states[0]!;
  const snapshot: CoordinatedPlayoutSnapshot = {
    loaded: true,
    definitionId: definition.id,
    definitionRevision: 'test',
    frame: 0,
    frameRate: 50,
    renderType: 'realtime',
    paused: true,
    recordingTruncated: false,
    clockEpochMs: null,
    error: null,
    prepared: {},
    slots: {
      [state.slotId]: {
        slotId: state.slotId,
        name: 'Main',
        current: null,
        desired: null,
        outgoing: null,
        incoming: null,
        pending: null,
        readiness: 'idle',
        error: null,
        transition: null,
      },
    },
  };
  const listeners = new Set<(value: CoordinatedPlayoutSnapshot) => void>();
  const publish = () => listeners.forEach((listener) => listener(structuredClone(snapshot)));
  let attached: FakeViewport | undefined;
  const graphic = {
    pausePlayout: vi.fn(() => {
      snapshot.paused = true;
    }),
    resumePlayout: vi.fn(() => {
      snapshot.paused = false;
    }),
    getPlayoutSnapshot: vi.fn(() => structuredClone(snapshot)),
    subscribePlayout: vi.fn((listener: (value: CoordinatedPlayoutSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    prepareSlot: vi.fn(
      async (params: { slotId: string; stateId: string; data?: Record<string, unknown> }) => {
        snapshot.prepared[params.slotId] = {
          ...params,
          templateId: state.templateId,
          data: params.data ?? {},
          requestId: `${id}-prepared`,
          status: 'ready',
          error: null,
        };
        publish();
        return ok;
      },
    ),
    customAction: vi.fn(
      async (params: {
        id: string;
        payload: {
          slotId: string;
          stateId?: string;
          actionId?: string;
          data?: Record<string, unknown>;
        };
      }) => {
        const slot = snapshot.slots[params.payload.slotId]!;
        if (params.id === 'transition.take') {
          slot.current = {
            stateId: params.payload.stateId!,
            templateId: state.templateId,
            requestId: `${id}-take`,
            instanceId: `${id}-instance`,
            data: params.payload.data ?? {},
          };
          slot.desired = slot.current;
        } else if (params.id === 'transition.out') {
          slot.current = null;
          slot.desired = null;
        }
        publish();
        return ok;
      },
    ),
    takePreparedSlot: vi.fn(async (params: { slotId: string }) => {
      const prepared = snapshot.prepared[params.slotId]!;
      return graphic.customAction({
        id: 'transition.take',
        payload: { slotId: params.slotId, stateId: prepared.stateId!, data: prepared.data },
      });
    }),
  };
  const runtime = {
    id,
    graphic,
    definition,
    descriptor: {
      width: 1920,
      height: 1080,
      frameRate: 50,
      templates: [{ id: state.templateId, dataDefaults: {}, descriptor: { customActions: [] } }],
      sharedInstances: [],
    },
    templates: [],
    attach: vi.fn((container: HTMLElement) => {
      container.replaceChildren({ id } as unknown as Node);
    }),
    park: vi.fn(() => {
      if (attached?.child === id) attached.child = null;
    }),
    dispose: vi.fn(async () => {
      listeners.clear();
      if (attached?.child === id) attached.child = null;
    }),
    useViewport: (value: FakeViewport) => {
      attached = value;
    },
    setSelectionData: (
      data: Record<string, unknown>,
      stateId = state.id,
      slotId = state.slotId,
    ) => {
      const slot = (snapshot.slots[slotId] ??= {
        ...snapshot.slots[state.slotId]!,
        slotId,
        current: null,
        desired: null,
      });
      slot.current = {
        stateId,
        templateId: state.templateId,
        requestId: `${id}-update`,
        instanceId: `${id}-instance`,
        data,
      };
      slot.desired = slot.current;
      publish();
    },
  };
  return runtime;
}

type FakeRuntime = ReturnType<typeof fakeRuntime>;
function asRuntime(runtime: FakeRuntime): CoordinatedPreviewRuntime {
  return runtime as unknown as CoordinatedPreviewRuntime;
}

function defaultCommand(
  runtime: FakeRuntime,
  operation: {
    type: string;
    slotId: string;
    stateId?: string;
    actionId?: string;
    data?: Record<string, unknown>;
  },
) {
  if (operation.type === 'template-action')
    return runtime.graphic.customAction({ id: 'template.action', payload: operation });
  if (operation.type === 'take' && operation.stateId === undefined)
    return runtime.graphic.takePreparedSlot({ slotId: operation.slotId });
  return runtime.graphic.customAction({
    id: operation.type === 'out' ? 'transition.out' : 'transition.take',
    payload: operation,
  });
}

let detach: (() => void) | null = null;
let unregisterPresentation: (() => void) | null = null;
beforeEach(() => {
  preview.clearBehaviorPreview();
  usePreviewSlotDataStore.setState({ drafts: {}, observed: {} });
  runtimeMocks.create.mockReset();
  runtimeMocks.command.mockReset().mockImplementation(defaultCommand);
});
afterEach(() => {
  preview.clearBehaviorPreview();
  detach?.();
  detach = null;
  unregisterPresentation?.();
  unregisterPresentation = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function workingPreview() {
  const source = fixture();
  const view = fakeViewport();
  detach = preview.attachBehaviorPreviewViewport(view.element);
  const runtime = fakeRuntime(source.set, 'working');
  runtime.useViewport(view);
  runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
  await preview.requestBehaviorPreview(source.request);
  expect(preview.useBehaviorPreviewStore.getState().onAir).toBe(true);
  return { ...source, view, runtime };
}

describe('transactional coordinated behavior preview', () => {
  it('clears the stale-source indicator after Replay loads the edited source', async () => {
    vi.useFakeTimers();
    const { set, view } = await workingPreview();
    useProjectStore.getState().updateDataField('preview-headline', { label: 'Edited field' });
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(true);
    const replacement = fakeRuntime(set, 'replayed');
    replacement.useViewport(view);
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(replacement));
    await preview.replayBehaviorPreview();
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(false);
    expect(view.child).toBe('replayed');
  });

  it('keeps edits made during Replay preparation marked as newer than the loaded snapshot', async () => {
    vi.useFakeTimers();
    const { set, view } = await workingPreview();
    const loading = deferred<CoordinatedPreviewRuntime>();
    runtimeMocks.create.mockReturnValueOnce(loading.promise);
    const replay = preview.replayBehaviorPreview();
    useProjectStore
      .getState()
      .updateDataField('preview-headline', { label: 'Edited during preparation' });
    const replacement = fakeRuntime(set, 'replayed');
    replacement.useViewport(view);
    loading.resolve(asRuntime(replacement));
    await replay;
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(true);
  });

  it('applies connection-only edits live without flagging artwork stale, while field edits still require replay', async () => {
    vi.useFakeTimers();
    const { runtime } = await workingPreview();
    const requestId = preview.useBehaviorPreviewStore.getState().requestId;
    const connectionId = useProjectStore.getState().addDataConnection();
    useProjectStore.getState().updateDataConnection(connectionId, {
      url: 'https://example.test/markets.json',
      enabled: true,
      refreshMs: 5000,
      target: 'both',
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(false);
    useProjectStore.getState().updateDataConnection(connectionId, { enabled: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(false);
    expect(preview.useBehaviorPreviewStore.getState().requestId).toBe(requestId);
    expect(runtimeMocks.create).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).not.toHaveBeenCalled();
    useProjectStore
      .getState()
      .updateDataField('preview-headline', { label: 'Updated operator field' });
    await vi.advanceTimersByTimeAsync(200);
    expect(preview.useBehaviorPreviewStore.getState().sourceChanged).toBe(true);
  });

  it('routes external lane data through the existing coordinator without resuming or rebuilding preview', async () => {
    const { runtime, request } = await workingPreview();
    const source = structuredClone(useProjectStore.getState().project);
    preview.pauseBehaviorPreview();
    runtime.graphic.resumePlayout.mockClear();
    runtimeMocks.command.mockClear();
    const builds = runtimeMocks.create.mock.calls.length;
    const state = request.definition.states[0]!;
    await preview.updateBehaviorPreviewSlot(state.slotId, { headline: 'Fresh feed' }, state.id);
    expect(runtimeMocks.command).toHaveBeenCalledExactlyOnceWith(runtime, {
      type: 'update',
      slotId: state.slotId,
      mode: 'in-place',
      stateId: state.id,
      data: { headline: 'Fresh feed' },
    });
    expect(runtime.graphic.resumePlayout).not.toHaveBeenCalled();
    expect(runtimeMocks.create).toHaveBeenCalledTimes(builds);
    expect(useProjectStore.getState().project).toEqual(source);
    expect(preview.useBehaviorPreviewStore.getState().data.headline).toBe('Fresh feed');
  });

  it('allows explicit operator or MCP updates to request their authored transition', async () => {
    const { runtime, request } = await workingPreview();
    runtimeMocks.command.mockClear();
    const state = request.definition.states[0]!;
    await preview.updateBehaviorPreviewSlot(
      state.slotId,
      { headline: 'Editorial replacement' },
      state.id,
      'transition',
    );
    expect(runtimeMocks.command).toHaveBeenCalledExactlyOnceWith(runtime, {
      type: 'update',
      slotId: state.slotId,
      stateId: state.id,
      mode: 'transition',
      data: { headline: 'Editorial replacement' },
    });
  });

  it('updates the selected template data form after actions while ignoring other lane or template data', async () => {
    const { request, runtime } = await workingPreview();
    const slotId = request.definition.states[0]!.slotId;
    expect(preview.useBehaviorPreviewStore.getState().data).toEqual({
      headline: 'Initial headline',
    });
    const initialRevision = preview.useBehaviorPreviewStore.getState().dataSyncRevision;
    runtime.graphic.customAction.mockImplementationOnce(async (params) => {
      expect(params.id).toBe('template.action');
      runtime.setSelectionData({ headline: 'Headline from action', unknownField: 'Ignore me' });
      return ok;
    });
    await preview.runBehaviorPreviewTemplateAction(slotId, 'update-headline');
    expect(preview.useBehaviorPreviewStore.getState().data).toEqual({
      headline: 'Headline from action',
    });
    const actionRevision = preview.useBehaviorPreviewStore.getState().dataSyncRevision;
    expect(actionRevision).toBe(initialRevision + 1);
    runtime.setSelectionData({ headline: 'Headline from action' });
    expect(preview.useBehaviorPreviewStore.getState().dataSyncRevision).toBe(actionRevision);
    runtime.setSelectionData({ headline: 'Another lane' }, 'other-state', 'other-slot');
    expect(preview.useBehaviorPreviewStore.getState().data).toEqual({
      headline: 'Headline from action',
    });
    expect(preview.useBehaviorPreviewStore.getState().dataSyncRevision).toBe(actionRevision);
    runtime.setSelectionData({ headline: 'Another template in this lane' }, 'other-state');
    expect(preview.useBehaviorPreviewStore.getState().data).toEqual({
      headline: 'Headline from action',
    });
    expect(preview.useBehaviorPreviewStore.getState().dataSyncRevision).toBe(actionRevision);
  });

  it('keeps fullscreen viewport ownership instead of revealing its dock underneath the player', async () => {
    const { set, request } = fixture();
    const view = fakeViewport();
    Object.assign(view.element.ownerDocument, { fullscreenElement: view.element });
    unregisterPresentation = registerPreviewPresentation({
      viewport: view.element,
      enter: async () => undefined,
    });
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const runtime = fakeRuntime(set, 'fullscreen');
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
    const reveal = vi.spyOn(usePaneRequestStore.getState(), 'reveal');
    await preview.requestBehaviorPreview(request);
    expect(reveal).not.toHaveBeenCalled();
    expect(view.child).toBe('fullscreen');
    Object.assign(view.element.ownerDocument, { fullscreenElement: null });
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(fakeRuntime(set, 'docked')));
    await preview.requestBehaviorPreview(request);
    expect(reveal).toHaveBeenCalledExactlyOnceWith('export');
  });
  it.each(['compile', 'load'])(
    'retains the working output after a replacement %s failure',
    async (stage) => {
      const { request, view, runtime } = await workingPreview();
      const previous = preview.useBehaviorPreviewStore.getState();
      runtimeMocks.create.mockRejectedValueOnce(new Error(`${stage} failed`));
      await expect(preview.requestBehaviorPreview(request)).rejects.toThrow(`${stage} failed`);
      expect(runtime.dispose).not.toHaveBeenCalled();
      expect(view.child).toBe('working');
      expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
        requestId: previous.requestId,
        definition: previous.definition,
        onAir: true,
        loading: false,
        busy: false,
        error: `${stage} failed`,
      });
      await preview.outBehaviorPreview();
      expect(preview.useBehaviorPreviewStore.getState().onAir).toBe(false);
    },
  );

  it('validates incoming readiness before replacing working output, and disposes failed candidates', async () => {
    const { set, request, view, runtime } = await workingPreview();
    const candidate = fakeRuntime(set, 'broken');
    candidate.graphic.prepareSlot.mockRejectedValueOnce(new Error('Image preparation failed'));
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(candidate));
    await expect(preview.requestBehaviorPreview(request)).rejects.toThrow(
      'Image preparation failed',
    );
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(view.child).toBe('working');
    expect(candidate.attach).not.toHaveBeenCalled();
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: true,
      error: 'Image preparation failed',
    });
  });

  it('rejects a failed first preparation without leaving a loaded session or runtime behind', async () => {
    const { set, request } = fixture();
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const candidate = fakeRuntime(set, 'broken-first');
    candidate.graphic.prepareSlot.mockRejectedValueOnce(new Error('First preparation failed'));
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(candidate));
    await expect(preview.requestBehaviorPreview(request)).rejects.toThrow(
      'First preparation failed',
    );
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(view.child).toBeNull();
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: false,
      definition: null,
      snapshot: null,
    });
  });

  it('retains working output when seeding an Out preview returns a failure response', async () => {
    const { set, request, view, runtime } = await workingPreview();
    const candidate = fakeRuntime(set, 'broken-out-seed');
    candidate.graphic.customAction.mockResolvedValueOnce({
      statusCode: 500,
      statusMessage: 'Could not seed Out preview',
    });
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(candidate));
    await expect(preview.requestBehaviorPreview({ ...request, phase: 'out' })).rejects.toThrow(
      'Could not seed Out preview',
    );
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(candidate.attach).not.toHaveBeenCalled();
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(view.child).toBe('working');
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: true,
    });
  });

  it('retains a successfully loaded session and usable controls after its first command fails', async () => {
    const { set, request } = fixture();
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const candidate = fakeRuntime(set, 'command-error');
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(candidate));
    runtimeMocks.command.mockRejectedValueOnce(new Error('Take command failed'));
    await expect(preview.requestBehaviorPreview(request)).rejects.toThrow('Take command failed');
    expect(candidate.dispose).not.toHaveBeenCalled();
    expect(view.child).toBe('command-error');
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      definition: set.transitionLogic,
      error: 'Take command failed',
    });
    await preview.takeBehaviorPreview();
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: true,
      error: null,
    });
  });

  it('cancels overlapping replacement preparation without disposing the working output early', async () => {
    const { set, request, view, runtime } = await workingPreview();
    const first = deferred<CoordinatedPreviewRuntime>();
    const second = deferred<CoordinatedPreviewRuntime>();
    runtimeMocks.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstTask = preview.requestBehaviorPreview(request);
    const firstSignal = runtimeMocks.create.mock.calls.at(-1)![1].signal as AbortSignal;
    const secondTask = preview.requestBehaviorPreview(request);
    expect(firstSignal.aborted).toBe(true);
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(view.child).toBe('working');
    const replacement = fakeRuntime(set, 'replacement');
    replacement.useViewport(view);
    second.resolve(asRuntime(replacement));
    await secondTask;
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(view.child).toBe('replacement');
    const late = fakeRuntime(set, 'late-cancelled');
    first.resolve(asRuntime(late));
    await firstTask;
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(late.attach).not.toHaveBeenCalled();
    expect(view.child).toBe('replacement');
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: true,
      error: null,
    });
  });

  it('derives rollback busy status from remaining commands rather than a stale backup', async () => {
    const { request, runtime } = await workingPreview();
    const command = deferred<void>();
    runtimeMocks.command.mockImplementationOnce(() => command.promise);
    const commandTask = preview.takeBehaviorPreview();
    expect(preview.useBehaviorPreviewStore.getState().busy).toBe(true);
    const replacement = deferred<CoordinatedPreviewRuntime>();
    runtimeMocks.create.mockReturnValueOnce(replacement.promise);
    const replacementTask = preview.requestBehaviorPreview(request);
    const rejected = expect(replacementTask).rejects.toThrow('Replacement failed');
    command.resolve();
    await commandTask;
    replacement.reject(new Error('Replacement failed'));
    await rejected;
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
    });
  });

  it('does not inherit the disposed output busy state when a replacement loads without autoplay', async () => {
    const { set, request } = await workingPreview();
    const command = deferred<void>();
    runtimeMocks.command.mockImplementationOnce(() => command.promise);
    const commandTask = preview.takeBehaviorPreview();
    const replacement = fakeRuntime(set, 'off-replacement');
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(replacement));
    await preview.requestBehaviorPreview({ ...request, autoplay: false });
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      loading: false,
      busy: false,
      onAir: false,
    });
    command.resolve();
    await commandTask;
    expect(preview.useBehaviorPreviewStore.getState().busy).toBe(false);
  });

  it('moves the prepared output between viewports and cancels a pending replacement on clear', async () => {
    const { set, request, runtime } = await workingPreview();
    detach!();
    const fullscreen = fakeViewport();
    runtime.useViewport(fullscreen);
    detach = preview.attachBehaviorPreviewViewport(fullscreen.element);
    expect(fullscreen.child).toBe('working');
    expect(runtime.graphic.resumePlayout).toHaveBeenCalled();
    const pending = deferred<CoordinatedPreviewRuntime>();
    runtimeMocks.create.mockReturnValueOnce(pending.promise);
    const task = preview.requestBehaviorPreview(request);
    const signal = runtimeMocks.create.mock.calls.at(-1)![1].signal as AbortSignal;
    preview.clearBehaviorPreview();
    expect(signal.aborted).toBe(true);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    const late = fakeRuntime(set, 'late-after-clear');
    pending.resolve(asRuntime(late));
    await task;
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(late.attach).not.toHaveBeenCalled();
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      requestId: null,
      loading: false,
      busy: false,
      snapshot: null,
    });
  });
});

describe('named-state presets and explicit Take admission in preview', () => {
  it('forgets ended runtime values but preserves staged edits when a preview is cleared', async () => {
    const { set, request, runtime, view } = await workingPreview();
    const state = request.definition.states[0]!;
    const key = previewSlotDataKey(
      set.id,
      request.definition.id,
      state.slotId,
      state.id,
      state.templateId,
    );
    runtime.setSelectionData({ headline: 'Live value' });
    expect(
      resolvePreviewSlotForm(set, request.definition, state.id, undefined, undefined)?.values
        .headline,
    ).toBe('Live value');
    const otherKey = previewSlotDataKey(
      set.id,
      request.definition.id,
      'other-slot',
      'other-state',
      state.templateId,
    );
    stagePreviewSlotField(otherKey, 'headline', 'Staged value');
    preview.clearBehaviorPreview();
    expect(usePreviewSlotDataStore.getState().observed[key]).toBeUndefined();
    expect(usePreviewSlotDataStore.getState().drafts[otherKey]).toEqual({
      headline: 'Staged value',
    });
    expect(
      resolvePreviewSlotForm(set, request.definition, state.id, undefined, undefined)?.values
        .headline,
    ).toBe('Initial headline');
    const replacement = fakeRuntime(set, 'fresh-session');
    replacement.useViewport(view);
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(replacement));
    await preview.requestBehaviorPreview(request);
    expect(replacement.graphic.prepareSlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headline: 'Initial headline' } }),
    );
  });

  it('acknowledges a staged retained value after Out and a matching Take', async () => {
    const { set, request, runtime } = await workingPreview();
    const state = request.definition.states[0]!;
    const key = previewSlotDataKey(
      set.id,
      request.definition.id,
      state.slotId,
      state.id,
      state.templateId,
    );
    runtime.setSelectionData({ headline: 'Same live value' });
    await runtime.graphic.customAction({ id: 'transition.out', payload: { slotId: state.slotId } });
    stagePreviewSlotField(key, 'headline', 'Same live value');
    runtime.setSelectionData({ headline: 'Same live value' });
    expect(usePreviewSlotDataStore.getState().drafts[key]).toBeUndefined();
  });
  it('lets an intentionally staged default-valued field override a named preset on first Take', async () => {
    const { set, request } = fixture();
    const state = set.transitionLogic!.states[0]!;
    state.dataDefaults = { headline: 'STATE preset' };
    await preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'Initial headline',
    );
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const runtime = fakeRuntime(set, 'staged-first');
    runtime.useViewport(view);
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
    await preview.requestBehaviorPreview(request);
    expect(runtime.graphic.prepareSlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headline: 'Initial headline' } }),
    );
  });
  it('prepares the first Take with its named preset instead of the standalone form defaults', async () => {
    const { set, request } = fixture();
    useTestDataStore.getState().resetAll();
    set.transitionLogic!.states[0]!.dataDefaults = { headline: 'DEVELOPING preset' };
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const runtime = fakeRuntime(set, 'first-preset');
    runtime.useViewport(view);
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
    await preview.requestBehaviorPreview({
      ...request,
      dataByTemplateId: { [set.templates[0]!.id]: { headline: 'Initial headline' } },
    });
    expect(runtime.graphic.prepareSlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headline: 'DEVELOPING preset' } }),
    );
    expect(preview.useBehaviorPreviewStore.getState().data.headline).toBe('DEVELOPING preset');
  });
  it('omits a full template-default payload when taking another state so its own preset and retained edits survive', async () => {
    const { runtime, request } = await workingPreview();
    const selected = request.definition.states[0]!;
    runtime.definition.states.push({
      ...selected,
      id: 'second-preset',
      name: 'Second preset',
      dataDefaults: { headline: 'Second state' },
    });
    await preview.takeBehaviorPreviewSlot(selected.slotId, 'second-preset');
    const operation = runtimeMocks.command.mock.calls.at(-1)![1];
    expect(operation).toMatchObject({
      type: 'take',
      slotId: selected.slotId,
      stateId: 'second-preset',
    });
    expect(Object.hasOwn(operation, 'data')).toBe(false);
  });
  it('takes a staged second state with only the explicitly edited keys', async () => {
    const { set, runtime, request } = await workingPreview();
    const first = request.definition.states[0]!;
    const second = {
      ...first,
      id: 'staged-second',
      name: 'Second',
      dataDefaults: { headline: 'Preset' },
    };
    runtime.definition.states.push(second);
    await preview.editBehaviorPreviewSlotField(
      set,
      runtime.definition,
      second.id,
      'headline',
      'Staged value',
    );
    await preview.takeBehaviorPreviewSlot(first.slotId, second.id);
    expect(runtimeMocks.command.mock.calls.at(-1)![1]).toMatchObject({
      type: 'take',
      slotId: first.slotId,
      stateId: second.id,
      data: { headline: 'Staged value' },
    });
  });
  it('debounces rapid on-air typing into one authored update and retains only its lane', async () => {
    const { set, request } = await workingPreview();
    const state = request.definition.states[0]!;
    runtimeMocks.command.mockClear();
    vi.useFakeTimers();
    const a = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'A',
    );
    const b = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'AB',
    );
    await vi.advanceTimersByTimeAsync(149);
    expect(runtimeMocks.command).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([a, b]);
    expect(runtimeMocks.command).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.command.mock.calls[0]![1]).toMatchObject({
      type: 'update',
      slotId: state.slotId,
      stateId: state.id,
      data: { headline: 'AB' },
    });
  });
  it('keeps operator fields editable during an update but blocks them during structural commands', async () => {
    const { set, request } = await workingPreview();
    const state = request.definition.states[0]!;
    const slowUpdate = deferred<void>();
    const slowTake = deferred<void>();
    runtimeMocks.command
      .mockClear()
      .mockImplementationOnce(() => slowUpdate.promise)
      .mockImplementationOnce(() => slowTake.promise);
    vi.useFakeTimers();
    const edit = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'Typing',
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      busy: true,
      structuralBusy: false,
    });
    const take = preview.takeBehaviorPreviewSlot(state.slotId, state.id);
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      busy: true,
      structuralBusy: true,
    });
    slowTake.resolve();
    await take;
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      busy: true,
      structuralBusy: false,
    });
    slowUpdate.resolve();
    await edit;
    expect(preview.useBehaviorPreviewStore.getState()).toMatchObject({
      busy: false,
      structuralBusy: false,
    });
  });
  it('does not redirect an edit when the lane changes before the debounce completes', async () => {
    const { set, runtime, request } = await workingPreview();
    const state = request.definition.states[0]!;
    runtimeMocks.command.mockClear();
    vi.useFakeTimers();
    const edit = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'Staged later',
    );
    runtime.setSelectionData({ headline: 'Other on air' }, 'other-state', state.slotId);
    await vi.advanceTimersByTimeAsync(150);
    await edit;
    expect(runtimeMocks.command).not.toHaveBeenCalled();
    const key = previewSlotDataKey(
      set.id,
      request.definition.id,
      state.slotId,
      state.id,
      state.templateId,
    );
    expect(usePreviewSlotDataStore.getState().drafts[key]).toEqual({ headline: 'Staged later' });
  });
  it('serializes newer edits behind an in-flight update without dropping the newer value', async () => {
    const { set, request } = await workingPreview();
    const state = request.definition.states[0]!;
    const slow = deferred<void>();
    runtimeMocks.command.mockClear().mockImplementationOnce(() => slow.promise);
    vi.useFakeTimers();
    const first = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'First',
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(runtimeMocks.command).toHaveBeenCalledTimes(1);
    const second = preview.editBehaviorPreviewSlotField(
      set,
      request.definition,
      state.id,
      'headline',
      'Newest',
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(runtimeMocks.command).toHaveBeenCalledTimes(1);
    slow.resolve();
    await Promise.all([first, second]);
    expect(runtimeMocks.command).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.command.mock.calls[1]![1]).toMatchObject({
      type: 'update',
      slotId: state.slotId,
      stateId: state.id,
      data: { headline: 'Newest' },
    });
  });
  it('does not silently seed required parents for a cold operator Take', async () => {
    const { set, request } = fixture(),
      target = set.transitionLogic!.states[0]!;
    set.transitionLogic!.slots[0]!.admission = { requireOnSlotIds: ['required'] };
    set.transitionLogic!.slots.push({ id: 'required', name: 'Headline', order: 1 });
    set.transitionLogic!.states.push({
      ...target,
      id: 'required-state',
      name: 'Headline',
      slotId: 'required',
    });
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const runtime = fakeRuntime(set, 'guarded-cold');
    runtime.useViewport(view);
    runtime.graphic.prepareSlot.mockResolvedValueOnce({
      statusCode: 550,
      statusMessage: 'Cannot Take Header: Headline must be On and have finished entering.',
    });
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
    await expect(preview.requestBehaviorPreview(request)).rejects.toThrow(/Headline must be On/);
    expect(runtime.graphic.customAction).not.toHaveBeenCalled();
    expect(runtimeMocks.command).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
  it('seeds only explicitly declared context and applies that context state preset', async () => {
    const { set, request } = fixture();
    useTestDataStore.getState().resetAll();
    const target = set.transitionLogic!.states[0]!;
    target.dataDefaults = { headline: 'SELECTED preset' };
    set.transitionLogic!.slots.push({ id: 'context', name: 'Context', order: 1 });
    set.transitionLogic!.states.push({
      ...target,
      id: 'context-state',
      name: 'Context',
      slotId: 'context',
      dataDefaults: { headline: 'CONTEXT preset' },
    });
    const view = fakeViewport();
    detach = preview.attachBehaviorPreviewViewport(view.element);
    const runtime = fakeRuntime(set, 'explicit-context');
    runtime.useViewport(view);
    const original = runtime.graphic.customAction.getMockImplementation()!;
    runtime.graphic.customAction.mockImplementation(async (params) =>
      params.payload.slotId === 'context' ? ok : original(params),
    );
    runtimeMocks.create.mockResolvedValueOnce(asRuntime(runtime));
    await preview.requestBehaviorPreview({
      ...request,
      contextStateIds: ['context-state'],
      dataByTemplateId: { [set.templates[0]!.id]: { headline: 'Initial headline' } },
    });
    expect(runtime.graphic.customAction).toHaveBeenCalledWith({
      id: 'transition.take',
      payload: {
        slotId: 'context',
        stateId: 'context-state',
        data: { headline: 'CONTEXT preset' },
      },
      skipAnimation: true,
    });
    expect(runtime.graphic.prepareSlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headline: 'SELECTED preset' } }),
    );
  });
});

import { compileDescriptor } from '@ograf-editor/codegen';
import { registerGraphicElement } from '@ograf-editor/ograf-runtime';
import type { Graphic, ReturnPayload } from '@ograf-editor/ograf-types';
import {
  compositionWithShaderParameterFields,
  getCompositionOutputRect,
  type Composition,
  type FieldDefinition,
  type FieldValue,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import {
  createCoordinatedPreviewRuntime,
  type CoordinatedPreviewRuntime,
} from './coordinatedPreviewRuntime';
import { resolveProjectSetTemplate } from './projectSet';
import type { PresenterDocumentSnapshot, ResolvedPresenterEntry } from './presenterDocument';
import { resolvePreviewDataRecord } from './previewData';
import {
  assertStudioRendererPluginsAllowed,
  registerRendererPluginPolicy,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

export interface PresenterEntryInfo {
  fields: FieldDefinition[];
  data: Record<string, FieldValue>;
  width: number;
  height: number;
  stepCount: number;
}
export interface PresenterRuntime {
  mode: 'independent' | 'coordinated';
  warning: string | null;
  plugins: RendererPluginSnapshot[];
  entryInfo(entry: ResolvedPresenterEntry): PresenterEntryInfo;
  attach(container: HTMLElement): void;
  park(): void;
  cue(
    index: number,
    data: Map<string, Record<string, FieldValue>>,
    activated?: () => void,
  ): Promise<number | undefined>;
  update(entry: ResolvedPresenterEntry, data: Record<string, FieldValue>): Promise<void>;
  step(delta: number): Promise<number | undefined>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

function successful(result: ReturnPayload | undefined, action: string): void {
  if (result && result.statusCode >= 400)
    throw new Error(result.statusMessage || `${action} failed.`);
}

function compositionFor(
  source: PresenterDocumentSnapshot,
  entry: ResolvedPresenterEntry,
): Composition {
  const project = source.projectSet
    ? resolveProjectSetTemplate(source.projectSet, entry.templateId)
    : source.project;
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition) throw new Error(`The main composition for “${entry.title}” is missing.`);
  return compositionWithShaderParameterFields(composition);
}

function entryInfo(
  source: PresenterDocumentSnapshot,
  entry: ResolvedPresenterEntry,
): PresenterEntryInfo {
  const composition = compositionFor(source, entry);
  const output = getCompositionOutputRect(composition);
  return {
    fields: structuredClone(composition.dataFields),
    data: resolvePreviewDataRecord(composition, {}),
    width: output.width,
    height: output.height,
    stepCount: composition.keyframes.filter((frame) => frame.role === 'step').length,
  };
}

/** Each independent cue owns the complete native Graphic lifecycle, including audio and rules. */
async function independentRuntime(
  source: PresenterDocumentSnapshot,
  _ownerDocument: Document,
  signal?: AbortSignal,
): Promise<PresenterRuntime> {
  // The main document outlives detached panes. Moving a live node into a visible viewport
  // adopts it into that document; its native adoptedCallback transfers animation clocks.
  const parkingDocument = globalThis.document;
  const parking = parkingDocument.createElement('div');
  parking.setAttribute('aria-hidden', 'true');
  parking.style.cssText =
    'position:fixed;left:-100000px;top:-100000px;visibility:hidden;pointer-events:none;';
  parkingDocument.body.append(parking);
  let disposed = false;
  let viewport: HTMLElement | null = null;
  type Mount = { entryId: string; graphic: HTMLElement & Graphic };
  let current: Mount | null = null;
  let prepared: Mount | null = null;
  const mounts = new Set<Mount>();
  // Keep one registered class per source template when navigating back and forth.
  const compiled = new Map<
    string,
    { descriptor: ReturnType<typeof compileDescriptor>; tagName: string }
  >();
  const plugins: RendererPluginSnapshot[] = [];
  const assertLive = () => {
    if (disposed || signal?.aborted) throw new Error('Preview loading or playback was cancelled.');
  };
  const release = async (mount: Mount) => {
    if (!mounts.delete(mount)) return;
    // Disconnect first: native cleanup cancels a pending lifecycle immediately instead of
    // serializing disposal behind a potentially long IN/OUT animation.
    mount.graphic.remove();
    await mount.graphic.dispose({});
  };
  const prepare = async (entry: ResolvedPresenterEntry, data: Record<string, FieldValue>) => {
    assertLive();
    const composition = compositionFor(source, entry);
    let cached = compiled.get(entry.templateId);
    if (!cached) {
      const descriptor = compileDescriptor(composition);
      cached = { descriptor, tagName: registerGraphicElement(descriptor) };
      compiled.set(entry.templateId, cached);
    }
    const descriptor = cached.descriptor;
    const required = descriptor.rendererPlugins ?? [];
    if (required.length) await useRendererPluginSettingsStore.getState().initialize();
    assertLive();
    assertStudioRendererPluginsAllowed(required);
    registerRendererPluginPolicy();
    for (const plugin of required) if (!plugins.includes(plugin)) plugins.push(plugin);
    const graphic = globalThis.document.createElement(cached.tagName) as HTMLElement & Graphic;
    const mount = { entryId: entry.id, graphic };
    mounts.add(mount);
    parking.append(graphic);
    try {
      const info = entryInfo(source, entry);
      successful(
        await graphic.load({
          data: resolvePreviewDataRecord(composition, data),
          renderType: 'realtime',
          renderCharacteristics: {
            resolution: { width: info.width, height: info.height },
            frameRate: composition.frameRate,
            accessToPublicInternet: false,
          },
        }),
        'Loading the template',
      );
      assertLive();
      assertStudioRendererPluginsAllowed(required);
      await Promise.all(
        Array.from(graphic.shadowRoot?.querySelectorAll('img') ?? []).map(async (image) => {
          if (!image.getAttribute('src')) return;
          try {
            await image.decode();
          } catch {
            throw new Error(`An image in “${entry.title}” could not be loaded.`);
          }
        }),
      );
      assertLive();
      return mount;
    } catch (cause) {
      await release(mount);
      throw cause;
    }
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', abort);
    await Promise.allSettled([...mounts].map(release));
    current = null;
    prepared = null;
    parking.remove();
  };
  const abort = () => {
    void dispose();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const first = source.entries.find((entry) => entry.available);
    if (!first) throw new Error('Open a template or template set to preview.');
    prepared = await prepare(first, entryInfo(source, first).data);
    return {
      mode: 'independent',
      warning: null,
      plugins,
      entryInfo: (entry) => entryInfo(source, entry),
      attach(container) {
        viewport = container;
        if (current && !disposed) container.replaceChildren(current.graphic);
      },
      park() {
        viewport = null;
        if (current && !disposed) parking.append(current.graphic);
      },
      async cue(index, data, activated) {
        assertLive();
        const entry = source.entries[index];
        if (!entry?.available) throw new Error('This template is not available.');
        // Finish resource preparation before touching the visible template. Failed loads leave it intact.
        const values = data.get(entry.id) ?? entryInfo(source, entry).data;
        const next = prepared?.entryId === entry.id ? prepared : await prepare(entry, values);
        try {
          if (prepared === next) {
            prepared = null;
            successful(
              await next.graphic.updateAction({
                data: resolvePreviewDataRecord(compositionFor(source, entry), values),
                skipAnimation: true,
              }),
              'Preparing data',
            );
          }
          assertLive();
          const previous = current;
          if (previous)
            successful(await previous.graphic.stopAction({}), 'Taking the previous template out');
          assertLive();
          current = next;
          activated?.();
          if (viewport?.isConnected) viewport.replaceChildren(next.graphic);
          else parking.append(next.graphic);
          if (previous) await release(previous);
          const result = await next.graphic.playAction({ goto: 0 });
          successful(result, 'Taking the template in');
          assertLive();
          return result.currentStep;
        } finally {
          if (current !== next) await release(next);
        }
      },
      async update(entry, data) {
        assertLive();
        if (current?.entryId !== entry.id)
          throw new Error('Take this template before updating its data.');
        successful(
          await current.graphic.updateAction({
            data: resolvePreviewDataRecord(compositionFor(source, entry), data),
          }),
          'Updating template data',
        );
      },
      async step(delta) {
        assertLive();
        if (!current) throw new Error('Take a template first.');
        const result = await current.graphic.playAction({ delta });
        successful(result, 'Advancing the template step');
        return result.currentStep;
      },
      async stop() {
        assertLive();
        if (current) successful(await current.graphic.stopAction({}), 'Taking the template out');
      },
      dispose,
    };
  } catch (cause) {
    await dispose();
    throw cause;
  }
}

function coordinatedRuntime(
  source: PresenterDocumentSnapshot,
  loaded: CoordinatedPreviewRuntime,
  signal?: AbortSignal,
): PresenterRuntime {
  let disposed = false;
  const assertLive = () => {
    if (disposed || signal?.aborted) throw new Error('Preview playback was cancelled.');
  };
  return {
    mode: 'coordinated',
    warning: null,
    plugins: [...loaded.descriptor.templates, ...loaded.descriptor.sharedInstances].flatMap(
      (item) => item.descriptor.rendererPlugins ?? [],
    ),
    entryInfo(entry) {
      const info = entryInfo(source, entry);
      return {
        ...info,
        width: loaded.descriptor.width,
        height: loaded.descriptor.height,
        stepCount: 1,
      };
    },
    attach: (container) => loaded.attach(container),
    park: () => loaded.park(),
    async cue(index, data, activated) {
      assertLive();
      // Browsing shows the selected template and its shared instances. Other slots belong
      // to live playout, so earlier selections must not accumulate behind this preview.
      const entry = source.entries[index];
      if (!entry?.available) throw new Error('This template is not available.');
      const state = loaded.definition.states.find((state) => state.id === entry.stateId);
      if (!state) throw new Error(`“${entry.title}” needs a valid playout state in Transitions.`);
      const desired = new Map([[state.slotId, { entry, stateId: state.id }]]);
      const before = loaded.graphic.getPlayoutSnapshot();
      const changed = [...desired].filter(([slotId, target]) => {
        const active = before.slots[slotId]?.current;
        return (
          active?.stateId !== target.stateId ||
          JSON.stringify(active.data) !==
            JSON.stringify(data.get(target.entry.id) ?? entryInfo(source, target.entry).data)
        );
      });
      // Prepare every changed slot first. A missing resource cannot blank the currently visible cue.
      for (const [slotId, target] of changed) {
        successful(
          await loaded.graphic.prepareSlot({
            slotId,
            stateId: target.stateId,
            data: data.get(target.entry.id) ?? entryInfo(source, target.entry).data,
          }),
          'Preparing coordinated template',
        );
        assertLive();
      }
      await Promise.all(
        Object.keys(before.slots)
          .filter((slotId) => !desired.has(slotId) && before.slots[slotId]?.current)
          .map(async (slotId) => {
            successful(
              await loaded.graphic.customAction({ id: 'transition.out', payload: { slotId } }),
              'Taking the old slot out',
            );
          }),
      );
      assertLive();
      activated?.();
      await Promise.all(
        changed.map(async ([slotId]) => {
          successful(
            await loaded.graphic.takePreparedSlot({ slotId }),
            'Taking the coordinated template',
          );
        }),
      );
      assertLive();
      return 0;
    },
    async update(entry, data) {
      assertLive();
      const state = loaded.definition.states.find((state) => state.id === entry.stateId);
      if (
        !state ||
        loaded.graphic.getPlayoutSnapshot().slots[state.slotId]?.current?.stateId !== state.id
      )
        throw new Error('This template is not currently on air.');
      successful(
        await loaded.graphic.customAction({
          id: 'transition.take',
          payload: { slotId: state.slotId, stateId: state.id, data },
        }),
        'Updating coordinated data',
      );
    },
    async step() {
      throw new Error('Use the template navigation controls for coordinated preview.');
    },
    async stop() {
      assertLive();
      successful(await loaded.graphic.stopAction({}), 'Taking the template out');
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await loaded.dispose();
    },
  };
}

/** Builds an isolated, frozen rehearsal; never selects an authoring template or touches live playout. */
export async function createPresenterRuntime(
  source: PresenterDocumentSnapshot,
  options: { document?: Document; signal?: AbortSignal } = {},
): Promise<PresenterRuntime> {
  const snapshot = structuredClone(source);
  const active = snapshot.entries.filter((entry) => entry.available);
  if (!active.length) throw new Error('Open a template or template set to preview.');
  const definition = snapshot.projectSet?.transitionLogic;
  const mapped =
    !!definition &&
    active.every((entry) =>
      definition.states.some(
        (state) => state.id === entry.stateId && state.templateId === entry.templateId,
      ),
    );
  let warning: string | null = null;
  if (mapped && snapshot.projectSet) {
    try {
      return coordinatedRuntime(
        snapshot,
        await createCoordinatedPreviewRuntime(snapshot.projectSet, {
          ...options,
          document: globalThis.document,
        }),
        options.signal,
      );
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      warning = `Using independent template playback: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  } else if (definition)
    warning =
      'Using independent template playback because some templates have no unique playout state in Transitions.';
  const runtime = await independentRuntime(
    snapshot,
    options.document ?? globalThis.document,
    options.signal,
  );
  runtime.warning = warning;
  return runtime;
}

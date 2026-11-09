import graphicRuntimeSource from '@ograf-editor/ograf-runtime/dist/graphic-runtime.js?raw';
import {
  buildExportArtifactsWithRuntime,
  compileDescriptor,
  EXPORTED_RESOURCE_URLS_KEY,
  validatePackageLayout,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  CoordinatedPlayoutSnapshot,
  Graphic,
  OGrafManifest,
  ScheduledAction,
} from '@ograf-editor/ograf-types';
import {
  lottiePlayerFrameAtTime,
  getElementShaderPaints,
  type Composition,
  type Element,
  type Project,
} from '@ograf-editor/scene-model';
import { createCertificationResourceUrls } from './certificationResources';
import { awaitExportOperation } from './exportAbort';
import {
  certificationMethodTiming,
  certificationPromiseWithTimeout,
  type CertificationMethodTiming,
} from './certificationTiming';
import {
  coordinatedCertificationCases,
  coordinatedCertificationCanvasCounts,
  coordinatedCertificationConflicts,
  coordinatedCertificationSuccessErrors,
  coordinatedCertificationRejectionErrors,
  coordinatedCertificationOutputIdentity,
  coordinatedCertificationNextTransitionFrame,
  createCoordinatedStartupEvidence,
} from './coordinatedCertification';
import {
  assertStudioRendererPluginsAllowed,
  rendererPluginAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

export type { ExportArtifacts } from '@ograf-editor/codegen';

/** The checks mirror ograf-devtool's manifest/module checks and its in-depth lifecycle exercise. */
export interface OGrafCompatibilityCheck {
  id: 'project' | 'manifest' | 'package' | 'module' | 'lifecycle';
  label: string;
  valid: boolean;
  errors: string[];
}

export interface OGrafCompatibilityResult {
  valid: boolean;
  checks: OGrafCompatibilityCheck[];
  errors: string[];
}

/** Compiles the exact files that will be certified and, only after certification, saved. */
export function buildExportArtifacts(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): ExportArtifacts {
  assertStudioRendererPluginsAllowed(compileDescriptor(composition).rendererPlugins ?? []);
  return buildExportArtifactsWithRuntime(project, composition, graphicRuntimeSource, profile);
}

function defaultsFromManifest(manifest: OGrafManifest): Record<string, unknown> {
  const schema = manifest.schema;
  if (!schema || typeof schema !== 'object') return {};
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return {};
  return Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || !('default' in value)) return [];
      return [[key, (value as { default: unknown }).default]];
    }),
  );
}

export function certificationSeekTimestamps(elements: Element[]): {
  target: number;
  rewind: number;
  exercisesAllLotties: boolean;
} {
  const target = 5_000;
  const lotties = elements.filter(
    (element): element is Extract<Element, { type: 'lottie' }> =>
      element.type === 'lottie' && !!element.animationData && element.speed > 0,
  );
  if (lotties.length === 0) return { target, rewind: 2_000, exercisesAllLotties: true };
  for (let attempt = 0; attempt < 1_999; attempt += 1) {
    const rewind = 1_000.5 + attempt;
    if (
      lotties.every(
        (element) =>
          Math.abs(
            lottiePlayerFrameAtTime(element, target) - lottiePlayerFrameAtTime(element, rewind),
          ) > 1e-6,
      )
    ) {
      return { target, rewind, exercisesAllLotties: true };
    }
  }
  return { target, rewind: 2_000.5, exercisesAllLotties: false };
}

function validateReturnPayload(
  method: string,
  payload: unknown,
  extraKeys: string[] = [],
): string[] {
  if (payload === undefined) return [];
  if (payload === null || typeof payload !== 'object') {
    return [`${method}() must return an object or undefined.`];
  }
  const errors: string[] = [];
  const record = payload as Record<string, unknown>;
  const allowed = new Set(['statusCode', 'statusMessage', ...extraKeys]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key) && !key.startsWith('v_')) {
      errors.push(
        `${method}() returned non-standard key "${key}" (vendor keys must start with "v_").`,
      );
    }
  }
  if (typeof record.statusCode !== 'number')
    errors.push(`${method}() statusCode must be a number.`);
  if (record.statusMessage !== undefined && typeof record.statusMessage !== 'string') {
    errors.push(`${method}() statusMessage must be a string when present.`);
  }
  if (typeof record.statusCode === 'number' && record.statusCode >= 400) {
    errors.push(
      `${method}() returned error ${record.statusCode}: ${String(record.statusMessage ?? '')}`,
    );
  }
  return errors;
}

type CallableGraphic = HTMLElement & Graphic & Record<string, unknown>;

/** Coordinated packages isolate each retained scene in its own shadow tree. */
function graphicElements<T extends HTMLElement>(
  graphic: Pick<CallableGraphic, 'shadowRoot'>,
  selector: string,
): T[] {
  const result: T[] = [];
  const visit = (root: ShadowRoot) => {
    result.push(...root.querySelectorAll<T>(selector));
    for (const element of root.querySelectorAll('*'))
      if (element.shadowRoot) visit(element.shadowRoot);
  };
  if (graphic.shadowRoot) visit(graphic.shadowRoot);
  return result;
}

export async function canvasPixelSignatures(
  graphic: Pick<CallableGraphic, 'shadowRoot'>,
): Promise<{ signatures: string[]; shaderCanvasCount: number; errors: string[] }> {
  const snapshots: Array<{ width: number; height: number; pixels: Uint8Array }> = [];
  const errors: string[] = [];
  let shaderCanvasCount = 0;
  const canvases = graphicElements<HTMLCanvasElement>(graphic, 'canvas');
  for (const [index, canvas] of canvases.entries()) {
    if (canvas.width <= 0 || canvas.height <= 0) {
      errors.push(
        `Canvas ${index + 1} has invalid backing dimensions ${canvas.width}x${canvas.height}.`,
      );
      continue;
    }
    try {
      let pixels: Uint8Array;
      const isShader = canvas.hasAttribute('data-ograf-shader-canvas');
      if (isShader && canvas.dataset?.ografShaderBackend === 'canvas2d') {
        if (canvas.dataset.ografShaderPaused === 'true')
          throw new Error('Shader WebGL context is unavailable.');
        // Copy the retained image for this shader. Reading the live Canvas2D surface directly
        // can switch Chromium's backing renderer between samples and alter the pixels we compare.
        if (!canvas.getContext('2d'))
          throw new Error('Shader Canvas2D presentation context is unavailable.');
        const snapshot = canvas.ownerDocument.createElement('canvas');
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const context = snapshot.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create a 2D pixel inspection context.');
        context.drawImage(canvas, 0, 0);
        pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
      } else if (isShader) {
        // Inspect the actual preserved GPU buffer, without a browser presentation/alpha conversion.
        const gl = canvas.getContext('webgl2');
        if (!gl || gl.isContextLost()) throw new Error('Shader WebGL context is unavailable.');
        pixels = new Uint8Array(canvas.width * canvas.height * 4);
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        try {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const error = gl.getError();
          if (error !== gl.NO_ERROR)
            throw new Error(`Shader pixel read failed (WebGL error ${error}).`);
        } finally {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        }
      } else {
        const snapshot = canvas.ownerDocument.createElement('canvas');
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const context = snapshot.getContext('2d');
        if (!context) throw new Error('Could not create a 2D pixel inspection context.');
        context.drawImage(canvas, 0, 0);
        pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
      }
      snapshots.push({ width: canvas.width, height: canvas.height, pixels });
      if (isShader) shaderCanvasCount += 1;
    } catch (error) {
      errors.push(
        `Canvas ${index + 1} pixels could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Take every snapshot in the same synchronous turn before hashing can yield to rendering.
  const signatures = await Promise.all(
    snapshots.map(async ({ width, height, pixels }) => {
      const digest = await crypto.subtle.digest('SHA-256', pixels as Uint8Array<ArrayBuffer>);
      const hash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      return `${width}x${height}:${hash}`;
    }),
  );
  return { signatures, shaderCanvasCount, errors };
}

export interface CertificationRealm {
  frame: HTMLIFrameElement;
  window: Window;
  document: Document;
}

export function createCertificationRealm(): CertificationRealm {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'position:fixed;left:-100000px;top:-100000px;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const realmWindow = frame.contentWindow;
  const realmDocument = frame.contentDocument;
  if (!realmWindow || !realmDocument) {
    frame.remove();
    throw new Error('Could not create the disposable certification document.');
  }
  return { frame, window: realmWindow, document: realmDocument };
}

export async function importModuleInRealm(
  realm: CertificationRealm,
  moduleUrl: string,
  signal?: AbortSignal,
): Promise<{ default?: CustomElementConstructor }> {
  signal?.throwIfAborted();
  const resultKey = `__ografCertification_${crypto.randomUUID().replaceAll('-', '_')}`;
  const eventName = `${resultKey}_ready`;
  return new Promise((resolve, reject) => {
    const script = realm.document.createElement('script');
    const cleanUp = () => {
      realm.window.removeEventListener(eventName, finish);
      signal?.removeEventListener('abort', abort);
      delete (realm.window as unknown as Record<string, unknown>)[resultKey];
      script.remove();
    };
    const abort = () => {
      cleanUp();
      reject(signal!.reason);
    };
    const finish = () => {
      const result = (realm.window as unknown as Record<string, unknown>)[resultKey] as
        { module?: { default?: CustomElementConstructor }; error?: string } | undefined;
      cleanUp();
      if (result?.module) resolve(result.module);
      else reject(new Error(result?.error || 'The certification module did not return a result.'));
    };
    realm.window.addEventListener(eventName, finish, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    script.type = 'module';
    script.textContent = `
      import(${JSON.stringify(moduleUrl)}).then(
        (module) => { window[${JSON.stringify(resultKey)}] = { module }; window.dispatchEvent(new Event(${JSON.stringify(eventName)})); },
        (error) => { window[${JSON.stringify(resultKey)}] = { error: error instanceof Error ? error.message : String(error) }; window.dispatchEvent(new Event(${JSON.stringify(eventName)})); }
      );
    `;
    try {
      realm.document.head.appendChild(script);
    } catch (error) {
      cleanUp();
      reject(error);
    }
  });
}

async function callGraphicMethod(
  graphic: CallableGraphic,
  method: keyof Graphic,
  params: unknown,
  extraKeys: string[] = [],
  timing: CertificationMethodTiming = certificationMethodTiming(
    undefined,
    method,
    params,
    'realtime',
  ),
  requireSuccess = false,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const fn = graphic[method];
  if (typeof fn !== 'function') return [`Graphic does not have a ${method}() method.`];
  try {
    const payload = await certificationPromiseWithTimeout(
      (fn as (params: unknown) => Promise<unknown>).call(graphic, params),
      method,
      timing,
      signal,
    );
    signal?.throwIfAborted();
    return [
      ...validateReturnPayload(method, payload, extraKeys),
      ...(requireSuccess
        ? coordinatedCertificationSuccessErrors(payload).map((issue) => `${method}(): ${issue}`)
        : []),
    ];
  } catch (error) {
    signal?.throwIfAborted();
    return [`${method}() failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Certify the exact coordinated module, including every reachable template state. */
async function validateCoordinatedLifecycle(
  realm: CertificationRealm,
  tagName: string,
  manifest: OGrafManifest,
  descriptor: CompiledTransitionLogicDescriptor,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const errors: string[] = [];
  const definition = descriptor.definition;
  const sharedDescriptors = descriptor.sharedInstances.map((instance) => instance.descriptor);
  const templates = new Map(descriptor.templates.map((template) => [template.id, template]));
  let cases: ReturnType<typeof coordinatedCertificationCases>;
  try {
    cases = coordinatedCertificationCases(definition);
  } catch (cause) {
    return [
      `Coordinated Take admission: ${cause instanceof Error ? cause.message : String(cause)}`,
    ];
  }
  const statePayload = (state: (typeof definition.states)[number]) => ({
    slotId: state.slotId,
    stateId: state.id,
    data: {
      ...(templates.get(state.templateId)?.dataDefaults ?? {}),
      ...(state.dataDefaults ?? {}),
    },
  });
  const modes = [
    ...(manifest.supportsRealTime ? (['realtime'] as const) : []),
    ...(manifest.supportsNonRealTime ? (['non-realtime'] as const) : []),
  ];
  for (const renderType of modes) {
    signal?.throwIfAborted();
    const graphic = realm.document.createElement(tagName) as CallableGraphic;
    graphic.style.cssText = 'position:fixed;left:-100000px;top:-100000px;visibility:hidden;';
    realm.document.body.appendChild(graphic);
    const call = async (
      method: keyof Graphic,
      params: unknown,
      extra: string[] = [],
      requireSuccess = false,
    ) => {
      const issues = await callGraphicMethod(
        graphic,
        method,
        params,
        extra,
        certificationMethodTiming(descriptor, method, params, renderType),
        requireSuccess,
        signal,
      );
      errors.push(...issues.map((issue) => `Coordinated ${renderType}: ${issue}`));
      return issues.length === 0;
    };
    const snapshot = (): CoordinatedPlayoutSnapshot | null => {
      const read = graphic.getPlayoutSnapshot;
      if (typeof read !== 'function') return null;
      try {
        return (read as () => CoordinatedPlayoutSnapshot).call(graphic);
      } catch {
        return null;
      }
    };
    const startupExpected = Object.fromEntries(
      definition.slots.map((slot) => [
        slot.id,
        descriptor.dataDefaults?.slots[slot.id]?.stateId ?? null,
      ]),
    );
    const watchStartup = () => {
      const evidence = createCoordinatedStartupEvidence(startupExpected);
      const subscribe = graphic.subscribePlayout;
      const dispose =
        typeof subscribe === 'function'
          ? (
              subscribe as (listener: (value: CoordinatedPlayoutSnapshot) => void) => () => void
            ).call(graphic, evidence.observe)
          : () => {};
      return {
        evidence,
        dispose,
        assert() {
          const current = snapshot();
          evidence.observe(current);
          errors.push(
            ...evidence
              .errors(current)
              .map((issue) => `Coordinated ${renderType} default Play: ${issue}`),
          );
        },
      };
    };
    const rejectPlayWithoutChangingOutput = async (name: string) => {
      signal?.throwIfAborted();
      const before = snapshot();
      try {
        const params = { goto: 0, skipAnimation: true };
        const payload = await certificationPromiseWithTimeout(
          graphic.playAction(params),
          'playAction',
          certificationMethodTiming(descriptor, 'playAction', params, renderType),
          signal,
        );
        errors.push(
          ...coordinatedCertificationRejectionErrors(payload, before, snapshot()).map(
            (issue) => `Coordinated ${renderType} ${name}: ${issue}`,
          ),
        );
      } catch (cause) {
        signal?.throwIfAborted();
        errors.push(
          `Coordinated ${renderType} ${name}: rejected Play must return an error payload: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    };
    const inspect = async (templateId: string, label: string) => {
      signal?.throwIfAborted();
      const template = templates.get(templateId);
      if (!template) return null;
      if (
        !graphicElements<HTMLElement>(graphic, '[data-ograf-transition-template]').some(
          (host) => host.dataset.ografTransitionTemplate === templateId,
        )
      )
        errors.push(`Coordinated ${renderType}: ${label} did not mount its template.`);
      const expected = coordinatedCertificationCanvasCounts(template, sharedDescriptors);
      const pixels = await awaitExportOperation(canvasPixelSignatures(graphic), signal);
      errors.push(...pixels.errors.map((issue) => `${label}: ${issue}`));
      if (pixels.signatures.length < expected.canvases)
        errors.push(`${label}: expected at least ${expected.canvases} rendered canvases.`);
      if (pixels.shaderCanvasCount < expected.shaders)
        errors.push(`${label}: expected at least ${expected.shaders} inspectable shader canvases.`);
      return pixels.signatures;
    };
    try {
      if (
        !(await call(
          'load',
          {
            renderType,
            renderCharacteristics: {
              resolution: { width: descriptor.width, height: descriptor.height },
              frameRate: descriptor.frameRate,
            },
            data: defaultsFromManifest(manifest),
          },
          [],
          true,
        ))
      )
        continue;
      // Exercise the actual generic controller entry point, not just individual custom Takes.
      if (renderType === 'realtime') {
        const normal = watchStartup();
        try {
          if (await call('playAction', { goto: 0 }, ['currentStep'], true)) normal.assert();
        } finally {
          normal.dispose();
        }
        await call('stopAction', { skipAnimation: true });
        await call('updateAction', { data: defaultsFromManifest(manifest), skipAnimation: true });
        const skipped = watchStartup();
        try {
          if (await call('playAction', { goto: 0, skipAnimation: true }, ['currentStep'], true))
            skipped.assert();
        } finally {
          skipped.dispose();
        }
      } else {
        const startup = watchStartup();
        try {
          if (
            (await call(
              'setActionsSchedule',
              { schedule: [{ timestamp: 0, action: { type: 'playAction', params: { goto: 0 } } }] },
              [],
              true,
            )) &&
            (await call('goToTime', { timestamp: 0 }, [], true))
          ) {
            // Advance only through observed entry/exit barriers. A long unused recipe must not
            // push this startup check past a legitimate later timer or Rules-triggered action.
            for (let phase = 0; phase < definition.slots.length * 2 + 2; phase++) {
              const current = snapshot();
              startup.evidence.observe(current);
              if (startup.evidence.entered) break;
              const boundary = coordinatedCertificationNextTransitionFrame(current);
              if (
                boundary === null ||
                !(await call(
                  'goToTime',
                  { timestamp: (boundary * 1000) / descriptor.frameRate },
                  [],
                  true,
                ))
              )
                break;
            }
            startup.assert();
          }
        } finally {
          startup.dispose();
        }
      }
      // Invalid selections are staged while fully Off. Their rejected Play cannot partially Take
      // siblings or alter preparation; this does not claim that active multi-lane Update is atomic.
      await call('stopAction', { skipAnimation: true });
      for (const conflict of coordinatedCertificationConflicts(definition)) {
        await call('customAction', { id: 'transition.clear', payload: {} });
        const slots = Object.fromEntries(
          Object.entries(conflict.states).map(([id, stateId]) => [
            id,
            { stateId: stateId ?? '', data: {} },
          ]),
        );
        if (await call('updateAction', { data: { slots }, skipAnimation: true }, [], true))
          await rejectPlayWithoutChangingOutput(conflict.name);
      }
      await call('customAction', { id: 'transition.clear', payload: {} });
      if (renderType === 'realtime') {
        const retained = new Map(
          graphicElements<HTMLElement>(graphic, '[data-ograf-transition-shared]').map((host) => [
            host.dataset.ografTransitionShared!,
            host,
          ]),
        );
        for (const instance of definition.sharedInstances)
          if (!retained.has(instance.id))
            errors.push(`Coordinated output did not prepare shared instance ${instance.name}.`);
        const takeover = definition.states.find((state) => state.takeOutSlotIds?.length);
        const occupiedCase =
          takeover &&
          [...cases]
            .sort((left, right) => right.prerequisites.length - left.prerequisites.length)
            .find(
              (entry) =>
                entry.state.slotId !== takeover.slotId &&
                [...entry.prerequisites, entry.state].some((state) =>
                  takeover.takeOutSlotIds!.includes(state.slotId),
                ) &&
                [...entry.prerequisites, entry.state].every(
                  (state) => state.slotId !== takeover.slotId,
                ),
            );
        if (takeover && occupiedCase) {
          for (const state of [...occupiedCase.prerequisites, occupiedCase.state])
            await call(
              'customAction',
              { id: 'transition.take', payload: statePayload(state), skipAnimation: true },
              [],
              true,
            );
          const before = snapshot();
          await call(
            'updateAction',
            {
              data: {
                slots: {
                  [takeover.slotId]: { stateId: takeover.id, data: statePayload(takeover).data },
                },
              },
              skipAnimation: true,
            },
            [],
            true,
          );
          const staged = snapshot();
          if (
            before &&
            staged &&
            coordinatedCertificationOutputIdentity(before) !==
              coordinatedCertificationOutputIdentity(staged)
          )
            errors.push(
              'Selecting an Off takeover lane changed existing on-air output before Play.',
            );
          await rejectPlayWithoutChangingOutput('conflicting takeover against on-air graphics');
          await call('customAction', { id: 'transition.clear', payload: {} });
        }
        for (const { state, prerequisites } of cases) {
          await call('customAction', { id: 'transition.clear', payload: {} });
          for (const prerequisite of prerequisites)
            await call('customAction', {
              id: 'transition.take',
              payload: statePayload(prerequisite),
              skipAnimation: true,
            });
          if (
            await call('customAction', {
              id: 'transition.take',
              payload: statePayload(state),
              skipAnimation: true,
            })
          )
            await inspect(state.templateId, state.name);
          const hosts = graphicElements<HTMLElement>(graphic, '[data-ograf-transition-shared]');
          for (const [id, host] of retained)
            if (!hosts.includes(host) || host.dataset.ografTransitionShared !== id)
              errors.push(`Shared instance ${id} was replaced during ${state.name}.`);
        }
        const lastState = cases.at(-1)?.state;
        await call('updateAction', {
          data: {
            slots: lastState
              ? {
                  [lastState.slotId]: { stateId: lastState.id, data: statePayload(lastState).data },
                }
              : {},
          },
          skipAnimation: true,
        });
        for (const slot of definition.slots)
          await call('customAction', {
            id: 'transition.out',
            payload: { slotId: slot.id },
            skipAnimation: true,
          });
        await call('stopAction', { skipAnimation: true });
        await call('customAction', { id: 'transition.clear', payload: {} });
      } else {
        const longest = Math.max(1, ...definition.transitions.map((item) => item.durationFrames));
        const intervalFrames = longest * 2 + descriptor.frameRate;
        const ms = (frame: number) => (frame * 1000) / descriptor.frameRate;
        const schedule: ScheduledAction[] = [];
        const samples: Array<{ timestamp: number; templateId: string; name: string }> = [];
        let frame = 0;
        for (const { state, prerequisites } of cases) {
          schedule.push({
            timestamp: ms(frame++),
            action: { type: 'customAction', params: { id: 'transition.clear', payload: {} } },
          });
          for (const prerequisite of prerequisites)
            schedule.push({
              timestamp: ms(frame++),
              action: {
                type: 'customAction',
                params: {
                  id: 'transition.take',
                  payload: statePayload(prerequisite),
                  skipAnimation: true,
                },
              },
            });
          schedule.push({
            timestamp: ms(frame),
            action: {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: statePayload(state),
              },
            },
          });
          samples.push({
            timestamp: ms(frame + longest + 1),
            templateId: state.templateId,
            name: state.name,
          });
          frame += intervalFrames;
        }
        schedule.push({ timestamp: ms(frame), action: { type: 'stopAction', params: {} } });
        if (await call('setActionsSchedule', { schedule })) {
          let lastPixels: string[] | null = null;
          for (const sample of samples)
            if (await call('goToTime', { timestamp: sample.timestamp }))
              lastPixels = await inspect(sample.templateId, sample.name);
          const last = samples.at(-1);
          if (last) {
            await call('goToTime', { timestamp: 0 });
            if (await call('goToTime', { timestamp: last.timestamp })) {
              const repeated = await inspect(last.templateId, last.name);
              if (lastPixels && JSON.stringify(lastPixels) !== JSON.stringify(repeated))
                errors.push(
                  'Coordinated output pixels changed after backward and repeated seeking.',
                );
            }
          }
          await call('goToTime', { timestamp: ms(frame + longest + 1) });
        }
      }
    } finally {
      try {
        if (signal?.aborted) void graphic.dispose({}).catch(() => undefined);
        else await call('dispose', {});
      } finally {
        graphic.remove();
      }
    }
  }
  return errors;
}

async function validateModuleAndLifecycle(
  artifacts: ExportArtifacts,
  signal?: AbortSignal,
): Promise<{ moduleErrors: string[]; lifecycleErrors: string[] }> {
  signal?.throwIfAborted();
  const moduleErrors: string[] = [];
  const lifecycleErrors: string[] = [];
  const moduleUrl = URL.createObjectURL(new Blob([artifacts.mainJs], { type: 'text/javascript' }));
  let realm: CertificationRealm | null = null;
  let resources: ReturnType<typeof createCertificationResourceUrls> | null = null;
  let activeGraphic: CallableGraphic | null = null;
  try {
    resources = createCertificationResourceUrls(artifacts.resources);
    realm = createCertificationRealm();
    (
      realm.window as unknown as {
        __OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__: typeof rendererPluginAllowed;
      }
    ).__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = rendererPluginAllowed;
    (realm.window as unknown as Record<string, unknown>)[EXPORTED_RESOURCE_URLS_KEY] = {
      [moduleUrl]: resources.urls,
    };
    const graphicModule = await importModuleInRealm(realm, moduleUrl, signal);
    signal?.throwIfAborted();
    if (typeof graphicModule.default !== 'function') {
      moduleErrors.push('main.js must default-export a Graphic custom-element class.');
      return { moduleErrors, lifecycleErrors };
    }

    const tagName = `ograf-compatibility-${crypto.randomUUID()}`;
    realm.window.customElements.define(tagName, graphicModule.default);
    const methodProbe = realm.document.createElement(tagName) as CallableGraphic;
    const requiredMethods: (keyof Graphic)[] = [
      'load',
      'dispose',
      'updateAction',
      'playAction',
      'stopAction',
      'customAction',
      ...(artifacts.manifest.supportsNonRealTime
        ? (['goToTime', 'setActionsSchedule'] as (keyof Graphic)[])
        : []),
    ];
    for (const method of requiredMethods) {
      if (typeof methodProbe[method] !== 'function') {
        moduleErrors.push(`Graphic does not have a ${method}() method.`);
      }
    }
    if (moduleErrors.length > 0) return { moduleErrors, lifecycleErrors };

    if (artifacts.transitionDescriptor) {
      const compiled = (
        graphicModule.default as CustomElementConstructor & {
          transitionDescriptor?: CompiledTransitionLogicDescriptor;
        }
      ).transitionDescriptor;
      if (
        !compiled ||
        compiled.id !== artifacts.transitionDescriptor.id ||
        JSON.stringify(compiled.definition) !==
          JSON.stringify(artifacts.transitionDescriptor.definition)
      ) {
        moduleErrors.push(
          'The exported coordinated definition does not match the compiled package.',
        );
        return { moduleErrors, lifecycleErrors };
      }
      lifecycleErrors.push(
        ...(await validateCoordinatedLifecycle(
          realm,
          tagName,
          artifacts.manifest,
          compiled,
          signal,
        )),
      );
      return { moduleErrors, lifecycleErrors };
    }

    const initialData = defaultsFromManifest(artifacts.manifest);
    const compiledDescriptor = (
      graphicModule.default as CustomElementConstructor & {
        descriptor?: CompiledGraphicDescriptor;
      }
    ).descriptor;
    const descriptorElements = [
      ...(compiledDescriptor?.layers.map((layer) => layer.element) ?? []),
      ...(compiledDescriptor?.collections?.flatMap((collection) =>
        collection.prototypeLayers.map((layer) => layer.element),
      ) ?? []),
    ];
    const seekTimestamps = certificationSeekTimestamps(descriptorElements);
    const expectedLottieCanvases =
      (compiledDescriptor?.layers.filter(
        (layer) => layer.element.type === 'lottie' && !!layer.element.animationData,
      ).length ?? 0) +
      (compiledDescriptor?.collections?.reduce(
        (count, collection) =>
          count +
          collection.capacity *
            collection.prototypeLayers.filter(
              (layer) => layer.element.type === 'lottie' && !!layer.element.animationData,
            ).length,
        0,
      ) ?? 0);
    const expectedShaderCanvases =
      (compiledDescriptor?.layers.reduce(
        (count, layer) => count + getElementShaderPaints(layer.element).length,
        0,
      ) ?? 0) +
      (compiledDescriptor?.collections?.reduce(
        (count, collection) =>
          count +
          collection.capacity *
            collection.prototypeLayers.reduce(
              (total, layer) => total + getElementShaderPaints(layer.element).length,
              0,
            ),
        0,
      ) ?? 0);
    const expectedCanvases = expectedLottieCanvases + expectedShaderCanvases;
    const reducedArrayData = Object.fromEntries(
      Object.entries(initialData).map(([key, value]) => [
        key,
        Array.isArray(value) && value.length > 1 ? value.slice(0, 1) : value,
      ]),
    );
    const renderTypes = [
      ...(artifacts.manifest.supportsRealTime ? (['realtime'] as const) : []),
      ...(artifacts.manifest.supportsNonRealTime ? (['non-realtime'] as const) : []),
    ];

    for (const renderType of renderTypes) {
      signal?.throwIfAborted();
      const graphic = realm.document.createElement(tagName) as CallableGraphic;
      activeGraphic = graphic;
      graphic.style.cssText = 'position:fixed;left:-100000px;top:-100000px;visibility:hidden;';
      realm.document.body.appendChild(graphic);
      const call = (method: keyof Graphic, params: unknown, extraKeys: string[] = []) =>
        callGraphicMethod(
          graphic,
          method,
          params,
          extraKeys,
          certificationMethodTiming(compiledDescriptor, method, params, renderType),
          false,
          signal,
        );
      lifecycleErrors.push(...(await call('load', { renderType })));
      if (renderType === 'realtime') {
        lifecycleErrors.push(
          ...(await call('updateAction', { data: initialData })),
          ...(await call('playAction', {}, ['currentStep'])),
          ...(await call('stopAction', {})),
        );
      } else {
        if (!seekTimestamps.exercisesAllLotties) {
          lifecycleErrors.push(
            'Certification could not choose a backward timestamp that changes every animated Lottie frame.',
          );
        }
        lifecycleErrors.push(
          ...(await call('setActionsSchedule', {
            schedule: [
              { timestamp: 0, action: { type: 'updateAction', params: { data: initialData } } },
              { timestamp: 1000, action: { type: 'playAction', params: {} } },
              {
                timestamp: 3000,
                action: { type: 'updateAction', params: { data: reducedArrayData } },
              },
              { timestamp: 7000, action: { type: 'stopAction', params: {} } },
            ],
          })),
          ...(await call('goToTime', {
            timestamp: seekTimestamps.target,
          })),
        );
        const canvasSnapshot = await awaitExportOperation(canvasPixelSignatures(graphic), signal);
        lifecycleErrors.push(...canvasSnapshot.errors);
        if (canvasSnapshot.signatures.length < expectedCanvases) {
          lifecycleErrors.push(
            `Expected at least ${expectedCanvases} rendered Canvas${expectedCanvases === 1 ? '' : 'es'}, found ${canvasSnapshot.signatures.length}.`,
          );
        }
        if (canvasSnapshot.shaderCanvasCount < expectedShaderCanvases) {
          lifecycleErrors.push(
            `Expected ${expectedShaderCanvases} shader canvases, found ${canvasSnapshot.shaderCanvasCount} with inspectable pixels.`,
          );
        }
        const collectionSnapshot = [
          ...(graphic.shadowRoot?.querySelectorAll<HTMLElement>('[data-ograf-collection-id]') ??
            []),
        ]
          .filter((element) => element.style.display !== 'none')
          .map(
            (element) =>
              `${element.dataset.ografCollectionId}:${element.dataset.ografCollectionIndex}`,
          );
        lifecycleErrors.push(
          ...(await call('goToTime', {
            timestamp: seekTimestamps.rewind,
          })),
          ...(await call('goToTime', {
            timestamp: seekTimestamps.target,
          })),
        );
        const replayedCollectionSnapshot = [
          ...(graphic.shadowRoot?.querySelectorAll<HTMLElement>('[data-ograf-collection-id]') ??
            []),
        ]
          .filter((element) => element.style.display !== 'none')
          .map(
            (element) =>
              `${element.dataset.ografCollectionId}:${element.dataset.ografCollectionIndex}`,
          );
        if (JSON.stringify(collectionSnapshot) !== JSON.stringify(replayedCollectionSnapshot)) {
          lifecycleErrors.push(
            'Non-realtime collection visibility changed after backward and repeated goToTime seeking.',
          );
        }
        const replayedCanvasSnapshot = await awaitExportOperation(
          canvasPixelSignatures(graphic),
          signal,
        );
        lifecycleErrors.push(...replayedCanvasSnapshot.errors);
        if (replayedCanvasSnapshot.signatures.length < expectedCanvases) {
          lifecycleErrors.push(
            `Expected at least ${expectedCanvases} replayed Canvas${expectedCanvases === 1 ? '' : 'es'}, found ${replayedCanvasSnapshot.signatures.length}.`,
          );
        }
        if (replayedCanvasSnapshot.shaderCanvasCount < expectedShaderCanvases) {
          lifecycleErrors.push(
            `Expected ${expectedShaderCanvases} replayed shader canvases, found ${replayedCanvasSnapshot.shaderCanvasCount} with inspectable pixels.`,
          );
        }
        if (
          canvasSnapshot.signatures.length > 0 &&
          JSON.stringify(canvasSnapshot.signatures) !==
            JSON.stringify(replayedCanvasSnapshot.signatures)
        ) {
          const changed = canvasSnapshot.signatures.flatMap((signature, index) =>
            signature !== replayedCanvasSnapshot.signatures[index] ? [index + 1] : [],
          );
          lifecycleErrors.push(
            `Canvas pixels changed after backward and repeated non-realtime goToTime seeking (canvases ${changed.join(', ')}).`,
          );
        }
      }
      lifecycleErrors.push(...(await call('dispose', { renderType })));
      graphic.remove();
      activeGraphic = null;
    }
  } catch (error) {
    signal?.throwIfAborted();
    const detail = error instanceof Error ? error.message : String(error);
    const recovery = /CustomElementRegistry|already been used|custom element/i.test(detail)
      ? ' Reload the editor tab to restore a fresh certification registry, then retry.'
      : '';
    moduleErrors.push(`main.js could not be imported: ${detail}${recovery}`);
  } finally {
    try {
      if (activeGraphic) void activeGraphic.dispose({}).catch(() => undefined);
    } finally {
      activeGraphic?.remove();
      realm?.frame.remove();
      resources?.dispose();
      URL.revokeObjectURL(moduleUrl);
    }
  }
  return { moduleErrors, lifecycleErrors };
}

/** Mandatory pre-save gate: no file writer is called unless every OGraf devtool-equivalent check passes. */
export async function certifyExportArtifacts(
  artifacts: ExportArtifacts,
  signal?: AbortSignal,
): Promise<OGrafCompatibilityResult> {
  signal?.throwIfAborted();
  const policyErrors: string[] = [];
  const snapshots = [
    ...(artifacts.descriptor?.rendererPlugins ?? []),
    ...(artifacts.transitionDescriptor?.templates.flatMap(
      (template) => template.descriptor.rendererPlugins ?? [],
    ) ?? []),
    ...(artifacts.transitionDescriptor?.sharedInstances.flatMap(
      (instance) => instance.descriptor.rendererPlugins ?? [],
    ) ?? []),
  ];
  if (snapshots.length)
    await awaitExportOperation(useRendererPluginSettingsStore.getState().initialize(), signal);
  signal?.throwIfAborted();
  try {
    assertStudioRendererPluginsAllowed(snapshots);
  } catch (cause) {
    policyErrors.push(cause instanceof Error ? cause.message : String(cause));
  }
  const projectErrors = [...artifacts.projectErrors, ...policyErrors];
  const manifestErrors = artifacts.manifestErrors;
  const packageErrors = validatePackageLayout(artifacts);
  const staticChecksPassed =
    artifacts.valid && packageErrors.length === 0 && policyErrors.length === 0;
  const { moduleErrors, lifecycleErrors } = staticChecksPassed
    ? await validateModuleAndLifecycle(artifacts, signal)
    : {
        moduleErrors: ['Not run because project, manifest, or package validation failed.'],
        lifecycleErrors: ['Not run because project, manifest, or package validation failed.'],
      };
  signal?.throwIfAborted();
  const checks: OGrafCompatibilityCheck[] = [
    {
      id: 'project',
      label: 'Project semantics',
      valid: projectErrors.length === 0,
      errors: projectErrors,
    },
    {
      id: 'manifest',
      label: 'Official OGraf v1 manifest schema',
      valid: manifestErrors.length === 0,
      errors: manifestErrors,
    },
    {
      id: 'package',
      label: 'OGraf package layout',
      valid: packageErrors.length === 0,
      errors: packageErrors,
    },
    {
      id: 'module',
      label: 'Graphic module/default export/API',
      valid: moduleErrors.length === 0,
      errors: moduleErrors,
    },
    {
      id: 'lifecycle',
      label: 'Real-time and non-real-time lifecycle',
      valid: lifecycleErrors.length === 0,
      errors: lifecycleErrors,
    },
  ];
  const errors = checks.flatMap((check) => check.errors.map((error) => `${check.label}: ${error}`));
  return { valid: errors.length === 0, checks, errors };
}

export async function certifyProject(project: Project): Promise<OGrafCompatibilityResult> {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition) {
    const error = 'The project mainCompositionId does not reference an existing composition.';
    return {
      valid: false,
      errors: [error],
      checks: [{ id: 'project', label: 'Project semantics', valid: false, errors: [error] }],
    };
  }
  if (compileDescriptor(composition).rendererPlugins?.length)
    await useRendererPluginSettingsStore.getState().initialize();
  return certifyExportArtifacts(buildExportArtifacts(project, composition));
}

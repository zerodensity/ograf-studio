import { EXPORTED_RESOURCE_URLS_KEY, getExportProfile } from '@ograf-editor/codegen';
import type { CoordinatedGraphicElement } from '@ograf-editor/ograf-runtime';
import type { CompiledTransitionLogicDescriptor, RenderType } from '@ograf-editor/ograf-types';
import {
  compositionWithShaderParameterFields,
  type FieldValue,
  type FieldDefinition,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { buildCoordinatedProjectSetArtifactsTask } from './coordinatedCompileTask';
import { createCertificationResourceUrls } from './certificationResources';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import {
  assertStudioRendererPluginsAllowed,
  rendererPluginAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

export interface CoordinatedPreviewTemplate {
  id: string;
  name: string;
  dataFields: FieldDefinition[];
  customActions: Array<{ id: string; name: string }>;
}

export interface CoordinatedPreviewRuntime {
  graphic: CoordinatedGraphicElement;
  descriptor: CompiledTransitionLogicDescriptor;
  definition: TransitionLogicDefinition;
  templates: CoordinatedPreviewTemplate[];
  attach(container: HTMLElement): void;
  park(): void;
  dispose(): Promise<void>;
}

/** Rehosting a prepared runtime can change the visible queue without changing a ticker itself. */
function refreshTickerControls(container: HTMLElement | null): void {
  if (!container) return;
  const EventClass = container.ownerDocument.defaultView?.Event ?? Event;
  container.dispatchEvent(new EventClass('ograf-ticker-status', { bubbles: true, composed: true }));
}

/** Studio and rehearsal load the same module and resource bytes used by coordinated export. */
export async function createCoordinatedPreviewRuntime(
  set: ProjectSetDocument,
  options: {
    document?: Document;
    renderType?: RenderType;
    replayClockEpochMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<CoordinatedPreviewRuntime> {
  const snapshot = structuredClone(set);
  const renderType = options.renderType ?? 'realtime';
  const artifacts = await buildCoordinatedProjectSetArtifactsTask(
    snapshot,
    getExportProfile(renderType),
    options.signal,
  );
  if (!artifacts.valid || !artifacts.transitionDescriptor)
    throw new Error(artifacts.errors.join('\n') || 'The coordinated source could not be compiled.');
  const descriptor = artifacts.transitionDescriptor;
  const plugins = [...descriptor.templates, ...descriptor.sharedInstances].flatMap(
    (source) => source.descriptor.rendererPlugins ?? [],
  );
  if (plugins.length) await useRendererPluginSettingsStore.getState().initialize();
  assertStudioRendererPluginsAllowed(plugins);
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = rendererPluginAllowed;
  const resources = createCertificationResourceUrls(artifacts.resources);
  const moduleUrl = URL.createObjectURL(new Blob([artifacts.mainJs], { type: 'text/javascript' }));
  const registry = (globals[EXPORTED_RESOURCE_URLS_KEY] ??= {}) as Record<
    string,
    Record<string, string>
  >;
  registry[moduleUrl] = resources.urls;
  const ownerDocument = options.document ?? globalThis.document;
  const parking = ownerDocument.createElement('div');
  parking.setAttribute('aria-hidden', 'true');
  parking.style.cssText =
    'position:fixed;left:-100000px;top:-100000px;visibility:hidden;pointer-events:none;';
  ownerDocument.body.append(parking);
  let graphic: CoordinatedGraphicElement | null = null;
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (graphic) await graphic.dispose();
    } finally {
      const container = graphic?.parentElement ?? null;
      graphic?.remove();
      refreshTickerControls(container);
      parking.remove();
      delete registry[moduleUrl];
      resources.dispose();
      URL.revokeObjectURL(moduleUrl);
    }
  };
  const aborted = () => {
    void dispose().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', aborted, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('Playout loading was cancelled.');
    const module = (await import(/* @vite-ignore */ moduleUrl)) as {
      default: CustomElementConstructor;
    };
    if (disposed) throw new Error('Playout loading was cancelled.');
    const tagName = `ograf-coordinated-preview-${crypto.randomUUID()}`;
    globalThis.customElements.define(tagName, module.default);
    graphic = globalThis.document.createElement(tagName) as CoordinatedGraphicElement;
    parking.append(graphic);
    if (
      typeof graphic.getPlayoutSnapshot !== 'function' ||
      typeof graphic.prepareSlot !== 'function'
    )
      throw new Error(
        'The coordinated runtime is outdated. Rebuild the runtime and reload Studio.',
      );
    const loaded = await graphic.load({
      renderType,
      ...(options.replayClockEpochMs === undefined
        ? {}
        : { v_ografReplayClockEpochMs: options.replayClockEpochMs }),
      renderCharacteristics: {
        resolution: { width: descriptor.width, height: descriptor.height },
        frameRate: descriptor.frameRate,
      },
    });
    if (loaded.statusCode >= 400)
      throw new Error(loaded.statusMessage || 'Could not load coordinated playout.');
    if (disposed || options.signal?.aborted) throw new Error('Playout loading was cancelled.');
    const instance = graphic;
    const templates = descriptor.templates.map((template) => {
      const project = resolveProjectSetTemplate(snapshot, template.id);
      const composition = project.compositions.find(
        (item) => item.id === project.mainCompositionId,
      )!;
      return {
        id: template.id,
        name: template.name,
        customActions: template.descriptor.customActions.map(({ id, name }) => ({ id, name })),
        dataFields: structuredClone(
          compositionWithShaderParameterFields(composition).dataFields,
        ).map((field) => ({
          ...field,
          ...(template.dataDefaults && Object.hasOwn(template.dataDefaults, field.key)
            ? { defaultValue: structuredClone(template.dataDefaults[field.key]) as FieldValue }
            : {}),
        })),
      };
    });
    return {
      graphic: instance,
      descriptor,
      definition: descriptor.definition,
      templates,
      attach(container) {
        if (!disposed) {
          const previous = instance.parentElement;
          container.replaceChildren(instance);
          if (previous !== container) refreshTickerControls(previous);
          refreshTickerControls(container);
        }
      },
      park() {
        if (!disposed) {
          const previous = instance.parentElement;
          parking.append(instance);
          refreshTickerControls(previous);
        }
      },
      dispose,
    };
  } catch (cause) {
    await dispose();
    throw cause;
  } finally {
    options.signal?.removeEventListener('abort', aborted);
  }
}

export { runCoordinatedPreviewCommand } from './coordinatedPreviewCommands';

import { EXPORTED_RESOURCE_URLS_KEY, type ExportArtifacts } from '@ograf-editor/codegen';
import type { CoordinatedGraphicElement } from '@ograf-editor/ograf-runtime';
import { THUMBNAIL_MAX_DIMENSION } from '@ograf-editor/scene-model';
import { captureMaskedCanvas } from './maskedCapture';
import { createCertificationResourceUrls } from './certificationResources';
import { coordinatedCertificationCases } from './coordinatedCertification';
import { awaitExportOperation } from './exportAbort';
import { createCertificationRealm, importModuleInRealm } from './ografCompatibility';
import {
  assertStudioRendererPluginsAllowed,
  rendererPluginAllowed,
  useRendererPluginSettingsStore,
} from './pluginSettingsStore';

async function thumbnailFontCss(artifacts: ExportArtifacts, signal: AbortSignal): Promise<string> {
  const descriptor = artifacts.transitionDescriptor!;
  const fonts = [...descriptor.templates, ...descriptor.sharedInstances].flatMap(
    (entry) => entry.descriptor.fonts ?? [],
  );
  const faces = new Map<string, string>();
  for (const font of fonts) {
    signal.throwIfAborted();
    const resource = artifacts.resources.find((entry) => entry.path === font.source);
    const key = JSON.stringify([
      font.family,
      font.weight,
      font.style,
      resource?.data ?? font.source,
    ]);
    if (faces.has(key)) continue;
    let source = font.source;
    if (resource) {
      const encoded = resource.base64
        ? resource.data
        : btoa(
            Array.from(new TextEncoder().encode(resource.data), (byte) =>
              String.fromCharCode(byte),
            ).join(''),
          );
      source = `data:${font.mimeType};base64,${encoded}`;
    } else if (!source.startsWith('data:')) {
      const response = await fetch(source, { signal });
      if (!response.ok) throw new Error(`Thumbnail font is unavailable: ${font.family}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      source = `data:${font.mimeType};base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
    }
    faces.set(
      key,
      `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(source)});font-weight:${font.weight ?? '100 900'};font-style:${font.style ?? 'normal'};}`,
    );
  }
  return [...faces.values()].join('\n');
}

/** Render the exact compiled coordinator in a disposable realm, then freeze its catalog pose. */
export async function createCoordinatedThumbnail(
  artifacts: ExportArtifacts,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const descriptor = artifacts.transitionDescriptor;
  if (!descriptor) throw new Error('A coordinated descriptor is required for its thumbnail.');
  const plugins = [...descriptor.templates, ...descriptor.sharedInstances].flatMap(
    (entry) => entry.descriptor.rendererPlugins ?? [],
  );
  if (plugins.length)
    await awaitExportOperation(useRendererPluginSettingsStore.getState().initialize(), signal);
  signal?.throwIfAborted();
  assertStudioRendererPluginsAllowed(plugins);
  let resourcesToDispose: ReturnType<typeof createCertificationResourceUrls> | undefined;
  let moduleUrlToDispose: string | undefined;
  let realmToDispose: ReturnType<typeof createCertificationRealm> | undefined;
  let globals: Record<string, unknown> | undefined;
  let graphic: CoordinatedGraphicElement | undefined;
  const capture = new AbortController();
  const abort = () => capture.abort(signal!.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => capture.abort(new Error('Coordinated thumbnail capture timed out.')),
    30_000,
  );
  try {
    const resources = (resourcesToDispose = createCertificationResourceUrls(artifacts.resources));
    const moduleUrl = (moduleUrlToDispose = URL.createObjectURL(
      new Blob([artifacts.mainJs], { type: 'text/javascript' }),
    ));
    const realm = (realmToDispose = createCertificationRealm());
    realm.frame.style.visibility = 'visible';
    realm.frame.style.width = `${descriptor.width}px`;
    realm.frame.style.height = `${descriptor.height}px`;
    realm.document.body.style.margin = '0';
    globals = realm.window as unknown as Record<string, unknown>;
    globals.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = rendererPluginAllowed;
    globals[EXPORTED_RESOURCE_URLS_KEY] = { [moduleUrl]: resources.urls };
    const work = async (): Promise<Blob> => {
      const module = await importModuleInRealm(realm, moduleUrl, capture.signal);
      capture.signal.throwIfAborted();
      if (!module.default) throw new Error('Coordinated thumbnail module has no default export.');
      const tag = `ograf-coordinated-thumbnail-${crypto.randomUUID()}`;
      realm.window.customElements.define(tag, module.default);
      graphic = realm.document.createElement(tag) as CoordinatedGraphicElement;
      realm.document.body.append(graphic);
      const loaded = await graphic.load({
        renderType: artifacts.manifest.supportsRealTime ? 'realtime' : 'non-realtime',
        renderCharacteristics: {
          resolution: { width: descriptor.width, height: descriptor.height },
          frameRate: descriptor.frameRate,
        },
      });
      capture.signal.throwIfAborted();
      if (loaded.statusCode >= 400)
        throw new Error(loaded.statusMessage || 'Could not load thumbnail graphic.');
      const cases = coordinatedCertificationCases(descriptor.definition);
      const selected = new Map<string, string>();
      // Keep the first compatible state in each lane; takeover states cannot remove an earlier lane.
      for (const slot of [...descriptor.definition.slots].sort((a, b) => a.order - b.order)) {
        if (selected.has(slot.id)) continue;
        for (const candidate of cases.filter((entry) => entry.state.slotId === slot.id)) {
          const plan = [...candidate.prerequisites, candidate.state];
          const planned = new Set(selected.keys());
          let compatible = true;
          for (const state of plan) {
            const lane = descriptor.definition.slots.find((entry) => entry.id === state.slotId)!;
            if (
              state.takeOutSlotIds?.some((id) => planned.has(id)) ||
              lane.admission?.blockWhileActiveSlotIds?.some((id) => planned.has(id))
            ) {
              compatible = false;
              break;
            }
            planned.add(state.slotId);
          }
          if (!compatible) continue;
          for (const state of plan) {
            if (selected.has(state.slotId)) continue;
            const result = await graphic.customAction({
              id: 'transition.take',
              payload: { slotId: state.slotId, stateId: state.id },
              skipAnimation: true,
            });
            capture.signal.throwIfAborted();
            if (result.statusCode >= 400)
              throw new Error(
                result.statusMessage || `Could not render thumbnail state ${state.name}.`,
              );
            selected.set(state.slotId, state.id);
          }
          break;
        }
      }
      if (!selected.size)
        throw new Error('No reachable state is available for the coordinated thumbnail.');
      graphic.pausePlayout();
      const fontEmbedCSS = await thumbnailFontCss(artifacts, capture.signal);
      capture.signal.throwIfAborted();
      const scale = Math.min(
        1,
        THUMBNAIL_MAX_DIMENSION / Math.max(descriptor.width, descriptor.height),
      );
      const canvas = await captureMaskedCanvas(graphic, {
        width: descriptor.width,
        height: descriptor.height,
        canvasWidth: Math.max(1, Math.round(descriptor.width * scale)),
        canvasHeight: Math.max(1, Math.round(descriptor.height * scale)),
        pixelRatio: 1,
        skipAutoScale: true,
        fontEmbedCSS,
      });
      capture.signal.throwIfAborted();
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Could not encode coordinated thumbnail.')),
          'image/png',
        ),
      );
    };
    return await awaitExportOperation(work(), capture.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    try {
      if (capture.signal.aborted) void graphic?.dispose().catch(() => undefined);
      else await graphic?.dispose();
    } finally {
      graphic?.remove();
      realmToDispose?.frame.remove();
      if (globals) delete globals[EXPORTED_RESOURCE_URLS_KEY];
      resourcesToDispose?.dispose();
      if (moduleUrlToDispose) URL.revokeObjectURL(moduleUrlToDispose);
    }
  }
}

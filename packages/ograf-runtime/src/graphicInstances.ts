import type { CompiledLayer } from '@ograf-editor/ograf-types';
import type { FrameCue } from '@ograf-editor/scene-model';

interface GraphicInstanceIdentity {
  readonly instanceId: string;
  readonly templateId?: string;
  readonly laneId?: string;
}

export interface GraphicInstance extends GraphicInstanceIdentity {
  readonly layers: Readonly<Record<string, HTMLElement>>;
}

export type GraphicInstances = Readonly<Record<string, GraphicInstance>>;

export type StudioFrameCueDetail = FrameCue & GraphicInstanceIdentity;

export function collectExportedLayers(
  layers: readonly CompiledLayer[],
  getLayer: (id: string) => HTMLElement | undefined,
): GraphicInstance['layers'] {
  const keyed: Record<string, HTMLElement> = Object.create(null);
  for (const layer of layers) {
    if (!layer.exportKey || layer.collectionItem) continue;
    const element = getLayer(layer.id);
    if (element) keyed[layer.exportKey] = element;
  }
  return keyed;
}

export function dispatchStudioFrameCue(
  host: HTMLElement,
  cue: FrameCue,
  { instanceId, templateId, laneId }: GraphicInstanceIdentity,
): void {
  const EventClass = host.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
  host.dispatchEvent(
    new EventClass<StudioFrameCueDetail>('ograf-studio-cue', {
      detail: {
        ...structuredClone(cue),
        instanceId,
        ...(templateId !== undefined ? { templateId } : {}),
        ...(laneId !== undefined ? { laneId } : {}),
      },
      bubbles: true,
      composed: true,
    }),
  );
}

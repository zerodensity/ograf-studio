import { getElementMediaPaint } from '@ograf-editor/scene-model';
import { LiveInputControls } from '../components/LiveInputControls';
import { useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import {
  canUseLiveMediaInput,
  defaultLiveMediaInput,
  liveMediaInputNames,
  routeLiveMediaInputToLayer,
} from '../state/liveMediaInputs';

/** The selection is the destination for both input routing and webcam preview. */
export function SelectedLiveInputControls() {
  const composition = useActiveComposition();
  const selectedIds = useSelectionStore((state) => state.selectedLayerIds);
  const selected =
    selectedIds.length === 1
      ? composition.layers.find((layer) => layer.id === selectedIds[0])
      : undefined;
  const target = canUseLiveMediaInput(selected) ? selected : undefined;
  const paint = target ? getElementMediaPaint(target.element) : undefined;
  return (
    <LiveInputControls
      inputNames={liveMediaInputNames(composition)}
      initialName={defaultLiveMediaInput(composition)}
      {...(paint?.source.kind === 'live' ? { currentName: paint.source.tag } : {})}
      {...(target ? { destination: target.name } : {})}
      disabled={!target}
      onUse={(name) => !!target && routeLiveMediaInputToLayer(target.id, name)}
    />
  );
}

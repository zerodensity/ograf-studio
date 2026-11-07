import { useActiveComposition } from '../state/projectStore';
import { resetLayerCrops, useLayerCropStore } from '../state/layerCropStore';

export function LayerCropEditor({ layerIds }: { layerIds: string[] }) {
  const composition = useActiveComposition();
  const layers = composition.layers.filter((layer) => layerIds.includes(layer.id));
  const disabled =
    !layers.length || layers.some((layer) => layer.isLocked || layer.element.type === 'audio');
  return (
    <>
      <div className="inspector-button-row">
        <button
          type="button"
          disabled={disabled}
          onClick={() => useLayerCropStore.getState().open(layerIds)}
        >
          Crop
        </button>
        {layers.some((layer) => layer.crop) ? (
          <button type="button" disabled={disabled} onClick={() => resetLayerCrops(layerIds)}>
            Reset Crop
          </button>
        ) : null}
      </div>
      <p className="inspector-hint">
        Trim the visible area of {layers.length > 1 ? 'the selected group' : 'this layer'} without
        moving or stretching its content.
      </p>
    </>
  );
}

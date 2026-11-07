import { ContextMenu } from './ContextMenu';
import { useActiveComposition } from '../state/projectStore';
import { resetLayerCrops, useLayerCropStore } from '../state/layerCropStore';

export interface LayerCropMenuPosition {
  x: number;
  y: number;
  layerIds: string[];
}

export function LayerCropContextMenu({
  menu,
  onClose,
}: {
  menu: LayerCropMenuPosition;
  onClose: () => void;
}) {
  const composition = useActiveComposition();
  const layers = composition.layers.filter((layer) => menu.layerIds.includes(layer.id));
  const disabled =
    !layers.length || layers.some((layer) => layer.isLocked || layer.element.type === 'audio');
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel="Crop selected layers"
      onClose={onClose}
      items={[
        {
          id: 'crop',
          label: 'Crop',
          disabled,
          onSelect: () => useLayerCropStore.getState().open(menu.layerIds),
        },
        {
          id: 'reset-crop',
          label: 'Reset Crop',
          disabled: disabled || !layers.some((layer) => layer.crop),
          onSelect: () => resetLayerCrops(menu.layerIds),
        },
      ]}
    />
  );
}

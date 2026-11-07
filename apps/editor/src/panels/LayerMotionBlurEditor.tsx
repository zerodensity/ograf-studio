import type { Layer } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { PropertyRow } from '../components/PropertyRow';
export function LayerMotionBlurEditor({ layer }: { layer: Layer }) {
  const setBlur = useProjectStore((state) => state.setLayerMotionBlur);
  const setting = layer.motionBlur ?? { enabled: false, shutterAngle: 180 };
  const apply = (patch: Partial<typeof setting>) =>
    runDiscreteHistoryStep(() => setBlur(layer.id, { ...setting, ...patch }), 'Change motion blur');
  return (
    <div className="inspector-motion-blur">
      <PropertyRow
        help="Experimental directional SVG blur from authored X/Y keyframe velocity. Path, modifier and live-data motion are not included. It adds GPU cost; test on your playout machine."
        className="inspector-row"
      >
        <span>Motion blur · experimental</span>
        <input
          type="checkbox"
          aria-label="Enable experimental motion blur"
          checked={setting.enabled}
          disabled={layer.isLocked}
          onChange={(e) => apply({ enabled: e.currentTarget.checked })}
        />
      </PropertyRow>
      {setting.enabled && (
        <PropertyRow
          help="Shutter angle controls the blur length, from 0° to 360°."
          className="inspector-row"
        >
          <span>Shutter angle</span>
          <input
            type="number"
            aria-label="Motion blur shutter angle"
            min={0}
            max={360}
            step={1}
            value={setting.shutterAngle}
            disabled={layer.isLocked}
            onChange={(e) =>
              apply({ shutterAngle: Math.max(0, Math.min(360, Number(e.currentTarget.value))) })
            }
          />
          <span>°</span>
        </PropertyRow>
      )}
      {setting.enabled && (
        <p className="inspector-hint">
          Uses X/Y keys and loop keys only; path, modifier, rule and live-data movement are not
          sampled. Test performance on the target renderer.
        </p>
      )}
    </div>
  );
}

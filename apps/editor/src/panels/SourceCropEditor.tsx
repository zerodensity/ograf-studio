import type { SourceCrop } from '@ograf-editor/scene-model';
import { useCropToolStore } from '../state/cropToolStore';
import { runDiscreteHistoryStep } from '../state/historyStore';

export function SourceCropEditor({
  value,
  src,
  video = false,
  layerId,
  disabled,
  onChange,
}: {
  value?: SourceCrop;
  src?: string;
  video?: boolean;
  layerId?: string;
  disabled?: boolean;
  onChange: (crop: SourceCrop | undefined) => void;
}) {
  return (
    <>
      <div className="inspector-button-row">
        <button
          type="button"
          disabled={disabled}
          title="Adjust the source crop directly on the canvas."
          onClick={() =>
            useCropToolStore.getState().openSource({ value, src, video, layerId, onChange })
          }
        >
          Crop Source
        </button>
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => runDiscreteHistoryStep(() => onChange(undefined), 'Reset media crop')}
          >
            Reset crop
          </button>
        ) : null}
      </div>
      {value ? (
        <p className="inspector-hint">
          Source crop: {Math.round(value.width * 100)}% × {Math.round(value.height * 100)}%
        </p>
      ) : null}
    </>
  );
}

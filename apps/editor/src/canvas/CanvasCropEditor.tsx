import { useCropToolStore } from '../state/cropToolStore';

export function CanvasCropEditor() {
  return (
    <button
      type="button"
      title="Adjust the canvas crop directly on the canvas"
      onClick={() => useCropToolStore.getState().openCanvas()}
    >
      Crop Canvas
    </button>
  );
}

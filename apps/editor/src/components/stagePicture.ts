import { usedFontFaceCss } from '@ograf-editor/ograf-runtime/src/fontEmbedding';
import {
  selfStyledCapture,
  selfStyledCaptureObstacle,
} from '@ograf-editor/ograf-runtime/src/selfStyledCapture';

/** Notes Studio shows on a layer of the stage. They are not part of the graphic. */
const STAGE_NOTES = '.layer-shader-paused, .layer-inline-text-badge, .layer-content-placeholder';

/**
 * A picture of the graphic as Studio's stage shows it, at the composition's own size. The runtime
 * draws each layer's content, so the stage is drawn from its markup; Studio's own marks on it, such
 * as a selection outline, come from stylesheets and stay out of the picture.
 */
export async function stagePicture(stage: HTMLElement): Promise<HTMLCanvasElement> {
  const width = stage.offsetWidth,
    height = stage.offsetHeight;
  if (!width || !height) throw new Error('The Studio canvas has no drawable size.');
  const obstacle = selfStyledCaptureObstacle(stage);
  if (obstacle)
    throw new Error(
      `The Studio canvas cannot be sampled while it holds ${obstacle}. Use the system eyedropper.`,
    );
  return selfStyledCapture(stage, {
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    style: {},
    fontEmbedCSS: await usedFontFaceCss(stage),
    partOfPage: true,
    filter: (element) => !element.matches(STAGE_NOTES),
  })();
}

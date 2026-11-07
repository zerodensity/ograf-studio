import { PresentationBackground } from '../components/PresentationBackground';

/** The editor uses the same document-wide presentation background as its preview. */
export function CanvasPresentationBackground() {
  return <PresentationBackground className="canvas-presentation-background" />;
}

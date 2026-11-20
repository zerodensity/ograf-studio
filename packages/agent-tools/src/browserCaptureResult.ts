export interface ResolvedFontResult {
  layerId: string;
  layerName: string;
  requestedFamily: string;
  resolvedFamily: string;
  resolution: 'inferred';
}

export interface RuntimeCollectionCaptureResult {
  id: string;
  name: string;
  receivedCount: number;
  renderedCount: number;
  capacity: number;
  truncated: boolean;
}

/** How a capture differs from a reference picture, with a picture of where. */
export interface CaptureComparisonResult {
  mimeType: 'image/png';
  /** Base64 PNG, black where the two agree and brighter where they differ. */
  data: string;
  /** Average colour distance over all pixels, from 0 to 1. */
  meanDifference: number;
  /** Share of pixels that differ by more than a tenth of the colour range. */
  differingFraction: number;
  referenceWidth: number;
  referenceHeight: number;
}

export interface BrowserCaptureResult {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  comparison?: CaptureComparisonResult;
  resolvedFonts: ResolvedFontResult[];
  runtimeCollections?: RuntimeCollectionCaptureResult[];
}

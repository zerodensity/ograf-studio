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

export interface BrowserCaptureResult {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resolvedFonts: ResolvedFontResult[];
  runtimeCollections?: RuntimeCollectionCaptureResult[];
}

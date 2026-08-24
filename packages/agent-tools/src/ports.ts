import type { AuthoringSession } from '@ograf-editor/authoring-core';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import type { FieldValue, Project } from '@ograf-editor/scene-model';

export interface CompatibilityResult {
  valid: boolean;
  checks: Array<{ id: string; label: string; valid: boolean; errors: string[] }>;
  errors: string[];
}

export interface BrowserCaptureRequest {
  target: 'composition' | 'viewport';
  project: Project;
  compositionId?: string;
  frame: number;
  maxDimension: number;
  matte: string;
  dataOverrides?: Record<string, FieldValue>;
}

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

export interface BrowserStripRequest {
  project: Project;
  compositionId?: string;
  frames: number[];
  columns: number;
  maxDimension: number;
  labelFrames: boolean;
  matte: string;
}

export interface BrowserStripResult extends BrowserCaptureResult {
  frames: number[];
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  compositionWidth: number;
  compositionHeight: number;
}

export interface PublishedCapture extends Omit<BrowserCaptureResult, 'data'> {
  data: string;
  url: string;
  expiresAt: string;
}

export interface PublishedStrip extends Omit<BrowserStripResult, 'data'> {
  data: string;
  url: string;
  expiresAt: string;
}

export interface BrowserMeasureTextRequest {
  project: Project;
  compositionId?: string;
  layerId: string;
  text?: string;
  frame: number;
}

export interface BrowserMeasureTextResult {
  layerId: string;
  layerName: string;
  frame: number;
  text: string;
  width: number;
  height: number;
  boxWidth: number;
  boxHeight: number;
  lines: number;
  overflowsParent: boolean;
  clippedBy: 'parent' | 'own-box' | null;
  appliedShrinkRatio: number;
  degenerate: boolean;
  resolvedFont: {
    requestedFamily: string;
    resolvedFamily: string;
    resolution: 'inferred';
  };
  clippedAt: number | null;
}

export interface EditorBridgeHealth {
  connected: boolean;
  responsive: boolean;
  latencyMs: number | null;
  lastHeartbeat: string | null;
  likelyCause: 'tab-throttled' | 'editor-disconnected' | null;
  certificationReady: boolean;
  certificationLikelyCause: string | null;
}

export interface AuthoringProposal {
  id: string;
  title: string;
  description: string;
  sessionId: string;
  baseRevision: number;
  operationTypes: string[];
  operationCount: number;
  previewUrl: string;
  previewExpiresAt: string;
  render: 'frame' | 'strip';
  frames: number[];
  valid: boolean;
  warnings: string[];
}

export interface ProposalDecisionResult {
  status: 'accepted' | 'rejected' | 'stale' | 'error';
  message: string;
  revision?: number;
}

export interface EditorBridgePort {
  readonly health: EditorBridgeHealth;
  certify(artifacts: ExportArtifacts, timeoutMs?: number): Promise<CompatibilityResult>;
  capture(request: BrowserCaptureRequest, timeoutMs?: number): Promise<PublishedCapture>;
  renderStrip(request: BrowserStripRequest, timeoutMs?: number): Promise<PublishedStrip>;
  measureText(
    request: BrowserMeasureTextRequest,
    timeoutMs?: number,
  ): Promise<BrowserMeasureTextResult>;
  presentProposal(
    proposal: AuthoringProposal,
    decide: (decision: 'accept' | 'reject') => Promise<ProposalDecisionResult>,
  ): void;
}

export interface AuthoringWorkspacePort {
  readonly root: string;
  list(): Array<{ sessionId: string; revision: number; projectName: string; valid: boolean }>;
  get(sessionId?: string): AuthoringSession;
  create(sessionId: string, project?: Project): AuthoringSession;
  delete(sessionId: string): void;
  open(sessionId: string, inputPath: string): Promise<AuthoringSession>;
  resolveAllowedPath(input: string): string;
}

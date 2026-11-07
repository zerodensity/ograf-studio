import type { AuthoringSession } from '@ograf-editor/authoring-core';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import type { FieldValue, Project } from '@ograf-editor/scene-model';
import type { LivePlayoutRequest } from './playoutSchemas';

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
  appliedFontSize: number;
  appliedFitRatio: number;
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
  templateSetsReady?: boolean;
  playoutReady?: boolean;
  connected: boolean;
  responsive: boolean;
  latencyMs: number | null;
  lastHeartbeat: string | null;
  likelyCause: 'tab-throttled' | 'editor-disconnected' | 'editor-updating' | null;
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
  project?: Project;
  compositionId?: string;
}

export interface ProposalDecisionResult {
  status: 'accepted' | 'rejected' | 'stale' | 'error';
  message: string;
  revision?: number;
}

export interface EditorBridgePort {
  requestLivePlayout?(
    request: LivePlayoutRequest,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  requestTemplateSet?(
    request: TemplateSetRequest,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
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

export interface TemplateSetRequest {
  action: 'read' | 'command' | 'archive' | 'export-coordinated';
  profile?: 'realtime' | 'non-realtime' | 'dual';
  expectedRevision?: string;
  /** Saves a snapshot copy; compact deduplicates source payloads, compatible retains the v5 layout. */
  archiveMode?: 'compact' | 'compatible';
  includeProjects?: boolean;
  resourceUsage?: { slotIds?: string[]; componentIds?: string[] };
  templateIds?: string[];
  offset?: number;
  limit?: number;
  operation?: Record<string, unknown>;
  confirm?: boolean;
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

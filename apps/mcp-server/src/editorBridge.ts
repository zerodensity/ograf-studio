import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import type { FieldValue, Project } from '@ograf-editor/scene-model';
import { WebSocketServer, WebSocket } from 'ws';
import type { AuthoringWorkspace } from './workspace';

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

export interface BrowserCaptureResult {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resolvedFonts: ResolvedFontResult[];
  runtimeCollections?: Array<{
    id: string;
    name: string;
    receivedCount: number;
    renderedCount: number;
    capacity: number;
    truncated: boolean;
  }>;
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

type EditorInbound =
  | { type: 'editor.hello'; project: Project }
  | { type: 'editor.project'; project: Project; reason?: string }
  | { type: 'heartbeat.result'; requestId: string }
  | { type: 'certification.result'; requestId: string; result: CompatibilityResult }
  | {
      type: 'capture.result';
      requestId: string;
      result?: BrowserCaptureResult;
      error?: string;
    }
  | {
      type: 'strip.result';
      requestId: string;
      result?: BrowserStripResult;
      error?: string;
    }
  | {
      type: 'measure-text.result';
      requestId: string;
      result?: BrowserMeasureTextResult;
      error?: string;
    }
  | { type: 'proposal.decision'; proposalId: string; decision: 'accept' | 'reject' };

interface PendingCertification {
  resolve: (result: CompatibilityResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingCapture {
  resolve: (result: BrowserCaptureResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingStrip {
  resolve: (result: BrowserStripResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingMeasureText {
  resolve: (result: BrowserMeasureTextResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface CaptureAsset {
  data: Buffer;
  mimeType: 'image/png';
  expiresAt: number;
}

interface PendingProposal {
  proposal: AuthoringProposal;
  decide: (decision: 'accept' | 'reject') => Promise<ProposalDecisionResult>;
  expiresAt: number;
}

const CAPTURE_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const HEARTBEAT_RESPONSIVE_MS = 750;
const HEARTBEAT_STALE_MS = 3_000;

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export class EditorBridge {
  #socket: WebSocket | null = null;
  #pendingCertifications = new Map<string, PendingCertification>();
  #pendingCaptures = new Map<string, PendingCapture>();
  #pendingStrips = new Map<string, PendingStrip>();
  #pendingTextMeasurements = new Map<string, PendingMeasureText>();
  #captureAssets = new Map<string, CaptureAsset>();
  #proposals = new Map<string, PendingProposal>();
  #unsubscribe: (() => void) | null = null;
  #editorReady = false;
  #heartbeatRequest: { requestId: string; sentAt: number } | null = null;
  #lastHeartbeatAt: number | null = null;
  #lastHeartbeatLatencyMs: number | null = null;
  #certificationRegistryHealthy = true;
  #editorBaselineInitialized = false;

  constructor(
    private readonly server: HttpServer,
    private readonly workspace: AuthoringWorkspace,
  ) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/editor' || !isLocalRequest(request)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
    wss.on('connection', (socket) => this.#connect(socket));
    const heartbeatTimer = setInterval(() => this.#requestHeartbeat(), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  get health(): EditorBridgeHealth {
    if (!this.connected) {
      return {
        connected: false,
        responsive: false,
        latencyMs: null,
        lastHeartbeat: this.#lastHeartbeatAt ? new Date(this.#lastHeartbeatAt).toISOString() : null,
        likelyCause: 'editor-disconnected',
        certificationReady: false,
        certificationLikelyCause: 'The live editor is disconnected.',
      };
    }
    const now = Date.now();
    const pendingLatency = this.#heartbeatRequest ? now - this.#heartbeatRequest.sentAt : null;
    const latencyMs = pendingLatency ?? this.#lastHeartbeatLatencyMs;
    const responseFresh =
      this.#lastHeartbeatAt !== null && now - this.#lastHeartbeatAt <= HEARTBEAT_STALE_MS;
    const responsive =
      responseFresh &&
      latencyMs !== null &&
      latencyMs <= HEARTBEAT_RESPONSIVE_MS &&
      (pendingLatency === null || pendingLatency <= HEARTBEAT_RESPONSIVE_MS);
    return {
      connected: true,
      responsive,
      latencyMs,
      lastHeartbeat: this.#lastHeartbeatAt ? new Date(this.#lastHeartbeatAt).toISOString() : null,
      likelyCause: responsive ? null : 'tab-throttled',
      certificationReady: responsive && this.#certificationRegistryHealthy,
      certificationLikelyCause: !responsive
        ? 'The editor is not responsive.'
        : this.#certificationRegistryHealthy
          ? null
          : 'The page custom-element registry is unhealthy. Reload the editor tab.',
    };
  }

  #send(payload: unknown): void {
    if (!this.connected) return;
    this.#socket!.send(JSON.stringify(payload));
  }

  #connect(socket: WebSocket): void {
    this.#socket?.close(1000, 'Replaced by a newer editor connection');
    this.#socket = socket;
    this.#editorReady = false;
    this.#heartbeatRequest = null;
    this.#lastHeartbeatAt = null;
    this.#lastHeartbeatLatencyMs = null;
    this.#certificationRegistryHealthy = true;
    this.#unsubscribe?.();
    this.#unsubscribe = this.workspace.get('editor').subscribe((change) => {
      if (change.source === 'editor') return;
      this.#send({
        type: 'project.replace',
        sessionId: change.sessionId,
        revision: change.revision,
        project: change.project,
        source: change.source,
        reason: change.reason,
        summary: change.summary,
      });
    });
    socket.on('message', (raw) => this.#receive(raw.toString()));
    socket.on('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#editorReady = false;
      this.#heartbeatRequest = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      for (const pending of this.#pendingCertifications.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('The live editor disconnected during certification.'));
      }
      this.#pendingCertifications.clear();
      for (const pending of this.#pendingCaptures.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('The live editor disconnected during capture.'));
      }
      this.#pendingCaptures.clear();
      for (const pending of this.#pendingStrips.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('The live editor disconnected during frame-strip rendering.'));
      }
      this.#pendingStrips.clear();
      for (const pending of this.#pendingTextMeasurements.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('The live editor disconnected during text measurement.'));
      }
      this.#pendingTextMeasurements.clear();
    });
  }

  #receive(raw: string): void {
    let message: EditorInbound;
    try {
      message = JSON.parse(raw) as EditorInbound;
    } catch {
      return;
    }
    if (message.type === 'editor.hello') {
      const session = this.workspace.get('editor');
      if (!this.#editorBaselineInitialized && session.revision === 0) {
        this.workspace.initializeEditorProject(message.project);
      } else if (!session.matchesExternal(message.project)) {
        const snapshot = session.snapshot();
        this.#send({
          type: 'project.replace',
          sessionId: 'editor',
          revision: snapshot.revision,
          project: snapshot.project,
          source: 'system',
          reason:
            'Editor handshake conflict: the connected tab differed from the authoritative MCP session and was synchronized without creating a revision.',
        });
      }
      this.#editorBaselineInitialized = true;
      this.#send({ type: 'editor.ack', revision: this.workspace.get('editor').revision });
      this.#pruneProposals();
      for (const pending of this.#proposals.values()) {
        this.#send({ type: 'proposal.present', proposal: pending.proposal });
      }
      this.#editorReady = true;
      this.#requestHeartbeat();
      return;
    }
    if (message.type === 'editor.project') {
      this.#editorBaselineInitialized = true;
      this.workspace.setEditorProject(message.project, message.reason ?? message.type);
      this.#send({ type: 'editor.ack', revision: this.workspace.get('editor').revision });
      this.#editorReady = true;
      this.#requestHeartbeat();
      return;
    }
    if (message.type === 'heartbeat.result') {
      if (this.#heartbeatRequest?.requestId !== message.requestId) return;
      this.#lastHeartbeatLatencyMs = Date.now() - this.#heartbeatRequest.sentAt;
      this.#lastHeartbeatAt = Date.now();
      this.#heartbeatRequest = null;
      return;
    }
    if (message.type === 'certification.result') {
      const pending = this.#pendingCertifications.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingCertifications.delete(message.requestId);
      const registryCollision = message.result.errors.some((error) =>
        /CustomElementRegistry|already been used|custom element registry/i.test(error),
      );
      if (registryCollision) this.#certificationRegistryHealthy = false;
      else if (message.result.valid) this.#certificationRegistryHealthy = true;
      pending.resolve(message.result);
      return;
    }
    if (message.type === 'capture.result') {
      const pending = this.#pendingCaptures.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingCaptures.delete(message.requestId);
      if (message.result) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Browser capture failed.'));
      return;
    }
    if (message.type === 'strip.result') {
      const pending = this.#pendingStrips.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingStrips.delete(message.requestId);
      if (message.result) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Browser frame-strip rendering failed.'));
      return;
    }
    if (message.type === 'measure-text.result') {
      const pending = this.#pendingTextMeasurements.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingTextMeasurements.delete(message.requestId);
      if (message.result) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Browser text measurement failed.'));
      return;
    }
    if (message.type === 'proposal.decision') {
      void this.#handleProposalDecision(message.proposalId, message.decision);
    }
  }

  presentProposal(proposal: AuthoringProposal, decide: PendingProposal['decide']): void {
    if (!this.connected) {
      throw new Error(
        'Human review requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    this.#pruneProposals();
    this.#proposals.set(proposal.id, {
      proposal,
      decide,
      expiresAt: Date.parse(proposal.previewExpiresAt),
    });
    this.#send({ type: 'proposal.present', proposal });
  }

  async #handleProposalDecision(proposalId: string, decision: 'accept' | 'reject'): Promise<void> {
    this.#pruneProposals();
    const pending = this.#proposals.get(proposalId);
    if (!pending) {
      this.#send({
        type: 'proposal.resolved',
        proposalId,
        result: {
          status: 'stale',
          message: 'This proposal is no longer available. Ask the agent to regenerate it.',
        } satisfies ProposalDecisionResult,
      });
      return;
    }
    this.#proposals.delete(proposalId);
    let result: ProposalDecisionResult;
    try {
      result = await pending.decide(decision);
    } catch (error) {
      result = {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.#send({ type: 'proposal.resolved', proposalId, result });
  }

  #pruneProposals(): void {
    const now = Date.now();
    for (const [proposalId, pending] of this.#proposals) {
      if (pending.expiresAt <= now) this.#proposals.delete(proposalId);
    }
  }

  certify(artifacts: ExportArtifacts, timeoutMs = 60_000): Promise<CompatibilityResult> {
    if (!this.connected) {
      throw new Error(
        'Certification requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    this.#assertResponsive('certification', timeoutMs);
    if (!this.#certificationRegistryHealthy) {
      throw new Error(
        'Certification is unavailable because the page custom-element registry is unhealthy. Reload the editor tab and retry.',
      );
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingCertifications.delete(requestId);
        reject(this.#timeoutError('certification', timeoutMs));
      }, timeoutMs);
      this.#pendingCertifications.set(requestId, { resolve, reject, timeout });
      this.#send({ type: 'certification.request', requestId, artifacts });
    });
  }

  async capture(request: BrowserCaptureRequest, timeoutMs = 30_000): Promise<PublishedCapture> {
    if (!this.connected) {
      throw new Error(
        'Capture requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    this.#assertResponsive('capture', timeoutMs);
    const requestId = randomUUID();
    const result = await new Promise<BrowserCaptureResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingCaptures.delete(requestId);
        reject(this.#timeoutError('capture', timeoutMs));
      }, timeoutMs);
      this.#pendingCaptures.set(requestId, { resolve, reject, timeout });
      this.#send({ type: 'capture.request', requestId, request });
    });

    return this.#publishPng(result);
  }

  async renderStrip(request: BrowserStripRequest, timeoutMs = 60_000): Promise<PublishedStrip> {
    if (!this.connected) {
      throw new Error(
        'Frame-strip rendering requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    this.#assertResponsive('frame-strip rendering', timeoutMs);
    const requestId = randomUUID();
    const result = await new Promise<BrowserStripResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingStrips.delete(requestId);
        reject(this.#timeoutError('frame-strip rendering', timeoutMs));
      }, timeoutMs);
      this.#pendingStrips.set(requestId, { resolve, reject, timeout });
      this.#send({ type: 'strip.request', requestId, request });
    });
    return this.#publishPng(result);
  }

  measureText(
    request: BrowserMeasureTextRequest,
    timeoutMs = 30_000,
  ): Promise<BrowserMeasureTextResult> {
    if (!this.connected) {
      throw new Error(
        'Text measurement requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    this.#assertResponsive('text measurement', timeoutMs);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingTextMeasurements.delete(requestId);
        reject(this.#timeoutError('text measurement', timeoutMs));
      }, timeoutMs);
      this.#pendingTextMeasurements.set(requestId, { resolve, reject, timeout });
      this.#send({ type: 'measure-text.request', requestId, request });
    });
  }

  getCaptureAsset(token: string): CaptureAsset | null {
    this.#pruneCaptureAssets();
    return this.#captureAssets.get(token) ?? null;
  }

  #requestHeartbeat(): void {
    if (!this.connected || !this.#editorReady || this.#heartbeatRequest) return;
    const requestId = randomUUID();
    this.#heartbeatRequest = { requestId, sentAt: Date.now() };
    this.#send({ type: 'heartbeat.request', requestId });
  }

  #timeoutError(operation: string, timeoutMs: number): Error {
    const health = this.health;
    const latency = health.latencyMs === null ? 'unavailable' : `${health.latencyMs} ms`;
    const remedy = health.connected
      ? 'The editor tab is likely backgrounded or minimised, which can throttle its main thread and requestAnimationFrame. Bring the editor tab to the foreground and retry.'
      : 'Open OGraf Studio and keep it connected to this MCP server, then retry.';
    return new Error(
      `Browser OGraf ${operation} timed out after ${timeoutMs} ms. Bridge heartbeat latency ${latency}. ${remedy} (connected: ${health.connected}, responsive: ${health.responsive})`,
    );
  }

  #assertResponsive(operation: string, timeoutMs: number): void {
    const health = this.health;
    if (
      health.connected &&
      !health.responsive &&
      health.latencyMs !== null &&
      health.latencyMs > HEARTBEAT_RESPONSIVE_MS
    ) {
      throw new Error(
        `Browser OGraf ${operation} cannot start within its ${timeoutMs} ms timeout because bridge heartbeat latency is already ${health.latencyMs} ms. The editor tab is likely backgrounded or minimised, which can throttle its main thread and requestAnimationFrame. Bring the editor tab to the foreground and retry. (connected: true, responsive: false)`,
      );
    }
  }

  #pruneCaptureAssets(): void {
    const now = Date.now();
    for (const [token, asset] of this.#captureAssets) {
      if (asset.expiresAt <= now) this.#captureAssets.delete(token);
    }
  }

  #publishPng<T extends BrowserCaptureResult>(
    result: T,
  ): Omit<T, 'data'> & { data: string; url: string; expiresAt: string } {
    if (result.mimeType !== 'image/png') {
      throw new Error(`Browser returned unsupported capture MIME type: ${result.mimeType}`);
    }
    const data = Buffer.from(result.data, 'base64');
    if (data.length === 0) throw new Error('Browser returned an empty PNG capture.');
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (
      data.length < pngSignature.length ||
      !data.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
      throw new Error('Browser capture payload is not a valid PNG byte stream.');
    }

    this.#pruneCaptureAssets();
    const token = randomUUID();
    const expiresAt = Date.now() + CAPTURE_TTL_MS;
    this.#captureAssets.set(token, { data, mimeType: result.mimeType, expiresAt });
    return {
      ...result,
      url: `${this.#origin()}/captures/${token}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  #origin(): string {
    const address = this.server.address() as AddressInfo | null;
    if (!address) throw new Error('MCP HTTP server is not listening.');
    return `http://127.0.0.1:${address.port}`;
  }
}

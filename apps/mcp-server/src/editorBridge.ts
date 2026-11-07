import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import {
  assertComponentGraphProjectUpdate,
  migrateProject,
  type ComponentGraphContext,
  type FieldValue,
  type Project,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { WebSocketServer, WebSocket } from 'ws';
import type { AuthoringWorkspace } from './workspace';
import type { ChatAgentController, ChatClientMessage } from './agent/chatAgent';
import type { ChatServerEvent } from './agent/types';
import { nodosSendMessageSchema, type NodosPresetHost } from './nodos/nodosPresets';
import {
  livePlayoutRequestSchema,
  MAX_PLAYOUT_REQUEST_BYTES,
  type LivePlayoutRequest,
  type TemplateSetRequest,
} from '@ograf-editor/agent-tools';

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

/** No browser operation has been dispatched when this error is returned. */
export class EditorReadinessError extends Error {
  readonly code = 'EDITOR_NOT_READY';
  readonly retryable = true;
  readonly admitted = false;
  readonly retryAfterMs = 250;

  constructor(
    readonly operation: string,
    readonly health: EditorBridgeHealth,
  ) {
    super(
      `Browser OGraf ${operation} is waiting for the editor to finish updating or respond to a fresh heartbeat. No operation was admitted. Keep Studio visible and retry after it settles.`,
    );
    this.name = 'EditorReadinessError';
  }
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

type EditorInbound =
  | {
      type: 'editor.hello';
      project: Project;
      componentGraphContext?: ComponentGraphContext | null;
      capabilities?: string[];
    }
  | { type: 'editor.component-graph'; componentGraphContext: ComponentGraphContext | null }
  | {
      type: 'playout.result';
      requestId: string;
      result?: Record<string, unknown>;
      error?: string;
    }
  | {
      type: 'template-set.result';
      requestId: string;
      result?: Record<string, unknown>;
      project?: Project;
      componentGraphContext?: ComponentGraphContext | null;
      error?: string;
    }
  | {
      type: 'editor.project';
      project: Project;
      componentGraphContext?: ComponentGraphContext | null;
      reason?: string;
    }
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
  | { type: 'proposal.decision'; proposalId: string; decision: 'accept' | 'reject' }
  | { type: 'nodos.send'; requestId?: unknown }
  | { type: 'nodos.types'; requestId?: unknown; address?: unknown }
  | ChatClientMessage;

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
const READINESS_GRACE_MS = 1_500;

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export class EditorBridge {
  #templateSetsReady = false;
  #playoutReady = false;
  #pendingPlayout = new Map<
    string,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  #pendingTemplateSets = new Map<
    string,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
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
  #readinessProbeRequired = false;
  #readinessWaiters = new Set<() => void>();
  #certificationRegistryHealthy = true;
  #editorBaselineInitialized = false;
  #editorSyncError: string | null = null;
  #componentGraphContext: ComponentGraphContext | null = null;
  #componentGraphReady = false;
  #chatController: ChatAgentController | null = null;
  #nodosPresets: NodosPresetHost | null = null;

  constructor(
    private readonly server: HttpServer,
    private readonly workspace: AuthoringWorkspace,
  ) {
    this.workspace.get('editor').setMutationValidator((previous, candidate, context) => {
      // Opening a standalone document closes the previous set. Its graph references belong
      // to that previous document, even when this file is an export retaining the child's ID.
      if (context?.documentContext === 'standalone') return;
      const sharedShape = (project: Project) =>
        JSON.stringify(
          project.compositions.flatMap((composition) =>
            composition.components
              .filter((component) => component.scope === 'set')
              .map((component) => ({
                compositionId: composition.id,
                id: component.id,
                layers: component.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id),
              })),
          ),
        );
      if (
        previous.id === candidate.id &&
        sharedShape(previous) !== sharedShape(candidate) &&
        (!this.#componentGraphReady ||
          (this.#componentGraphContext !== null &&
            this.#componentGraphContext.projectId !== previous.id))
      )
        throw new Error(
          'Reload connected Studio before changing shared component structure; its graph-reference guard is not available.',
        );
      assertComponentGraphProjectUpdate(previous, candidate, this.#componentGraphContext);
    });
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

  setChatController(controller: ChatAgentController): void {
    this.#chatController = controller;
  }

  setNodosPresetHost(host: NodosPresetHost): void {
    this.#nodosPresets = host;
    // The editor offers the engine's types for data fields, so it gets them whenever they change.
    host.onTypes((address, types) =>
      this.#send({ type: 'nodos.types.changed', address, ...types }),
    );
  }

  sendChatEvent(event: ChatServerEvent): void {
    this.#send(event);
  }

  get health(): EditorBridgeHealth {
    if (!this.connected) {
      return {
        connected: false,
        playoutReady: false,
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
      !this.#readinessProbeRequired &&
      responseFresh &&
      latencyMs !== null &&
      latencyMs <= HEARTBEAT_RESPONSIVE_MS &&
      (pendingLatency === null || pendingLatency <= HEARTBEAT_RESPONSIVE_MS);
    return {
      connected: true,
      templateSetsReady: this.#templateSetsReady,
      playoutReady: this.#playoutReady,
      responsive,
      latencyMs,
      lastHeartbeat: this.#lastHeartbeatAt ? new Date(this.#lastHeartbeatAt).toISOString() : null,
      likelyCause: this.#readinessProbeRequired
        ? 'editor-updating'
        : responsive
          ? null
          : 'tab-throttled',
      certificationReady:
        responsive && this.#certificationRegistryHealthy && !this.#editorSyncError,
      certificationLikelyCause:
        this.#editorSyncError ??
        (this.#readinessProbeRequired
          ? 'The editor is settling after a template change.'
          : !responsive
            ? 'The editor is not responsive.'
            : this.#certificationRegistryHealthy
              ? null
              : 'The page custom-element registry is unhealthy. Reload the editor tab.'),
    };
  }

  #send(payload: unknown): void {
    if (!this.connected) return;
    this.#socket!.send(JSON.stringify(payload));
  }

  #connect(socket: WebSocket): void {
    this.#rejectPlayoutRequests(
      'The active Studio connection changed during the playout request. Read the new playout session before issuing further commands.',
    );
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(
        JSON.stringify({
          type: 'editor.replaced',
          message: 'This tab is not the active editor session. Reload it to make it authoritative.',
        }),
      );
      this.#socket.close(1000, 'Replaced by a newer editor connection');
    }
    this.#socket = socket;
    this.#templateSetsReady = false;
    this.#playoutReady = false;
    this.#editorReady = false;
    this.#componentGraphReady = false;
    this.#componentGraphContext = null;
    this.#editorSyncError = null;
    this.#heartbeatRequest = null;
    this.#lastHeartbeatAt = null;
    this.#lastHeartbeatLatencyMs = null;
    this.#readinessProbeRequired = false;
    this.#notifyReadinessWaiters();
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
        ...(change.documentContext ? { documentContext: change.documentContext } : {}),
        reason: change.reason,
        summary: change.summary,
      });
      this.#beginReadinessProbe();
    });
    socket.on('message', (raw) => {
      if (this.#socket !== socket) return;
      try {
        this.#receive(raw.toString());
      } catch (error) {
        this.#editorSyncError = error instanceof Error ? error.message : String(error);
        this.#editorReady = false;
        this.#send({
          type: 'editor.error',
          message: `The editor update could not be synchronized: ${this.#editorSyncError}. Undo or correct the edit to reconnect.`,
        });
      }
    });
    socket.on('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#notifyReadinessWaiters();
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
      for (const pending of this.#pendingTemplateSets.values()) {
        clearTimeout(pending.timeout);
        pending.reject(
          new Error(
            'The editor disconnected during the template-set request. Re-read the set after reconnecting before retrying.',
          ),
        );
      }
      this.#pendingTemplateSets.clear();
      this.#rejectPlayoutRequests(
        'The editor disconnected during the playout request. Read playout after reconnecting before retrying with the original requestId.',
      );
    });
  }

  #receive(raw: string): void {
    let message: EditorInbound;
    try {
      message = JSON.parse(raw) as EditorInbound;
    } catch {
      return;
    }
    if (message.type === 'editor.hello' || message.type === 'editor.project') {
      const candidate = migrateProject(message.project);
      const validation = validateProject(candidate);
      if (!validation.valid) throw new Error(validation.errors.slice(0, 3).join(' '));
      message.project = candidate;
      if (Object.hasOwn(message, 'componentGraphContext')) {
        this.#componentGraphContext = message.componentGraphContext ?? null;
        this.#componentGraphReady = true;
      }
    }
    if (message.type === 'editor.component-graph') {
      this.#componentGraphContext = message.componentGraphContext;
      this.#componentGraphReady = true;
      return;
    }
    if (message.type === 'editor.hello') {
      this.#templateSetsReady = message.capabilities?.includes('template-sets-v1') ?? false;
      this.#playoutReady = message.capabilities?.includes('playout-v1') ?? false;
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
      this.#editorSyncError = null;
      this.#send({ type: 'editor.ack', revision: this.workspace.get('editor').revision });
      this.#pruneProposals();
      for (const pending of this.#proposals.values()) {
        this.#send({ type: 'proposal.present', proposal: pending.proposal });
      }
      this.#editorReady = true;
      this.#requestHeartbeat();
      this.#chatController?.handle({ type: 'chat.status.request' });
      return;
    }
    if (message.type === 'editor.project') {
      const changedTemplate =
        this.workspace.get('editor').snapshot().project.id !== message.project.id;
      this.workspace.setEditorProject(message.project, message.reason ?? message.type);
      this.#editorBaselineInitialized = true;
      this.#editorSyncError = null;
      this.#send({ type: 'editor.ack', revision: this.workspace.get('editor').revision });
      this.#editorReady = true;
      if (changedTemplate) this.#beginReadinessProbe();
      else this.#requestHeartbeat();
      return;
    }
    if (message.type === 'heartbeat.result') {
      if (this.#heartbeatRequest?.requestId !== message.requestId) return;
      this.#lastHeartbeatLatencyMs = Date.now() - this.#heartbeatRequest.sentAt;
      this.#lastHeartbeatAt = Date.now();
      this.#heartbeatRequest = null;
      this.#readinessProbeRequired = false;
      this.#notifyReadinessWaiters();
      // A late reply can be the end of transient activation work. Confirm recovery once more
      // inside the existing grace period rather than carrying that old latency into admission.
      if (this.#readinessWaiters.size && !this.health.responsive) this.#beginReadinessProbe();
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
    if (message.type === 'playout.result') {
      const pending = this.#pendingPlayout.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingPlayout.delete(message.requestId);
      if (message.error || !message.result)
        pending.reject(new Error(message.error ?? 'Live playout request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === 'template-set.result') {
      const pending = this.#pendingTemplateSets.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingTemplateSets.delete(message.requestId);
      if (message.error || !message.result) {
        pending.reject(new Error(message.error ?? 'Template-set request failed.'));
        return;
      }
      try {
        if (Object.hasOwn(message, 'componentGraphContext')) {
          this.#componentGraphContext = message.componentGraphContext ?? null;
          this.#componentGraphReady = true;
        }
        if (message.project) {
          const candidate = migrateProject(message.project);
          const validation = validateProject(candidate);
          if (!validation.valid) throw new Error(validation.errors.slice(0, 3).join(' '));
          this.workspace.setEditorProject(candidate, 'Template-set command');
          this.#send({ type: 'editor.ack', revision: this.workspace.get('editor').revision });
          this.#beginReadinessProbe();
        }
        pending.resolve({
          ...message.result,
          projectRevision: this.workspace.get('editor').revision,
        });
      } catch (cause) {
        pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
      return;
    }
    if (message.type === 'proposal.decision') {
      void this.#handleProposalDecision(message.proposalId, message.decision);
      return;
    }
    if (message.type === 'nodos.send') {
      void this.#sendNodosPreset(message);
      return;
    }
    if (message.type === 'nodos.types') {
      void this.#sendNodosTypes(message.requestId, message.address);
      return;
    }
    if (
      message.type === 'chat.send' ||
      message.type === 'chat.cancel' ||
      message.type === 'chat.exclusive' ||
      message.type === 'chat.status.request'
    ) {
      this.#chatController?.handle(message);
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

  async #sendNodosPreset(message: unknown): Promise<void> {
    const parsed = nodosSendMessageSchema.safeParse(message);
    const requestId = (message as { requestId?: unknown }).requestId;
    const result = !parsed.success
      ? { ok: false, message: `The Nodos preset request is malformed: ${parsed.error.message}` }
      : this.#nodosPresets
        ? await this.#nodosPresets.send(parsed.data)
        : { ok: false, message: 'This server cannot send presets to Nodos.' };
    this.#send({ type: 'nodos.result', requestId, ...result });
  }

  /** The structs, tables and enums of the Nodos engine at the address, for fields to take as their types. */
  async #sendNodosTypes(requestId: unknown, address: unknown): Promise<void> {
    const result =
      typeof address !== 'string' || !address
        ? { ok: false, message: 'The Nodos types request names no engine address.' }
        : this.#nodosPresets
          ? await this.#nodosPresets.types(address)
          : { ok: false, message: 'This server cannot reach Nodos.' };
    this.#send({ type: 'nodos.types.result', requestId, ...result });
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

  async certify(artifacts: ExportArtifacts, timeoutMs = 60_000): Promise<CompatibilityResult> {
    if (!this.connected) {
      throw new Error(
        'Certification requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    await this.#awaitResponsive('certification', timeoutMs);
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
    await this.#awaitResponsive('capture', timeoutMs);
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
    await this.#awaitResponsive('frame-strip rendering', timeoutMs);
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

  async measureText(
    request: BrowserMeasureTextRequest,
    timeoutMs = 30_000,
  ): Promise<BrowserMeasureTextResult> {
    if (!this.connected) {
      throw new Error(
        'Text measurement requires OGraf Studio to be open and connected to the local MCP server.',
      );
    }
    await this.#awaitResponsive('text measurement', timeoutMs);
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

  async requestTemplateSet(
    request: TemplateSetRequest,
    timeoutMs = 20_000,
  ): Promise<Record<string, unknown>> {
    if (!this.connected)
      throw new Error('Template-set tools require the live editor to be connected.');
    if (!this.#templateSetsReady)
      throw new Error('Reload the editor to enable the updated template-set API.');
    await this.#awaitResponsive('template-set operation', timeoutMs);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingTemplateSets.delete(requestId);
        reject(
          new Error(
            'Template-set request timed out. Inspect the live set before retrying; expired queued requests do not execute.',
          ),
        );
      }, timeoutMs);
      this.#pendingTemplateSets.set(requestId, { resolve, reject, timeout });
      this.#send({
        type: 'template-set.request',
        requestId,
        expiresAt: Date.now() + timeoutMs,
        request,
      });
    });
  }

  async requestLivePlayout(
    request: LivePlayoutRequest,
    timeoutMs = 20_000,
  ): Promise<Record<string, unknown>> {
    if (!this.connected) throw new Error('Live playout tools require Studio to be connected.');
    if (!this.#playoutReady) throw new Error('Reload Studio to enable the live playout API.');
    const parsed = livePlayoutRequestSchema.parse(request);
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_PLAYOUT_REQUEST_BYTES)
      throw new Error('Live playout requests must not exceed 96 KiB.');
    await this.#awaitResponsive('live playout', timeoutMs);
    if (this.#pendingPlayout.size >= 64)
      throw new Error(
        'Too many pending live playout requests; read status after outstanding requests finish.',
      );
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingPlayout.delete(requestId);
        reject(
          new Error(
            'Live playout request timed out. Read playout before retrying with the original requestId; expired requests are not admitted.',
          ),
        );
      }, timeoutMs);
      this.#pendingPlayout.set(requestId, { resolve, reject, timeout });
      this.#send({
        type: 'playout.request',
        requestId,
        expiresAt: Date.now() + timeoutMs,
        request: parsed,
      });
    });
  }

  #rejectPlayoutRequests(message: string): void {
    for (const pending of this.#pendingPlayout.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.#pendingPlayout.clear();
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

  #notifyReadinessWaiters(): void {
    for (const notify of this.#readinessWaiters) notify();
  }

  #beginReadinessProbe(): void {
    this.#readinessProbeRequired = true;
    // A reply sent before the template change cannot prove that the new document settled.
    this.#heartbeatRequest = null;
    this.#requestHeartbeat();
  }

  async #awaitResponsive(operation: string, timeoutMs: number): Promise<void> {
    const health = this.health;
    if (
      !this.#readinessProbeRequired &&
      (health.responsive ||
        health.latencyMs === null ||
        health.latencyMs <= HEARTBEAT_RESPONSIVE_MS)
    )
      return;
    const socket = this.#socket;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.#readinessWaiters.delete(check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (!this.connected || this.#socket !== socket)
          finish(new EditorReadinessError(operation, this.health));
        else if (this.health.responsive) finish();
      };
      const timer = setTimeout(
        () => finish(new EditorReadinessError(operation, this.health)),
        Math.max(1, Math.min(READINESS_GRACE_MS, timeoutMs)),
      );
      this.#readinessWaiters.add(check);
      if (!this.#readinessProbeRequired) this.#beginReadinessProbe();
      check();
    });
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

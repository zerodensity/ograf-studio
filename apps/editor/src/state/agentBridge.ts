import { useEffect } from 'react';
import { resolveAgentBridgeUrl } from './agentBridgeUrl';
import type { Project } from '@ograf-editor/scene-model';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import { create } from 'zustand';
import { certifyExportArtifacts } from './ografCompatibility';
import { resetHistory } from './historyStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import {
  captureAgentPng,
  measureAgentText,
  renderAgentStripPng,
  type AgentCaptureRequest,
  type AgentMeasureTextRequest,
  type AgentStripRequest,
} from './agentCapture';
import type { AgentLayerReference } from './agentLayerReference';

interface AgentBridgeStatus {
  connected: boolean;
  authoritative: boolean;
  revision: number | null;
  activity: string;
  setStatus: (patch: Partial<Omit<AgentBridgeStatus, 'setStatus'>>) => void;
}

export const useAgentBridgeStatus = create<AgentBridgeStatus>((set) => ({
  connected: false,
  authoritative: true,
  revision: null,
  activity: 'Agent bridge offline',
  setStatus: (patch) => set(patch),
}));

export interface ChatUsage {
  input: number;
  output: number;
  cacheRead: number;
}

export interface ChatTranscriptEntry {
  id: string;
  turnId: string;
  kind: 'user' | 'assistant' | 'tool' | 'proposal' | 'error';
  text: string;
  status?: 'running' | 'ok' | 'error';
  usage?: ChatUsage;
}

export interface ChatProgress {
  phase: 'sending' | 'waiting' | 'continuing' | 'tool';
  message: string;
  round: number;
  updatedAt: number;
}

interface AgentChatState {
  configured: boolean | null;
  exclusive: boolean;
  externalAgentActive: boolean;
  provider: string | null;
  model: string | null;
  configMessage: string | null;
  entries: ChatTranscriptEntry[];
  activeTurnId: string | null;
  activeTurnStartedAt: number | null;
  progress: ChatProgress | null;
  sessionUsage: ChatUsage;
  projectUsage: ChatUsage;
  addEntry: (entry: ChatTranscriptEntry) => void;
  patchTool: (turnId: string, callId: string, patch: Partial<ChatTranscriptEntry>) => void;
  setState: (patch: Partial<Omit<AgentChatState, 'addEntry' | 'patchTool' | 'setState'>>) => void;
}

const EMPTY_USAGE: ChatUsage = { input: 0, output: 0, cacheRead: 0 };
const PROJECT_USAGE_KEY = 'ograf-studio:agent-usage';

function addUsage(left: ChatUsage, right: ChatUsage): ChatUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
  };
}

function readProjectUsage(projectId: string): ChatUsage {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_USAGE_KEY) ?? '{}') as Record<
      string,
      ChatUsage
    >;
    return all[projectId] ?? EMPTY_USAGE;
  } catch {
    return EMPTY_USAGE;
  }
}

function persistProjectUsage(projectId: string, usage: ChatUsage): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_USAGE_KEY) ?? '{}') as Record<
      string,
      ChatUsage
    >;
    all[projectId] = usage;
    localStorage.setItem(PROJECT_USAGE_KEY, JSON.stringify(all));
  } catch {
    // Usage display is local convenience state and must never enter the project document.
  }
}

export const useAgentChatStore = create<AgentChatState>((set) => ({
  configured: null,
  exclusive: false,
  externalAgentActive: false,
  provider: null,
  model: null,
  configMessage: null,
  entries: [],
  activeTurnId: null,
  activeTurnStartedAt: null,
  progress: null,
  sessionUsage: EMPTY_USAGE,
  projectUsage: EMPTY_USAGE,
  addEntry: (entry) => set((state) => ({ entries: [...state.entries, entry] })),
  patchTool: (turnId, callId, patch) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.turnId === turnId && entry.id === callId ? { ...entry, ...patch } : entry,
      ),
    })),
  setState: (patch) => set(patch),
}));

export interface AgentAuthoringProposal {
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

interface AgentReviewState {
  proposals: AgentAuthoringProposal[];
  lastResolution: { status: string; message: string } | null;
  present: (proposal: AgentAuthoringProposal) => void;
  resolve: (proposalId: string, result: { status: string; message: string }) => void;
  dismissResolution: () => void;
}

export const useAgentReviewStore = create<AgentReviewState>((set) => ({
  proposals: [],
  lastResolution: null,
  present: (proposal) =>
    set((state) => ({
      proposals: [...state.proposals.filter((candidate) => candidate.id !== proposal.id), proposal],
      lastResolution: null,
    })),
  resolve: (proposalId, result) =>
    set((state) => ({
      proposals: state.proposals.filter((proposal) => proposal.id !== proposalId),
      lastResolution: result,
    })),
  dismissResolution: () => set({ lastResolution: null }),
}));

let sendProposalDecision: ((payload: unknown) => void) | null = null;
let sendChatPayload: ((payload: unknown) => void) | null = null;

export function decideAgentProposal(proposalId: string, decision: 'accept' | 'reject'): void {
  if (!sendProposalDecision) return;
  useAgentBridgeStatus.getState().setStatus({
    activity:
      decision === 'accept' ? 'Applying accepted agent proposal…' : 'Rejecting agent proposal…',
  });
  sendProposalDecision({ type: 'proposal.decision', proposalId, decision });
}

export function sendAgentChat(text: string, references: AgentLayerReference[] = []): void {
  if (!sendChatPayload || !text.trim()) return;
  const turnId = crypto.randomUUID();
  const selection = useSelectionStore.getState();
  const timeline = useTimelineStore.getState();
  const activity = useAgentBridgeStatus.getState().activity;
  const projectId = useProjectStore.getState().project.id;
  const referencedLayerIds = references.map((reference) => reference.layerId);
  useAgentChatStore.getState().addEntry({
    id: `user-${turnId}`,
    turnId,
    kind: 'user',
    text: text.trim(),
  });
  useAgentChatStore.getState().setState({
    activeTurnId: turnId,
    activeTurnStartedAt: Date.now(),
    progress: {
      phase: 'sending',
      message: 'Sending request to the model',
      round: 0,
      updatedAt: Date.now(),
    },
  });
  sendChatPayload({
    type: 'chat.send',
    turnId,
    sessionId: `editor:${projectId}`,
    text: text.trim(),
    ambient: {
      selection: {
        layerIds: referencedLayerIds.length ? referencedLayerIds : selection.selectedLayerIds,
        primaryLayerId: referencedLayerIds[0] ?? selection.selectedLayerId,
      },
      ...(references.length ? { references } : {}),
      frame: timeline.currentFrame,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        zoom: Number(
          document.querySelector<HTMLElement>('.canvas-stage-viewport')?.dataset.ografZoom ?? 1,
        ),
      },
      recentEdits: activity && activity !== 'Agent connected' ? [activity] : [],
    },
  });
}

export function cancelAgentChat(): void {
  const turnId = useAgentChatStore.getState().activeTurnId;
  if (turnId) sendChatPayload?.({ type: 'chat.cancel', turnId });
}

export function setAgentChatExclusive(enabled: boolean): void {
  sendChatPayload?.({ type: 'chat.exclusive', enabled });
}

type BridgeMessage =
  | { type: 'editor.ack'; revision: number }
  | { type: 'heartbeat.request'; requestId: string }
  | {
      type: 'project.replace';
      revision: number;
      project: Project;
      source: string;
      reason?: string;
      summary?: { operationCount?: number; operationTypes?: string[] };
    }
  | { type: 'certification.request'; requestId: string; artifacts: ExportArtifacts }
  | { type: 'capture.request'; requestId: string; request: AgentCaptureRequest }
  | { type: 'strip.request'; requestId: string; request: AgentStripRequest }
  | { type: 'measure-text.request'; requestId: string; request: AgentMeasureTextRequest }
  | { type: 'proposal.present'; proposal: AgentAuthoringProposal }
  | {
      type: 'proposal.resolved';
      proposalId: string;
      result: { status: string; message: string; revision?: number };
    }
  | { type: 'editor.replaced'; message: string }
  | {
      type: 'chat.config';
      configured: boolean;
      exclusive: boolean;
      provider?: string;
      model?: string;
      message?: string;
    }
  | { type: 'chat.external'; active: boolean }
  | { type: 'chat.turn.start'; turnId: string }
  | {
      type: 'chat.progress';
      turnId: string;
      phase: 'waiting' | 'continuing';
      message: string;
      round: number;
    }
  | { type: 'chat.text'; turnId: string; text: string }
  | {
      type: 'chat.tool';
      turnId: string;
      callId: string;
      name: string;
      summary: string;
      status: 'running' | 'ok' | 'error';
    }
  | { type: 'chat.proposal'; turnId: string; proposalId: string }
  | { type: 'chat.turn.end'; turnId: string; stopReason: string; usage: ChatUsage }
  | { type: 'chat.error'; turnId: string; message: string };

const BRIDGE_URL = resolveAgentBridgeUrl(
  import.meta.env.VITE_OGRAF_AGENT_BRIDGE_URL,
  window.location,
);

/** Keeps the live browser document and the local MCP authoring session synchronized. */
export function useAgentBridge(): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let syncTimer: number | undefined;
    let stopped = false;
    let applyingRemote = false;
    let replaced = false;
    // Certification, raster capture, frame strips, and text measurement all exercise the same
    // browser renderer/font resources. Serialize them so a heavy strip cannot overlap a save gate
    // or leave shared renderer state half-disposed for the next request.
    let browserWorkQueue: Promise<void> = Promise.resolve();
    const status = useAgentBridgeStatus.getState().setStatus;

    const send = (payload: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };
    sendProposalDecision = send;
    sendChatPayload = send;

    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project === previous.project || applyingRemote) return;
      if (state.project.id !== previous.project.id) {
        useAgentChatStore.getState().setState({ projectUsage: readProjectUsage(state.project.id) });
      }
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        send({
          type: 'editor.project',
          project: useProjectStore.getState().project,
          reason: 'UI edit',
        });
      }, 150);
    });

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(BRIDGE_URL);
      socket.addEventListener('open', () => {
        if (stopped) {
          socket?.close();
          return;
        }
        status({ connected: true, authoritative: true, activity: 'Agent connected' });
        send({ type: 'editor.hello', project: useProjectStore.getState().project });
      });
      socket.addEventListener('message', async (event) => {
        let message: BridgeMessage;
        try {
          message = JSON.parse(String(event.data)) as BridgeMessage;
        } catch {
          return;
        }
        if (message.type === 'editor.ack') {
          status({ revision: message.revision });
          return;
        }
        if (message.type === 'editor.replaced') {
          replaced = true;
          status({ connected: false, authoritative: false, activity: message.message });
          return;
        }
        if (message.type === 'chat.config') {
          useAgentChatStore.getState().setState({
            configured: message.configured,
            exclusive: message.exclusive,
            provider: message.provider ?? null,
            model: message.model ?? null,
            configMessage: message.message ?? null,
            projectUsage: readProjectUsage(useProjectStore.getState().project.id),
          });
          return;
        }
        if (message.type === 'chat.external') {
          useAgentChatStore.getState().setState({ externalAgentActive: message.active });
          return;
        }
        if (message.type === 'chat.turn.start') {
          const chat = useAgentChatStore.getState();
          chat.setState({
            activeTurnId: message.turnId,
            activeTurnStartedAt: chat.activeTurnStartedAt ?? Date.now(),
            progress: {
              phase: 'waiting',
              message: 'Preparing model request',
              round: 1,
              updatedAt: Date.now(),
            },
          });
          return;
        }
        if (message.type === 'chat.progress') {
          useAgentChatStore.getState().setState({
            progress: {
              phase: message.phase,
              message: message.message,
              round: message.round,
              updatedAt: Date.now(),
            },
          });
          return;
        }
        if (message.type === 'chat.text') {
          useAgentChatStore.getState().addEntry({
            id: `assistant-${message.turnId}-${crypto.randomUUID()}`,
            turnId: message.turnId,
            kind: 'assistant',
            text: message.text,
          });
          return;
        }
        if (message.type === 'chat.tool') {
          const chat = useAgentChatStore.getState();
          const exists = chat.entries.some(
            (entry) => entry.turnId === message.turnId && entry.id === message.callId,
          );
          if (exists) chat.patchTool(message.turnId, message.callId, { status: message.status });
          else
            chat.addEntry({
              id: message.callId,
              turnId: message.turnId,
              kind: 'tool',
              text: message.summary,
              status: message.status,
            });
          chat.setState({
            progress:
              message.status === 'running'
                ? {
                    phase: 'tool',
                    message: `Running tool: ${message.summary}`,
                    round: chat.progress?.round ?? 1,
                    updatedAt: Date.now(),
                  }
                : {
                    phase: 'continuing',
                    message:
                      message.status === 'ok'
                        ? `Finished tool: ${message.summary}`
                        : `Tool reported an error: ${message.summary}`,
                    round: chat.progress?.round ?? 1,
                    updatedAt: Date.now(),
                  },
          });
          return;
        }
        if (message.type === 'chat.proposal') {
          useAgentChatStore.getState().addEntry({
            id: `proposal-${message.proposalId}`,
            turnId: message.turnId,
            kind: 'proposal',
            text: 'A design proposal is ready in the review panel.',
          });
          return;
        }
        if (message.type === 'chat.turn.end') {
          const chat = useAgentChatStore.getState();
          const sessionUsage = addUsage(chat.sessionUsage, message.usage);
          const projectId = useProjectStore.getState().project.id;
          const projectUsage = addUsage(readProjectUsage(projectId), message.usage);
          persistProjectUsage(projectId, projectUsage);
          chat.setState({
            activeTurnId: null,
            activeTurnStartedAt: null,
            progress: null,
            sessionUsage,
            projectUsage,
          });
          chat.addEntry({
            id: `usage-${message.turnId}`,
            turnId: message.turnId,
            kind: 'assistant',
            text: message.stopReason === 'cancelled' ? 'Cancelled.' : '',
            usage: message.usage,
          });
          return;
        }
        if (message.type === 'chat.error') {
          const chat = useAgentChatStore.getState();
          chat.setState({ activeTurnId: null, activeTurnStartedAt: null, progress: null });
          chat.addEntry({
            id: `error-${message.turnId}`,
            turnId: message.turnId,
            kind: 'error',
            text: message.message,
          });
          return;
        }
        if (message.type === 'heartbeat.request') {
          window.setTimeout(
            () => send({ type: 'heartbeat.result', requestId: message.requestId }),
            0,
          );
          return;
        }
        if (message.type === 'project.replace') {
          applyingRemote = true;
          useProjectStore.getState().loadProject(message.project);
          useSelectionStore.getState().select(null);
          resetHistory();
          applyingRemote = false;
          const count = message.summary?.operationCount;
          const detail = message.reason || message.summary?.operationTypes?.join(', ');
          const sourceLabel =
            message.source === 'agent'
              ? 'Agent'
              : message.source === 'undo'
                ? 'Agent undo'
                : message.source === 'redo'
                  ? 'Agent redo'
                  : 'Agent update';
          status({
            revision: message.revision,
            activity: `${sourceLabel}: ${count ? `${count} change${count === 1 ? '' : 's'}` : 'project updated'}${detail ? ` — ${detail}` : ''}`,
          });
          return;
        }
        if (message.type === 'proposal.present') {
          useAgentReviewStore.getState().present(message.proposal);
          status({ activity: `Review requested: ${message.proposal.title}` });
          return;
        }
        if (message.type === 'proposal.resolved') {
          useAgentReviewStore.getState().resolve(message.proposalId, message.result);
          status({
            revision: message.result.revision ?? useAgentBridgeStatus.getState().revision,
            activity: message.result.message,
          });
          return;
        }
        if (message.type === 'certification.request') {
          browserWorkQueue = browserWorkQueue
            .catch(() => undefined)
            .then(async () => {
              status({ activity: 'Agent requested OGraf certification…' });
              try {
                const result = await certifyExportArtifacts(message.artifacts);
                send({ type: 'certification.result', requestId: message.requestId, result });
                status({
                  activity: result.valid
                    ? 'Agent output OGraf certified'
                    : 'Agent output certification failed',
                });
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                send({
                  type: 'certification.result',
                  requestId: message.requestId,
                  result: { valid: false, checks: [], errors: [detail] },
                });
                status({ activity: 'Agent output certification failed' });
              }
            });
          return;
        }
        if (message.type === 'capture.request') {
          browserWorkQueue = browserWorkQueue
            .catch(() => undefined)
            .then(async () => {
              status({ activity: 'Agent requested PNG capture…' });
              try {
                const result = await captureAgentPng(message.request);
                send({ type: 'capture.result', requestId: message.requestId, result });
                status({ activity: 'Agent PNG capture ready' });
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                send({ type: 'capture.result', requestId: message.requestId, error: detail });
                status({ activity: 'Agent PNG capture failed' });
              }
            });
          return;
        }
        if (message.type === 'strip.request') {
          browserWorkQueue = browserWorkQueue
            .catch(() => undefined)
            .then(async () => {
              status({ activity: 'Agent requested PNG frame strip…' });
              try {
                const result = await renderAgentStripPng(message.request);
                send({ type: 'strip.result', requestId: message.requestId, result });
                status({ activity: 'Agent PNG frame strip ready' });
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                send({ type: 'strip.result', requestId: message.requestId, error: detail });
                status({ activity: 'Agent PNG frame strip failed' });
              }
            });
          return;
        }
        if (message.type === 'measure-text.request') {
          browserWorkQueue = browserWorkQueue
            .catch(() => undefined)
            .then(async () => {
              status({ activity: 'Agent requested text measurement…' });
              try {
                const result = await measureAgentText(message.request);
                send({ type: 'measure-text.result', requestId: message.requestId, result });
                status({ activity: 'Agent text measurement ready' });
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                send({ type: 'measure-text.result', requestId: message.requestId, error: detail });
                status({ activity: 'Agent text measurement failed' });
              }
            });
        }
      });
      socket.addEventListener('close', () => {
        // React StrictMode intentionally mounts, cleans up, and remounts effects in development.
        // The disposed bridge must not overwrite the status of its replacement connection.
        if (stopped) return;
        const chat = useAgentChatStore.getState();
        if (chat.activeTurnId) {
          chat.addEntry({
            id: `error-${chat.activeTurnId}-disconnect`,
            turnId: chat.activeTurnId,
            kind: 'error',
            text: 'The agent connection closed before the turn finished. Reconnect, then retry.',
          });
          chat.setState({ activeTurnId: null, activeTurnStartedAt: null, progress: null });
        }
        status({ connected: false, revision: null, activity: 'Agent bridge offline' });
        if (!replaced) reconnectTimer = window.setTimeout(connect, 3000);
      });
      socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(syncTimer);
      unsubscribe();
      if (sendProposalDecision === send) sendProposalDecision = null;
      if (sendChatPayload === send) sendChatPayload = null;
      socket?.close();
    };
  }, []);
}

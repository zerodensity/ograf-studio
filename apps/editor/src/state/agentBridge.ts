import { useAgentReviewStore, type AgentAuthoringProposal } from './agentReviewStore';
export { useAgentReviewStore, type AgentAuthoringProposal } from './agentReviewStore';
import { useEffect } from 'react';
import type { AgentAreaReference } from '@ograf-editor/agent-tools/chat-references';
import { resolveAgentBridgeUrl } from './agentBridgeUrl';
import { getTotalFrames, type Project } from '@ograf-editor/scene-model';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import { create } from 'zustand';
import { certifyExportArtifacts } from './ografCompatibility';
import { applyRemoteProjectUpdate } from './historyStore';
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
  areaReferences?: AgentAreaReference[];
  areaSummaries?: Array<{ number: number; frame: number; instruction: string }>;
}

export interface ChatProgress {
  phase: 'sending' | 'waiting' | 'continuing' | 'tool' | 'complete' | 'error';
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
  pendingAssistantText: string;
  sessionUsage: ChatUsage;
  projectUsage: ChatUsage;
  addEntry: (entry: ChatTranscriptEntry) => void;
  setState: (patch: Partial<Omit<AgentChatState, 'addEntry' | 'setState'>>) => void;
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
  pendingAssistantText: '',
  sessionUsage: EMPTY_USAGE,
  projectUsage: EMPTY_USAGE,
  addEntry: (entry) =>
    set((state) => ({
      entries: [
        ...state.entries.map((previous) =>
          entry.areaReferences && previous.areaReferences
            ? { ...previous, areaReferences: undefined }
            : previous,
        ),
        entry,
      ],
    })),
  setState: (patch) => set(patch),
}));

let sendProposalDecision: ((payload: unknown) => void) | null = null;
let sendChatPayload: ((payload: unknown) => void) | null = null;
type ProposalCapture = (
  request: AgentCaptureRequest,
  isCurrent: () => boolean,
) => Promise<Awaited<ReturnType<typeof captureAgentPng>> | null>;
const directProposalCapture: ProposalCapture = async (request, isCurrent) =>
  isCurrent() ? captureAgentPng(request) : null;
let proposalCapture = directProposalCapture;

/** Share the renderer queue with MCP capture/certification work. */
export function captureAgentProposal(request: AgentCaptureRequest, isCurrent: () => boolean) {
  return proposalCapture(request, isCurrent);
}

export function decideAgentProposal(proposalId: string, decision: 'accept' | 'reject'): void {
  const proposal = useAgentReviewStore.getState().proposals.find((item) => item.id === proposalId);
  const connection = useAgentBridgeStatus.getState();
  if (
    !sendProposalDecision ||
    !connection.connected ||
    !connection.authoritative ||
    !proposal ||
    proposal.deciding
  )
    return;
  if (decision === 'accept' && (!proposal.valid || proposal.staleReason || !proposal.previewReady))
    return;
  useAgentReviewStore.getState().update(proposalId, { deciding: decision });
  useAgentBridgeStatus.getState().setStatus({
    activity:
      decision === 'accept' ? 'Applying accepted agent proposal…' : 'Rejecting agent proposal…',
  });
  sendProposalDecision({ type: 'proposal.decision', proposalId, decision });
}

export function sendAgentChat(
  text: string,
  references: AgentLayerReference[] = [],
  areaReferences: AgentAreaReference[] = [],
): void {
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
    ...(areaReferences.length
      ? {
          areaSummaries: areaReferences.map((area, index) => ({
            number: index + 1,
            frame: area.frame,
            instruction: area.instruction ?? '',
          })),
        }
      : {}),
    ...(areaReferences.length ? { areaReferences } : {}),
  });
  useAgentChatStore.getState().setState({
    activeTurnId: turnId,
    pendingAssistantText: '',
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
    ...(areaReferences.length ? { areaReferences } : {}),
    ambient: {
      selection: {
        layerIds: areaReferences.length
          ? []
          : referencedLayerIds.length
            ? referencedLayerIds
            : selection.selectedLayerIds,
        primaryLayerId: areaReferences.length
          ? null
          : (referencedLayerIds[0] ?? selection.selectedLayerId),
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

/** Activity replaces one status line; it must never append or patch transcript rows. */
export function updateAgentChatActivity(
  message: Extract<
    BridgeMessage,
    { type: 'chat.progress' | 'chat.text' | 'chat.tool' | 'chat.proposal' }
  >,
): void {
  const chat = useAgentChatStore.getState();
  if (chat.activeTurnId !== message.turnId) return;
  let text: string;
  let phase: ChatProgress['phase'] = 'continuing';
  let round = chat.progress?.round ?? 1;
  if (message.type === 'chat.progress') {
    text = message.message;
    phase = message.phase;
    round = message.round;
  } else if (message.type === 'chat.tool') {
    text = `${message.status === 'running' ? 'Running' : message.status === 'ok' ? 'Done' : 'Error'}: ${message.summary}`;
    phase =
      message.status === 'running' ? 'tool' : message.status === 'error' ? 'error' : 'continuing';
  } else if (message.type === 'chat.proposal') {
    text = 'Proposal ready for review';
  } else {
    text = message.text;
  }
  chat.setState({
    progress: { phase, message: text, round, updatedAt: Date.now() },
    ...(message.type === 'chat.text' ? { pendingAssistantText: message.text } : {}),
  });
}

export function finishAgentChatTurn(
  message: Extract<BridgeMessage, { type: 'chat.turn.end' }>,
): void {
  const chat = useAgentChatStore.getState();
  if (chat.activeTurnId !== message.turnId) return;
  const projectId = useProjectStore.getState().project.id;
  const projectUsage = addUsage(readProjectUsage(projectId), message.usage);
  persistProjectUsage(projectId, projectUsage);
  const cancelled = message.stopReason === 'cancelled';
  chat.setState({
    activeTurnId: null,
    activeTurnStartedAt: null,
    pendingAssistantText: '',
    progress: {
      phase: 'complete',
      message: cancelled
        ? 'Cancelled'
        : useAgentReviewStore.getState().proposals.length
          ? 'Proposal ready for review'
          : 'Completed',
      round: chat.progress?.round ?? 1,
      updatedAt: Date.now(),
    },
    sessionUsage: addUsage(chat.sessionUsage, message.usage),
    projectUsage,
  });
  chat.addEntry({
    id: `assistant-${message.turnId}`,
    turnId: message.turnId,
    kind: 'assistant',
    text: cancelled ? 'Cancelled.' : chat.pendingAssistantText,
    usage: message.usage,
  });
}

type BridgeMessage =
  | { type: 'editor.ack'; revision: number }
  | { type: 'editor.error'; message: string }
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
    const queuedProposalCapture: ProposalCapture = (request, isCurrent) => {
      const result = browserWorkQueue
        .catch(() => undefined)
        .then(() => (isCurrent() ? captureAgentPng(request) : null));
      browserWorkQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    proposalCapture = queuedProposalCapture;
    const status = useAgentBridgeStatus.getState().setStatus;

    const send = (payload: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };
    sendProposalDecision = send;
    sendChatPayload = send;

    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project === previous.project || applyingRemote) return;
      useAgentReviewStore
        .getState()
        .invalidate('The template changed. Ask the assistant to regenerate this proposal.');
      if (state.project.id !== previous.project.id) {
        useAgentChatStore.getState().setState({ projectUsage: readProjectUsage(state.project.id) });
      }
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined;
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
          useAgentReviewStore
            .getState()
            .invalidate(
              'The template changed. Ask the assistant to regenerate this proposal.',
              message.revision,
            );
          const prior = useAgentBridgeStatus.getState();
          status({
            revision: message.revision,
            ...(prior.activity.startsWith('The editor update could not be synchronized:')
              ? { activity: 'Agent connected' }
              : {}),
          });
          return;
        }
        if (message.type === 'editor.error') {
          status({ activity: message.message });
          return;
        }
        if (message.type === 'editor.replaced') {
          useAgentReviewStore.getState().invalidate('This editor is no longer the active session.');
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
            pendingAssistantText: '',
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
        if (
          message.type === 'chat.progress' ||
          message.type === 'chat.text' ||
          message.type === 'chat.tool' ||
          message.type === 'chat.proposal'
        ) {
          updateAgentChatActivity(message);
          return;
        }
        if (message.type === 'chat.turn.end') {
          finishAgentChatTurn(message);
          return;
        }
        if (message.type === 'chat.error') {
          const chat = useAgentChatStore.getState();
          chat.setState({
            activeTurnId: null,
            activeTurnStartedAt: null,
            pendingAssistantText: '',
            progress: {
              phase: 'error',
              message: message.message,
              round: chat.progress?.round ?? 1,
              updatedAt: Date.now(),
            },
          });
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
          window.clearTimeout(syncTimer);
          syncTimer = undefined;
          useAgentReviewStore
            .getState()
            .invalidate(
              'The template changed. Ask the assistant to regenerate this proposal.',
              message.revision,
            );
          applyingRemote = true;
          try {
            applyRemoteProjectUpdate(message.project, message);
          } finally {
            applyingRemote = false;
          }
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
          const stale =
            syncTimer !== undefined ||
            message.proposal.baseRevision !== useAgentBridgeStatus.getState().revision;
          useTimelineStore.getState().controller?.pause();
          useTimelineStore.getState().setPreviewLoopLayerId(null);
          useAgentReviewStore
            .getState()
            .present(
              message.proposal,
              useProjectStore.getState().project,
              stale
                ? 'The template changed. Ask the assistant to regenerate this proposal.'
                : undefined,
            );
          status({ activity: `Review requested: ${message.proposal.title}` });
          return;
        }
        if (message.type === 'proposal.resolved') {
          const reviewed = useAgentReviewStore
            .getState()
            .proposals.find((item) => item.id === message.proposalId);
          if (message.result.status === 'accepted' && reviewed) {
            const state = useProjectStore.getState();
            const composition = state.project.compositions.find(
              (item) => item.id === (reviewed.compositionId ?? state.project.mainCompositionId),
            );
            if (composition) {
              useProjectStore.setState({ activeCompositionId: composition.id });
              useTimelineStore
                .getState()
                .setCurrentFrame(Math.min(reviewed.previewFrame, getTotalFrames(composition)));
            }
          }
          useAgentReviewStore.getState().resolve(message.proposalId, message.result);
          if (!useAgentChatStore.getState().activeTurnId)
            useAgentChatStore.getState().setState({
              progress: {
                phase: 'complete',
                message: message.result.message,
                round: 1,
                updatedAt: Date.now(),
              },
            });
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
        useAgentReviewStore
          .getState()
          .invalidate('Connection lost. Reconnect before reviewing this proposal.');
        const chat = useAgentChatStore.getState();
        if (chat.activeTurnId) {
          chat.addEntry({
            id: `error-${chat.activeTurnId}-disconnect`,
            turnId: chat.activeTurnId,
            kind: 'error',
            text: 'The agent connection closed before the turn finished. Reconnect, then retry.',
          });
          chat.setState({
            activeTurnId: null,
            activeTurnStartedAt: null,
            pendingAssistantText: '',
            progress: {
              phase: 'error',
              message: 'Connection lost',
              round: 1,
              updatedAt: Date.now(),
            },
          });
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
      if (proposalCapture === queuedProposalCapture) proposalCapture = directProposalCapture;
      socket?.close();
    };
  }, []);
}

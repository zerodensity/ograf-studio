import { useEffect } from 'react';
import type { Project } from '@ograf-editor/scene-model';
import type { ExportArtifacts } from '@ograf-editor/codegen';
import { create } from 'zustand';
import { certifyExportArtifacts } from './ografCompatibility';
import { resetHistory } from './historyStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import {
  captureAgentPng,
  measureAgentText,
  renderAgentStripPng,
  type AgentCaptureRequest,
  type AgentMeasureTextRequest,
  type AgentStripRequest,
} from './agentCapture';

interface AgentBridgeStatus {
  connected: boolean;
  revision: number | null;
  activity: string;
  setStatus: (patch: Partial<Omit<AgentBridgeStatus, 'setStatus'>>) => void;
}

export const useAgentBridgeStatus = create<AgentBridgeStatus>((set) => ({
  connected: false,
  revision: null,
  activity: 'Agent bridge offline',
  setStatus: (patch) => set(patch),
}));

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
  | { type: 'measure-text.request'; requestId: string; request: AgentMeasureTextRequest };

const BRIDGE_URL = import.meta.env.VITE_OGRAF_AGENT_BRIDGE_URL ?? 'ws://127.0.0.1:4318/editor';

/** Keeps the live browser document and the local MCP authoring session synchronized. */
export function useAgentBridge(): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let syncTimer: number | undefined;
    let stopped = false;
    let applyingRemote = false;
    let captureQueue: Promise<void> = Promise.resolve();
    const status = useAgentBridgeStatus.getState().setStatus;

    const send = (payload: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project === previous.project || applyingRemote) return;
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
        status({ connected: true, activity: 'Agent connected' });
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
        if (message.type === 'certification.request') {
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
          return;
        }
        if (message.type === 'capture.request') {
          captureQueue = captureQueue
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
          captureQueue = captureQueue
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
          captureQueue = captureQueue
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
        status({ connected: false, revision: null, activity: 'Agent bridge offline' });
        reconnectTimer = window.setTimeout(connect, 3000);
      });
      socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(syncTimer);
      unsubscribe();
      socket?.close();
    };
  }, []);
}

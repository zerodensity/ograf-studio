import type {
  TransitionLogicDefinition,
  TransitionLogicSelection,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor, CompiledLayer } from './descriptor';

/** Public controls for the coordinator. Missing slots retain their current selection. */
export interface TransitionLogicControlData {
  slots: Record<string, { stateId: string | null; data: Record<string, unknown> }>;
}

export interface CompiledTransitionLogicTemplate {
  id: string;
  name: string;
  descriptor: CompiledGraphicDescriptor;
  dataDefaults?: Record<string, unknown>;
  sharedLayers: Array<{ layerId: string; instanceId: string; sourceLayerId: string }>;
  /** Source public field key -> this template's public field key. */
  sharedDataBindings: Array<{ instanceId: string; fields: Record<string, string> }>;
}

/** Self-contained runtime contract for one coordinated OGraf graphic. */
export interface CompiledTransitionLogicDescriptor {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  definition: TransitionLogicDefinition;
  /** Baked numeric wrapper motion; incoming samples 0..D and outgoing D..2D. */
  contentAnimations?: Record<
    string,
    {
      incoming?: { layer: CompiledLayer; durationFrames: number };
      outgoing?: { layer: CompiledLayer; durationFrames: number };
    }
  >;
  templates: CompiledTransitionLogicTemplate[];
  sharedInstances: Array<{
    id: string;
    descriptor: CompiledGraphicDescriptor;
    dataDefaults?: Record<string, unknown>;
  }>;
  dataDefaults?: TransitionLogicControlData;
}

/** Off-air resource preparation. Taking uses this exact data snapshot. */
export interface CoordinatedPreparedSlot {
  slotId: string;
  stateId: string | null;
  templateId: string | null;
  data: Record<string, unknown>;
  requestId: string;
  status: 'preparing' | 'ready' | 'failed';
  error: string | null;
}

export interface CoordinatedPlayoutSlot {
  slotId: string;
  name: string;
  current: TransitionLogicSelection | null;
  desired: TransitionLogicSelection | null;
  outgoing: TransitionLogicSelection | null;
  incoming: TransitionLogicSelection | null;
  pending: {
    requestId: string;
    stateId: string | null;
    data: Record<string, unknown>;
    ready: boolean;
  } | null;
  readiness: 'idle' | 'preparing' | 'ready' | 'failed';
  error: string | null;
  transition: {
    id: string;
    requestId: string;
    transitionId: string;
    startFrame: number;
    endFrame: number;
    progress: number;
  } | null;
}

/** A detached JSON-safe copy; reading or subscribing cannot mutate the coordinator. */
export interface CoordinatedPlayoutSnapshot {
  loaded: boolean;
  definitionId: string | null;
  definitionRevision: string | null;
  frame: number;
  frameRate: number;
  renderType: 'realtime' | 'non-realtime';
  paused: boolean;
  recordingTruncated: boolean;
  /** null keeps authored deterministic clock reference times in ordinary offline exports. */
  clockEpochMs: number | null;
  error: string | null;
  slots: Record<string, CoordinatedPlayoutSlot>;
  prepared: Record<string, CoordinatedPreparedSlot>;
  /** Independent active loop transports; absent in descriptors from older runtimes. */
  loops?: Array<{ slotId: string; groupId: string; name: string; paused: boolean }>;
}

export interface CoordinatedPrepareSlotParams {
  slotId: string;
  /** null or an empty string means Off. */
  stateId: string | null;
  data?: Record<string, unknown>;
}

export interface CoordinatedTakePreparedSlotParams {
  slotId: string;
  skipAnimation?: boolean;
}

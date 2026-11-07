import { create } from 'zustand';
import type { FieldDefinition } from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from './projectSet';
import type { TestValue } from './testDataStore';
import type { TickerUpdateStatus } from '@ograf-editor/ograf-runtime';

/** A view of the mounted preview controller. No graphic instances or saved document state live here. */
export interface PlayoutControlsSession {
  tickerUpdates?: TickerUpdateStatus[];
  editorSynchronized?: boolean;
  templateName: string;
  templateIndex: number;
  templateCount: number;
  currentStep: number | undefined;
  stepCount: number;
  ready: boolean;
  loading: boolean;
  error: string;
  behaviorActive: boolean;
  behaviorLabel: string;
  projectSet: ProjectSetDocument | null;
  activeTemplateId: string | null;
  dataTemplateId: string | null;
  dataTemplateName: string;
  data: Record<string, TestValue>;
  fields: FieldDefinition[];
  values: Record<string, TestValue>;
  customActions: Array<{ id: string; name?: string }>;
  changeTemplate: (delta: -1 | 1) => void;
  play: (params: { delta?: number; goto?: number }) => void;
  out: () => void;
  customAction: (id: string) => void;
  updateData: (key: string, value: TestValue) => void;
  updateDataBatch?: (data: Record<string, TestValue>) => void;
  runRundown?: (
    rows: Array<Record<string, TestValue>>,
    options: { holdMs: number; signal: AbortSignal; onRow: (index: number) => void },
  ) => Promise<void>;
  navigate: (delta: -1 | 1) => void;
  canNavigate: () => boolean;
}

interface PlayoutControlsState {
  owner: object | null;
  session: PlayoutControlsSession | null;
}

export const usePlayoutControlsStore = create<PlayoutControlsState>(() => ({
  owner: null,
  session: null,
}));

export function publishPlayoutControls(owner: object, session: PlayoutControlsSession): void {
  usePlayoutControlsStore.setState({ owner, session });
}

export function unregisterPlayoutControls(owner: object): void {
  if (usePlayoutControlsStore.getState().owner === owner)
    usePlayoutControlsStore.setState({ owner: null, session: null });
}

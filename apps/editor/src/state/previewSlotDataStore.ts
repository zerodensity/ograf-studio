import { create } from 'zustand';
import type { CoordinatedPlayoutSlot } from '@ograf-editor/ograf-types';
import {
  compositionWithShaderParameterFields,
  type Composition,
  type FieldDefinition,
  type FieldValue,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import { resolveRuntimePreviewDataRecord, resolveStatePresetPreviewData } from './previewData';

interface PreviewSlotDataState {
  /** Only intentional operator edits, not inherited defaults or runtime feed data. */
  drafts: Record<string, Record<string, FieldValue>>;
  /** Most recent on-air values, including feed and Rule writes, retained after Out. */
  observed: Record<string, Record<string, FieldValue>>;
}

/** Shared by docked and fullscreen views; never persisted into a template or set. */
export const usePreviewSlotDataStore = create<PreviewSlotDataState>(() => ({
  drafts: {},
  observed: {},
}));

export function previewSlotDataKey(
  setId: string,
  definitionId: string,
  slotId: string,
  stateId: string,
  templateId?: string,
): string {
  return JSON.stringify([setId, definitionId, slotId, stateId, templateId ?? null]);
}

export function stagePreviewSlotField(key: string, field: string, value: FieldValue): void {
  usePreviewSlotDataStore.setState((state) => ({
    drafts: { ...state.drafts, [key]: { ...state.drafts[key], [field]: value } },
  }));
}

export function observePreviewSlotValues(key: string, values: Record<string, FieldValue>): void {
  usePreviewSlotDataStore.setState((state) =>
    state.observed[key] === values ? state : { observed: { ...state.observed, [key]: values } },
  );
}

export function forgetPreviewSlotObserved(setId: string): void {
  usePreviewSlotDataStore.setState((state) => {
    const observed = Object.fromEntries(
      Object.entries(state.observed).filter(([key]) => {
        try {
          return (JSON.parse(key) as string[])[0] !== setId;
        } catch {
          return true;
        }
      }),
    );
    return Object.keys(observed).length === Object.keys(state.observed).length
      ? state
      : { observed };
  });
}

/** Clear only values that have not been changed again since an async command started. */
export function acknowledgePreviewSlotFields(key: string, sent: Record<string, FieldValue>): void {
  usePreviewSlotDataStore.setState((state) => {
    const previous = state.drafts[key];
    if (!previous) return state;
    const next = { ...previous };
    for (const [field, value] of Object.entries(sent))
      if (JSON.stringify(previous[field]) === JSON.stringify(value)) delete next[field];
    const drafts = { ...state.drafts };
    if (Object.keys(next).length) drafts[key] = next;
    else delete drafts[key];
    return { drafts };
  });
}

const compositions = new WeakMap<ProjectSetDocument, Map<string, Composition | null>>();
const runtimeValues = new WeakMap<
  Composition,
  Map<string, { signature: string; values: Record<string, FieldValue> }>
>();

/** Progress snapshots do not require rehydrating unchanged field data. */
export function cachedPreviewSlotRuntimeData(
  composition: Composition,
  stateId: string,
  data: Record<string, unknown>,
): Record<string, FieldValue> {
  let entries = runtimeValues.get(composition);
  if (!entries) {
    entries = new Map();
    runtimeValues.set(composition, entries);
  }
  const signature = JSON.stringify(data);
  const previous = entries.get(stateId);
  if (previous?.signature === signature) return previous.values;
  const values = resolveRuntimePreviewDataRecord(composition, data);
  entries.set(stateId, { signature, values });
  return values;
}

export function previewSlotComposition(
  source: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  stateId: string,
): { composition: Composition; state: TransitionLogicDefinition['states'][number] } | null {
  const state = definition.states.find((item) => item.id === stateId);
  if (!state || !source.templates.some((template) => template.id === state.templateId)) return null;
  try {
    let cached = compositions.get(source);
    if (!cached) {
      cached = new Map();
      compositions.set(source, cached);
    }
    if (!cached.has(state.templateId)) {
      const project = resolveProjectSetTemplate(source, state.templateId);
      const composition = project.compositions.find(
        (entry) => entry.id === project.mainCompositionId,
      );
      cached.set(
        state.templateId,
        composition ? compositionWithShaderParameterFields(composition) : null,
      );
    }
    const composition = cached.get(state.templateId);
    return composition ? { composition, state } : null;
  } catch {
    return null;
  }
}

/** On-air values come from that lane's runtime; an off-air form starts with its state preset. */
export function resolvePreviewSlotForm(
  source: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  stateId: string,
  status: CoordinatedPlayoutSlot | undefined,
  draft: Record<string, FieldValue> | undefined,
): { fields: FieldDefinition[]; values: Record<string, FieldValue> } | null {
  const resolved = previewSlotComposition(source, definition, stateId);
  if (!resolved) return null;
  const { composition, state } = resolved;
  const selected = status?.incoming ?? status?.current ?? status?.outgoing;
  const key = previewSlotDataKey(
    source.id,
    definition.id,
    state.slotId,
    state.id,
    state.templateId,
  );
  const values =
    selected?.stateId === stateId
      ? cachedPreviewSlotRuntimeData(composition, state.id, selected.data)
      : (usePreviewSlotDataStore.getState().observed[key] ??
        resolveStatePresetPreviewData(composition, state.dataDefaults));
  const allowed = new Set(composition.dataFields.map((field) => field.key));
  const patch = Object.fromEntries(
    Object.entries(draft ?? {}).filter(([field]) => allowed.has(field)),
  );
  return { fields: composition.dataFields, values: { ...values, ...patch } };
}

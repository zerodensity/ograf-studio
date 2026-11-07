import { create } from 'zustand';
import type {
  Composition,
  DataConnectionDefinition,
  FieldValue,
  Project,
} from '@ograf-editor/scene-model';
import { createPublicMarketsReader } from '../data/publicMarketsReader';
import { readDataConnection } from './dataConnections';
import { createDataConnectionUpdateQueue } from './dataConnectionUpdateQueue';
import {
  createDataConnectionRuntime,
  type DataConnectionConsumer,
  type DataConnectionStatus,
} from './dataConnectionRuntimeCore';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import { useTestDataStore } from './testDataStore';
import {
  behaviorPreviewDataSource,
  updateBehaviorPreviewSlot,
  useBehaviorPreviewStore,
} from './behaviorPreviewStore';

export { type DataConnectionStatus } from './dataConnectionRuntimeCore';
export const connectionRuntimeKey = (
  projectId: string,
  compositionId: string,
  connectionId: string,
) => JSON.stringify([projectId, compositionId, connectionId]);
export const useDataConnectionRuntimeStore = create<{
  statuses: Record<string, DataConnectionStatus>;
}>(() => ({ statuses: {} }));

const resolvedProjects = new WeakMap<ProjectSetDocument, Map<string, Project>>();
function resolved(set: ProjectSetDocument, id: string): Project {
  let cache = resolvedProjects.get(set);
  if (!cache) resolvedProjects.set(set, (cache = new Map()));
  let project = cache.get(id);
  if (!project) cache.set(id, (project = resolveProjectSetTemplate(set, id)));
  return project;
}
const target = (connection: DataConnectionDefinition) => connection.target ?? 'editor-preview';
function previewRoutingStamp(state: ReturnType<typeof useBehaviorPreviewStore.getState>): string {
  return JSON.stringify([
    state.requestId,
    state.loading,
    state.snapshot?.loaded,
    state.snapshot?.paused,
    Object.values(state.snapshot?.slots ?? {}).map((slot) => [
      slot.slotId,
      slot.current?.templateId,
      slot.current?.stateId,
      slot.current?.instanceId,
      slot.incoming?.templateId,
      slot.incoming?.stateId,
      slot.incoming?.instanceId,
      Boolean(slot.transition),
      Boolean(slot.pending),
    ]),
  ]);
}
const fieldValues = (composition: Composition, data: Record<string, unknown> = {}) =>
  Object.fromEntries(
    composition.dataFields.map((field) => [
      field.id,
      (data[field.key] ?? field.defaultValue) as FieldValue,
    ]),
  );

let runtime: ReturnType<typeof createDataConnectionRuntime> | null = null;
let refreshTargets: (() => void) | null = null;
let stopRuntime: (() => void) | null = null;

/** Start once per Studio application, independent of mounted panes and fullscreen hosts. */
export function initializeDataConnectionRuntime(): () => void {
  if (runtime) return stopRuntime!;
  let stopped = false;
  let queued = false;
  let activeKeys = new Set<string>();
  const previewUpdates = createDataConnectionUpdateQueue();
  const consumerStatuses = new Map<string, { statusKey: string; status: DataConnectionStatus }>();
  const publish = () => {
    const statuses: Record<string, DataConnectionStatus> = {};
    for (const [key, value] of consumerStatuses) {
      if (!activeKeys.has(key)) continue;
      const previous = statuses[value.statusKey];
      const next = value.status;
      if (!previous) statuses[value.statusKey] = next;
      else
        statuses[value.statusKey] = {
          ...(next.phase === 'error' || previous.phase !== 'error' ? next : previous),
          updatedAt: Math.max(previous.updatedAt ?? 0, next.updatedAt ?? 0) || undefined,
          pending: previous.pending || next.pending,
        };
    }
    if (
      JSON.stringify(statuses) !== JSON.stringify(useDataConnectionRuntimeStore.getState().statuses)
    )
      useDataConnectionRuntimeStore.setState({ statuses });
  };
  runtime = createDataConnectionRuntime({
    createReader(connection) {
      if (connection.source === 'public-markets') {
        const provider = createPublicMarketsReader({
          symbols: connection.publicMarkets?.symbols,
        });
        return {
          read: (signal) => provider.fetchSnapshot({ signal }),
          dispose: provider.dispose,
          warning(payload) {
            const snapshot = payload as Record<string, unknown>;
            const failures =
              snapshot.errors && typeof snapshot.errors === 'object'
                ? Object.values(snapshot.errors)
                : [];
            if (failures.length) {
              const first = failures[0] as { message?: unknown };
              return `Market feed degraded · ${String(first.message ?? 'A provider request failed').slice(0, 220)} · last values retained`;
            }
            return snapshot.status === 'DEGRADED'
              ? 'Market feed delayed or unavailable · last values retained'
              : undefined;
          },
        };
      }
      return { read: (signal) => readDataConnection(connection, fetch, { signal }) };
    },
    status(consumer, status) {
      consumerStatuses.set(consumer.key, { statusKey: consumer.statusKey, status });
      publish();
    },
  });
  const reconcile = () => {
    if (stopped || !runtime) return;
    queued = false;
    const editor = useProjectStore.getState();
    const composition = getActiveComposition(editor.project, editor.activeCompositionId);
    const projectSetState = useProjectSetStore.getState();
    const set = projectSetState.projectSet;
    const preview = behaviorPreviewDataSource();
    const consumers: DataConnectionConsumer[] = [];
    const declared = new Map<string, DataConnectionStatus>();
    const declare = (project: Project, comp: Composition, connection: DataConnectionDefinition) => {
      const key = connectionRuntimeKey(project.id, comp.id, connection.id);
      declared.set(key, {
        phase: connection.enabled ? 'idle' : 'disabled',
        message: connection.enabled ? 'Ready · refresh to connect' : 'Disabled',
        pending: false,
      });
      return key;
    };
    for (const connection of composition.dataConnections ?? []) {
      const statusKey = declare(editor.project, composition, connection);
      if (!connection.enabled) continue;
      const editorTarget = target(connection) !== 'coordinated-preview';
      if (!editorTarget && preview?.source.id === set?.id) continue;
      consumers.push({
        key: `${editorTarget ? 'editor' : 'waiting'}:${statusKey}`,
        statusKey,
        version: JSON.stringify([
          editor.project.id,
          composition.id,
          connection,
          composition.dataFields,
        ]),
        connection,
        fields: composition.dataFields,
        previous: () => useTestDataStore.getState().values,
        apply(values) {
          if (!editorTarget) return false;
          const current = useProjectStore.getState();
          if (
            current.project.id !== editor.project.id ||
            current.activeCompositionId !== composition.id
          )
            return false;
          const changed = Object.fromEntries(
            Object.entries(values).filter(
              ([id, value]) =>
                JSON.stringify(useTestDataStore.getState().values[id]) !== JSON.stringify(value),
            ),
          );
          if (Object.keys(changed).length)
            useTestDataStore
              .getState()
              .setValues(
                changed,
                getActiveComposition(current.project, current.activeCompositionId).layers,
                composition.dataFields,
              );
          return true;
        },
      });
    }
    const behavior = useBehaviorPreviewStore.getState();
    if (preview && set?.id === preview.source.id) {
      for (const frozenTemplate of preview.source.templates) {
        const currentTemplate = set.templates.find((entry) => entry.id === frozenTemplate.id);
        if (!currentTemplate) continue;
        const frozenProject = resolved(preview.source, frozenTemplate.id);
        const frozenComposition = frozenProject.compositions.find(
          (entry) => entry.id === frozenProject.mainCompositionId,
        )!;
        const currentProject =
          projectSetState.activeTemplateId === frozenTemplate.id
            ? editor.project
            : resolved(set, frozenTemplate.id);
        const currentComposition = currentProject.compositions.find(
          (entry) => entry.id === frozenComposition.id,
        );
        if (!currentComposition) continue;
        const selections = Object.values(behavior.snapshot?.slots ?? {}).flatMap((slot) => {
          const selected = slot.incoming ?? slot.current;
          return selected?.templateId === frozenTemplate.id
            ? [{ slotId: slot.slotId, ...selected }]
            : [];
        });
        for (const connection of currentComposition.dataConnections ?? []) {
          const statusKey = declare(currentProject, currentComposition, connection);
          if (!connection.enabled || target(connection) === 'editor-preview') continue;
          consumers.push({
            key: `preview:${preview.sessionId}:${frozenTemplate.id}:${statusKey}`,
            statusKey,
            version: JSON.stringify([
              connection,
              frozenComposition.dataFields,
              selections.map(({ slotId, stateId, instanceId }) => [slotId, stateId, instanceId]),
            ]),
            connection,
            fields: frozenComposition.dataFields,
            previous() {
              const selection = Object.values(
                useBehaviorPreviewStore.getState().snapshot?.slots ?? {},
              )
                .map((slot) => slot.current)
                .find((item) => item?.templateId === frozenTemplate.id);
              return fieldValues(frozenComposition, selection?.data);
            },
            async apply(values) {
              const latest = useBehaviorPreviewStore.getState();
              if (
                latest.requestId !== preview.sessionId ||
                latest.loading ||
                latest.snapshot?.paused ||
                useProjectSetStore.getState().projectSet?.id !== preview.source.id
              )
                return false;
              const lanes = Object.values(latest.snapshot?.slots ?? {}).filter(
                (slot) =>
                  slot.current?.templateId === frozenTemplate.id &&
                  !slot.transition &&
                  !slot.pending,
              );
              if (!lanes.length) return false;
              if (
                connection.mappings.some(
                  (mapping) =>
                    !frozenComposition.dataFields.some((field) => field.id === mapping.fieldId),
                )
              )
                throw new Error('Replay the combined preview to use the new data fields.');
              const data = Object.fromEntries(
                frozenComposition.dataFields.flatMap((field) =>
                  Object.hasOwn(values, field.id) ? [[field.key, values[field.id]!]] : [],
                ),
              );
              const applied = await Promise.all(
                lanes.map(async (slot) => {
                  const changed = Object.fromEntries(
                    Object.entries(data).filter(
                      ([key, value]) =>
                        JSON.stringify(slot.current!.data[key]) !== JSON.stringify(value),
                    ),
                  );
                  if (!Object.keys(changed).length) return true;
                  const stateId = slot.current!.stateId;
                  const instanceId = slot.current!.instanceId;
                  return previewUpdates.enqueue({
                    slotId: slot.slotId,
                    identity: JSON.stringify([preview.sessionId, stateId, instanceId]),
                    data: changed,
                    valid() {
                      const state = useBehaviorPreviewStore.getState();
                      const selected = state.snapshot?.slots[slot.slotId];
                      const open = useProjectSetStore.getState();
                      if (
                        state.requestId !== preview.sessionId ||
                        state.loading ||
                        state.snapshot?.paused ||
                        open.projectSet?.id !== preview.source.id ||
                        selected?.current?.stateId !== stateId ||
                        selected.current.instanceId !== instanceId ||
                        selected.transition ||
                        selected.pending
                      )
                        return false;
                      const project =
                        open.activeTemplateId === frozenTemplate.id
                          ? useProjectStore.getState().project
                          : resolved(open.projectSet, frozenTemplate.id);
                      const configured = project.compositions
                        .find((item) => item.id === frozenComposition.id)
                        ?.dataConnections.find((item) => item.id === connection.id);
                      return (
                        !!configured?.enabled &&
                        JSON.stringify(configured) === JSON.stringify(connection)
                      );
                    },
                    update: (patch) =>
                      updateBehaviorPreviewSlot(slot.slotId, patch, stateId, 'in-place'),
                  });
                }),
              );
              return applied.every(Boolean);
            },
          });
        }
      }
    }
    activeKeys = new Set(consumers.map((consumer) => consumer.key));
    for (const key of consumerStatuses.keys())
      if (!activeKeys.has(key)) consumerStatuses.delete(key);
    for (const [key, status] of declared) {
      if (consumers.some((consumer) => consumer.statusKey === key)) continue;
      const marker = `declared:${key}`;
      activeKeys.add(marker);
      consumerStatuses.set(marker, { statusKey: key, status });
    }
    runtime.reconcile(consumers);
    publish();
  };
  const schedule = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(reconcile);
  };
  refreshTargets = reconcile;
  const unsubscribes = [
    useProjectStore.subscribe((next, previous) => {
      if (
        next.project !== previous.project ||
        next.activeCompositionId !== previous.activeCompositionId
      )
        schedule();
    }),
    useProjectSetStore.subscribe((next, previous) => {
      if (
        next.projectSet !== previous.projectSet ||
        next.activeTemplateId !== previous.activeTemplateId
      )
        schedule();
    }),
    useBehaviorPreviewStore.subscribe((next, previous) => {
      if (previewRoutingStamp(next) !== previewRoutingStamp(previous)) schedule();
    }),
  ];
  stopRuntime = () => {
    if (stopped) return;
    stopped = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    previewUpdates.dispose();
    runtime?.dispose();
    runtime = null;
    refreshTargets = null;
    stopRuntime = null;
    useDataConnectionRuntimeStore.setState({ statuses: {} });
  };
  reconcile();
  return stopRuntime;
}

export async function refreshDataConnection(
  projectId: string,
  compositionId: string,
  connectionId: string,
): Promise<void> {
  if (!runtime) initializeDataConnectionRuntime();
  refreshTargets?.();
  await runtime!.refresh(connectionRuntimeKey(projectId, compositionId, connectionId));
}
if (import.meta.hot) import.meta.hot.dispose(() => stopRuntime?.());

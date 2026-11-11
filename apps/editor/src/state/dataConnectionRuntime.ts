import { create } from 'zustand';
import { publicFieldValueForExport } from '@ograf-editor/codegen';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import {
  fieldExposedToOgraf,
  parseChartData,
  valueAtSourcePath,
  type Composition,
  type DataConnectionDefinition,
  type FieldValue,
  type Project,
} from '@ograf-editor/scene-model';
import { createPublicMarketsReader } from '../data/publicMarketsReader';
import { mapConnectionPayload, readDataConnection } from './dataConnections';
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
import { resolvePreviewFieldValue } from './previewFieldValue';
import { buildPreviewDataFromTestValues } from './previewData';
import {
  behaviorPreviewDataSource,
  updateBehaviorPreviewSlot,
  useBehaviorPreviewStore,
} from './behaviorPreviewStore';
import { useSharedPlayoutEditor } from './sharedPlayoutEditor';
import { publishSharedPlayoutFeed } from './sharedPlayoutPublish';

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
function previewRoutingStamp(snapshot: CoordinatedPlayoutSnapshot | null): string {
  return JSON.stringify([
    snapshot?.loaded,
    snapshot?.paused,
    Object.values(snapshot?.slots ?? {}).map((slot) => [
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

function sharedConnectionValues(composition: Composition, values: Record<string, FieldValue>) {
  const fields = composition.dataFields.filter(
    (field) => fieldExposedToOgraf(field) && Object.hasOwn(values, field.id),
  );
  const resolved = buildPreviewDataFromTestValues({ ...composition, dataFields: fields }, values);
  return Object.fromEntries(
    fields.map((field) => [field.key, publicFieldValueForExport(field, resolved[field.key]!)]),
  );
}

function changedConnectionValues(
  values: Record<string, FieldValue>,
  previous: Record<string, unknown>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value),
    ),
  );
}

interface CoordinatedConnectionDestination {
  id: string;
  source: ProjectSetDocument;
  shared: boolean;
  snapshot(): CoordinatedPlayoutSnapshot | null;
  update(
    slotId: string,
    stateId: string,
    patch: Record<string, FieldValue>,
  ): Promise<void | boolean>;
}

function validateChartConnectionUpdate(
  composition: Composition,
  values: Record<string, FieldValue>,
  destination: 'editor' | 'coordinated',
): void {
  for (const layer of composition.layers) {
    if (layer.element.type !== 'chart') continue;
    for (const binding of layer.bindings) {
      if (binding.targetProperty !== 'data' || !Object.hasOwn(values, binding.fieldId)) continue;
      const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
      if (!field) continue;
      const value = values[field.id];
      const root = destination === 'editor' ? resolvePreviewFieldValue(field, value) : value;
      const targets = [valueAtSourcePath(root, binding.sourcePath)];
      // The editor's frame player reads the field root. Its designer view can also read
      // the first array item, so validate both before publishing a shared preview value.
      if (destination === 'editor' && field.type === 'array' && Array.isArray(root))
        targets.push(valueAtSourcePath(root[0], binding.sourcePath));
      for (const target of new Set(targets)) {
        if (target === undefined) continue;
        try {
          parseChartData(binding.valueMap?.[String(target)] ?? target);
        } catch (error) {
          const detail =
            error instanceof SyntaxError
              ? 'Expected valid chart JSON.'
              : error instanceof Error
                ? error.message
                : String(error);
          const path = [field.key, ...(binding.sourcePath ?? [])].join('.');
          throw new Error(
            `Chart data invalid for "${layer.name}" at "${path}". ${detail} Last valid data retained. Correct the source and refresh.`,
          );
        }
      }
    }
  }
}

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
  const sharedLifetime = new AbortController();
  let singleFeed: { publicationId: string; values: Record<string, FieldValue> } | undefined;
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
    const { publicationId, publishedSource } = useSharedPlayoutEditor.getState();
    const destinations: CoordinatedConnectionDestination[] = [];
    if (preview && preview.source.id === set?.id) {
      destinations.push({
        id: `preview:${preview.sessionId}`,
        source: preview.source,
        shared: false,
        snapshot() {
          const latest = useBehaviorPreviewStore.getState();
          return latest.requestId === preview.sessionId && !latest.loading ? latest.snapshot : null;
        },
        update: (slotId, stateId, patch) =>
          updateBehaviorPreviewSlot(slotId, patch, stateId, 'in-place'),
      });
    }
    if (
      publicationId &&
      publishedSource &&
      'set' in publishedSource &&
      publishedSource.set.id === set?.id
    ) {
      destinations.push({
        id: `shared:${publicationId}`,
        source: publishedSource.set,
        shared: true,
        snapshot() {
          const latest = useSharedPlayoutEditor.getState();
          return latest.publicationId === publicationId ? latest.liveSnapshot : null;
        },
        update(slotId, stateId, patch) {
          return publishSharedPlayoutFeed(
            publicationId,
            { kind: 'slot', slotId, stateId },
            patch,
            sharedLifetime.signal,
          );
        },
      });
    }
    const sharedSingle =
      publicationId &&
      publishedSource &&
      'composition' in publishedSource &&
      publishedSource.project.id === editor.project.id &&
      publishedSource.composition.id === composition.id
        ? publishedSource.composition
        : null;
    if (sharedSingle && publicationId && singleFeed?.publicationId !== publicationId)
      singleFeed = { publicationId, values: fieldValues(sharedSingle) };
    if (!sharedSingle) singleFeed = undefined;
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
      if (!editorTarget && destinations.length) continue;
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
          const activeComposition = getActiveComposition(
            current.project,
            current.activeCompositionId,
          );
          const testData = useTestDataStore.getState();
          const changed = changedConnectionValues(values, testData.values);
          if (Object.keys(changed).length) {
            validateChartConnectionUpdate(activeComposition, changed, 'editor');
            testData.setValues(changed, activeComposition.layers, activeComposition.dataFields);
          }
          return true;
        },
      });
      if (editorTarget && sharedSingle && publicationId && singleFeed) {
        const feed = singleFeed;
        const connectionStamp = JSON.stringify(connection);
        const valid = () => {
          const open = useProjectStore.getState();
          const latest = useSharedPlayoutEditor.getState();
          return (
            latest.publicationId === publicationId &&
            open.documentLoadRevision === editor.documentLoadRevision &&
            open.project.id === editor.project.id &&
            open.activeCompositionId === composition.id &&
            getActiveComposition(open.project, open.activeCompositionId).dataConnections.some(
              (configured) =>
                configured.id === connection.id &&
                configured.enabled &&
                JSON.stringify(configured) === connectionStamp,
            )
          );
        };
        consumers.push({
          key: `shared:${publicationId}:${statusKey}`,
          statusKey,
          version: JSON.stringify([editor.documentLoadRevision, connectionStamp]),
          connection,
          fields: sharedSingle.dataFields,
          previous: () => feed.values,
          async apply(values) {
            if (!valid()) return false;
            if (
              connection.mappings.some(
                (mapping) => !sharedSingle.dataFields.some((field) => field.id === mapping.fieldId),
              )
            )
              throw new Error('Reopen the template to use the new data fields in shared preview.');
            const changed = changedConnectionValues(values, feed.values);
            const patch = sharedConnectionValues(sharedSingle, changed);
            if (!Object.keys(patch).length) return true;
            validateChartConnectionUpdate(sharedSingle, changed, 'editor');
            const applied = await previewUpdates.enqueue({
              slotId: `shared-graphic:${publicationId}`,
              identity: publicationId,
              data: patch,
              valid,
              update(data) {
                return publishSharedPlayoutFeed(
                  publicationId,
                  { kind: 'graphic' },
                  data,
                  sharedLifetime.signal,
                );
              },
            });
            if (applied) Object.assign(feed.values, changed);
            return applied;
          },
        });
      }
    }
    for (const destination of destinations) {
      if (!set) continue;
      for (const frozenTemplate of destination.source.templates) {
        const currentTemplate = set.templates.find((entry) => entry.id === frozenTemplate.id);
        if (!currentTemplate) continue;
        const frozenProject = resolved(destination.source, frozenTemplate.id);
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
        const selections = Object.values(destination.snapshot()?.slots ?? {}).flatMap((slot) => {
          const selected = slot.incoming ?? slot.current;
          return selected?.templateId === frozenTemplate.id
            ? [{ slotId: slot.slotId, ...selected }]
            : [];
        });
        for (const connection of currentComposition.dataConnections ?? []) {
          const statusKey = declare(currentProject, currentComposition, connection);
          if (!connection.enabled || target(connection) === 'editor-preview') continue;
          consumers.push({
            key: `${destination.id}:${frozenTemplate.id}:${statusKey}`,
            statusKey,
            version: JSON.stringify([
              connection,
              frozenComposition.dataFields,
              selections.map(({ slotId, stateId, instanceId }) => [slotId, stateId, instanceId]),
            ]),
            connection,
            fields: frozenComposition.dataFields,
            previous() {
              const selection = Object.values(destination.snapshot()?.slots ?? {})
                .map((slot) => slot.current)
                .find((item) => item?.templateId === frozenTemplate.id);
              return fieldValues(frozenComposition, selection?.data);
            },
            async apply(values, payload) {
              const latest = destination.snapshot();
              if (
                !latest?.loaded ||
                latest.paused ||
                useProjectSetStore.getState().projectSet?.id !== destination.source.id
              )
                return false;
              const lanes = Object.values(latest.slots).filter(
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
                throw new Error(
                  destination.shared
                    ? 'Reopen the template set to use the new data fields in shared preview.'
                    : 'Replay the combined preview to use the new data fields.',
                );
              if (!destination.shared)
                validateChartConnectionUpdate(frozenComposition, values, 'coordinated');
              const data = Object.fromEntries(
                frozenComposition.dataFields.flatMap((field) =>
                  Object.hasOwn(values, field.id) ? [[field.key, values[field.id]!]] : [],
                ),
              );
              const patches = lanes.map((slot) => {
                const current = slot.current!.data;
                if (!destination.shared)
                  return { slot, changed: changedConnectionValues(data, current) };
                // Missing source paths keep each on-air instance's own value, even when the
                // same template is taken into two lanes with different operator data.
                const previous = fieldValues(frozenComposition, current);
                const mapped = mapConnectionPayload(
                  connection,
                  frozenComposition.dataFields,
                  payload,
                  previous,
                );
                const changedFields = changedConnectionValues(mapped, previous);
                validateChartConnectionUpdate(frozenComposition, changedFields, 'coordinated');
                return { slot, changed: sharedConnectionValues(frozenComposition, changedFields) };
              });
              const applied = await Promise.all(
                patches.map(async ({ slot, changed }) => {
                  if (!Object.keys(changed).length) return true;
                  const stateId = slot.current!.stateId;
                  const instanceId = slot.current!.instanceId;
                  return previewUpdates.enqueue({
                    slotId: `${destination.id}:${slot.slotId}`,
                    identity: JSON.stringify([stateId, instanceId]),
                    data: changed,
                    valid() {
                      const state = destination.snapshot();
                      const selected = state?.slots[slot.slotId];
                      const open = useProjectSetStore.getState();
                      if (
                        !state?.loaded ||
                        state.paused ||
                        open.projectSet?.id !== destination.source.id ||
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
                    update: (patch) => destination.update(slot.slotId, stateId, patch),
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
      if (
        next.requestId !== previous.requestId ||
        next.loading !== previous.loading ||
        previewRoutingStamp(next.snapshot) !== previewRoutingStamp(previous.snapshot)
      )
        schedule();
    }),
    useSharedPlayoutEditor.subscribe((next, previous) => {
      if (
        next.publicationId !== previous.publicationId ||
        next.publishedSource !== previous.publishedSource ||
        (next.liveSnapshot !== previous.liveSnapshot &&
          previewRoutingStamp(next.liveSnapshot) !== previewRoutingStamp(previous.liveSnapshot))
      )
        schedule();
    }),
  ];
  stopRuntime = () => {
    if (stopped) return;
    stopped = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    sharedLifetime.abort();
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

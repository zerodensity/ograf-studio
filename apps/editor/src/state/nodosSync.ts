import { create } from 'zustand';
import type { Project } from '@ograf-editor/scene-model';
import { sendNodosPreset, useAgentBridgeStatus } from './agentBridge';
import { buildNodosPreset } from './exportPackage';
import { nodosTemplatePresetName } from './nodosPreset';
import { clearNodosTypes, loadNodosTypes } from './nodosTypes';
import { resolveProjectSetTemplate } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';

const STORAGE_KEY = 'ograf-studio:nodos:v1';
const UPDATE_DELAY_MS = 1500;
export const DEFAULT_NODOS_ADDRESS = 'localhost:11003';

/** Studio-local choices. Assigned names survive unticking and template renames. */
export interface NodosPreferences {
  enabled: boolean;
  address: string;
  category: string;
  presets: Record<string, string>;
  assignedPresets: Record<string, string>;
}
export interface NodosTemplate {
  id: string;
  name: string;
  project: Project;
}
const DEFAULT_PREFERENCES: NodosPreferences = {
  enabled: false,
  address: DEFAULT_NODOS_ADDRESS,
  category: 'OGraf',
  presets: {},
  assignedPresets: {},
};
function validNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, name]) =>
        !!id &&
        !['__proto__', 'constructor', 'prototype'].includes(id) &&
        typeof name === 'string' &&
        /^[A-Za-z0-9_.]+$/.test(name),
    ),
  );
}
function unusedName(templateId: string, used: Set<string>): string {
  const base = nodosTemplatePresetName(templateId);
  let name = base;
  for (let suffix = 2; used.has(name); suffix++) name = `${base}_${suffix}`;
  return name;
}
function loadPreferences(): NodosPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<NodosPreferences> | null) : null;
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_PREFERENCES };
    const selected = validNames(stored.presets);
    const assigned = { ...selected, ...validNames(stored.assignedPresets) };
    const used = new Set<string>();
    for (const [id, name] of Object.entries(assigned)) {
      // Keep unambiguous legacy classes. One duplicate slug cannot belong to two templates.
      assigned[id] = name.length > 128 || used.has(name) ? unusedName(id, used) : name;
      used.add(assigned[id]!);
    }
    return {
      enabled: stored.enabled === true,
      address:
        typeof stored.address === 'string' && stored.address.trim()
          ? stored.address.trim()
          : DEFAULT_NODOS_ADDRESS,
      category:
        typeof stored.category === 'string' && stored.category.trim()
          ? stored.category.trim()
          : DEFAULT_PREFERENCES.category,
      presets: Object.fromEntries(Object.keys(selected).map((id) => [id, assigned[id]!])),
      assignedPresets: assigned,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
function savePreferences(preferences: NodosPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* Without browser storage choices last until the page reloads. */
  }
}
export const useNodos = create<NodosPreferences & { status: Record<string, string> }>(() => ({
  ...loadPreferences(),
  status: {},
}));
function preferences(): NodosPreferences {
  const { enabled, address, category, presets, assignedPresets } = useNodos.getState();
  return { enabled, address, category, presets, assignedPresets };
}

/** The two stores publish separately during activation; never pair old content with a new template ID. */
export function openTemplates(): NodosTemplate[] {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  const active = useProjectStore.getState().project;
  if (!projectSet) return [{ id: active.id, name: active.name || 'Untitled', project: active }];
  return projectSet.templates.map((template) => ({
    id: template.id,
    name: template.name,
    project:
      template.id === activeTemplateId && template.project.id === active.id
        ? active
        : template.project,
  }));
}
interface TemplateInput extends NodosTemplate {
  documentId: string;
  dependencies: readonly unknown[];
}
/** Compare immutable references, not serialized scenes or resolved copies, on every edit. */
function inputs(): Map<string, TemplateInput> {
  const { projectSet } = useProjectSetStore.getState();
  const shared = projectSet
    ? [
        projectSet.settings,
        projectSet.brandKit,
        projectSet.controls,
        projectSet.assetSlots,
        projectSet.assets,
        projectSet.componentAssets,
      ]
    : [];
  const sources = new Map(projectSet?.templates.map((template) => [template.id, template]));
  return new Map(
    openTemplates().map((template) => {
      const source = sources.get(template.id);
      return [
        template.id,
        {
          ...template,
          documentId: projectSet ? `set:${projectSet.id}` : `project:${template.project.id}`,
          dependencies: [
            ...shared,
            source?.inheritSettings,
            source?.settingsOverrides,
            source?.brandKitOverrides,
            source?.typographyOverrides,
            source?.backgroundOverrides,
            source?.backgroundOverridden,
          ],
        },
      ];
    }),
  );
}
function sameInput(a: TemplateInput | undefined, b: TemplateInput): boolean {
  return (
    !!a &&
    a.documentId === b.documentId &&
    a.name === b.name &&
    a.project === b.project &&
    a.dependencies.length === b.dependencies.length &&
    a.dependencies.every((value, index) => value === b.dependencies[index])
  );
}
function playedProject(template: NodosTemplate): Project {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  const active = useProjectStore.getState().project;
  return projectSet && (template.id !== activeTemplateId || active.id !== template.project.id)
    ? resolveProjectSetTemplate(projectSet, template.id)
    : template.project;
}
function setStatus(templateId: string, message: string): void {
  useNodos.setState((state) => ({ status: { ...state.status, [templateId]: message } }));
}
interface SendJob {
  revision: number;
  running: boolean;
  queued: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}
const jobs = new Map<string, SendJob>();
let observed = inputs();
let disposed = false;
function cancel(templateId: string): void {
  const job = jobs.get(templateId);
  if (!job) return;
  job.revision++;
  job.queued = false;
  clearTimeout(job.timer);
  job.timer = undefined;
}
function requestSend(templateId: string, delay = 0): void {
  if (disposed) return;
  let job = jobs.get(templateId);
  if (!job)
    jobs.set(templateId, (job = { revision: 0, running: false, queued: false, timer: undefined }));
  job.revision++;
  job.queued = true;
  clearTimeout(job.timer);
  job.timer = undefined;
  if (delay)
    job.timer = setTimeout(() => {
      job.timer = undefined;
      void send(templateId, job);
    }, delay);
  else void send(templateId, job);
}
async function send(templateId: string, job: SendJob): Promise<void> {
  if (disposed || job.running || !job.queued || job.timer !== undefined) return;
  job.queued = false;
  const { enabled, address, category, presets } = preferences();
  const presetName = presets[templateId],
    template = observed.get(templateId);
  if (!enabled || !presetName || !template) return;
  if (!useAgentBridgeStatus.getState().connected) {
    setStatus(templateId, 'Waiting for Studio server…');
    return;
  }
  const revision = job.revision;
  const current = () =>
    !disposed &&
    revision === job.revision &&
    useAgentBridgeStatus.getState().connected &&
    useNodos.getState().enabled &&
    useNodos.getState().address === address &&
    useNodos.getState().category === category &&
    useNodos.getState().presets[templateId] === presetName &&
    sameInput(observed.get(templateId), template);
  job.running = true;
  setStatus(templateId, 'Updating Nodos…');
  try {
    const project = structuredClone(playedProject(template));
    const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
    if (!composition) throw new Error('The template has no main composition.');
    const built = await buildNodosPreset(project, composition, {
      displayName: template.name,
      category,
    });
    // Thumbnail/certification work can outlive the selection, document or engine address.
    if (!current()) return;
    const result = await sendNodosPreset({
      address,
      preset: { ...built.preset, name: presetName },
      files: built.files,
    });
    if (current()) setStatus(templateId, result.ok ? `In Nodos as ${presetName}` : result.message);
  } catch (error) {
    if (current()) setStatus(templateId, error instanceof Error ? error.message : String(error));
  } finally {
    job.running = false;
    // A newer edit keeps its debounce deadline. Never retry the obsolete snapshot.
    if (job.queued && job.timer === undefined) void send(templateId, job);
  }
}
function sendAll(): void {
  observed = inputs();
  for (const id of jobs.keys()) cancel(id);
  const { enabled, address } = preferences();
  if (enabled && useAgentBridgeStatus.getState().connected) void loadNodosTypes(address);
  else clearNodosTypes();
  if (!enabled) return;
  for (const template of observed.values())
    if (preferences().presets[template.id]) requestSend(template.id);
}
export function updateNodosPreferences(
  patch: Partial<Pick<NodosPreferences, 'enabled' | 'address' | 'category'>>,
): void {
  if (
    Object.entries(patch).every(
      ([key, value]) => preferences()[key as keyof NodosPreferences] === value,
    )
  )
    return;
  useNodos.setState(patch);
  savePreferences(preferences());
  sendAll();
}
export function chooseNodosTemplate(template: NodosTemplate, chosen: boolean): void {
  if (!openTemplates().some((candidate) => candidate.id === template.id)) return;
  const { presets: selected, assignedPresets: assigned } = preferences();
  if (!!selected[template.id] === chosen) return;
  const presets = { ...selected },
    assignedPresets = { ...assigned };
  if (chosen) {
    assignedPresets[template.id] ??= unusedName(
      template.id,
      new Set(Object.values(assignedPresets)),
    );
    presets[template.id] = assignedPresets[template.id]!;
  } else delete presets[template.id];
  useNodos.setState({ presets, assignedPresets });
  savePreferences(preferences());
  observed = inputs();
  if (chosen) requestSend(template.id);
  else cancel(template.id);
}
function onDocumentChange(): void {
  const next = inputs(),
    { enabled, presets } = preferences();
  for (const id of observed.keys()) if (!next.has(id)) cancel(id);
  for (const [id, template] of next) {
    if (sameInput(observed.get(id), template)) continue;
    if (enabled && presets[id]) requestSend(id, UPDATE_DELAY_MS);
    else cancel(id);
  }
  observed = next;
}
const unsubscribers = [
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project) onDocumentChange();
  }),
  useProjectSetStore.subscribe((state, previous) => {
    if (
      state.projectSet !== previous.projectSet ||
      state.activeTemplateId !== previous.activeTemplateId
    )
      onDocumentChange();
  }),
  useAgentBridgeStatus.subscribe((state, previous) => {
    if (state.connected === previous.connected) return;
    if (state.connected) sendAll();
    else {
      clearNodosTypes();
      for (const id of jobs.keys()) cancel(id);
      for (const template of observed.values())
        if (preferences().enabled && preferences().presets[template.id])
          setStatus(template.id, 'Waiting for Studio server…');
    }
  }),
];
if (useAgentBridgeStatus.getState().connected) queueMicrotask(sendAll);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    clearNodosTypes();
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    for (const id of jobs.keys()) cancel(id);
  });

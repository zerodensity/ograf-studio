import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentDefinition, TransitionLogicDefinition } from '@ograf-editor/scene-model';
import {
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  validateProjectSetDocument,
  type ProjectSetDocument,
} from './projectSet';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import { runDiscreteHistoryStep } from './historyStore';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import {
  applyTransitionLogicDefinition,
  createDefaultTransitionLogic,
  createTransitionLogicTemplateSet,
  transitionLogicEditorComponents,
  transitionLogicEditorErrors,
  transitionLogicEditorSetSnapshot,
} from './transitionLogicEditing';
import {
  transitionLogicDraftChanged,
  transitionLogicFingerprint,
  useTransitionLogicDraftStore,
} from './transitionLogicDraftStore';

type EditTransitionDefinition = (change: (definition: TransitionLogicDefinition) => void) => void;

export interface TransitionRuleCommitOptions {
  expectedFingerprint?: string;
  initialize?: boolean;
}

export type TransitionRuleCommitResult =
  { ok: true; definition: TransitionLogicDefinition } | { ok: false; error: string };

export interface TransitionRuleAuthoring {
  projectSet: ProjectSetDocument | null;
  /** Includes unsaved changes in the active template. The separate definition is the draft. */
  snapshot: ProjectSetDocument | null;
  activeTemplateId: string | null;
  definition: TransitionLogicDefinition | null;
  components: ComponentDefinition[];
  errors: string[];
  dirty: boolean;
  conflict: boolean;
  loading: boolean;
  edit: EditTransitionDefinition;
  commit: (
    update: (definition: TransitionLogicDefinition) => TransitionLogicDefinition,
    options?: TransitionRuleCommitOptions,
  ) => TransitionRuleCommitResult;
  apply: () => boolean;
  revert: () => void;
  enable: () => boolean;
  createSet: () => boolean;
  error: string;
  clearError: () => void;
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Shared Rules toolbar state; the existing session draft remains the only authoring copy. */
export function useTransitionRuleAuthoring(): TransitionRuleAuthoring {
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const currentProject = useProjectStore((state) => state.project);
  const currentProjectId = currentProject.id;
  const setId = projectSet?.id;
  const applied = projectSet?.transitionLogic;
  const draft = useTransitionLogicDraftStore((state) => (setId ? state.drafts[setId] : undefined));
  const sync = useTransitionLogicDraftStore((state) => state.sync);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (setId) sync(setId, applied);
  }, [setId, applied, sync]);
  useEffect(() => setActionError(''), [setId]);

  // A null draft is a pending removal, not permission to fall back to the applied graph.
  const definition = draft ? draft.definition : (applied ?? null);
  const derived = useMemo(() => {
    if (!projectSet) return { snapshot: null, components: [], error: '' };
    try {
      const snapshot = transitionLogicEditorSetSnapshot(projectSet, currentProject);
      const components = transitionLogicEditorComponents(snapshot, currentProject);
      return {
        snapshot,
        components,
        error: '',
      };
    } catch (cause) {
      return { snapshot: null, components: [], error: errorMessage(cause) };
    }
  }, [projectSet, currentProject]);
  const errors = useMemo(
    () =>
      derived.snapshot && definition
        ? transitionLogicEditorErrors(derived.snapshot, definition, derived.components)
        : [],
    [derived.snapshot, derived.components, definition],
  );
  const dirty = !!draft && transitionLogicDraftChanged(draft);
  const conflict = !!draft && dirty && draft.baseline !== transitionLogicFingerprint(applied);
  const clearError = useCallback(() => setActionError(''), []);
  const run = useCallback((action: () => void): boolean => {
    try {
      setActionError('');
      action();
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause));
      return false;
    }
  }, []);

  const currentSession = useCallback(() => {
    const current = useProjectSetStore.getState().projectSet;
    if (!setId || !current || current.id !== setId)
      throw new Error(
        'The template set changed. Select the current template before editing its transition rules.',
      );
    const drafts = useTransitionLogicDraftStore.getState();
    drafts.sync(current.id, current.transitionLogic);
    const currentDraft = useTransitionLogicDraftStore.getState().drafts[current.id];
    if (!currentDraft) throw new Error('Transition definitions are still loading. Try again.');
    return { current, currentDraft };
  }, [setId]);

  const editableSession = useCallback(() => {
    const session = currentSession();
    if (
      transitionLogicDraftChanged(session.currentDraft) &&
      session.currentDraft.baseline !== transitionLogicFingerprint(session.current.transitionLogic)
    )
      throw new Error(
        'The applied playout transitions changed. Revert to the current definitions before editing or applying this draft.',
      );
    return session;
  }, [currentSession]);

  const edit = useCallback<EditTransitionDefinition>(
    (change) => {
      run(() => {
        const { current, currentDraft } = editableSession();
        if (!currentDraft.definition)
          throw new Error('Set up playout transitions before editing template transition rules.');
        useTransitionLogicDraftStore.getState().edit(current.id, change);
      });
    },
    [editableSession, run],
  );

  /** Direct rule edits publish only their own change; an existing advanced draft stays private. */
  const commit = useCallback<TransitionRuleAuthoring['commit']>(
    (update, options = {}) => {
      try {
        setActionError('');
        if (!setId && options.initialize && !useProjectSetStore.getState().projectSet) {
          const project = useProjectStore.getState().project;
          if (project.id !== currentProjectId)
            throw new Error(
              'The current template changed. Add the transition rule again from that template.',
            );
          if (
            options.expectedFingerprint !== undefined &&
            options.expectedFingerprint !== transitionLogicFingerprint(null)
          )
            throw new Error(
              'The transition definitions changed. Add the rule again from the current template.',
            );
          // Build and validate before publishing so a failed first rule leaves the standalone
          // template untouched. The set and initial graph enter history as one explicit Add.
          const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, project);
          const components = componentLibraryFromTemplates(created);
          if (components.length) created.componentAssets = components;
          const definition = update(createDefaultTransitionLogic(created));
          const errors = transitionLogicEditorErrors(created, definition, components);
          if (errors.length) throw new Error(errors.join(' '));
          created.transitionLogic = structuredClone(definition);
          validateProjectSetDocument(created);
          if (
            useProjectSetStore.getState().projectSet ||
            useProjectStore.getState().project.id !== currentProjectId
          )
            throw new Error('The current template changed while the rule was being created.');
          runDiscreteHistoryStep(() => {
            const session = useProjectSetStore.getState();
            session.setProjectSet(created);
            session.setActiveTemplateId(created.templates[0]!.id);
          }, 'Create Template Transition Rules');
          useTransitionLogicDraftStore.getState().sync(created.id, created.transitionLogic);
          return { ok: true, definition: structuredClone(definition) };
        }
        const { current, currentDraft } = editableSession();
        if (transitionLogicDraftChanged(currentDraft))
          throw new Error(
            'There are unapplied transition changes. Apply or revert that draft in Advanced settings before editing this rule.',
          );
        const fingerprint = transitionLogicFingerprint(current.transitionLogic);
        if (
          options.expectedFingerprint !== undefined &&
          options.expectedFingerprint !== fingerprint
        )
          throw new Error(
            'This transition rule changed while you were editing it. Reload the rule before saving.',
          );
        if (!current.transitionLogic && !options.initialize)
          throw new Error('Enable template transitions before editing this rule.');
        const snapshot = transitionLogicEditorSetSnapshot(current);
        const source = current.transitionLogic ?? createDefaultTransitionLogic(snapshot);
        const updated = update(structuredClone(source));
        const errors = transitionLogicEditorErrors(snapshot, updated);
        if (errors.length) throw new Error(errors.join(' '));
        if (transitionLogicFingerprint(updated) !== fingerprint) {
          applyTransitionLogicDefinition(updated, { setId: current.id, baseline: fingerprint });
          const latest = useProjectSetStore.getState().projectSet;
          if (!latest || latest.id !== current.id || !latest.transitionLogic)
            throw new Error('The template set changed while this rule was being saved.');
          useTransitionLogicDraftStore.getState().reset(latest.id, latest.transitionLogic);
          return { ok: true, definition: structuredClone(latest.transitionLogic) };
        }
        return { ok: true, definition: updated };
      } catch (cause) {
        const error = errorMessage(cause);
        setActionError(error);
        return { ok: false, error };
      }
    },
    [currentProjectId, editableSession, setId],
  );

  const apply = useCallback(
    () =>
      run(() => {
        const { current, currentDraft } = editableSession();
        const snapshot = transitionLogicEditorSetSnapshot(current);
        const errors = currentDraft.definition
          ? transitionLogicEditorErrors(snapshot, currentDraft.definition)
          : [];
        if (errors.length) throw new Error(errors.join(' '));
        if (!transitionLogicDraftChanged(currentDraft)) return;
        applyTransitionLogicDefinition(currentDraft.definition, {
          setId: current.id,
          baseline: currentDraft.baseline,
        });
        const latest = useProjectSetStore.getState().projectSet;
        if (latest?.id === current.id)
          useTransitionLogicDraftStore.getState().reset(latest.id, latest.transitionLogic);
      }),
    [editableSession, run],
  );

  const revert = useCallback(() => {
    run(() => {
      const { current } = currentSession();
      useTransitionLogicDraftStore.getState().reset(current.id, current.transitionLogic);
    });
  }, [currentSession, run]);

  const enable = useCallback(
    () =>
      run(() => {
        const { current, currentDraft } = editableSession();
        if (currentDraft.definition) return;
        const snapshot = transitionLogicEditorSetSnapshot(current);
        useTransitionLogicDraftStore
          .getState()
          .replace(current.id, createDefaultTransitionLogic(snapshot));
      }),
    [editableSession, run],
  );

  const createSet = useCallback(
    () =>
      run(() => {
        const current = useProjectSetStore.getState().projectSet;
        if (current) {
          if (current.id !== setId)
            throw new Error('A template set was opened. Use its existing transition rules.');
          return;
        }
        if (setId)
          throw new Error(
            'The template set was closed. Select the current template before creating a set.',
          );
        createTransitionLogicTemplateSet();
        const created = useProjectSetStore.getState().projectSet;
        if (created)
          useTransitionLogicDraftStore.getState().sync(created.id, created.transitionLogic);
      }),
    [setId, run],
  );

  return {
    projectSet,
    snapshot: derived.snapshot,
    activeTemplateId,
    definition,
    components: derived.components,
    errors,
    dirty,
    conflict,
    loading: !!projectSet && !draft,
    edit,
    commit,
    apply,
    revert,
    enable,
    createSet,
    error: actionError || derived.error,
    clearError,
  };
}

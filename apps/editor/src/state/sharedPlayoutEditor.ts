import { create } from 'zustand';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import { isUntouchedBlankTiming } from './newTemplateTiming';
import { useProjectSetStore } from './projectSetStore';
import { getActiveComposition, useProjectStore } from './projectStore';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';
import {
  buildSharedPlayoutPreview,
  getSharedPlayoutLinks,
  publishSharedPlayout,
  type SharedPlayoutLinks,
  type SharedPlayoutSource,
} from './sharedPlayoutPublish';

interface SharedPlayoutEditorState {
  checking: boolean;
  links: SharedPlayoutLinks | null;
  preparingName: string | null;
  publicationName: string | null;
  publicationId: string | null;
  publishedSource: SharedPlayoutSource | null;
  liveSnapshot: CoordinatedPlayoutSnapshot | null;
  error: string;
  retry: (() => void) | null;
}

const initialState: SharedPlayoutEditorState = {
  checking: true,
  links: null,
  preparingName: null,
  publicationName: null,
  publicationId: null,
  publishedSource: null,
  liveSnapshot: null,
  error: '',
  retry: null,
};

export const useSharedPlayoutEditor = create<SharedPlayoutEditorState>(() => initialState);

export function setSharedPlayoutLiveSnapshot(
  publicationId: string,
  snapshot: CoordinatedPlayoutSnapshot | null,
): void {
  useSharedPlayoutEditor.setState((state) =>
    state.publicationId === publicationId && state.liveSnapshot !== snapshot
      ? { liveSnapshot: snapshot }
      : state,
  );
}

interface PreviewTarget {
  key: string;
  name: string;
  source: SharedPlayoutSource;
}

function currentTarget(previous: PreviewTarget | null): PreviewTarget | null {
  const { project, activeCompositionId, documentLoadRevision } = useProjectStore.getState();
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  const template = projectSet?.templates.find((item) => item.id === activeTemplateId);
  if (projectSet && template?.project.id !== project.id) return null;
  if (projectSet?.transitionLogic) {
    const key = JSON.stringify(['set', documentLoadRevision, projectSet.id]);
    if (previous?.key === key) return previous;
    return {
      key,
      name: projectSet.name,
      source: { set: structuredClone(transitionLogicEditorSetSnapshot(projectSet, project)) },
    };
  }
  const composition = getActiveComposition(project, activeCompositionId);
  if (project.compositions.length === 1 && isUntouchedBlankTiming(composition)) return null;
  const key = JSON.stringify([
    'template',
    documentLoadRevision,
    activeTemplateId,
    project.id,
    composition.id,
  ]);
  if (previous?.key === key) return previous;
  return {
    key,
    name: template?.name ?? project.name,
    source: { project, composition },
  };
}

/** Follow document opens and template selection independently of the docked preview. */
export function installSharedPlayoutAutoFollow(): () => void {
  const lifetime = new AbortController();
  const setState = useSharedPlayoutEditor.setState;
  let desired: PreviewTarget | null = null;
  let publishedKey: string | undefined;
  let failedKey: string | undefined;
  let preparing: AbortController | null = null;
  let running = false;
  let queued = false;

  const follow = async () => {
    if (running) return;
    running = true;
    try {
      while (
        !lifetime.signal.aborted &&
        desired &&
        desired.key !== publishedKey &&
        desired.key !== failedKey
      ) {
        const target = desired;
        setState({ preparingName: target.name, error: '' });
        const preparation = new AbortController();
        preparing = preparation;
        try {
          const artifacts = await buildSharedPlayoutPreview(target.source, preparation.signal);
          if (lifetime.signal.aborted || desired?.key !== target.key) continue;
          preparing = null;
          // Once a POST begins, let it settle before sending the next publication.
          const links = await publishSharedPlayout(artifacts, lifetime.signal);
          publishedKey = target.key;
          if (!lifetime.signal.aborted)
            setState((state) => ({
              links,
              publicationName: target.name,
              publicationId: links.publicationId,
              publishedSource: target.source,
              liveSnapshot: state.publicationId === links.publicationId ? state.liveSnapshot : null,
            }));
        } catch (cause) {
          if (lifetime.signal.aborted || preparation.signal.aborted || desired?.key !== target.key)
            continue;
          failedKey = target.key;
          setState({
            error: cause instanceof Error ? cause.message : 'Unable to prepare the shared preview.',
          });
        } finally {
          preparing = null;
        }
      }
    } finally {
      running = false;
      if (!lifetime.signal.aborted) setState({ preparingName: null });
    }
  };

  const schedule = () => {
    if (queued || !useSharedPlayoutEditor.getState().links || lifetime.signal.aborted) return;
    queued = true;
    // Opening a set or navigating to a child updates both stores in the same turn.
    queueMicrotask(() => {
      queued = false;
      if (lifetime.signal.aborted) return;
      let next: PreviewTarget | null;
      try {
        next = currentTarget(desired);
      } catch (cause) {
        preparing?.abort();
        desired = null;
        setState({
          error:
            cause instanceof Error ? cause.message : 'Unable to read the shared preview source.',
        });
        return;
      }
      if (desired?.key !== next?.key) {
        preparing?.abort();
        failedKey = undefined;
        setState({ error: '' });
      }
      desired = next;
      void follow();
    });
  };

  setState({
    ...initialState,
    retry: () => {
      failedKey = undefined;
      desired = null;
      schedule();
    },
  });
  const unsubscribeProject = useProjectStore.subscribe(schedule);
  const unsubscribeSet = useProjectSetStore.subscribe(schedule);
  void getSharedPlayoutLinks(lifetime.signal)
    .catch(() => null)
    .then((links) => {
      if (lifetime.signal.aborted) return;
      setState({ checking: false, links });
      schedule();
    });

  return () => {
    lifetime.abort();
    preparing?.abort();
    unsubscribeProject();
    unsubscribeSet();
  };
}

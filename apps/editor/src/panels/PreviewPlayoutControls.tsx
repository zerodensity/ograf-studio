import type { PlayoutControlsSession } from '../state/playoutControlsStore';
import { previewArrowNavigationLabel } from '../state/previewPresentation';
import { useBehaviorPreviewStore } from '../state/behaviorPreviewStore';
import {
  transitionLogicDraftChanged,
  useTransitionLogicDraftStore,
} from '../state/transitionLogicDraftStore';
import { PreviewDataFields } from './PreviewDataFields';
import { PreviewTransitionLogicControls } from './PreviewTransitionLogicControls';
import { PreviewError } from './PreviewError';
import { EditorPreviewControls } from './EditorPreviewControls';
import { TickerPendingUpdates } from './TickerPendingUpdates';
import { PreviewBackgroundControls } from './PreviewBackgroundControls';
import { SyncViewersControl } from './SyncViewersControl';
import { PreviewFpsControls } from '../components/PreviewFpsOverlay';

/** The fullscreen popup and dockable controls operate the same registered preview. */
export function PreviewPlayoutControls({
  session,
  showStatus = false,
}: {
  session: PlayoutControlsSession;
  showStatus?: boolean;
}) {
  const hasLaneDefinition = useTransitionLogicDraftStore((state) => {
    const draft = session.projectSet ? state.drafts[session.projectSet.id] : undefined;
    return Boolean(
      draft && transitionLogicDraftChanged(draft)
        ? draft.definition
        : session.projectSet?.transitionLogic,
    );
  });
  const hasLaneSession = useBehaviorPreviewStore(
    (state) =>
      !!session.projectSet && !!state.requestId && state.sourceSetId === session.projectSet.id,
  );
  // Match the lane controls' render scope, including Ready/Off before the first Take.
  // Boolean selectors avoid rerendering this shared popup/pane on playback snapshots.
  const laneControlsOwnData =
    !session.editorSynchronized &&
    (session.sharedTransition
      ? Boolean((session.sharedTransition.source ?? session.projectSet)?.transitionLogic)
      : hasLaneDefinition || hasLaneSession);
  const showTemplateControls =
    session.editorSynchronized || (!laneControlsOwnData && !session.behaviorActive);
  const backwardLabel = previewArrowNavigationLabel(
    -1,
    session.currentStep,
    session.stepCount,
    session.templateIndex > 0,
  );
  const forwardLabel = previewArrowNavigationLabel(
    1,
    session.currentStep,
    session.stepCount,
    session.templateIndex < session.templateCount - 1,
  );
  return (
    <>
      {showStatus && (
        <div className="preview-template-navigation" aria-label="Controlled template">
          <span title={session.templateName}>{session.templateName}</span>
          {session.templateCount > 1 && (
            <small>
              {session.templateIndex + 1}/{session.templateCount}
            </small>
          )}
          {!session.editorSynchronized && (
            <span className="preview-step-indicator" role="status">
              {session.currentStep === undefined
                ? 'Off air'
                : `Step ${session.currentStep + 1} of ${session.stepCount}`}
            </span>
          )}
        </div>
      )}
      <div className="preview-controls-row">
        {!session.editorSynchronized && (
          <>
            <button
              type="button"
              aria-label={`Navigate backward: ${backwardLabel}`}
              title={`${backwardLabel} (Left arrow)`}
              disabled={
                !session.canNavigate() ||
                (session.currentStep === undefined && session.templateIndex <= 0)
              }
              onClick={() => session.navigate(-1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label={`Navigate forward: ${forwardLabel}`}
              title={`${forwardLabel} (Right arrow)`}
              disabled={!session.canNavigate()}
              onClick={() => session.navigate(1)}
            >
              →
            </button>
          </>
        )}
        {!session.editorSynchronized && (
          <>
            <button
              type="button"
              onClick={() => session.play({ delta: -1 })}
              disabled={!session.ready || session.currentStep === undefined}
              title="Go back one step"
            >
              ⏮ Back
            </button>
            <button
              type="button"
              onClick={() => session.play({ delta: 1 })}
              disabled={!session.ready}
            >
              {session.currentStep === undefined ? 'Take In ▶' : 'Next ⏭'}
            </button>
            <button type="button" onClick={session.out} disabled={!session.ready}>
              Take Out
            </button>
          </>
        )}
      </div>
      {session.editorSynchronized && <EditorPreviewControls />}
      {session.viewerSync && <SyncViewersControl session={session.viewerSync} />}
      <TickerPendingUpdates statuses={session.tickerUpdates ?? []} />
      {showStatus && session.loading && (
        <p className="playout-controls-note" role="status">
          Preparing preview…
        </p>
      )}
      {showStatus && session.error && <PreviewError message={session.error} />}
      {session.behaviorActive && <p className="playout-controls-note">{session.behaviorLabel}</p>}
      {!session.editorSynchronized && (
        <PreviewTransitionLogicControls
          projectSet={session.projectSet}
          activeTemplateId={session.activeTemplateId}
          dataTemplateId={session.dataTemplateId}
          data={session.data}
          shared={session.sharedTransition}
        />
      )}
      <PreviewBackgroundControls />
      <PreviewFpsControls />
      {showTemplateControls && session.fields.length > 0 ? (
        <PreviewDataFields
          fields={session.fields}
          values={session.values}
          onChange={session.updateData}
        />
      ) : showTemplateControls ? (
        <p className="playout-controls-note">This template has no exposed data fields.</p>
      ) : null}
      {showTemplateControls && session.customActions.length > 0 && (
        <div className="preview-controls-row" aria-label="Custom actions">
          {session.customActions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={!session.ready}
              onClick={() => session.customAction(action.id)}
            >
              {action.name || action.id}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

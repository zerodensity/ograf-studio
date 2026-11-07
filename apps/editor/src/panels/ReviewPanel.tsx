import { useEffect, useState } from 'react';
import {
  getCompositionOutputRect,
  getLayerTransformAtFrame,
  layerMotionWindows,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { useProjectStore, useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { captureAgentPng } from '../state/agentCapture';
import { useReviewPlacementStore } from '../state/reviewPlacementStore';
import { canvasFrame, useCanvasViewStore } from '../state/canvasViewStore';
import {
  addReviewComment,
  changedReviewLayerIds,
  resolveReviewComment,
  reviewOf,
  reviewProjectFingerprint,
  saveReviewVersion,
  setReviewApproval,
} from '../state/projectReview';
import { Panel } from './Panel';
import './ReviewPanel.css';

interface ComparisonFrame {
  label: string;
  before: string;
  current: string;
  beforeFrame: number;
  currentFrame: number;
}
const EMPTY_CHANGED = new Set<string>();
function frames(composition: Composition) {
  const window = layerMotionWindows(composition);
  return [window?.start ?? 0, window?.firstStep ?? 0, window?.end ?? 0];
}

function ComparisonImage({
  image,
  composition,
  frame,
  changed,
  label,
}: {
  image: string;
  composition: Composition;
  frame: number;
  changed: Set<string>;
  label: string;
}) {
  const output = getCompositionOutputRect(composition);
  return (
    <div className="review-image" title={label}>
      <img src={image} alt={label} />
      {composition.layers
        .filter((layer) => changed.has(layer.id) && layer.keyframes.length)
        .map((layer) => {
          const pose = getLayerTransformAtFrame(layer, frame);
          return (
            <span
              key={layer.id}
              className="review-changed-outline"
              title={layer.name}
              style={{
                left: `${(100 * (pose.x - output.x)) / output.width}%`,
                top: `${(100 * (pose.y - output.y)) / output.height}%`,
                width: `${(100 * pose.width) / output.width}%`,
                height: `${(100 * pose.height) / output.height}%`,
                transform: `rotate(${pose.rotation}deg)`,
              }}
            />
          );
        })}
    </div>
  );
}

export function ReviewPanel() {
  const project = useProjectStore((state) => state.project);
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const currentFrame = useTimelineStore((state) => state.currentFrame);
  const placement = useReviewPlacementStore((state) => state.placement);
  const placing = useReviewPlacementStore((state) => state.placing);
  const selectedCommentId = useReviewPlacementStore((state) => state.selectedCommentId);
  const [author, setAuthor] = useState('');
  const [comment, setComment] = useState('');
  const [versionName, setVersionName] = useState('');
  const [versionId, setVersionId] = useState('');
  const [comparison, setComparison] = useState<ComparisonFrame[]>([]);
  const [comparisonProject, setComparisonProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [approvalCheck, setApprovalCheck] = useState<{
    project: Project;
    fingerprint: string;
  } | null>(null);
  const [differenceCheck, setDifferenceCheck] = useState<{
    project: Project;
    previous: Project;
    ids: Set<string>;
  } | null>(null);
  const review = reviewOf(project);
  const version = review.versions.find((item) => item.id === versionId);
  const previous = version?.snapshot as Project | undefined;
  const previousComposition = previous?.compositions.find((item) => item.id === composition.id);
  useEffect(() => {
    if (!previous) return;
    const timer = window.setTimeout(
      () =>
        setDifferenceCheck({
          project,
          previous,
          ids: new Set(changedReviewLayerIds(project, previous)),
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [project, previous]);
  const differenceReady =
    differenceCheck?.project === project && differenceCheck?.previous === previous;
  const changed = differenceReady ? differenceCheck.ids : EMPTY_CHANGED;
  useEffect(() => {
    if (!review.approval) return;
    const timer = window.setTimeout(
      () => setApprovalCheck({ project, fingerprint: reviewProjectFingerprint(project) }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [project, review.approval]);
  const checkingApproval = Boolean(review.approval && approvalCheck?.project !== project);
  const approvalCurrent = Boolean(
    !checkingApproval &&
    review.approval &&
    review.approval.fingerprint === approvalCheck?.fingerprint,
  );
  const safely = (operation: () => void) => {
    try {
      operation();
      setStatus('');
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const add = () =>
    safely(() => {
      const layer = composition.layers.find((item) => item.id === selectedLayerId);
      const visibleFrame = canvasFrame(composition, currentFrame);
      const pose = layer?.keyframes.length ? getLayerTransformAtFrame(layer, visibleFrame) : null;
      const anchor =
        placement?.projectId === project.id && placement.compositionId === composition.id
          ? placement
          : null;
      addReviewComment({
        text: comment,
        author: author.trim() || 'Designer',
        compositionId: composition.id,
        layerId: anchor ? anchor.layerId : (layer?.id ?? null),
        frame: anchor?.frame ?? Math.round(visibleFrame),
        x: anchor?.x ?? (pose ? pose.x + pose.width / 2 : composition.width / 2),
        y: anchor?.y ?? (pose ? pose.y + pose.height / 2 : composition.height / 2),
      });
      useReviewPlacementStore.getState().clearPlacement();
      setComment('');
    });
  const compare = async () => {
    if (!previous || !previousComposition) {
      setStatus('The selected version does not contain this composition.');
      return;
    }
    setBusy(true);
    setStatus('Capturing versions…');
    try {
      const priorFrames = frames(previousComposition),
        currentFrames = frames(composition);
      const output: ComparisonFrame[] = [];
      for (const [index, label] of ['Before', 'On air', 'After'].entries()) {
        const capture = (source: Project, comp: Composition, frame: number) =>
          captureAgentPng({
            target: 'composition',
            project: source,
            compositionId: comp.id,
            frame,
            maxDimension: 640,
            matte: '#000000',
          });
        const prior = await capture(previous, previousComposition, priorFrames[index]!);
        const now = await capture(project, composition, currentFrames[index]!);
        output.push({
          label,
          before: `data:image/png;base64,${prior.data}`,
          current: `data:image/png;base64,${now.data}`,
          beforeFrame: priorFrames[index]!,
          currentFrame: currentFrames[index]!,
        });
      }
      if (useProjectStore.getState().project !== project)
        throw new Error(
          'The project changed during capture. Compare again to see the latest version.',
        );
      setComparison(output);
      setComparisonProject(project);
      setStatus(`${changed.size} changed layer${changed.size === 1 ? '' : 's'} highlighted.`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Review">
      <div className="review-panel">
        <label>
          Your name{' '}
          <input
            value={author}
            maxLength={128}
            onChange={(event) => setAuthor(event.currentTarget.value)}
            placeholder="Designer"
          />
        </label>
        <h3>Comments</h3>
        <p>Comments are saved with the editable project and stay out of OGraf exports.</p>
        <textarea
          aria-label="New review comment"
          value={comment}
          maxLength={2000}
          onChange={(event) => setComment(event.currentTarget.value)}
          placeholder="Add a comment at the current frame"
        />
        <div className="review-row">
          <button
            type="button"
            onClick={() =>
              placing
                ? useReviewPlacementStore.getState().cancelPlacement()
                : useReviewPlacementStore.getState().startPlacement()
            }
          >
            {placing ? 'Cancel placement' : 'Choose point on canvas'}
          </button>
          <button type="button" disabled={!comment.trim() || placing} onClick={add}>
            Add comment
          </button>
        </div>
        <p>
          {placing
            ? 'Click a point on the canvas, or press Escape to cancel.'
            : placement?.compositionId === composition.id && placement.projectId === project.id
              ? `Point selected at ${Math.round(placement.x)}, ${Math.round(placement.y)} · frame ${placement.frame}.`
              : 'Without a chosen point, the selected object or canvas centre is used.'}
        </p>
        <ul className="review-comments">
          {review.comments
            .filter((item) => item.compositionId === composition.id)
            .map((item) => (
              <li
                key={item.id}
                className={`${item.resolved ? 'resolved' : ''}${selectedCommentId === item.id ? ' selected' : ''}`}
              >
                <strong>{item.author}</strong> · frame {item.frame}
                <p>{item.text}</p>
                <button
                  type="button"
                  onClick={() => {
                    useCanvasViewStore.getState().setMode('animate');
                    useTimelineStore.getState().controller?.seek(item.frame);
                    if (
                      item.layerId &&
                      composition.layers.some((layer) => layer.id === item.layerId)
                    )
                      useSelectionStore.getState().select(item.layerId);
                    useReviewPlacementStore.getState().selectComment(item.id);
                  }}
                >
                  Show
                </button>{' '}
                <button
                  type="button"
                  onClick={() => safely(() => resolveReviewComment(item.id, !item.resolved))}
                >
                  {item.resolved ? 'Reopen' : 'Resolve'}
                </button>
              </li>
            ))}
        </ul>
        <h3>Versions</h3>
        <div className="review-row">
          <input
            aria-label="New version name"
            maxLength={128}
            value={versionName}
            onChange={(event) => setVersionName(event.currentTarget.value)}
            placeholder="Version name"
          />
          <button
            type="button"
            disabled={!versionName.trim()}
            onClick={() =>
              safely(() => {
                saveReviewVersion(versionName);
                setVersionName('');
              })
            }
          >
            Save version
          </button>
        </div>
        <div className="review-row">
          <select
            aria-label="Compare version"
            value={versionId}
            onChange={(event) => {
              setVersionId(event.currentTarget.value);
              setComparison([]);
            }}
          >
            <option value="">Choose a version</option>
            {review.versions.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!version || busy || !differenceReady}
            onClick={() => void compare()}
          >
            Compare
          </button>
        </div>
        {version && (
          <p>
            Changed layers:{' '}
            {!differenceReady
              ? 'Checking…'
              : changed.size
                ? [...changed]
                    .map(
                      (id) =>
                        composition.layers.find((layer) => layer.id === id)?.name ??
                        previousComposition?.layers.find((layer) => layer.id === id)?.name ??
                        id,
                    )
                    .join(', ')
                : 'none'}
          </p>
        )}
        {previousComposition &&
          comparisonProject === project &&
          comparison.map((item) => (
            <div className="review-comparison" key={item.label}>
              <strong>{item.label}</strong>
              <div className="review-comparison-pair">
                <ComparisonImage
                  image={item.before}
                  composition={previousComposition}
                  frame={item.beforeFrame}
                  changed={changed}
                  label={`${version?.name} · ${item.label}`}
                />
                <ComparisonImage
                  image={item.current}
                  composition={composition}
                  frame={item.currentFrame}
                  changed={changed}
                  label={`Current · ${item.label}`}
                />
              </div>
            </div>
          ))}
        <h3>Approval</h3>
        {review.approval ? (
          <p>
            {checkingApproval
              ? 'Checking approval…'
              : approvalCurrent
                ? 'Approved'
                : 'Approval is out of date'}{' '}
            · {review.approval.author} · {new Date(review.approval.at).toLocaleString()}
          </p>
        ) : (
          <p>Not approved</p>
        )}
        <div className="review-row">
          <button
            type="button"
            disabled={!author.trim()}
            onClick={() => safely(() => setReviewApproval(author))}
          >
            Approve current version
          </button>
          {review.approval && (
            <button type="button" onClick={() => safely(() => setReviewApproval(null))}>
              Remove approval
            </button>
          )}
        </div>
        <p role="status">{status}</p>
      </div>
    </Panel>
  );
}

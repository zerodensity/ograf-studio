import { useEffect, useRef, useState } from 'react';
import { getTotalFrames } from '@ograf-editor/scene-model';
import { captureAgentProposal } from '../state/agentBridge';
import {
  proposalComposition,
  useAgentReviewStore,
  type ReviewProposal,
} from '../state/agentReviewStore';
import { useFitZoom } from './useFitZoom';
import './AgentProposalCanvas.css';

export function AgentProposalCanvas({ proposal }: { proposal: ReviewProposal }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ src: string; frame: number; original: boolean } | null>(
    null,
  );
  const project = proposal.showOriginal ? proposal.originalProject : proposal.project;
  const composition = proposalComposition(proposal, project);
  const draftComposition = proposalComposition(proposal);
  const originalComposition = proposalComposition(proposal, proposal.originalProject);
  const width = composition?.width ?? originalComposition?.width ?? 1920;
  const height = composition?.height ?? originalComposition?.height ?? 1080;
  const zoom = useFitZoom(viewport, width, height, 24);
  const frame = Math.min(
    proposal.previewFrame,
    composition ? getTotalFrames(composition) : proposal.previewFrame,
  );
  const totalFrames = draftComposition ? getTotalFrames(draftComposition) : proposal.previewFrame;
  const setFrame = (value: number) => useAgentReviewStore.getState().setFrame(proposal.id, value);

  useEffect(() => {
    let active = true;
    setImage(null);
    useAgentReviewStore.getState().update(proposal.id, { previewReady: false, previewError: null });
    if (!project || !composition) {
      if (proposal.render === 'strip') {
        useAgentReviewStore.getState().update(proposal.id, {
          previewError: 'Ask the assistant to regenerate this proposal as a single frame.',
          previewReady: false,
        });
        return () => {
          active = false;
        };
      }
      setImage({ src: proposal.previewUrl, frame, original: proposal.showOriginal });
      return () => {
        active = false;
      };
    }
    void captureAgentProposal(
      {
        target: 'composition',
        project,
        compositionId: composition.id,
        frame,
        maxDimension: 1920,
        matte: 'transparent',
      },
      () => active,
    )
      .then((result) => {
        if (active && result)
          setImage({
            src: `data:image/png;base64,${result.data}`,
            frame,
            original: proposal.showOriginal,
          });
      })
      .catch((error) => {
        if (active)
          useAgentReviewStore.getState().update(proposal.id, {
            previewReady: false,
            previewError: error instanceof Error ? error.message : 'Could not show the proposal.',
          });
      });
    return () => {
      active = false;
    };
  }, [
    proposal.id,
    project,
    composition,
    frame,
    proposal.previewUrl,
    proposal.previewAttempt,
    proposal.showOriginal,
    proposal.previewFrame,
    proposal.render,
  ]);

  return (
    <section className="agent-proposal-canvas" aria-label="AI proposal canvas">
      <header>
        <strong>{proposal.showOriginal ? 'Original' : 'Proposed changes'}</strong>
        <span>{proposal.title}</span>
        <button
          type="button"
          disabled={!proposal.project || !originalComposition}
          onClick={() => useAgentReviewStore.getState().compare(proposal.id)}
        >
          {proposal.showOriginal ? 'Show proposed changes' : 'Compare original'}
        </button>
      </header>
      <div className="agent-proposal-frame-controls">
        <button
          type="button"
          aria-label="Previous proposal frame"
          disabled={!draftComposition || proposal.previewFrame <= 0}
          onClick={() => setFrame(proposal.previewFrame - 1)}
        >
          ‹
        </button>
        <label>
          Frame{' '}
          <input
            type="number"
            aria-label="Proposal frame"
            min={0}
            max={totalFrames}
            value={proposal.previewFrame}
            disabled={!draftComposition}
            onChange={(event) => setFrame(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          aria-label="Next proposal frame"
          disabled={!draftComposition || proposal.previewFrame >= totalFrames}
          onClick={() => setFrame(proposal.previewFrame + 1)}
        >
          ›
        </button>
        <input
          type="range"
          aria-label="Scrub proposal frames"
          min={0}
          max={totalFrames}
          value={proposal.previewFrame}
          disabled={!draftComposition}
          onChange={(event) => setFrame(Number(event.target.value))}
        />
        <span>Review in AI Assistant</span>
      </div>
      <div className="agent-proposal-viewport" ref={viewport}>
        <div
          className="agent-proposal-artwork"
          style={{ width: width * zoom, height: height * zoom }}
        >
          {image && image.frame === frame && image.original === proposal.showOriginal && (
            <img
              src={image.src}
              alt={`${proposal.showOriginal ? 'Original' : 'Proposed'} graphic at frame ${frame}`}
              onLoad={() =>
                useAgentReviewStore.getState().update(proposal.id, { previewReady: true })
              }
              onError={() =>
                useAgentReviewStore.getState().update(proposal.id, {
                  previewError: 'Could not display the proposal preview.',
                  previewReady: false,
                })
              }
            />
          )}
        </div>
        {!proposal.previewReady && !proposal.previewError && (
          <span className="agent-proposal-loading" role="status">
            Rendering preview…
          </span>
        )}
        {proposal.previewError && (
          <div className="agent-proposal-error" role="alert">
            <p>{proposal.previewError}</p>
            <button type="button" onClick={() => useAgentReviewStore.getState().retry(proposal.id)}>
              Retry preview
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

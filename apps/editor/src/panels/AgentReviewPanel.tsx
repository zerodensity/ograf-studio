import { useEffect, useState } from 'react';
import { decideAgentProposal, useAgentReviewStore } from '../state/agentBridge';
import './AgentReviewPanel.css';

export function AgentReviewPanel() {
  const proposals = useAgentReviewStore((state) => state.proposals);
  const lastResolution = useAgentReviewStore((state) => state.lastResolution);
  const dismissResolution = useAgentReviewStore((state) => state.dismissResolution);
  const proposal = proposals[0];
  const [deciding, setDeciding] = useState<'accept' | 'reject' | null>(null);

  useEffect(() => setDeciding(null), [proposal?.id]);

  if (!proposal) {
    return lastResolution ? (
      <div className={`agent-review-toast is-${lastResolution.status}`} role="status">
        <span>{lastResolution.message}</span>
        <button type="button" onClick={dismissResolution} aria-label="Dismiss">
          ×
        </button>
      </div>
    ) : null;
  }

  const decide = (decision: 'accept' | 'reject') => {
    setDeciding(decision);
    decideAgentProposal(proposal.id, decision);
  };

  return (
    <aside className="agent-review-panel" aria-label="AI authoring proposal">
      <header>
        <div>
          <span className="agent-review-eyebrow">
            AI proposal · revision {proposal.baseRevision}
          </span>
          <h2>{proposal.title}</h2>
        </div>
        {proposals.length > 1 && <span>{proposals.length} queued</span>}
      </header>
      {proposal.description && <p className="agent-review-description">{proposal.description}</p>}
      <img
        src={proposal.previewUrl}
        alt={`${proposal.title} projected ${proposal.render} preview`}
        className="agent-review-preview"
      />
      <div className="agent-review-meta">
        <span>
          {proposal.operationCount} change{proposal.operationCount === 1 ? '' : 's'}
        </span>
        <span>{proposal.render === 'strip' ? 'Contact sheet' : `Frame ${proposal.frames[0]}`}</span>
        <span className={proposal.valid ? 'is-valid' : 'is-invalid'}>
          {proposal.valid ? 'Project-valid' : 'Validation failed'}
        </span>
      </div>
      <div className="agent-review-operations">
        {proposal.operationTypes.map((operation, index) => (
          <code key={`${operation}-${index}`}>{operation}</code>
        ))}
      </div>
      {proposal.warnings.length > 0 && (
        <details>
          <summary>
            {proposal.warnings.length} warning{proposal.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {proposal.warnings.slice(0, 8).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <footer>
        <button
          type="button"
          className="agent-review-reject"
          disabled={deciding !== null}
          onClick={() => decide('reject')}
        >
          {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          className="agent-review-accept"
          disabled={deciding !== null || !proposal.valid}
          onClick={() => decide('accept')}
          title={
            proposal.valid ? 'Apply these exact operations' : 'Invalid proposals cannot be applied'
          }
        >
          {deciding === 'accept' ? 'Applying…' : 'Accept changes'}
        </button>
      </footer>
    </aside>
  );
}

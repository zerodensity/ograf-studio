import {
  decideAgentProposal,
  useAgentReviewStore,
  useAgentBridgeStatus,
} from '../state/agentBridge';
import './AgentReviewPanel.css';

export function AgentReviewPanel() {
  const proposals = useAgentReviewStore((state) => state.proposals);
  const lastResolution = useAgentReviewStore((state) => state.lastResolution);
  const dismissResolution = useAgentReviewStore((state) => state.dismissResolution);
  const proposal = proposals[0];
  const connected = useAgentBridgeStatus((state) => state.connected && state.authoritative);
  const deciding = proposal?.deciding ?? null;

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
    decideAgentProposal(proposal.id, decision);
  };

  return (
    <aside className="agent-review-panel" aria-label="AI authoring proposal">
      <header>
        <div>
          <span className="agent-review-eyebrow">Review proposed changes</span>
          <h2>{proposal.title}</h2>
        </div>
        {proposals.length > 1 && <span>{proposals.length} queued</span>}
      </header>
      {proposal.description && <p className="agent-review-description">{proposal.description}</p>}
      <div className="agent-review-meta">
        <span>
          {proposal.operationCount} change{proposal.operationCount === 1 ? '' : 's'}
        </span>
        <span>{`Frame ${proposal.previewFrame}`}</span>
        <span className={proposal.valid ? 'is-valid' : 'is-invalid'}>
          {proposal.valid ? 'Project-valid' : 'Validation failed'}
        </span>
      </div>
      <details>
        <summary>Change details</summary>
        <div className="agent-review-operations">
          {proposal.operationTypes.map((operation, index) => (
            <code key={`${operation}-${index}`}>{operation}</code>
          ))}
        </div>
      </details>
      {proposal.staleReason && (
        <p className="agent-review-error" role="alert">
          {proposal.staleReason}
        </p>
      )}
      {proposal.previewError && (
        <p className="agent-review-error" role="alert">
          {proposal.previewError}
        </p>
      )}
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
          disabled={deciding !== null || !connected}
          onClick={() => decide('reject')}
        >
          {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          className="agent-review-accept"
          disabled={
            deciding !== null ||
            !connected ||
            !proposal.valid ||
            !!proposal.staleReason ||
            !proposal.previewReady
          }
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

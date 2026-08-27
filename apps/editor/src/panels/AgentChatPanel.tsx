import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAgentChat,
  sendAgentChat,
  setAgentChatExclusive,
  useAgentBridgeStatus,
  useAgentChatStore,
} from '../state/agentBridge';
import {
  AGENT_LAYER_REFERENCE_MIME,
  decodeAgentLayerReference,
  selectedLayerReferences,
  type AgentLayerReference,
} from '../state/agentLayerReference';
import { useSelectionStore } from '../state/selectionStore';
import { useActiveComposition } from '../state/projectStore';
import './AgentChatPanel.css';

function usageLabel(usage: { input: number; output: number; cacheRead: number }): string {
  return `${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out · ${usage.cacheRead.toLocaleString()} cached`;
}

function elapsedLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${remainder.toString().padStart(2, '0')}` : `${remainder}s`;
}

export function AgentChatPanel() {
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [manualReferences, setManualReferences] = useState<AgentLayerReference[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = useAgentBridgeStatus((state) => state.connected);
  const authoritative = useAgentBridgeStatus((state) => state.authoritative);
  const chat = useAgentChatStore();
  const composition = useActiveComposition();
  const selectedLayerIds = useSelectionStore((state) => state.selectedLayerIds);
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const selectedLayerProperty = useSelectionStore((state) => state.selectedLayerProperty);
  const selectedLayerKeyframeId = useSelectionStore((state) => state.selectedLayerKeyframeId);
  const selectedReferences = useMemo(
    () =>
      selectedLayerReferences(
        composition,
        selectedLayerIds,
        selectedLayerId,
        selectedLayerProperty,
        selectedLayerKeyframeId,
      ),
    [
      composition,
      selectedLayerId,
      selectedLayerIds,
      selectedLayerKeyframeId,
      selectedLayerProperty,
    ],
  );
  const selectedReferenceIds = useMemo(
    () => new Set(selectedReferences.map((reference) => reference.layerId)),
    [selectedReferences],
  );
  const references = useMemo(
    () =>
      [
        ...selectedReferences,
        ...manualReferences.filter((reference) => !selectedReferenceIds.has(reference.layerId)),
      ].slice(0, 32),
    [manualReferences, selectedReferenceIds, selectedReferences],
  );
  const busy = Boolean(chat.activeTurnId);
  const enabled = connected && authoritative && chat.configured === true;
  const elapsedSeconds = chat.activeTurnStartedAt
    ? Math.max(0, Math.floor((now - chat.activeTurnStartedAt) / 1_000))
    : 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.entries]);

  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const submit = () => {
    if (!enabled || busy || !text.trim()) return;
    sendAgentChat(text, references);
    setText('');
    setManualReferences([]);
  };

  const acceptsLayerReference = (types: readonly string[]) =>
    Array.from(types).includes(AGENT_LAYER_REFERENCE_MIME);

  return (
    <section
      className={`agent-chat-panel${dragActive ? ' layer-drag-active' : ''}`}
      aria-label="OGraf Studio AI chat"
      onDragEnter={(event) => {
        if (!acceptsLayerReference(event.dataTransfer.types)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!acceptsLayerReference(event.dataTransfer.types)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!acceptsLayerReference(event.dataTransfer.types)) return;
        event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        if (!acceptsLayerReference(event.dataTransfer.types)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = 0;
        setDragActive(false);
        const reference = decodeAgentLayerReference(
          event.dataTransfer.getData(AGENT_LAYER_REFERENCE_MIME),
        );
        if (!reference) return;
        setManualReferences((current) =>
          [
            ...current.filter((candidate) => candidate.layerId !== reference.layerId),
            reference,
          ].slice(-8),
        );
      }}
    >
      {dragActive ? (
        <div className="agent-chat-drop-overlay" aria-hidden="true">
          <strong>Drop layer to reference it</strong>
          <span>The next prompt will target this layer explicitly.</span>
        </div>
      ) : null}
      <div className="agent-chat-status">
        <span className={enabled ? 'online' : ''} />
        {chat.configured
          ? `${chat.provider} · ${chat.model}`
          : chat.configured === false
            ? 'Agent not configured'
            : 'Checking agent configuration…'}
      </div>
      <div className="agent-chat-concurrency">
        <span>
          {chat.externalAgentActive ? 'External MCP agent active' : 'No external MCP activity'}
        </span>
        <label>
          <input
            type="checkbox"
            checked={chat.exclusive}
            onChange={(event) => setAgentChatExclusive(event.target.checked)}
            disabled={!connected || !authoritative}
          />
          Exclusive while chatting
        </label>
      </div>
      {!authoritative ? (
        <div className="agent-chat-notice error">
          This tab is not the active editor session. Reload it to make this tab authoritative.
        </div>
      ) : !connected ? (
        <div className="agent-chat-notice">The local OGraf Studio server is offline.</div>
      ) : chat.configured === false ? (
        <div className="agent-chat-notice">
          {chat.configMessage ?? 'Configure a provider on the local server and restart it.'}
        </div>
      ) : null}
      {busy ? (
        <div
          className={`agent-chat-progress${elapsedSeconds >= 60 ? ' delayed' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="agent-chat-spinner" aria-hidden="true" />
          <div>
            <strong>{chat.progress?.message ?? 'Working on your request'}</strong>
            <span>
              {elapsedLabel(elapsedSeconds)} elapsed
              {chat.progress?.round ? ` · Model round ${chat.progress.round}` : ''}
            </span>
            {elapsedSeconds >= 60 ? (
              <small>
                This is taking longer than usual. You can keep waiting or cancel and retry.
              </small>
            ) : elapsedSeconds >= 15 ? (
              <small>
                Still working—complex authoring requests may require several tool rounds.
              </small>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="agent-chat-transcript" ref={scrollRef} aria-live="polite">
        {chat.entries.length === 0 ? (
          <div className="agent-chat-empty">
            Describe a graphic, or select a layer and ask for a change. Visual proposals appear in
            the review panel before they are applied.
          </div>
        ) : null}
        {chat.entries.map((entry) =>
          entry.text || entry.usage ? (
            <div key={entry.id} className={`agent-chat-entry ${entry.kind} ${entry.status ?? ''}`}>
              {entry.text ? <div>{entry.text}</div> : null}
              {entry.usage ? <small>{usageLabel(entry.usage)}</small> : null}
            </div>
          ) : null,
        )}
      </div>
      <div className="agent-chat-usage">
        <span>Session: {usageLabel(chat.sessionUsage)}</span>
        <span>Project: {usageLabel(chat.projectUsage)}</span>
      </div>
      <div className="agent-chat-composer">
        {references.length ? (
          <div className="agent-chat-references" aria-label="Referenced layers" aria-live="polite">
            {references.map((reference) => (
              <span
                key={reference.layerId}
                title={`${reference.elementType} · ${reference.layerId}`}
              >
                <strong>{reference.name}</strong>
                <small>
                  {reference.elementType}
                  {reference.selectedProperty ? ` · ${reference.selectedProperty}` : ''}
                </small>
                {selectedReferenceIds.has(reference.layerId) ? (
                  <em>selected</em>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${reference.name} reference`}
                    onClick={() =>
                      setManualReferences((current) =>
                        current.filter((candidate) => candidate.layerId !== reference.layerId),
                      )
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? 'Agent is working…' : 'Ask OGraf Studio…'}
          disabled={!enabled || busy}
          rows={3}
        />
        {busy ? (
          <button
            type="button"
            className="cancel"
            title="Cancel the current agent turn"
            onClick={cancelAgentChat}
          >
            Cancel
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={!enabled || !text.trim()}>
            Send
          </button>
        )}
      </div>
    </section>
  );
}

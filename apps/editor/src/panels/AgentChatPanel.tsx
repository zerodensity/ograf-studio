import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAreaReference } from '@ograf-editor/agent-tools/chat-references';
import {
  MAX_AREA_REFERENCES,
  MAX_AREA_REFERENCE_DATA,
} from '@ograf-editor/agent-tools/chat-references';
import { AreaReferenceCapture } from '../components/AreaReferenceCapture';
import { VoiceDictationButton } from '../components/VoiceDictationButton';
import { appendDictatedText, useDictationState } from '../state/speechDictation';
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
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import './AgentChatPanel.css';
import { AgentReviewPanel } from './AgentReviewPanel';
import { useAgentReviewStore } from '../state/agentReviewStore';

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
  const [areaReferences, setAreaReferences] = useState<AgentAreaReference[]>([]);
  const [areaError, setAreaError] = useState('');
  const dictating = useDictationState((state) => Boolean(state.activeId));
  const [captureDocument, setCaptureDocument] = useState<Document | null>(null);
  const pendingProposalId = useAgentReviewStore((state) => state.proposals[0]?.id);
  useEffect(() => {
    if (pendingProposalId) setCaptureDocument(null);
  }, [pendingProposalId]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const projectId = useProjectStore((state) => state.project.id);
  const [now, setNow] = useState(Date.now());
  const [manualReferences, setManualReferences] = useState<AgentLayerReference[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = useAgentBridgeStatus((state) => state.connected);
  const authoritative = useAgentBridgeStatus((state) => state.authoritative);
  const chat = useAgentChatStore();
  const transcriptEntries = useMemo(
    () => chat.entries.filter((entry) => entry.kind !== 'tool' && entry.kind !== 'proposal'),
    [chat.entries],
  );
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
      (areaReferences.length
        ? []
        : [
            ...selectedReferences,
            ...manualReferences.filter((reference) => !selectedReferenceIds.has(reference.layerId)),
          ]
      ).slice(0, 32),
    [areaReferences, manualReferences, selectedReferenceIds, selectedReferences],
  );
  const busy = Boolean(chat.activeTurnId);
  const enabled = connected && authoritative && chat.configured === true;
  useEffect(() => {
    setAreaReferences([]);
    setAreaError('');
    setCaptureDocument(null);
    setManualReferences([]);
  }, [projectId, composition.id]);
  const elapsedSeconds = chat.activeTurnStartedAt
    ? Math.max(0, Math.floor((now - chat.activeTurnStartedAt) / 1_000))
    : 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcriptEntries]);

  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const submit = () => {
    if (
      !enabled ||
      busy ||
      dictating ||
      (!text.trim() && !areaReferences.some((area) => area.instruction?.trim()))
    )
      return;
    if (
      areaReferences.some(
        (area) => area.projectId !== projectId || area.compositionId !== composition.id,
      )
    )
      return;
    if (
      areaReferences.reduce((bytes, area) => bytes + area.image.data.length, 0) >
      MAX_AREA_REFERENCE_DATA
    ) {
      setAreaError(
        'These images are too large to send together. Remove an area or capture smaller regions.',
      );
      return;
    }
    sendAgentChat(
      text.trim() || 'Apply the instructions for the attached numbered areas.',
      references,
      areaReferences,
    );
    setText('');
    setManualReferences([]);
    setAreaReferences([]);
    setAreaError('');
  };

  const acceptsLayerReference = (types: readonly string[]) =>
    Array.from(types).includes(AGENT_LAYER_REFERENCE_MIME);

  return (
    <section
      className={`agent-chat-panel${dragActive ? ' layer-drag-active' : ''}${captureDocument ? ' is-area-capture' : ''}`}
      aria-label="OGraf Studio AI Assistant"
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
      <AgentReviewPanel />
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
      <div
        className={`agent-chat-progress${busy && elapsedSeconds >= 60 ? ' delayed' : ''}${chat.progress?.phase === 'error' ? ' error' : ''}`}
        role="status"
        aria-label="Assistant status"
        aria-live="polite"
        title={chat.progress?.message ?? 'Ready'}
      >
        {busy ? (
          <span className="agent-chat-spinner" aria-hidden="true" />
        ) : (
          <span className="agent-chat-status-icon" aria-hidden="true">
            {chat.progress?.phase === 'error' ? '!' : '·'}
          </span>
        )}
        <strong>{chat.progress?.message ?? 'Ready'}</strong>
        <span className="agent-chat-progress-time" aria-hidden="true">
          {busy ? elapsedLabel(elapsedSeconds) : ''}
        </span>
      </div>
      <div className="agent-chat-transcript" ref={scrollRef} aria-live="polite">
        {transcriptEntries.length === 0 ? (
          <div className="agent-chat-empty">
            Describe a graphic, or capture an area and ask for a change. Visual proposals appear in
            the main canvas, with approval controls here.
          </div>
        ) : null}
        {transcriptEntries.map((entry) =>
          entry.text || entry.usage ? (
            <div key={entry.id} className={`agent-chat-entry ${entry.kind} ${entry.status ?? ''}`}>
              {entry.text ? <div>{entry.text}</div> : null}
              {entry.areaSummaries?.map((area, index) => (
                <div className="agent-chat-area-sent" key={index}>
                  <small>
                    Area {area.number} · Frame {area.frame}
                    {area.instruction ? ` — ${area.instruction}` : ''}
                  </small>
                  {entry.areaReferences?.[index] ? (
                    <img
                      className="agent-chat-area-preview"
                      src={`data:image/png;base64,${entry.areaReferences[index]!.image.data}`}
                      alt={`Attached area ${area.number} at frame ${area.frame}`}
                    />
                  ) : null}
                </div>
              ))}
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
        <div className="agent-composer-tools">
          <button
            type="button"
            className="agent-area-button"
            disabled={
              busy ||
              dictating ||
              !!pendingProposalId ||
              areaReferences.length >= MAX_AREA_REFERENCES
            }
            title={
              pendingProposalId
                ? 'Finish reviewing the proposal before marking areas'
                : 'Draw numbered areas on the main canvas and annotate them here'
            }
            onClick={() => {
              setAreaError('');
              setCaptureDocument(document);
            }}
          >
            {areaReferences.length
              ? `Add areas (${areaReferences.length}/${MAX_AREA_REFERENCES})`
              : 'Capture areas'}
          </button>
          <VoiceDictationButton
            label="assistant message"
            disabled={busy || !enabled}
            onError={setAreaError}
            onText={(spoken) => setText((current) => appendDictatedText(current, spoken, 16000))}
          />
        </div>
        {areaReferences.length ? (
          <div className="agent-area-list" aria-label="Attached canvas areas">
            {areaReferences.map((area, index) => (
              <div className="agent-area-card" key={index}>
                <div className="agent-area-thumbnail">
                  <img
                    src={`data:image/png;base64,${area.image.data}`}
                    alt={`Selected canvas area ${index + 1}`}
                  />
                  <span>
                    Area {index + 1}
                    <small>
                      {area.rect.width} × {area.rect.height} · Frame {area.frame}
                    </small>
                  </span>
                  <VoiceDictationButton
                    label={`attached area ${index + 1} annotation`}
                    disabled={busy}
                    onError={setAreaError}
                    onText={(spoken) =>
                      setAreaReferences((current) =>
                        current.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                instruction: appendDictatedText(item.instruction ?? '', spoken),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    disabled={dictating}
                    aria-label={`Remove area ${index + 1} reference`}
                    onClick={() => {
                      setAreaReferences((current) => current.filter((_, i) => i !== index));
                      setAreaError('');
                    }}
                  >
                    ×
                  </button>
                </div>
                <textarea
                  aria-label={`Instruction for attached area ${index + 1}`}
                  maxLength={2000}
                  rows={2}
                  placeholder="What should change here?"
                  value={area.instruction ?? ''}
                  onChange={(event) =>
                    setAreaReferences((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, instruction: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
        {areaError ? (
          <div className="area-capture-error agent-area-error" role="alert">
            {areaError}
          </div>
        ) : null}
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
          ref={inputRef}
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
          <button
            type="button"
            onClick={submit}
            disabled={
              !enabled ||
              dictating ||
              (!text.trim() && !areaReferences.some((area) => area.instruction?.trim()))
            }
          >
            Send
          </button>
        )}
      </div>
      {captureDocument ? (
        <AreaReferenceCapture
          ownerDocument={captureDocument}
          maxAreas={MAX_AREA_REFERENCES - areaReferences.length}
          numberOffset={areaReferences.length}
          onClose={(reason) => {
            setCaptureDocument(null);
            if (reason) setAreaError(reason);
          }}
          onAttach={(captured) => {
            if (
              captured.every(
                (reference) =>
                  reference.projectId === projectId && reference.compositionId === composition.id,
              )
            )
              setAreaReferences((current) =>
                [...current, ...captured].slice(0, MAX_AREA_REFERENCES),
              );
            setCaptureDocument(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}

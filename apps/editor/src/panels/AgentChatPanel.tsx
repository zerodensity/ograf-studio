import { useEffect, useRef, useState } from 'react';
import {
  cancelAgentChat,
  sendAgentChat,
  setAgentChatExclusive,
  useAgentBridgeStatus,
  useAgentChatStore,
} from '../state/agentBridge';
import './AgentChatPanel.css';

function usageLabel(usage: { input: number; output: number; cacheRead: number }): string {
  return `${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out · ${usage.cacheRead.toLocaleString()} cached`;
}

export function AgentChatPanel() {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = useAgentBridgeStatus((state) => state.connected);
  const authoritative = useAgentBridgeStatus((state) => state.authoritative);
  const chat = useAgentChatStore();
  const busy = Boolean(chat.activeTurnId);
  const enabled = connected && authoritative && chat.configured === true;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.entries]);

  const submit = () => {
    if (!enabled || busy || !text.trim()) return;
    sendAgentChat(text);
    setText('');
  };

  return (
    <section className="agent-chat-panel" aria-label="OGraf Studio AI chat">
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
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask OGraf Studio…"
          disabled={!enabled || busy}
          rows={3}
        />
        {busy ? (
          <button type="button" className="cancel" onClick={cancelAgentChat}>
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

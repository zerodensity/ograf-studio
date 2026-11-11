import { useEffect, useRef, useState } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  isSharedPlayoutEnabled,
  publishSharedPlayout,
  type SharedPlayoutPublication,
  type SharedPlayoutSource,
} from '../state/sharedPlayoutPublish';

export function SharedPlayoutPublish({
  source,
  busy,
  onPublishing,
}: {
  source: SharedPlayoutSource;
  busy: boolean;
  onPublishing: (publishing: boolean) => void;
}) {
  const { window } = useEditorWindow();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState<
    (SharedPlayoutPublication & { name: string }) | null
  >(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const pending = useRef<AbortController | null>(null);
  const unavailable =
    'set' in source &&
    (source.set.templates.length === 0
      ? 'Add a template before publishing.'
      : !source.set.transitionLogic &&
        'Choose Current template in Export scope to publish from a set without Transition Logic.');

  useEffect(() => {
    const controller = new AbortController();
    void isSharedPlayoutEnabled(controller.signal)
      .catch(() => false)
      .then((available) => {
        if (!controller.signal.aborted) setEnabled(available);
      });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, []);

  const publish = async () => {
    if (!enabled || unavailable || busy || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const name = 'set' in source ? source.set.name : source.project.name;
    setPublishing(true);
    onPublishing(true);
    setError('');
    setCopyStatus('');
    try {
      const result = await publishSharedPlayout(source, controller.signal);
      if (!controller.signal.aborted) setPublication({ ...result, name });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Shared playout publication failed.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setPublishing(false);
      onPublishing(false);
    }
  };

  const copyLink = async (label: string, url: string) => {
    try {
      if (!window.navigator.clipboard) throw new Error('Clipboard is unavailable.');
      await window.navigator.clipboard.writeText(url);
      setCopyStatus(`${label} link copied.`);
    } catch {
      setCopyStatus(`Use the ${label.toLowerCase()} link menu to copy its URL.`);
    }
  };

  return (
    <section aria-label="Shared LAN playout" className="preview-playout-share">
      <div className="preview-controls-row">
        <button
          type="button"
          disabled={!enabled || Boolean(unavailable) || busy || publishing}
          onClick={() => void publish()}
        >
          {publishing ? 'Certifying and publishing…' : 'Publish to LAN'}
        </button>
      </div>
      {enabled === null && (
        <p className="preview-export-status" role="status">
          Checking shared playout…
        </p>
      )}
      {enabled === false && (
        <p className="preview-export-status">
          Start Studio with <code>--playout-port &lt;port&gt;</code> to enable shared playout. Set{' '}
          <code>--playout-host &lt;LAN IPv4&gt;</code> for access from other machines.
        </p>
      )}
      {enabled && unavailable && <p className="preview-export-status">{unavailable}</p>}
      {error && (
        <p className="preview-validation invalid" role="alert">
          {error}
        </p>
      )}
      {publication && (
        <>
          <p className="preview-export-status" role="status">
            Published “{publication.name}” for real-time playout.
          </p>
          {(
            [
              ['Viewer', publication.viewerUrl],
              ['Operator', publication.operatorUrl],
            ] as const
          ).map(([label, url]) => (
            <div className="preview-controls-row" key={label}>
              <a href={url} target="_blank" rel="noreferrer">
                {label} link
              </a>
              <button type="button" onClick={() => void copyLink(label, url)}>
                Copy {label.toLowerCase()} link
              </button>
            </div>
          ))}
        </>
      )}
      {copyStatus && (
        <p className="preview-export-status" role="status">
          {copyStatus}
        </p>
      )}
    </section>
  );
}

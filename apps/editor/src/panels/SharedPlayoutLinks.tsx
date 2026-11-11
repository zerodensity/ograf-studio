import { useState } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useSharedPlayoutEditor } from '../state/sharedPlayoutEditor';

export function SharedPlayoutLinks() {
  const { window } = useEditorWindow();
  const { checking, links, preparingName, publicationName, error, retry } =
    useSharedPlayoutEditor();
  const [copyStatus, setCopyStatus] = useState('');
  const copyLink = async (label: string, url: string) => {
    try {
      await window.navigator.clipboard.writeText(url);
      setCopyStatus(`${label} link copied.`);
    } catch {
      setCopyStatus(`Use the ${label.toLowerCase()} link menu to copy its URL.`);
    }
  };

  return (
    <section aria-label="Shared LAN playout" className="preview-playout-share">
      {checking ? (
        <p className="preview-export-status" role="status">
          Checking shared playout…
        </p>
      ) : !links ? (
        <p className="preview-export-status">
          Start Studio with <code>--playout-port &lt;port&gt;</code> to enable shared playout. Set{' '}
          <code>--playout-host &lt;LAN IPv4&gt;</code> for access from other machines.
        </p>
      ) : (
        <>
          <p className="preview-export-status" role="status">
            {preparingName
              ? `Preparing “${preparingName}” for the shared Live session…`
              : publicationName
                ? `The viewer link shows the shared Live session for “${publicationName}”.`
                : 'Open a template to start the shared Live session.'}
          </p>
          {(
            [
              ['Viewer', links.viewerUrl],
              ['Operator', links.operatorUrl],
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
      {error && (
        <>
          <p className="preview-validation invalid" role="alert">
            {error}
          </p>
          <div className="preview-controls-row">
            <button type="button" onClick={() => retry?.()} disabled={preparingName !== null}>
              Retry shared preview
            </button>
          </div>
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

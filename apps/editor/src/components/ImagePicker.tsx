import { useEditorWindow, isDomElement } from '../layout/EditorWindow';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActiveComposition } from '../state/projectStore';
import { useImagePlacement } from '../state/useImagePlacement';
import { IMAGE_ACCEPT } from '../state/imageImport';
import './ImagePicker.css';

export function ImagePicker({
  onClose,
  replaceLayerId,
}: {
  onClose: () => void;
  replaceLayerId?: string;
}) {
  const { document } = useEditorWindow();
  const composition = useActiveComposition();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const { place, busy, error } = useImagePlacement();
  const images = composition.assets.filter((a) => a.kind === 'image');
  const matches = images.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    const node = dialog.current!;
    const previousFocus = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (isDomElement(previousFocus) && previousFocus.isConnected) previousFocus.focus();
    };
  }, [document]);
  const choose = async (source: File[] | { assetId: string }) => {
    if (await place(source, { replaceLayerId })) onClose();
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="image-picker"
      aria-labelledby="image-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
    >
      <header className="image-picker-header">
        <div>
          <h2 id="image-picker-title">{replaceLayerId ? 'Replace image' : 'Add images'}</h2>
          <p>
            {replaceLayerId
              ? 'Keep this layer’s size, position and animation.'
              : 'Choose a file or reuse an image from this template.'}
          </p>
        </div>
        <button type="button" aria-label="Close image picker" onClick={onClose}>
          ×
        </button>
      </header>
      <div
        className={`image-picker-upload${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files = [...event.dataTransfer.files];
          if (files.length) void choose(files);
        }}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="3" y="4" width="26" height="24" rx="2" />
          <circle cx="11" cy="12" r="3" />
          <path d="m5 25 9-9 6 6 4-4 5 5" />
        </svg>
        <strong>{busy ? 'Opening image…' : 'Drop images here'}</strong>
        <span>PNG, JPEG, WebP, GIF, AVIF or SVG</span>
        <button
          className="image-picker-primary"
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Choose {replaceLayerId ? 'file' : 'files'}…
        </button>
        <input
          ref={input}
          type="file"
          aria-label="Image files"
          accept={IMAGE_ACCEPT}
          multiple={!replaceLayerId}
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) void choose(files);
          }}
        />
      </div>
      {error && (
        <p className="image-picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="image-picker-library-heading">
        <strong>
          In this template <span>{images.length}</span>
        </strong>
        {images.length > 0 && (
          <input
            type="search"
            aria-label="Find an image"
            placeholder="Find an image…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </div>
      {matches.length ? (
        <div className="image-picker-grid">
          {matches.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="image-picker-card"
              disabled={busy}
              onClick={() => void choose({ assetId: asset.id })}
              title={asset.name}
            >
              <span className="image-picker-thumbnail">
                <img src={asset.dataUri} alt="" />
              </span>
              <span>{asset.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="image-picker-empty">
          {images.length ? 'No matching images.' : 'Images you add will appear here for reuse.'}
        </p>
      )}
      <footer>
        {replaceLayerId
          ? 'The original image stays available in Resources.'
          : 'Images keep their proportions. Large images are fitted to the canvas.'}
      </footer>
    </dialog>,
    document.body,
  );
}

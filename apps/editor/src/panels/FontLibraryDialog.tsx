import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorWindow } from '../layout/EditorWindow';
import { useMovableDialog } from '../components/useMovableDialog';
import { prepareLibraryFontAsset } from '../state/fontLibraryImport';
import { acquireProjectFonts, hasLoadedProjectFont } from '../state/projectFonts';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useProjectStore } from '../state/projectStore';
import { FONT_LIBRARY, type LibraryFont } from '../state/fontLibraryCatalog';
import './FontLibraryDialog.css';

export function FontLibraryDialog({
  layerId,
  compositionId,
  text,
  onApply,
  onClose,
}: {
  layerId: string;
  compositionId: string;
  text: string;
  onApply: (family: string) => void;
  onClose: () => void;
}) {
  const { document, window } = useEditorWindow();
  const ref = useRef<HTMLDialogElement>(null),
    active = useRef(true),
    movable = useMovableDialog(ref);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('All'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      FONT_LIBRARY.filter(
        (font) =>
          (category === 'All' || font.category === category) &&
          font.family.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, category],
  );
  useEffect(() => {
    const dialog = ref.current!;
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    const loaded: FontFace[] = [];
    if (window.FontFace && document.fonts)
      for (const font of FONT_LIBRARY) {
        const face = new window.FontFace(
          `OGraf Library ${font.id}`,
          `url(${JSON.stringify(font.url)})`,
          { weight: font.weight },
        );
        document.fonts.add(face);
        loaded.push(face);
        void face.load().catch(() => {});
      }
    return () => {
      active.current = false;
      for (const face of loaded) document.fonts.delete(face);
      if (dialog.open) dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [document, window]);
  const add = async (font: LibraryFont) => {
    setBusy(font.id);
    setError('');
    let lease: ReturnType<typeof acquireProjectFonts> | undefined;
    try {
      const asset = await prepareLibraryFontAsset(font);
      if (!active.current) return;
      lease = acquireProjectFonts(document, [asset]);
      await lease.ready;
      if (!active.current) return;
      if (!hasLoadedProjectFont(document, font.family))
        throw new Error(`The ${font.family} font could not be loaded.`);
      const state = useProjectStore.getState();
      const composition = state.project.compositions.find((item) => item.id === compositionId);
      const layer = composition?.layers.find((item) => item.id === layerId);
      if (
        state.activeCompositionId !== compositionId ||
        !layer ||
        layer.isLocked ||
        layer.element.type !== 'text'
      )
        throw new Error('The original text object is no longer available.');
      const duplicate = composition!.assets.find(
        (item) => item.dataUri === asset.dataUri && item.mimeType === asset.mimeType,
      );
      if (duplicate && duplicate.kind !== 'font')
        throw new Error('This resource is already imported with a different type.');
      if (duplicate && duplicate.fontFamily && duplicate.fontFamily !== font.family)
        throw new Error('This font is already imported under a different family name.');
      runDiscreteHistoryStep(() => {
        const id = useProjectStore.getState().addPreparedAsset(asset);
        if (duplicate && (!duplicate.fontFamily || !duplicate.licenseText)) {
          useProjectStore.getState().updateAsset(id, {
            ...(!duplicate.fontFamily
              ? { fontFamily: font.family, fontWeight: font.weight, fontStyle: 'normal' as const }
              : {}),
            ...(!duplicate.licenseText
              ? {
                  licenseName: asset.licenseName,
                  licenseUrl: asset.licenseUrl,
                  licenseText: asset.licenseText,
                }
              : {}),
          });
        }
        onApply(font.family);
      }, `Apply ${font.family} font`);
      onClose();
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lease?.dispose();
      if (active.current) setBusy(null);
    }
  };
  return createPortal(
    <dialog
      ref={ref}
      {...movable.dialogProps}
      className="font-library-dialog"
      aria-labelledby="font-library-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header {...movable.handleProps}>
        <div>
          <h2 id="font-library-title">Font library</h2>
          <p>Bundled fonts are added to the template and included in exports.</p>
        </div>
        <button type="button" aria-label="Close font library" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="font-library-filters">
        <input
          aria-label="Search fonts"
          placeholder="Search fonts…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <select
          aria-label="Font category"
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value)}
        >
          <option>All</option>
          <option>Sans serif</option>
          <option>Serif</option>
          <option>Display</option>
        </select>
      </div>
      <div className="font-library-list">
        {filtered.map((font) => (
          <article className="font-library-card" key={font.id}>
            <div className="font-library-name">
              <strong>{font.family}</strong>
              <span>{font.category} · SIL OFL 1.1</span>
              <button type="button" disabled={busy !== null} onClick={() => void add(font)}>
                {busy === font.id ? 'Adding…' : 'Add to project'}
              </button>
            </div>
            <div
              className="font-library-preview"
              style={{ fontFamily: `"OGraf Library ${font.id}"` }}
            >
              {text.trim() || 'The quick brown fox 0123456789'}
            </div>
            <small>Pairs with {font.pairings.join(' · ')}</small>
            <details>
              <summary>View license</summary>
              <pre className="font-library-license">{font.licenseText}</pre>
            </details>
          </article>
        ))}
        {!filtered.length && <p>No fonts match this search.</p>}
      </div>
      {error && (
        <p role="alert" className="font-library-error">
          {error}
        </p>
      )}
      <footer>
        Fonts are available offline. Adobe Fonts are not included because their licenses generally
        do not permit embedding.
      </footer>
    </dialog>,
    document.body,
  );
}

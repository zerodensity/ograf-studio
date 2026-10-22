import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorWindow } from '../layout/EditorWindow';
import { nodosPresetName, type NodosPresetOptions } from '../state/nodosPreset';
import './TemplateSaveDialog.css';

/** Asks for the name and node menu category of a Nodos preset, then exports it. */
export function NodosPresetDialog({
  defaultName,
  fileName,
  onClose,
  onSaved,
  save,
}: {
  defaultName: string;
  fileName: string;
  onClose: () => void;
  onSaved: () => void;
  save: (options: NodosPresetOptions) => Promise<'saved' | 'cancelled' | 'downloaded'>;
}) {
  const { document: ownerDocument } = useEditorWindow();
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState('OGraf');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const canSave = !saving && name.trim() !== '' && category.trim() !== '';
  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const result = await save({ displayName: name.trim(), category: category.trim() });
      if (result !== 'cancelled') onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the Nodos preset.');
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <div className="template-save-backdrop">
      <section
        className="template-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export Nodos preset"
        ref={dialogRef}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !saving) onClose();
          if (event.key === 'Enter') void submit();
          if (event.key === 'Tab') {
            const controls = [
              ...(dialogRef.current?.querySelectorAll<HTMLElement>(
                'input:not(:disabled), button:not(:disabled)',
              ) ?? []),
            ];
            const current = controls.indexOf(ownerDocument.activeElement as HTMLElement);
            if (
              controls.length &&
              ((event.shiftKey && current <= 0) ||
                (!event.shiftKey && current === controls.length - 1))
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <h2>Export Nodos preset</h2>
        <label>
          Name in the Nodos node menu
          <input
            ref={inputRef}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Menu category
          <input
            value={category}
            disabled={saving}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        <div className="template-save-filenames">
          <span>{fileName}</span>
          <span>{nodosPresetName(name.trim())}.nosnode (inside ZIP)</span>
        </div>
        <p>
          The ZIP holds the OGraf package, a page that plays it, and a preset that creates an
          ElectroNode showing that page. RealityHub serves the package and sends the preset to
          Nodos.
        </p>
        {error ? (
          <div role="alert" className="template-save-error">
            {error}
          </div>
        ) : null}
        <div className="template-save-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!canSave} onClick={() => void submit()}>
            {saving ? 'Testing & exporting…' : 'Export .nodos.zip'}
          </button>
        </div>
      </section>
    </div>,
    ownerDocument.body,
  );
}

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useMovableDialog } from '../components/useMovableDialog';
import { useEditorWindow } from '../layout/EditorWindow';
import { EXAMPLE_LEVELS, type ExampleLevel, type ExampleLicense } from './exampleCatalog';
import {
  loadExampleCatalogManager,
  saveExampleCatalogManager,
  type EditableExampleDetails,
  type EditableExampleEntry,
  type ExampleCatalogManagerSnapshot,
} from './exampleCatalogManagerFiles';
import './ExampleCatalogManager.css';

type DropTarget = { id: string; after: boolean };

function insertionTarget(event: DragEvent<HTMLLIElement>, id: string): DropTarget {
  const row = event.currentTarget.getBoundingClientRect();
  return { id, after: event.clientY >= row.top + row.height / 2 };
}

function moveExample(order: string[], id: string, { id: target, after }: DropTarget): string[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return order;
  const result = order.filter((entryId) => entryId !== id);
  result.splice(result.indexOf(target) + Number(after), 0, id);
  return result;
}

function CatalogFields({
  details,
  onChange,
}: {
  details: EditableExampleDetails;
  onChange(details: EditableExampleDetails): void;
}) {
  const editText = (
    key: 'title' | 'summary' | 'category' | 'author' | 'page' | 'credits',
    value: string,
  ) => {
    const next = { ...details, [key]: value };
    if ((key === 'page' || key === 'credits') && !value.trim()) delete next[key];
    onChange(next);
  };
  const textInput = (
    key: 'title' | 'category' | 'author' | 'page',
    label: string,
    maxLength: number,
  ) => (
    <label>
      {label}
      <input
        type={key === 'page' ? 'url' : 'text'}
        maxLength={maxLength}
        value={details[key] ?? ''}
        onChange={(event) => editText(key, event.currentTarget.value)}
      />
    </label>
  );
  const license = details.license;
  const editLicense = (key: keyof ExampleLicense, value: string) => {
    const nextLicense: ExampleLicense = { name: '', ...license, [key]: value };
    if (!nextLicense.url?.trim()) delete nextLicense.url;
    if (!nextLicense.attribution?.trim()) delete nextLicense.attribution;
    const next = { ...details };
    if (nextLicense.name.trim() || nextLicense.url || nextLicense.attribution) {
      next.license = nextLicense;
    } else {
      delete next.license;
    }
    onChange(next);
  };

  return (
    <>
      {textInput('title', 'Title', 80)}
      <label>
        Summary
        <textarea
          rows={3}
          maxLength={300}
          value={details.summary}
          onChange={(event) => editText('summary', event.currentTarget.value)}
        />
      </label>
      <div className="example-catalog-manager-field-row">
        {textInput('category', 'Category', 40)}
        <label>
          Level
          <select
            value={details.level}
            onChange={(event) =>
              onChange({ ...details, level: event.currentTarget.value as ExampleLevel })
            }
          >
            {EXAMPLE_LEVELS.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Tags (one per line)
        <textarea
          rows={3}
          value={details.tags.join('\n')}
          onChange={(event) =>
            onChange({ ...details, tags: event.currentTarget.value.split('\n') })
          }
        />
      </label>
      {textInput('author', 'Author', 80)}
      {textInput('page', 'Example page URL', 512)}
      <label className="example-catalog-manager-checkbox">
        <input
          type="checkbox"
          checked={!details.unlisted}
          onChange={(event) => onChange({ ...details, unlisted: !event.currentTarget.checked })}
        />
        List this example in Project Explorer
      </label>
      <fieldset className="example-catalog-manager-license">
        <legend>License &amp; Credits</legend>
        <label>
          License name
          <input
            maxLength={120}
            value={license?.name ?? ''}
            onChange={(event) => editLicense('name', event.currentTarget.value)}
          />
        </label>
        <label>
          License URL
          <input
            type="url"
            maxLength={512}
            value={license?.url ?? ''}
            onChange={(event) => editLicense('url', event.currentTarget.value)}
          />
        </label>
        <label>
          Attribution
          <textarea
            rows={2}
            maxLength={1000}
            value={license?.attribution ?? ''}
            onChange={(event) => editLicense('attribution', event.currentTarget.value)}
          />
        </label>
        <label>
          Third-party credits
          <textarea
            rows={2}
            maxLength={2000}
            value={details.credits ?? ''}
            onChange={(event) => editText('credits', event.currentTarget.value)}
          />
        </label>
      </fieldset>
    </>
  );
}

export function ExampleCatalogManager({ onClose }: { onClose(): void }) {
  const { window: owner } = useEditorWindow();
  const dialog = useRef<HTMLElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const movable = useMovableDialog(dialog);
  const [snapshot, setSnapshot] = useState<ExampleCatalogManagerSnapshot | null>(null);
  const [entries, setEntries] = useState<EditableExampleEntry[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [busy, setBusy] = useState<'open' | 'save' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const dragging = useRef<string | null>(null);
  const busyRef = useRef(false);
  const supported = typeof owner.showDirectoryPicker === 'function';
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const dirty =
    !!snapshot &&
    (order.some((id, index) => id !== snapshot.order[index]) ||
      entries.some(
        (entry, index) =>
          entry !== snapshot.entries[index] &&
          JSON.stringify(entry) !== JSON.stringify(snapshot.entries[index]),
      ));

  useEffect(() => {
    firstButton.current?.focus();
  }, []);

  const confirmDiscard = () => !dirty || owner.confirm('Discard unsaved catalog changes?');
  const close = () => {
    if (!busyRef.current && confirmDiscard()) onClose();
  };
  const open = async () => {
    if (busyRef.current || !owner.showDirectoryPicker || !confirmDiscard()) return;
    busyRef.current = true;
    setBusy('open');
    setStatus('');
    setError('');
    try {
      const directory = await owner.showDirectoryPicker({
        mode: 'readwrite',
        id: 'ograf-example-catalog',
      });
      const loaded = await loadExampleCatalogManager(directory);
      setSnapshot(loaded);
      setEntries(loaded.entries);
      setOrder(loaded.order);
      setSelectedId(loaded.order[0] ?? null);
      setStatus(`Opened ${loaded.name}.`);
    } catch (cause) {
      if (!(cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Could not open the catalog.');
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const save = async () => {
    if (!snapshot || !dirty || busyRef.current) return;
    busyRef.current = true;
    setBusy('save');
    setStatus('');
    setError('');
    try {
      const normalized = entries.map((entry, index) => {
        if (entry === snapshot.entries[index]) return entry;
        return {
          ...entry,
          details: { ...entry.details, tags: entry.details.tags.filter((tag) => tag.trim()) },
        };
      });
      const saved = await saveExampleCatalogManager(snapshot, normalized, order);
      setSnapshot(saved);
      setEntries(saved.entries);
      setOrder(saved.order);
      setStatus('Saved to the local catalog folder.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the catalog.');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const edit = (id: string, details: EditableExampleDetails) => {
    if (busyRef.current) return;
    setEntries((items) => items.map((entry) => (entry.id === id ? { ...entry, details } : entry)));
    setStatus('');
    setError('');
  };
  const move = (id: string, target: DropTarget) => {
    if (busyRef.current) return;
    const next = moveExample(order, id, target);
    const index = next.indexOf(id);
    if (index === order.indexOf(id)) return;
    setOrder(next);
    setStatus(
      `${byId.get(id)?.details.title || id} moved to position ${index + 1} of ${next.length}.`,
    );
    setError('');
  };
  const clearDrag = () => {
    dragging.current = null;
    setDropTarget(null);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:enabled, input:enabled, select:enabled, textarea:enabled, [data-movable-dialog-handle]',
    );
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    const focused = event.currentTarget.ownerDocument.activeElement;
    if (event.shiftKey && focused === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && focused === last && first) {
      event.preventDefault();
      first.focus();
    }
  };

  let body: ReactNode;
  if (!snapshot) {
    body = (
      <div className="example-catalog-manager-empty">
        <h2>Choose an examples checkout</h2>
        <p>Select the folder containing catalog.json to edit its details and featured order.</p>
        {!supported && (
          <p>Open Studio in a browser with local folder access to edit the catalog.</p>
        )}
      </div>
    );
  } else {
    body = (
      <div className="example-catalog-manager-body">
        <div className="example-catalog-manager-list">
          <h2>Featured order</h2>
          <p>Drag an example or use the move buttons.</p>
          <ol aria-label="Featured order">
            {order.map((id, index) => {
              const example = byId.get(id)!;
              const title = example.details.title || id;
              return (
                <li
                  key={id}
                  data-selected={id === selectedId || undefined}
                  data-drop={
                    dropTarget?.id === id ? (dropTarget.after ? 'after' : 'before') : undefined
                  }
                  onDragOver={(event) => {
                    if (!dragging.current || busyRef.current) return;
                    event.preventDefault();
                    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                    setDropTarget(dragging.current === id ? null : insertionTarget(event, id));
                  }}
                  onDrop={(event) => {
                    const source = dragging.current;
                    if (!source || busyRef.current) return;
                    event.preventDefault();
                    move(source, insertionTarget(event, id));
                    clearDrag();
                  }}
                >
                  <span
                    className="example-catalog-manager-handle"
                    draggable={!busy}
                    aria-hidden="true"
                    title="Drag to reorder"
                    onDragStart={(event) => {
                      if (busyRef.current) {
                        event.preventDefault();
                        return;
                      }
                      dragging.current = id;
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', id);
                      }
                    }}
                    onDragEnd={clearDrag}
                  >
                    ⠿
                  </span>
                  <button
                    type="button"
                    className="example-catalog-manager-select"
                    aria-pressed={id === selectedId}
                    onClick={() => setSelectedId(id)}
                    disabled={!!busy}
                  >
                    <span>{title}</span>
                    {example.details.unlisted && <small>Unlisted</small>}
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${title} up`}
                    disabled={!!busy || index === 0}
                    onClick={() => move(id, { id: order[index - 1]!, after: false })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${title} down`}
                    disabled={!!busy || index === order.length - 1}
                    onClick={() => move(id, { id: order[index + 1]!, after: true })}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        {selected ? (
          <div className="example-catalog-manager-details" key={selected.id}>
            <h2>Example details</h2>
            <code>{selected.id}</code>
            <fieldset disabled={!!busy}>
              <CatalogFields
                details={selected.details}
                onChange={(details) => edit(selected.id, details)}
              />
            </fieldset>
          </div>
        ) : (
          <p className="example-catalog-manager-empty">This catalog has no examples.</p>
        )}
      </div>
    );
  }

  return (
    <div className="example-catalog-manager-backdrop">
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="example-catalog-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="example-catalog-manager-title"
        aria-busy={!!busy}
        onKeyDown={keyDown}
      >
        <header {...movable.handleProps} className="example-catalog-manager-header">
          <h1 id="example-catalog-manager-title">Example catalog manager</h1>
          <button
            type="button"
            ref={supported ? undefined : firstButton}
            onClick={close}
            disabled={!!busy}
          >
            Back to Project Explorer
          </button>
        </header>
        <div className="example-catalog-manager-toolbar">
          <button
            ref={supported ? firstButton : undefined}
            type="button"
            disabled={!!busy || !supported}
            onClick={() => void open()}
          >
            {busy === 'open'
              ? 'Opening…'
              : snapshot
                ? 'Choose another folder…'
                : 'Choose catalog folder…'}
          </button>
          {snapshot && <span className="example-catalog-manager-folder">{snapshot.name}</span>}
        </div>
        {body}
        <footer className="example-catalog-manager-footer">
          <div>
            <p role="status">{status || (dirty ? 'Unsaved changes' : '')}</p>
            {error && <p role="alert">{error}</p>}
          </div>
          {snapshot && (
            <button
              type="button"
              className="example-catalog-manager-save"
              disabled={!!busy || !dirty}
              onClick={() => void save()}
            >
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

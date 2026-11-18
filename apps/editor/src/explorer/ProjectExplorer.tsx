import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { PROJECT_DOCUMENT_VERSION } from '@ograf-editor/scene-model';
import { OgrafLogo } from '../components/OgrafLogo';
import {
  StartupSettingsFields,
  useStartupSettingsDraft,
} from '../components/StartupSettingsFields';
import { useMovableDialog } from '../components/useMovableDialog';
import { STUDIO_BUILD_DATE, STUDIO_BUILD_REVISION, STUDIO_VERSION } from '../state/buildInfo';
import { openStudioDocumentFromFile } from '../state/fileIO';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { importEditableProjectFromOgraf } from '../state/importOgraf';
import { onAirFrame } from '../state/onAirFrame';
import { applyOpenedStudioDocument } from '../state/openStudioDocument';
import { useProjectStore } from '../state/projectStore';
import {
  listRecentDocuments,
  readRecentDocument,
  type RecentDocument,
} from '../state/recentDocuments';
import { useSelectionStore } from '../state/selectionStore';
import { commitStartupCreation } from '../state/startupCreation';
import { openStartupImportedGraphic } from '../state/startupImport';
import { useStartupScreenStore, type StartupRequest } from '../state/startupScreenStore';
import { parseStudioDocument } from '../state/studioDocument';
import { useTimelineStore } from '../state/timelineStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import {
  EMPTY_EXAMPLE_CATALOG,
  EXAMPLE_LEVELS,
  type ExampleLevel,
  type ExampleSource,
} from './exampleCatalog';
import { loadExampleBytes } from './exampleCatalogClient';
import { exampleFileCache, useExampleCatalogStore } from './exampleCatalogStore';
import {
  EXPLORER_SORT_LABELS,
  EXPLORER_SORTS,
  explorerCategories,
  isNewExample,
  listExplorerItems,
  type ExampleItem,
  type ExplorerBrowse,
  type ExplorerItem,
  type ExplorerSort,
  type RecipeItem,
} from './explorerItems';
import { useExampleAsset } from './useExampleAsset';
import './ProjectExplorer.css';

const BLANK = 'blank';
/** The pointer must rest on a card this long before its preview loads, so a pass-over costs nothing. */
const HOVER_PREVIEW_DELAY_MS = 180;

/** `ready` opens now; `download` needs a connection that is there; `offline` one that is not. */
type Availability = 'ready' | 'download' | 'offline' | 'update';
type SourceFilter = 'local' | 'online' | null;

function recipeAsset(recipe: RecipeItem, extension: 'webp' | 'mp4'): string {
  return `${import.meta.env.BASE_URL}explorer/recipes/${recipe.id}.${extension}`;
}

function megabytes(bytes: number): string {
  return bytes < 100_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Badge({ item, availability }: { item: ExplorerItem; availability: Availability }) {
  if (item.kind === 'recipe')
    return <span className="project-explorer-badge is-recipe">Recipe</span>;
  if (availability === 'update')
    return <span className="project-explorer-badge is-muted">Needs newer Studio</span>;
  if (item.source === 'builtin') return <span className="project-explorer-badge">Built in</span>;
  if (availability === 'ready')
    return <span className="project-explorer-badge is-saved">Saved</span>;
  if (availability === 'offline')
    return <span className="project-explorer-badge is-muted">Needs internet</span>;
  return <span className="project-explorer-badge is-online">Online</span>;
}

/** A still picture that turns into the looping preview while `playing`. */
function Picture({
  image,
  video,
  playing,
  label,
}: {
  image: string | null;
  video: string | null;
  playing: boolean;
  label: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => setImageFailed(false), [image]);
  useEffect(() => setVideoFailed(false), [video]);
  return (
    <span className="project-explorer-picture">
      {image && !imageFailed ? (
        <img src={image} alt="" draggable={false} onError={() => setImageFailed(true)} />
      ) : (
        <span className="project-explorer-picture-empty">{label}</span>
      )}
      {playing && video && !videoFailed && (
        <video
          src={video}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
          onError={() => setVideoFailed(true)}
        />
      )}
    </span>
  );
}

function ItemPicture({ item, playing }: { item: ExplorerItem; playing: boolean }) {
  const source: ExampleSource = item.kind === 'example' ? item.source : 'builtin';
  const image = useExampleAsset(
    item.kind === 'example' ? item.thumbnailUrl : recipeAsset(item, 'webp'),
    source,
  );
  const video = useExampleAsset(
    !playing ? null : item.kind === 'example' ? item.previewUrl : recipeAsset(item, 'mp4'),
    source,
  );
  return <Picture image={image} video={video} playing={playing} label={item.title} />;
}

function Card({
  item,
  selected,
  availability,
  isNew,
  onSelect,
  onActivate,
}: {
  item: ExplorerItem;
  selected: boolean;
  availability: Availability;
  isNew: boolean;
  onSelect(): void;
  onActivate(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`project-explorer-card${selected ? ' is-selected' : ''}${
        availability === 'offline' || availability === 'update' ? ' is-unavailable' : ''
      }`}
      data-explorer-card={item.id}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onActivate}
      onPointerEnter={() => {
        timer.current = window.setTimeout(() => setHovered(true), HOVER_PREVIEW_DELAY_MS);
      }}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setHovered(false);
      }}
    >
      <ItemPicture item={item} playing={hovered} />
      <span className="project-explorer-card-badges">
        <Badge item={item} availability={availability} />
        {isNew && <span className="project-explorer-badge is-new">New</span>}
      </span>
      <span className="project-explorer-card-text">
        <strong>{item.title}</strong>
        <span>{[item.level, ...item.tags.slice(0, 2)].join(' · ')}</span>
      </span>
    </button>
  );
}

function Properties({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="project-explorer-properties">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LicenseAndCredits({ license, credits }: Pick<ExampleItem, 'license' | 'credits'>) {
  return (
    <details className="project-explorer-license">
      <summary>License &amp; Credits</summary>
      <p>
        {license?.url ? (
          <a href={license.url} target="_blank" rel="noopener noreferrer">
            {license.name} ↗
          </a>
        ) : (
          (license?.name ?? 'License not specified')
        )}
      </p>
      {license?.attribution && <p>{license.attribution}</p>}
      {credits && (
        <>
          <h3>Third-party credits</h3>
          <p>{credits}</p>
        </>
      )}
    </details>
  );
}

export function ProjectExplorer({ request }: { request: StartupRequest }) {
  const isStartup = request.kind === 'startup';
  /** Adding a template to an open set starts from a blank or a recipe; examples replace the document. */
  const offersExamples = isStartup || request.kind === 'new-template';
  const draft = useStartupSettingsDraft(request, true);
  const close = () => useStartupScreenStore.getState().close();
  const showWelcomeOnStartup = useWorkspaceStore(
    (state) => state.editorPreferences.showWelcomeOnStartup,
  );
  const workspaceStorageError = useWorkspaceStore((state) => state.storageError);
  const storedCatalog = useExampleCatalogStore((state) => state.catalog);
  const online = useExampleCatalogStore((state) => state.online);
  const savedIds = useExampleCatalogStore((state) => state.savedIds);
  const catalog = offersExamples ? storedCatalog : EMPTY_EXAMPLE_CATALOG;

  const [view, setView] = useState<'library' | 'recent'>('library');
  const [browse, setBrowse] = useState<ExplorerBrowse>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [level, setLevel] = useState<ExampleLevel | null>(null);
  const [source, setSource] = useState<SourceFilter>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ExplorerSort>('featured');
  const [selectedId, setSelectedId] = useState(BLANK);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preferenceTouched, setPreferenceTouched] = useState(false);
  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const dialog = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const movable = useMovableDialog(dialog);

  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    if (offersExamples) void useExampleCatalogStore.getState().refresh();
  }, [offersExamples]);
  useEffect(() => {
    if (isStartup) void listRecentDocuments().then(setRecent);
  }, [isStartup]);
  useEffect(() => {
    if (!isStartup) return;
    const initialProject = useProjectStore.getState().project;
    return useProjectStore.subscribe((state) => {
      if (state.project !== initialProject) useStartupScreenStore.getState().setVisible(false);
    });
  }, [isStartup]);

  const availabilityOf = (item: ExplorerItem): Availability => {
    if (item.kind === 'recipe') return 'ready';
    if (item.documentVersion > PROJECT_DOCUMENT_VERSION) return 'update';
    if (item.source === 'builtin' || savedIds.has(item.id)) return 'ready';
    return online === false ? 'offline' : 'download';
  };
  const fromSource = (item: ExplorerItem): boolean =>
    source === null ||
    (source === 'online'
      ? item.kind === 'example' && item.source === 'online'
      : availabilityOf(item) === 'ready');

  const listing = useMemo(
    () => listExplorerItems(catalog, { browse, category, level, query }, sort),
    [catalog, browse, category, level, query, sort],
  );
  const recipes = listing.recipes.filter(fromSource);
  const examples = listing.examples.filter(fromSource);
  const categories = useMemo(() => explorerCategories(catalog), [catalog]);
  const showBlank =
    browse !== 'examples' &&
    !category &&
    !level &&
    source !== 'online' &&
    'blank project empty'.includes(query.trim().toLocaleLowerCase());
  const items: ExplorerItem[] = [...recipes, ...examples];
  const order = [...(showBlank ? [BLANK] : []), ...items.map((item) => item.id)];
  const selected = order.includes(selectedId) ? selectedId : (order[0] ?? null);
  const selectedItem = items.find((item) => item.id === selected) ?? null;
  const now = useMemo(() => new Date(), []);
  const listedExamples = catalog.examples.filter((example) => !example.unlisted);

  const dismiss = () => {
    if (isStartup) {
      const startup = useStartupScreenStore.getState();
      if (startup.bootCreatedProject === useProjectStore.getState().project)
        startup.setPristineStartupProject(startup.bootCreatedProject);
    }
    close();
  };
  const ownerWindow = () => dialog.current?.ownerDocument.defaultView ?? window;
  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));

  /** Create the blank document this request asked for; recipes then build on it. */
  const prepare = (): boolean => {
    const settings = draft.resolve();
    if (!settings) {
      setError('Enter a positive whole-number canvas width and height, and a positive frame rate.');
      return false;
    }
    try {
      const created = commitStartupCreation(settings, (message) => ownerWindow().confirm(message));
      if (created) setError('');
      return created;
    } catch (cause) {
      report(cause);
      return false;
    }
  };
  const createBlank = () => {
    if (prepare()) close();
  };
  const createRecipe = (recipe: RecipeItem) => {
    if (!prepare()) return;
    let ids: string[] = [];
    runDiscreteHistoryStep(() => {
      ids = Object.values(useProjectStore.getState()[recipe.method]().layers);
    }, `Add ${recipe.title}`);
    useSelectionStore.getState().selectMany([...new Set(ids)]);
    const state = useProjectStore.getState();
    const composition = state.project.compositions.find(
      (item) => item.id === state.activeCompositionId,
    );
    if (composition) {
      const frame = onAirFrame(composition);
      useTimelineStore.getState().controller?.seek(frame);
      useTimelineStore.getState().setCurrentFrame(frame);
    }
    close();
  };
  const openExample = async (example: ExampleItem) => {
    if (opening || availabilityOf(example) === 'update' || availabilityOf(example) === 'offline')
      return;
    setOpening(example.id);
    setError('');
    try {
      const bytes = await loadExampleBytes(
        example,
        (input, init) => fetch(input, init),
        await exampleFileCache(),
      );
      const document = await parseStudioDocument(bytes);
      useExampleCatalogStore.getState().markSaved(example.id);
      // The window may have been closed, or reused for another request, while downloading.
      if (useStartupScreenStore.getState().request !== request) return;
      if (
        !isStartup &&
        !ownerWindow().confirm(
          `Open "${example.title}"? Unsaved changes in the current document will be lost.`,
        )
      )
        return;
      applyOpenedStudioDocument(document);
      close();
    } catch (cause) {
      report(cause);
    } finally {
      setOpening(null);
    }
  };
  const activate = (id: string | null) => {
    if (id === BLANK) createBlank();
    const item = items.find((candidate) => candidate.id === id);
    if (item?.kind === 'recipe') createRecipe(item);
    else if (item) void openExample(item);
  };
  const openFile = async () => {
    try {
      const document = await openStudioDocumentFromFile(ownerWindow());
      if (document) {
        applyOpenedStudioDocument(document);
        close();
      }
    } catch (cause) {
      report(cause);
    }
  };
  const importPackage = async () => {
    try {
      const imported = await importEditableProjectFromOgraf();
      if (!imported) return;
      openStartupImportedGraphic(imported);
      close();
    } catch (cause) {
      report(cause);
    }
  };
  const openRecent = async (item: RecentDocument) => {
    try {
      const opened = await readRecentDocument(item);
      if (
        !ownerWindow().confirm(
          'Open this recent document? Unsaved changes in the current document will be lost.',
        )
      )
        return;
      applyOpenedStudioDocument(opened);
      close();
    } catch (cause) {
      report(cause);
    }
  };

  /** Arrow keys walk the cards as they are laid out, across the recipe and example sections. */
  const move = (direction: 'left' | 'right' | 'up' | 'down') => {
    const cards = [
      ...(dialog.current?.querySelectorAll<HTMLElement>('[data-explorer-card]') ?? []),
    ];
    const current = cards.find((card) => card.dataset.explorerCard === selected);
    let target: HTMLElement | undefined;
    if (!current) target = cards[0];
    else if (direction === 'left' || direction === 'right')
      target = cards[cards.indexOf(current) + (direction === 'right' ? 1 : -1)];
    else {
      const from = current.getBoundingClientRect();
      const centre = from.left + from.width / 2;
      const beyond = cards
        .map((card) => ({ card, box: card.getBoundingClientRect() }))
        .filter(({ box }) =>
          direction === 'down' ? box.top > from.top + 1 : box.top < from.top - 1,
        );
      const rowTop =
        direction === 'down'
          ? Math.min(...beyond.map(({ box }) => box.top))
          : Math.max(...beyond.map(({ box }) => box.top));
      target = beyond
        .filter(({ box }) => Math.abs(box.top - rowTop) < 2)
        .toSorted(
          (a, b) =>
            Math.abs(a.box.left + a.box.width / 2 - centre) -
            Math.abs(b.box.left + b.box.width / 2 - centre),
        )[0]?.card;
    }
    if (!target) return;
    setSelectedId(target.dataset.explorerCard!);
    target.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    const target = event.target as HTMLElement;
    if (event.key === 'Tab') {
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [data-movable-dialog-handle]',
        ) ?? []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first && last && event.shiftKey && target === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && target === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    const inSearch = target === search.current;
    if (view !== 'library' || (!inSearch && target.matches('input, select, textarea'))) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 'down' : 'up');
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !inSearch) {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 'right' : 'left');
    } else if (event.key === 'Enter' && (inSearch || target.closest('[data-explorer-card]'))) {
      event.preventDefault();
      activate(selected);
    } else if (
      !inSearch &&
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      // Typing anywhere searches: the key lands in the search box because it now has the focus.
      if (event.key === '/') event.preventDefault();
      search.current?.focus();
    }
  };

  const railButton = (
    label: string,
    active: boolean,
    onClick: () => void,
    count?: number | string,
  ) => (
    <button
      key={label}
      type="button"
      className={`project-explorer-rail-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      {count !== undefined && <i>{count}</i>}
    </button>
  );
  const showLibrary = (next: { browse?: ExplorerBrowse; category?: string | null }) => {
    setView('library');
    setBrowse(next.browse ?? 'all');
    setCategory(next.category ?? null);
    setSource(null);
  };
  const inLibrary = view === 'library';
  const title = isStartup ? 'Start creating' : 'New template';
  const settingsHint =
    request.kind === 'set-template' || request.kind === 'second-template'
      ? 'The new template is added to the template set.'
      : null;

  const detail = (() => {
    if (!inLibrary) return null;
    if (selected === BLANK)
      return (
        <>
          <div className="project-explorer-detail-body">
            <span className="project-explorer-picture is-blank">
              <span className="project-explorer-picture-empty">＋</span>
            </span>
            <h2>Blank project</h2>
            <p>An empty canvas at the size and frame rate you choose.</p>
            <div className="project-explorer-settings">
              <StartupSettingsFields draft={draft} />
            </div>
            {settingsHint && <p className="project-explorer-note">{settingsHint}</p>}
          </div>
          <div className="project-explorer-actions">
            <button type="button" className="project-explorer-primary" onClick={createBlank}>
              Create blank project
            </button>
          </div>
        </>
      );
    if (!selectedItem) return null;
    if (selectedItem.kind === 'recipe')
      return (
        <>
          <div className="project-explorer-detail-body">
            <ItemPicture item={selectedItem} playing />
            <h2>{selectedItem.title}</h2>
            <div className="project-explorer-badges">
              <Badge item={selectedItem} availability="ready" />
              <span className="project-explorer-badge">{selectedItem.level}</span>
            </div>
            <p>{selectedItem.summary}</p>
            <div className="project-explorer-settings">
              <StartupSettingsFields draft={draft} />
            </div>
            <p className="project-explorer-note">
              {settingsHint ?? 'A recipe is built for the canvas you choose here.'}
            </p>
          </div>
          <div className="project-explorer-actions">
            <button
              type="button"
              className="project-explorer-primary"
              onClick={() => createRecipe(selectedItem)}
            >
              Create {selectedItem.title}
            </button>
          </div>
        </>
      );
    const availability = availabilityOf(selectedItem);
    return (
      <>
        <div className="project-explorer-detail-body">
          <ItemPicture item={selectedItem} playing />
          <h2>{selectedItem.title}</h2>
          <div className="project-explorer-badges">
            <Badge item={selectedItem} availability={availability} />
            <span className="project-explorer-badge">{selectedItem.level}</span>
            {isNewExample(selectedItem, now) && (
              <span className="project-explorer-badge is-new">New</span>
            )}
          </div>
          <p>{selectedItem.summary}</p>
          <Properties
            rows={[
              ['Canvas', `${selectedItem.canvas.width} × ${selectedItem.canvas.height}`],
              ['Frame rate', `${Number(selectedItem.canvas.frameRate.toFixed(3))} fps`],
              ['Templates', selectedItem.templates],
              [
                'Size',
                `${megabytes(selectedItem.bytes)}${
                  selectedItem.source === 'online' && availability === 'ready'
                    ? ', saved on this computer'
                    : ''
                }`,
              ],
              ['Category', selectedItem.category],
              ['Updated', longDate(selectedItem.updated)],
              ['Author', selectedItem.author],
            ]}
          />
          <LicenseAndCredits
            key={selectedItem.id}
            license={selectedItem.license}
            credits={selectedItem.credits}
          />
          {selectedItem.tags.length > 0 && (
            <>
              <h3>Uses</h3>
              <div className="project-explorer-tags">
                {selectedItem.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </>
          )}
          <p className="project-explorer-note">
            {availability === 'update'
              ? 'This example was made with a newer OGraf Studio. Update Studio to open it.'
              : availability === 'offline'
                ? 'This example has not been downloaded yet. It opens once you are online.'
                : 'Opens as an untitled copy and keeps its own canvas size.'}
          </p>
        </div>
        <div className="project-explorer-actions">
          <button
            type="button"
            className="project-explorer-primary"
            disabled={availability === 'update' || availability === 'offline' || opening !== null}
            onClick={() => void openExample(selectedItem)}
          >
            {opening === selectedItem.id ? 'Opening…' : 'Open example'}
          </button>
          {selectedItem.pageUrl && (
            <a href={selectedItem.pageUrl} target="_blank" rel="noopener noreferrer">
              Web page ↗
            </a>
          )}
        </div>
      </>
    );
  })();

  const cards = (list: ExplorerItem[]) =>
    list.map((item) => (
      <Card
        key={item.id}
        item={item}
        selected={item.id === selected}
        availability={availabilityOf(item)}
        isNew={item.kind === 'example' && isNewExample(item, now)}
        onSelect={() => setSelectedId(item.id)}
        onActivate={() => activate(item.id)}
      />
    ));

  return (
    <div className="project-explorer-backdrop">
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="project-explorer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-explorer-title"
        onKeyDown={onKeyDown}
      >
        <header {...movable.handleProps} className="project-explorer-header">
          <h1 id="project-explorer-title">{title}</h1>
          <input
            ref={search}
            type="search"
            className="project-explorer-search"
            placeholder={offersExamples ? 'Search recipes and examples…' : 'Search recipes…'}
            aria-label="Search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setView('library');
            }}
          />
          <button
            type="button"
            className="project-explorer-close"
            aria-label={isStartup ? 'Close welcome screen' : 'Close without creating'}
            onClick={dismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="project-explorer-body">
          <nav className="project-explorer-rail" aria-label="Browse">
            <h2>Start</h2>
            {railButton('＋ Blank project', false, () => {
              showLibrary({});
              setLevel(null);
              setQuery('');
              setSelectedId(BLANK);
            })}
            {isStartup &&
              railButton('Recent', view === 'recent', () => setView('recent'), recent.length)}
            {isStartup && railButton('Open file…', false, () => void openFile())}
            {isStartup && railButton('Import .ograf.zip…', false, () => void importPackage())}
            <h2>Browse</h2>
            {railButton(
              'All',
              inLibrary && browse === 'all' && !category && !source,
              () => showLibrary({}),
              (offersExamples ? listedExamples.length : 0) + 6,
            )}
            {offersExamples &&
              railButton(
                'Recipes',
                inLibrary && browse === 'recipes' && !category && !source,
                () => showLibrary({ browse: 'recipes' }),
                6,
              )}
            {offersExamples &&
              railButton(
                'Examples',
                inLibrary && browse === 'examples' && !category && !source,
                () => showLibrary({ browse: 'examples' }),
                listedExamples.length,
              )}
            <h2>Category</h2>
            {categories.map(({ name, count }) =>
              railButton(
                name,
                inLibrary && category === name,
                () => showLibrary({ category: name }),
                count,
              ),
            )}
            {offersExamples && (
              <>
                <h2>Source</h2>
                {railButton('On this computer', inLibrary && source === 'local', () => {
                  showLibrary({});
                  setSource('local');
                })}
                {railButton('Online', inLibrary && source === 'online', () => {
                  showLibrary({});
                  setSource('online');
                })}
              </>
            )}
            <div className="project-explorer-rail-footer">
              {offersExamples && online === false && (
                <p>Offline. Showing the examples saved on this computer.</p>
              )}
              {isStartup && (
                <label title="Turn this back on in Settings & Preferences → Workspace & windows.">
                  <input
                    type="checkbox"
                    checked={showWelcomeOnStartup === false}
                    onChange={(event) => {
                      const hidden = event.currentTarget.checked;
                      setPreferenceTouched(true);
                      useWorkspaceStore.getState().updateEditorPreferences({
                        showWelcomeOnStartup: !hidden,
                      });
                      const startup = useStartupScreenStore.getState();
                      startup.setPristineStartupProject(hidden ? startup.bootCreatedProject : null);
                    }}
                  />
                  Don’t show on startup
                </label>
              )}
              {isStartup && preferenceTouched && workspaceStorageError && (
                <p role="status">{workspaceStorageError}</p>
              )}
              <div className="project-explorer-brand">
                <OgrafLogo section /> <strong>Studio</strong>
                <span>
                  {`Version ${STUDIO_VERSION}`} · {`Build ${STUDIO_BUILD_REVISION}`} ·{' '}
                  <time dateTime={STUDIO_BUILD_DATE}>{STUDIO_BUILD_DATE}</time>
                </span>
                <a
                  href="https://github.com/zerodensity/ograf-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub ↗
                </a>
              </div>
            </div>
          </nav>
          {inLibrary ? (
            <main className="project-explorer-main">
              <div className="project-explorer-toolbar">
                <button
                  type="button"
                  className={`project-explorer-chip${level === null ? ' is-active' : ''}`}
                  aria-pressed={level === null}
                  onClick={() => setLevel(null)}
                >
                  Any level
                </button>
                {EXAMPLE_LEVELS.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={`project-explorer-chip${level === name ? ' is-active' : ''}`}
                    aria-pressed={level === name}
                    onClick={() => setLevel(name)}
                  >
                    {name}
                  </button>
                ))}
                <span className="project-explorer-count">
                  {items.length} {items.length === 1 ? 'project' : 'projects'}
                </span>
                <label className="project-explorer-sort">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.currentTarget.value as ExplorerSort)}
                  >
                    {EXPLORER_SORTS.map((name) => (
                      <option key={name} value={name}>
                        {EXPLORER_SORT_LABELS[name]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="project-explorer-scroll">
                {(showBlank || recipes.length > 0) && (
                  <>
                    <h2>
                      {offersExamples ? 'Recipes' : 'Start from'}{' '}
                      <span>built for the canvas you choose</span>
                    </h2>
                    <div className="project-explorer-grid">
                      {showBlank && (
                        <button
                          type="button"
                          className={`project-explorer-card is-blank${
                            selected === BLANK ? ' is-selected' : ''
                          }`}
                          data-explorer-card={BLANK}
                          aria-pressed={selected === BLANK}
                          onClick={() => setSelectedId(BLANK)}
                          onDoubleClick={createBlank}
                        >
                          <span className="project-explorer-picture is-blank">
                            <span className="project-explorer-picture-empty">＋</span>
                          </span>
                          <span className="project-explorer-card-text">
                            <strong>Blank project</strong>
                            <span>An empty canvas</span>
                          </span>
                        </button>
                      )}
                      {cards(recipes)}
                    </div>
                  </>
                )}
                {examples.length > 0 && (
                  <>
                    <h2>Examples</h2>
                    <div className="project-explorer-grid">{cards(examples)}</div>
                  </>
                )}
                {order.length === 0 && (
                  <p className="project-explorer-empty">
                    {query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing here yet.'}
                  </p>
                )}
              </div>
            </main>
          ) : (
            <main className="project-explorer-main">
              <div className="project-explorer-scroll">
                <h2>Recent</h2>
                {recent.length === 0 && (
                  <p className="project-explorer-empty">Documents you open or save appear here.</p>
                )}
                <div className="project-explorer-recents">
                  {recent.map((item) => (
                    <button type="button" key={item.id} onClick={() => void openRecent(item)}>
                      <strong>{item.name}</strong>
                      <span>{new Date(item.openedAt).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            </main>
          )}
          {inLibrary && <aside className="project-explorer-detail">{detail}</aside>}
        </div>
        {error && (
          <p role="alert" className="project-explorer-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

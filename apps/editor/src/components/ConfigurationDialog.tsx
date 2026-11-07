import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  rendererPluginKey,
  isRendererPluginSnapshot,
  isShaderPackPluginSnapshot,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import { isDomElement, useEditorWindow } from '../layout/EditorWindow';
import { useProjectStore } from '../state/projectStore';
import { parseStudioPluginFile } from '../state/rendererPluginBundles';
import {
  studioPluginUpdatePlan,
  type StudioPluginUpdatePlan,
} from '../state/pluginApplicationUpdates';
import {
  rendererPluginReference,
  useRendererPluginSettingsStore,
  type InstalledStudioPlugin,
} from '../state/pluginSettingsStore';
import { requiredProjectStudioPlugins } from './configurationPlugins';
import {
  applicationComponents,
  applicationProjectUsage,
  installedApplicationGroups,
} from './configurationApplications';
import { ApplicationBundleDetails, ApplicationComponents } from './ApplicationBundleDetails';
import { useMovableDialog } from './useMovableDialog';
import './ConfigurationDialog.css';

interface BundleReview {
  snapshot: StudioPluginSnapshot;
  previous?: StudioPluginSnapshot;
  plan?: StudioPluginUpdatePlan;
  useForNew: boolean;
  intent: 'add' | 'update' | 'restore';
}

export interface ConfigurationDialogProps {
  onClose?: () => void;
  embedded?: boolean;
  /** Complete manager inside the unified Studio preferences page. */
  showAll?: boolean;
  selectedPlugin?: { id: string; kind: StudioPluginSnapshot['manifest']['kind'] };
  selectedVersionKey?: string;
  onSelectVersion?: (key: string) => void;
  addRequestId?: number;
}

export function ConfigurationDialog({
  onClose = () => {},
  embedded = false,
  showAll = false,
  selectedPlugin,
  selectedVersionKey,
  onSelectVersion,
  addRequestId,
}: ConfigurationDialogProps) {
  const { document: ownerDocument } = useEditorWindow();
  const project = useProjectStore((state) => state.project);
  const settings = useRendererPluginSettingsStore();
  const initialize = settings.initialize;
  const [review, setReview] = useState<BundleReview | null>(null);
  const [removing, setRemoving] = useState<InstalledStudioPlugin | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const selectedCard = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const subdialog = useRef<HTMLElement>(null);
  const reviewDialog = useRef<HTMLElement>(null);
  const removeDialog = useRef<HTMLElement>(null);
  const managerMovement = useMovableDialog(dialog, { enabled: !embedded });
  const reviewMovement = useMovableDialog(reviewDialog, { enabled: Boolean(review) });
  const removeMovement = useMovableDialog(removeDialog, { enabled: Boolean(removing) });
  const setReviewDialog = useCallback((element: HTMLElement | null) => {
    reviewDialog.current = element;
    subdialog.current = element;
  }, []);
  const setRemoveDialog = useCallback((element: HTMLElement | null) => {
    removeDialog.current = element;
    subdialog.current = element;
  }, []);
  const updateTarget = useRef<StudioPluginSnapshot | null>(null);
  const browseRequest = useRef<() => void>(() => {});
  const lastAddRequest = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const allGroups = installedApplicationGroups(settings.installed, settings.defaultProvider);
  const fullManager = !embedded || showAll;
  const matchesSelection = (snapshot: StudioPluginSnapshot) =>
    fullManager ||
    Boolean(
      selectedPlugin &&
      snapshot.manifest.id === selectedPlugin.id &&
      snapshot.manifest.kind === selectedPlugin.kind &&
      (!selectedVersionKey ||
        rendererPluginKey(rendererPluginReference(snapshot)) === selectedVersionKey),
    );
  const groups = allGroups.filter(
    (group) =>
      fullManager ||
      Boolean(
        selectedPlugin &&
        group.id === selectedPlugin.id &&
        group.kind === selectedPlugin.kind &&
        (!selectedVersionKey ||
          group.versions.some(
            (entry) =>
              rendererPluginKey(rendererPluginReference(entry.snapshot)) === selectedVersionKey,
          )),
      ),
  );
  const available = settings.installed.filter((entry) => entry.enabled && entry.trusted);
  const blocked = requiredProjectStudioPlugins(project).filter(
    (snapshot) =>
      matchesSelection(snapshot) &&
      (fullManager ||
        !settings.installed.some(
          (entry) =>
            rendererPluginKey(rendererPluginReference(entry.snapshot)) ===
            rendererPluginKey(rendererPluginReference(snapshot)),
        )) &&
      !available.some(
        (entry) =>
          rendererPluginKey(rendererPluginReference(entry.snapshot)) ===
          rendererPluginKey(rendererPluginReference(snapshot)),
      ),
  );
  const removeUsage = removing
    ? applicationProjectUsage(project, rendererPluginReference(removing.snapshot))
    : null;
  const subdialogIdentity = review
    ? `review:${review.snapshot.sha256}`
    : removing
      ? `remove:${removing.snapshot.sha256}`
      : '';
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!embedded) dialog.current?.focus();
  }, [embedded]);
  useEffect(() => {
    if (showAll && selectedPlugin?.id) selectedCard.current?.scrollIntoView({ block: 'nearest' });
  }, [showAll, selectedPlugin?.id, selectedPlugin?.kind, selectedVersionKey, settings.loading]);
  useEffect(() => {
    if (!subdialogIdentity) return;
    const active = ownerDocument.activeElement;
    if (isDomElement(active) && !subdialog.current?.contains(active)) returnFocus.current = active;
    const anchor = returnFocus.current;
    const fallback = dialog.current;
    subdialog.current?.focus();
    const keepFocus = (event: FocusEvent) => {
      const scope = subdialog.current;
      if (scope && isDomElement(event.target) && !scope.contains(event.target)) scope.focus();
    };
    ownerDocument.addEventListener('focusin', keepFocus);
    return () => {
      ownerDocument.removeEventListener('focusin', keepFocus);
      if (anchor?.isConnected) anchor.focus();
      else fallback?.focus();
    };
  }, [subdialogIdentity, ownerDocument]);
  const trapFocus = (event: KeyboardEvent<HTMLElement>, scope: HTMLElement | null) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...(scope?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [data-movable-dialog-handle]',
      ) ?? []),
    ].filter((control) => control.getClientRects().length > 0);
    const current = controls.indexOf(ownerDocument.activeElement as HTMLElement);
    if (!controls.length) {
      event.preventDefault();
      scope?.focus();
      return;
    }
    if (
      (event.shiftKey && current <= 0) ||
      (!event.shiftKey && (current < 0 || current === controls.length - 1))
    ) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  };
  const subdialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        setReview(null);
        setRemoving(null);
      }
    }
    trapFocus(event, subdialog.current);
  };
  const run = async (action: () => void | Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const chooseBundle = async (file: File | undefined) => {
    if (!file) return;
    const previous = updateTarget.current;
    updateTarget.current = null;
    await run(async () => {
      const snapshot = await parseStudioPluginFile(file);
      // Identity is checked before trust; Update never accepts a different application id.
      const plan = previous ? studioPluginUpdatePlan(previous, snapshot) : undefined;
      const defaultProvider = useRendererPluginSettingsStore.getState().defaultProvider;
      setReview({
        snapshot,
        previous: previous ?? undefined,
        plan,
        intent: previous ? 'update' : 'add',
        useForNew:
          fullManager &&
          Boolean(
            isRendererPluginSnapshot(snapshot) &&
            previous &&
            defaultProvider &&
            rendererPluginKey(defaultProvider) ===
              rendererPluginKey(rendererPluginReference(previous)),
          ),
      });
    });
  };
  const browse = (previous: StudioPluginSnapshot | null) => {
    updateTarget.current = previous;
    setError('');
    input.current?.click();
  };
  useEffect(() => {
    browseRequest.current = () => {
      if (!busy && !review && !removing) browse(null);
    };
  });
  useEffect(() => {
    if (!embedded || !addRequestId || addRequestId === lastAddRequest.current) return;
    lastAddRequest.current = addRequestId;
    // Navigation may mount this page after the browser's file-picker gesture expires.
    // Focus the real Add button so the picker is opened by its own user click.
    if (showAll) addButton.current?.focus();
    else browseRequest.current();
  }, [embedded, showAll, addRequestId]);
  const restore = (snapshot: StudioPluginSnapshot) => {
    setError('');
    setReview({ snapshot, useForNew: false, intent: 'restore' });
  };
  const installReviewed = async () => {
    if (!review) return;
    const approved = review;
    await settings.install(approved.snapshot);
    const installedKey = rendererPluginKey(rendererPluginReference(approved.snapshot));
    setSelectedVersions((current) => ({
      ...current,
      [approved.snapshot.manifest.id + ':' + approved.snapshot.manifest.kind]: rendererPluginKey(
        rendererPluginReference(approved.snapshot),
      ),
    }));
    if (embedded) onSelectVersion?.(installedKey);
    setReview(null);
    if (fullManager && approved.useForNew && isRendererPluginSnapshot(approved.snapshot)) {
      try {
        settings.setDefaultProvider(rendererPluginReference(approved.snapshot));
      } catch (cause) {
        throw new Error(
          `Application installed, but the default for new charts could not be changed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  };
  const before = review?.previous ? applicationComponents(review.previous) : null;
  const after = review ? applicationComponents(review.snapshot) : null;
  const manager = (
    <section
      {...(!embedded ? managerMovement.dialogProps : {})}
      className={`configuration-dialog${embedded ? ' configuration-embedded' : ''}`}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-labelledby={embedded ? undefined : 'configuration-title'}
      aria-label={embedded ? 'Plugin settings' : undefined}
      aria-description={
        embedded ? undefined : 'Resize this window by dragging its bottom-right corner.'
      }
      tabIndex={-1}
      ref={dialog}
      onKeyDown={(event) => {
        if (embedded) return;
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) {
          if (review) setReview(null);
          else if (removing) setRemoving(null);
          else onClose();
        }
        trapFocus(event, subdialog.current ?? dialog.current);
      }}
    >
      {!embedded ? (
        <header
          {...managerMovement.handleProps}
          className="configuration-header"
          inert={Boolean(review || removing)}
        >
          <strong id="configuration-title">Plugins</strong>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close Plugins">
            ×
          </button>
        </header>
      ) : null}
      <div className="configuration-content" inert={Boolean(review || removing)}>
        {!embedded ? (
          <nav aria-label="Plugin settings pages">
            <button type="button" className="is-selected" aria-current="page">
              Plugins
            </button>
          </nav>
        ) : null}
        <div className="configuration-page">
          <div className="configuration-page-header">
            <h2>{fullManager ? 'Installed plugins' : 'Plugin settings'}</h2>
            {fullManager ? (
              <button ref={addButton} type="button" disabled={busy} onClick={() => browse(null)}>
                Add plugin…
              </button>
            ) : null}
          </div>
          <input
            hidden
            ref={input}
            type="file"
            accept=".ogsplugin.zip"
            onChange={(event) => {
              void chooseBundle(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {fullManager ? (
            <>
              <p className="configuration-help">
                The included plugins are available with Studio. Enabled state and the default chart
                provider are preferences for this user. Templates keep their exact saved versions.
              </p>
              <p className="configuration-help">
                Install .ogsplugin.zip bundles. Charts run JavaScript; animation packs use validated
                JSON; shader packs run GLSL on the GPU. Names, versions and licenses are publisher
                declarations.
              </p>
              <p className="configuration-help">
                Add or update complete bundles. Separate library files and bring-your-own-license
                (BYOL) setup are not supported.
              </p>
            </>
          ) : null}
          {fullManager ? (
            <label className="configuration-default-provider">
              Default for new charts
              <select
                value={settings.defaultProvider ? rendererPluginKey(settings.defaultProvider) : ''}
                disabled={busy}
                onChange={(event) =>
                  void run(() => {
                    const chosen = settings.installed.find(
                      (entry) =>
                        rendererPluginKey(rendererPluginReference(entry.snapshot)) ===
                        event.target.value,
                    );
                    settings.setDefaultProvider(
                      chosen ? rendererPluginReference(chosen.snapshot) : null,
                    );
                  })
                }
              >
                <option value="">No default provider</option>
                {settings.installed
                  .filter(
                    (entry) =>
                      entry.enabled && entry.trusted && isRendererPluginSnapshot(entry.snapshot),
                  )
                  .map((entry) => {
                    const reference = rendererPluginReference(entry.snapshot);
                    const key = rendererPluginKey(reference);
                    return (
                      <option key={key} value={key}>
                        {applicationComponents(entry.snapshot).name} {reference.version}
                      </option>
                    );
                  })}
              </select>
            </label>
          ) : null}
          {settings.loading ? (
            <p className="configuration-help">Loading installed plugins…</p>
          ) : null}
          {groups.length === 0 && blocked.length === 0 && !settings.loading ? (
            <p className="configuration-help">
              {embedded && allGroups.length
                ? 'Select a plugin to inspect its settings.'
                : 'No plugins installed. Add a reviewed .ogsplugin.zip bundle to get started.'}
            </p>
          ) : null}
          <div className="configuration-applications">
            {groups.map((group) => {
              const entry =
                group.versions.find(
                  (version) =>
                    rendererPluginKey(rendererPluginReference(version.snapshot)) ===
                    (selectedVersions[group.key] ??
                      (embedded &&
                      selectedVersionKey !== undefined &&
                      (!showAll ||
                        (group.id === selectedPlugin?.id && group.kind === selectedPlugin?.kind))
                        ? selectedVersionKey
                        : undefined)),
                ) ?? group.preferred;
              const snapshot = entry.snapshot;
              const reference = rendererPluginReference(snapshot);
              const key = rendererPluginKey(reference);
              const info = applicationComponents(snapshot);
              const isDefault = Boolean(
                settings.defaultProvider && rendererPluginKey(settings.defaultProvider) === key,
              );
              const usage = applicationProjectUsage(project, reference);
              return (
                <article
                  ref={
                    group.id === selectedPlugin?.id && group.kind === selectedPlugin?.kind
                      ? selectedCard
                      : undefined
                  }
                  className="configuration-application-card"
                  key={group.key}
                  aria-label={`Application ${info.name}`}
                >
                  {fullManager ? (
                    <header>
                      <strong>{info.name}</strong>
                      <span className="application-kind">
                        {snapshot.manifest.kind === 'chart'
                          ? 'Charts'
                          : snapshot.manifest.kind === 'shader-pack'
                            ? 'Shader pack'
                            : 'Animation presets'}
                      </span>
                      <span
                        className={`application-status${entry.enabled && entry.trusted ? ' is-active' : ''}`}
                      >
                        {!entry.trusted
                          ? snapshot.manifest.kind !== 'animation-presets'
                            ? 'Needs trust'
                            : 'Needs review'
                          : entry.enabled
                            ? 'Active'
                            : 'Disabled'}
                      </span>
                      {isDefault ? (
                        <span className="application-default-badge">Default</span>
                      ) : null}
                      {entry.bundled ? (
                        <span className="application-included-badge">Included with Studio</span>
                      ) : null}
                      {group.versions.length > 1 ? (
                        <select
                          aria-label={`Installed version for ${info.name}`}
                          value={key}
                          disabled={busy}
                          onChange={(event) => {
                            setSelectedVersions((current) => ({
                              ...current,
                              [group.key]: event.target.value,
                            }));
                            if (embedded) onSelectVersion?.(event.target.value);
                          }}
                        >
                          {group.versions.map((version) => (
                            <option
                              key={rendererPluginKey(rendererPluginReference(version.snapshot))}
                              value={rendererPluginKey(rendererPluginReference(version.snapshot))}
                            >
                              {version.snapshot.manifest.version}
                              {group.versions.filter(
                                (other) =>
                                  other.snapshot.manifest.version ===
                                  version.snapshot.manifest.version,
                              ).length > 1
                                ? ` · ${version.snapshot.sha256.slice(0, 8)}`
                                : ''}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </header>
                  ) : null}
                  <ApplicationComponents snapshot={snapshot} />
                  <footer>
                    <span>
                      {usage.objects} project {usage.objects === 1 ? 'object' : 'objects'}
                      {usage.componentObjects
                        ? ` · ${usage.componentObjects} saved component objects`
                        : ''}
                    </span>
                    <div className="configuration-plugin-actions">
                      {entry.trusted ? (
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Enabled ${info.name} ${reference.version}`}
                            checked={entry.enabled}
                            disabled={busy}
                            onChange={(event) =>
                              void run(() => settings.setEnabled(reference, event.target.checked))
                            }
                          />
                          Enabled
                        </label>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => restore(snapshot)}>
                          {snapshot.manifest.kind !== 'animation-presets'
                            ? 'Review & trust'
                            : 'Review & install'}
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => browse(snapshot)}>
                        Update…
                      </button>
                      <button
                        type="button"
                        disabled={busy || entry.bundled}
                        title={
                          entry.bundled
                            ? 'Included plugins stay installed with Studio. You can disable this version.'
                            : undefined
                        }
                        onClick={() => {
                          setError('');
                          setRemoving(entry);
                        }}
                      >
                        Remove…
                      </button>
                    </div>
                  </footer>
                  <details className="application-details">
                    <summary>Details · identity, presets and hash</summary>
                    <ApplicationBundleDetails snapshot={snapshot} />
                  </details>
                </article>
              );
            })}
          </div>
          {blocked.length ? (
            <section className="configuration-project-plugins">
              <h3>Project bundles need review</h3>
              <p className="configuration-help">
                The project keeps exact bundles. Opening a template never enables unknown code or
                installs preset data. Restoring a preset pack allows reapplication without changing
                baked keys.
              </p>
              {blocked.map((snapshot) => (
                <div
                  className="configuration-plugin-row"
                  key={rendererPluginKey(rendererPluginReference(snapshot))}
                >
                  <div>
                    <strong>{applicationComponents(snapshot).name}</strong>
                    <span>
                      Studio adapter {snapshot.manifest.name} {snapshot.manifest.version}
                    </span>
                  </div>
                  <button type="button" disabled={busy} onClick={() => restore(snapshot)}>
                    Review saved bundle
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          {error || settings.error ? (
            <p className="configuration-error" role="alert">
              {error || settings.error}
            </p>
          ) : null}
          {settings.error ? (
            <button
              type="button"
              disabled={busy || settings.loading}
              onClick={() => void run(() => settings.refresh())}
            >
              Retry loading plugins
            </button>
          ) : null}
        </div>
      </div>
      {review || removing
        ? createPortal(
            <>
              {review && after ? (
                <div className="configuration-subdialog-backdrop">
                  <section
                    {...reviewMovement.dialogProps}
                    className="configuration-subdialog"
                    ref={setReviewDialog}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Review application bundle"
                    onKeyDown={subdialogKeyDown}
                  >
                    <header {...reviewMovement.handleProps} className="configuration-page-header">
                      <h2>
                        {review.intent === 'update'
                          ? 'Review application update'
                          : review.intent === 'restore'
                            ? 'Review saved application'
                            : 'Review new application'}
                      </h2>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="Close application review"
                        onClick={() => setReview(null)}
                      >
                        ×
                      </button>
                    </header>
                    {before ? (
                      <table className="application-update-comparison">
                        <thead>
                          <tr>
                            <th>Component</th>
                            <th>Installed selection</th>
                            <th>New bundle</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th>
                              {review.snapshot.manifest.kind === 'chart'
                                ? 'Studio adapter (integration code)'
                                : review.snapshot.manifest.kind === 'shader-pack'
                                  ? 'Shader pack'
                                  : 'Preset pack'}
                            </th>
                            <td>
                              {before.adapter.name}
                              <br />
                              {before.adapter.version}
                              <small>{before.adapter.license} · declared</small>
                            </td>
                            <td>
                              {after.adapter.name}
                              <br />
                              {after.adapter.version}
                              <small>{after.adapter.license} · declared</small>
                            </td>
                          </tr>
                          {before.library && after.library ? (
                            <tr>
                              <th>Underlying library</th>
                              <td>
                                {before.library.name} {before.library.version}
                                <small>
                                  {before.library.license} · {before.library.licenseOrigin}
                                </small>
                              </td>
                              <td>
                                {after.library.name} {after.library.version}
                                <small>
                                  {after.library.license} · {after.library.licenseOrigin}
                                </small>
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    ) : (
                      <ApplicationComponents snapshot={review.snapshot} />
                    )}
                    {review.plan ? (
                      <p className="configuration-help">
                        {review.snapshot.manifest.kind === 'animation-presets'
                          ? review.plan.presetDataChanged
                            ? 'Preset definitions changed.'
                            : 'Preset definitions are unchanged.'
                          : review.snapshot.manifest.kind === 'shader-pack'
                            ? review.plan.shaderDataChanged
                              ? 'Shader definitions or code changed.'
                              : 'Shader definitions and code are unchanged.'
                            : review.plan.rendererSourceChanged
                              ? 'Combined bundled code bytes changed.'
                              : 'Combined bundled code bytes are unchanged.'}{' '}
                        Versions and component attribution are declarations in the package.
                      </p>
                    ) : null}
                    {review.plan?.warnings.length ? (
                      <ul className="configuration-update-warnings">
                        {review.plan.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    <ApplicationBundleDetails snapshot={review.snapshot} />
                    {fullManager && review.snapshot.manifest.kind === 'chart' ? (
                      <label className="application-new-default">
                        <input
                          type="checkbox"
                          checked={review.useForNew}
                          disabled={busy}
                          onChange={(event) =>
                            setReview({ ...review, useForNew: event.target.checked })
                          }
                        />
                        Use for new charts
                      </label>
                    ) : null}
                    <p className="configuration-help">
                      Existing project objects keep their pinned versions. Install adds this
                      complete bundle alongside installed versions; it does not replace saved code
                      or preset definitions inside your templates.
                    </p>
                    <p className="configuration-help">
                      {review.snapshot.manifest.kind === 'chart'
                        ? 'Trust & Install allows this exact bundled JavaScript to run with Studio’s access to your project.'
                        : isShaderPackPluginSnapshot(review.snapshot)
                          ? 'Trust & Install approves this exact GLSL code for explicit use. Installing does not compile or preview it. Applying a shader runs on your GPU and may increase GPU load.'
                          : 'Install adds this reviewed JSON preset pack. It executes no JavaScript and does not change previously baked animation keys.'}
                    </p>
                    {error ? (
                      <p className="configuration-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <div className="configuration-review-actions">
                      <button type="button" disabled={busy} onClick={() => setReview(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(installReviewed)}
                      >
                        {busy
                          ? 'Installing…'
                          : review.snapshot.manifest.kind !== 'animation-presets'
                            ? 'Trust & Install'
                            : 'Install'}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
              {removing && removeUsage ? (
                <div className="configuration-subdialog-backdrop">
                  <section
                    {...removeMovement.dialogProps}
                    className="configuration-subdialog configuration-remove-review"
                    ref={setRemoveDialog}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Remove application version"
                    onKeyDown={subdialogKeyDown}
                  >
                    <h2 {...removeMovement.handleProps}>
                      Remove {applicationComponents(removing.snapshot).name}{' '}
                      {removing.snapshot.manifest.version}?
                    </h2>
                    <p>
                      {removeUsage.objects} project{' '}
                      {removeUsage.objects === 1 ? 'object uses' : 'objects use'} this exact version
                      {removeUsage.componentObjects
                        ? `, plus ${removeUsage.componentObjects} saved component objects`
                        : ''}
                      .
                    </p>
                    {removeUsage.compositions.length ? (
                      <p className="configuration-help">
                        Used in: {removeUsage.compositions.join(', ')}
                      </p>
                    ) : null}
                    <p className="configuration-help">
                      These counts cover the current project only. Other saved templates have not
                      been checked.
                    </p>
                    <p className="configuration-help">
                      {removing.snapshot.manifest.kind === 'chart'
                        ? 'Removal disables local previews using this version and deletes its installed bundle. Saved templates retain their pinned code; exported graphics are unchanged.'
                        : removing.snapshot.manifest.kind === 'shader-pack'
                          ? 'Removal removes this pack from the chooser and deletes its installed copy. Previously applied shader paints and effects are independent copies and continue working.'
                          : 'Removal removes this pack from local preset choosers and deletes its installed copy. Previously baked animation keys and exported playback remain unchanged.'}
                    </p>
                    {error ? (
                      <p className="configuration-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <div className="configuration-review-actions">
                      <button type="button" disabled={busy} onClick={() => setRemoving(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await settings.remove(rendererPluginReference(removing.snapshot));
                            setRemoving(null);
                          })
                        }
                      >
                        Remove version
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </>,
            ownerDocument.body,
          )
        : null}
    </section>
  );
  return embedded
    ? manager
    : createPortal(
        <div
          className="configuration-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          {manager}
        </div>,
        ownerDocument.body,
      );
}

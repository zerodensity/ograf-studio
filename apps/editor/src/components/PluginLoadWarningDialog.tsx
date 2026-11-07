import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rendererPluginKey, studioPluginReference } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { chartRendererUpgradeOffers } from '../state/chartRendererUpgrade';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { collectPluginLoadWarnings, type PluginLoadWarning } from '../state/pluginLoadWarnings';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { activateProjectSetTemplate } from '../state/projectSetSession';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { useStartupScreenStore } from '../state/startupScreenStore';
import { useMovableDialog } from './useMovableDialog';
import './WorkspaceDialogs.css';
import './PluginLoadWarningDialog.css';

/** Loading never grants trust or changes authored renderer pins. */
export function PluginLoadWarningDialogHost() {
  const project = useProjectStore((state) => state.project);
  const loadRevision = useProjectStore((state) => state.documentLoadRevision);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const installed = useRendererPluginSettingsStore((state) => state.installed);
  const initialized = useRendererPluginSettingsStore((state) => state.initialized);
  const loading = useRendererPluginSettingsStore((state) => state.loading);
  const welcomeVisible = useStartupScreenStore((state) => state.visible);
  const { window: owner, document } = useEditorWindow();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const announcedDocument = useRef<string | null>(null);
  const warnings = useMemo(
    () =>
      collectPluginLoadWarnings({
        project,
        projectSet,
        activeTemplateId,
        installed,
        initialized,
        loading,
      }),
    [project, projectSet, activeTemplateId, installed, initialized, loading],
  );
  const documentKey = `${projectSet?.id ?? project.id}:${loadRevision}`;
  useEffect(() => {
    if (!initialized || loading || welcomeVisible) return;
    if (announcedDocument.current !== documentKey) {
      announcedDocument.current = documentKey;
      setError('');
      setOpen(warnings.length > 0);
    } else if (!warnings.length) {
      setOpen(false);
      setError('');
    }
  }, [documentKey, initialized, loading, welcomeVisible, warnings]);
  const isActive = (warning: PluginLoadWarning) =>
    warning.projectId === project.id &&
    (projectSet ? warning.templateId === activeTemplateId : warning.templateId === null);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const review = (warning: PluginLoadWarning) => {
    run(() => {
      if (!isActive(warning) && warning.templateId) activateProjectSetTemplate(warning.templateId);
      setOpen(false);
      useConfigurationRequestStore
        .getState()
        .openSettings(
          warning.reference?.id,
          'chart',
          warning.reference ? rendererPluginKey(warning.reference) : undefined,
        );
    });
  };
  const useInstalled = (warning: PluginLoadWarning) =>
    run(() => {
      if (!warning.reference || !warning.replacement || !isActive(warning))
        throw new Error('Open the affected template before changing its renderer.');
      const state = useProjectStore.getState();
      const session = useProjectSetStore.getState();
      if (
        state.project.id !== warning.projectId ||
        state.documentLoadRevision !== loadRevision ||
        (warning.templateId !== null && session.activeTemplateId !== warning.templateId)
      )
        throw new Error('The document changed. Review the current warning before updating.');
      const offer = chartRendererUpgradeOffers(
        state.project,
        useRendererPluginSettingsStore.getState().installed,
        session.projectSet,
        session.activeTemplateId,
      ).find(
        (candidate) =>
          rendererPluginKey(candidate.from) === rendererPluginKey(warning.reference!) &&
          rendererPluginKey(studioPluginReference(candidate.to)) ===
            rendererPluginKey(warning.replacement!),
      );
      if (!offer || offer.errors.length)
        throw new Error(
          'The renderer or document changed. Review its current compatibility before updating.',
        );
      runDiscreteHistoryStep(
        () =>
          useProjectStore.getState().upgradeChartRenderer(warning.reference!, warning.replacement!),
        'Update chart renderer',
      );
    });
  const enableSaved = (warning: PluginLoadWarning) =>
    run(() => {
      if (!warning.reference) return;
      const settings = useRendererPluginSettingsStore.getState();
      const exact = settings.installed.find(
        (entry) =>
          rendererPluginKey(studioPluginReference(entry.snapshot)) ===
          rendererPluginKey(warning.reference!),
      );
      if (!exact?.trusted)
        throw new Error('Review and trust the exact saved plugin before enabling it.');
      settings.setEnabled(warning.reference, true);
    });
  if (!warnings.length || welcomeVisible) return null;
  const affected = new Set(warnings.map((warning) => warning.templateId ?? warning.projectId)).size;
  return (
    <>
      <section
        className="plugin-load-warning-banner"
        role="alert"
        aria-label="Plugin mismatch warning"
      >
        <span aria-hidden="true">⚠</span>
        <strong>Charts cannot render</strong>
        <span>
          Plugin mismatch in {affected} {affected === 1 ? 'template' : 'templates'}.
        </span>
        <button
          type="button"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          Review plugins…
        </button>
      </section>
      {open &&
        createPortal(
          <PluginLoadWarningDialog
            warnings={warnings}
            documentName={projectSet?.name ?? project.name}
            isActive={isActive}
            error={error}
            owner={owner}
            onClose={() => setOpen(false)}
            onReview={review}
            onUseInstalled={useInstalled}
            onEnableSaved={enableSaved}
            onOpenTemplate={(warning) =>
              run(() => {
                if (warning.templateId) activateProjectSetTemplate(warning.templateId);
                usePaneRequestStore.getState().reveal('export');
              })
            }
          />,
          document.body,
        )}
    </>
  );
}

const reasonText: Record<PluginLoadWarning['reason'], string> = {
  unconfigured: 'No chart renderer has been selected.',
  'invalid-reference': 'The saved renderer reference is invalid.',
  'missing-bundle': 'The renderer code is missing from the document.',
  'invalid-bundle': 'The saved renderer bundle could not be verified.',
  'not-installed': 'This exact renderer build is not installed in Studio.',
  disabled: 'The saved renderer is disabled in Studio.',
  untrusted: 'The saved renderer has not been trusted in Studio.',
  'content-mismatch': 'The saved renderer code differs from the installed build.',
};

interface WarningDialogProps {
  warnings: PluginLoadWarning[];
  documentName: string;
  isActive: (warning: PluginLoadWarning) => boolean;
  error: string;
  owner: Window;
  onClose: () => void;
  onReview: (warning: PluginLoadWarning) => void;
  onUseInstalled: (warning: PluginLoadWarning) => void;
  onEnableSaved: (warning: PluginLoadWarning) => void;
  onOpenTemplate: (warning: PluginLoadWarning) => void;
}

export function PluginLoadWarningDialog({
  warnings,
  documentName,
  isActive,
  error,
  owner,
  onClose,
  onReview,
  onUseInstalled,
  onEnableSaved,
  onOpenTemplate,
}: WarningDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog);
  useEffect(() => {
    const previous = owner.document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[data-plugin-warning-action]')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [owner]);
  return (
    <div
      className="workspace-dialog-backdrop plugin-load-warning-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="workspace-dialog plugin-load-warning-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="plugin-warning-title"
        aria-describedby="plugin-warning-description"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [data-movable-dialog-handle]',
              ) ?? []),
            ].filter((element) => element.getClientRects().length > 0);
            const index = controls.indexOf(owner.document.activeElement as HTMLElement);
            if (
              (event.shiftKey && index <= 0) ||
              (!event.shiftKey && index === controls.length - 1)
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <header {...movable.handleProps}>
          <div>
            <h2 id="plugin-warning-title">
              <span aria-hidden="true">⚠ </span>Plugin mismatch — charts unavailable
            </h2>
            <p>{documentName}</p>
          </div>
          <button type="button" aria-label="Close plugin mismatch warning" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="workspace-dialog-content">
          <p id="plugin-warning-description">
            Some charts cannot render or export until their renderer requirements are resolved. Your
            chart data, animation and Rules are preserved.
          </p>
          <div className="plugin-load-warning-list">
            {warnings.map((warning) => {
              const active = isActive(warning);
              return (
                <article className="plugin-load-warning-item" key={warning.key}>
                  <div className="plugin-load-warning-heading">
                    <strong>{warning.templateName}</strong>
                    <span>
                      {warning.objects} {warning.objects === 1 ? 'chart' : 'charts'}
                      {warning.componentObjects
                        ? ` · ${warning.componentObjects} component charts`
                        : ''}
                    </span>
                  </div>
                  <p>
                    <strong>{warning.pluginName}</strong> · {reasonText[warning.reason]}
                  </p>
                  {warning.reference && (
                    <p className="plugin-load-warning-build">
                      Saved:{' '}
                      <code title={warning.reference.sha256}>
                        {warning.reference.version} · {warning.reference.sha256.slice(0, 12)}
                      </code>
                    </p>
                  )}
                  {warning.replacement && (
                    <p className="plugin-load-warning-build">
                      Available:{' '}
                      <code title={warning.replacement.sha256}>
                        {warning.replacement.version} · {warning.replacement.sha256.slice(0, 12)}
                      </code>{' '}
                      <span>Installed, enabled and trusted</span>
                    </p>
                  )}
                  {warning.reference &&
                    warning.replacement &&
                    warning.reference.version === warning.replacement.version && (
                      <p>The version numbers match, but these are different renderer builds.</p>
                    )}
                  {warning.replacementErrors.length > 0 && (
                    <ul>
                      {warning.replacementErrors.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  <div className="plugin-load-warning-actions">
                    {warning.replacement && !warning.replacementErrors.length && active && (
                      <button
                        data-plugin-warning-action
                        type="button"
                        className="workspace-primary-action"
                        onClick={() => onUseInstalled(warning)}
                      >
                        Use installed renderer
                      </button>
                    )}
                    {!active && warning.templateId && (
                      <button
                        data-plugin-warning-action
                        type="button"
                        onClick={() => onOpenTemplate(warning)}
                      >
                        Open affected template
                      </button>
                    )}
                    {warning.reason === 'disabled' && (
                      <button
                        data-plugin-warning-action
                        type="button"
                        onClick={() => onEnableSaved(warning)}
                      >
                        Enable saved renderer
                      </button>
                    )}
                    <button
                      data-plugin-warning-action
                      type="button"
                      onClick={() => onReview(warning)}
                    >
                      Review plugin settings…
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="plugin-load-warning-note">
            Using an installed renderer is an undoable document change. Review the output afterwards
            and save the template or set to retain it. Unfamiliar plugin code still requires
            explicit trust.
          </p>
          {error && (
            <p className="workspace-dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Continue editing
          </button>
        </footer>
      </section>
    </div>
  );
}

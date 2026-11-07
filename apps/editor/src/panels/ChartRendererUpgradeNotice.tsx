import { useMemo, useState } from 'react';
import { rendererPluginKey, studioPluginReference } from '@ograf-editor/scene-model';
import { chartRendererReferences, chartRendererUpgradeOffers } from '../state/chartRendererUpgrade';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';

/** A deliberate source migration; opening a template never trusts or changes its pins. */
export function ChartRendererUpgradeNotice() {
  const project = useProjectStore((state) => state.project);
  const installed = useRendererPluginSettingsStore((state) => state.installed);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const [error, setError] = useState('');
  const offers = useMemo(
    () => chartRendererUpgradeOffers(project, installed, projectSet, activeTemplateId),
    [project, installed, projectSet, activeTemplateId],
  );
  const missing = useMemo(
    () =>
      chartRendererReferences(project).filter(
        (reference) =>
          !installed.some(
            (entry) =>
              entry.enabled &&
              entry.trusted &&
              rendererPluginKey(studioPluginReference(entry.snapshot)) ===
                rendererPluginKey(reference),
          ) &&
          !offers.some((offer) => rendererPluginKey(offer.from) === rendererPluginKey(reference)),
      ),
    [project, installed, offers],
  );
  const otherMissing = useMemo(
    () =>
      (projectSet?.templates ?? [])
        .filter((template) => template.id !== activeTemplateId)
        .flatMap((template) =>
          chartRendererReferences(template.project)
            .filter(
              (reference) =>
                !installed.some(
                  (entry) =>
                    entry.enabled &&
                    entry.trusted &&
                    rendererPluginKey(studioPluginReference(entry.snapshot)) ===
                      rendererPluginKey(reference),
                ),
            )
            .map((reference) => ({ template: template.name, templateId: template.id, reference })),
        ),
    [projectSet, activeTemplateId, installed],
  );
  if (!offers.length && !missing.length && !otherMissing.length) return null;
  return (
    <section aria-label="Chart renderer updates" className="chart-renderer-upgrade-notices">
      {offers.map((offer) => {
        const to = studioPluginReference(offer.to);
        const targetKey = rendererPluginKey(to);
        const oldInstalled = installed.some(
          (entry) =>
            entry.enabled &&
            entry.trusted &&
            rendererPluginKey(studioPluginReference(entry.snapshot)) ===
              rendererPluginKey(offer.from),
        );
        const sameVersion = offer.from.version === to.version;
        return (
          <details key={`${rendererPluginKey(offer.from)}-${targetKey}`}>
            <summary>
              {oldInstalled
                ? 'Chart renderer update available'
                : 'Saved chart renderer is unavailable'}
            </summary>
            <p>
              This template uses {offer.from.id} {offer.from.version} ·{' '}
              {offer.from.sha256.slice(0, 8)}. Studio has{' '}
              {sameVersion ? 'a different installed build' : `version ${to.version}`} ·{' '}
              {to.sha256.slice(0, 8)}. The replacement is installed, enabled and trusted.
            </p>
            <p>
              Update {offer.objects} {offer.objects === 1 ? 'chart' : 'charts'}
              {offer.componentObjects
                ? ` and ${offer.componentObjects} saved component charts`
                : ''}
              . The previous renderer stays saved in the template and this change can be undone.
              {projectSet && offer.componentObjects
                ? ` This also updates ${offer.sharedInstances} inherited chart ${offer.sharedInstances === 1 ? 'instance' : 'instances'} in other templates. ${offer.preservedOverrides} explicitly overridden ${offer.preservedOverrides === 1 ? 'instance keeps' : 'instances keep'} their existing renderer.`
                : ''}{' '}
              Review the output after updating; a different renderer may look different.
            </p>
            {offer.errors.length > 0 && (
              <ul>
                {offer.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={offer.errors.length > 0}
              onClick={() => {
                try {
                  runDiscreteHistoryStep(
                    () => useProjectStore.getState().upgradeChartRenderer(offer.from, to),
                    'Update chart renderer',
                  );
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Use this renderer for the template
            </button>
            {!oldInstalled && (
              <button
                type="button"
                onClick={() =>
                  useConfigurationRequestStore
                    .getState()
                    .openSettings(offer.from.id, 'chart', rendererPluginKey(offer.from))
                }
              >
                Review saved renderer instead
              </button>
            )}
          </details>
        );
      })}
      {missing.map((reference) => (
        <details key={rendererPluginKey(reference)}>
          <summary>Saved chart renderer is unavailable</summary>
          <p>
            This template uses {reference.id} {reference.version} · {reference.sha256.slice(0, 8)}.
            It is not currently installed, trusted and enabled, and no compatible enabled update is
            available.
          </p>
          <button
            type="button"
            onClick={() =>
              useConfigurationRequestStore
                .getState()
                .openSettings(reference.id, 'chart', rendererPluginKey(reference))
            }
          >
            Review saved renderer
          </button>
        </details>
      ))}
      {otherMissing.map(({ template, templateId, reference }) => (
        <details key={`${templateId}-${rendererPluginKey(reference)}`}>
          <summary>Another template has an unavailable chart renderer</summary>
          <p>
            {template} uses {reference.id} {reference.version} · {reference.sha256.slice(0, 8)}.
            Select that template in the Templates pane to review its saved renderer and available
            updates.
          </p>
        </details>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

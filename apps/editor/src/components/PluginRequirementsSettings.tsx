import { useEffect, useMemo } from 'react';
import {
  rendererPluginKey,
  studioPluginReference,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { resolveProjectSetTemplate } from '../state/projectSet';
import { useProjectStore } from '../state/projectStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { requiredProjectStudioPlugins } from './configurationPlugins';
import { applicationComponents, applicationProjectUsage } from './configurationApplications';

/** Document pins describe dependencies; local installation policy belongs to Studio. */
export function PluginRequirementsSettings({ scope }: { scope: 'template-set' | 'template' }) {
  const project = useProjectStore((state) => state.project);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const installed = useRendererPluginSettingsStore((state) => state.installed);
  const initialize = useRendererPluginSettingsStore((state) => state.initialize);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  const requirements = useMemo(() => {
    const projects =
      scope === 'template-set' && projectSet
        ? projectSet.templates.map((template) => ({
            name: template.name,
            project:
              template.id === activeTemplateId
                ? project
                : resolveProjectSetTemplate(projectSet, template.id),
          }))
        : [{ name: project.name, project }];
    const collected = new Map<
      string,
      {
        snapshot: StudioPluginSnapshot;
        templates: string[];
        objects: number;
        componentObjects: number;
      }
    >();
    for (const source of projects) {
      // Include definitions which have not yet been placed in the scene as instances.
      const withDefinitions = {
        ...source.project,
        compositions: source.project.compositions.map((composition) => ({
          ...composition,
          layers: [
            ...composition.layers,
            ...composition.components.flatMap((component) => component.layers),
          ],
        })),
      };
      for (const snapshot of requiredProjectStudioPlugins(withDefinitions)) {
        const reference = studioPluginReference(snapshot);
        const key = rendererPluginKey(reference);
        const usage = applicationProjectUsage(source.project, reference);
        const previous = collected.get(key);
        collected.set(key, {
          snapshot,
          templates: [...(previous?.templates ?? []), source.name],
          objects: (previous?.objects ?? 0) + usage.objects,
          componentObjects: (previous?.componentObjects ?? 0) + usage.componentObjects,
        });
      }
    }
    return [...collected.values()].sort((left, right) =>
      applicationComponents(left.snapshot).name.localeCompare(
        applicationComponents(right.snapshot).name,
      ),
    );
  }, [scope, projectSet, activeTemplateId, project]);
  if (scope === 'template-set' && !projectSet)
    return <p>Create or open a template set to see its plugin requirements.</p>;
  return (
    <section
      className="plugin-requirements"
      aria-label={`${scope === 'template-set' ? 'Template Set' : 'Template'} plugin requirements`}
    >
      <h3>Plugin requirements</h3>
      <p>
        Objects keep the exact plugin version and saved options in this{' '}
        {scope === 'template-set' ? 'template set' : 'template'}. Installing or updating a Studio
        plugin does not change these pins.
      </p>
      <p>
        Applied shaders and baked animation keys remain part of the document. Their source packs are
        authoring libraries; they are not required to play existing copies.
      </p>
      {requirements.length ? (
        requirements.map(({ snapshot, templates, objects, componentObjects }) => {
          const reference = studioPluginReference(snapshot);
          const key = rendererPluginKey(reference);
          const local = installed.find(
            (entry) => rendererPluginKey(studioPluginReference(entry.snapshot)) === key,
          );
          return (
            <article className="plugin-requirement" key={key}>
              <header>
                <strong>{applicationComponents(snapshot).name}</strong>
                <span>{reference.version}</span>
                <small>
                  {local?.bundled
                    ? local.enabled
                      ? 'Included with Studio'
                      : 'Included with Studio · Disabled'
                    : local?.trusted && local.enabled
                      ? 'Available in Studio'
                      : local
                        ? 'Disabled or awaiting review'
                        : 'Saved in document'}
                </small>
              </header>
              <p>
                {objects} {objects === 1 ? 'object' : 'objects'}
                {componentObjects ? ` · ${componentObjects} saved component objects` : ''}
                {scope === 'template-set' ? ` · ${templates.join(', ')}` : ''}
              </p>
              <code title="Exact saved bundle identity">
                {reference.id} · {reference.sha256.slice(0, 12)}
              </code>
              <button
                type="button"
                onClick={() =>
                  useConfigurationRequestStore
                    .getState()
                    .openSettings(reference.id, snapshot.manifest.kind, key)
                }
              >
                Manage installed plugin…
              </button>
            </article>
          );
        })
      ) : (
        <p>
          No plugin bundles are required by this{' '}
          {scope === 'template-set' ? 'template set' : 'template'}.
        </p>
      )}
    </section>
  );
}

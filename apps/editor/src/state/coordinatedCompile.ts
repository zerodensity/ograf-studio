import graphicRuntimeSource from '@ograf-editor/ograf-runtime/dist/graphic-runtime.js?raw';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import type { InstalledStudioPlugin } from './pluginSettingsStore';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import {
  resolveStudioRendererComponent,
  resolveStudioRendererProject,
} from './studioRendererResolution';

/** Pure compilation shared by workers, packages and non-browser callers. */
export function buildCoordinatedProjectSetArtifacts(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  installed: readonly InstalledStudioPlugin[] = [],
): ExportArtifacts {
  const snapshot = structuredClone(set);
  if (!snapshot.transitionLogic)
    throw new Error('Set up and apply playout transitions before exporting a coordinated package.');
  if (!snapshot.templates.length) throw new Error('Insert a template before exporting this set.');
  return buildCoordinatedExportArtifactsWithRuntime(
    {
      id: snapshot.id,
      outputLayer: snapshot.outputLayer,
      name: snapshot.name,
      definition: snapshot.transitionLogic,
      templates: snapshot.templates.map((template) => ({
        id: template.id,
        name: template.name,
        project: resolveStudioRendererProject(
          resolveProjectSetTemplate(snapshot, template.id),
          installed,
        ),
      })),
      componentAssets: componentLibraryFromTemplates(snapshot).map((component) =>
        resolveStudioRendererComponent(component, installed),
      ),
    },
    graphicRuntimeSource,
    profile,
  );
}

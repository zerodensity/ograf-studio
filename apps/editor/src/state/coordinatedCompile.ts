import graphicRuntimeSource from '@ograf-editor/ograf-runtime/dist/graphic-runtime.js?raw';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';

/** Pure compilation shared by workers, packages and non-browser callers. */
export function buildCoordinatedProjectSetArtifacts(
  set: ProjectSetDocument,
  profile?: ExportProfile,
): ExportArtifacts {
  const snapshot = structuredClone(set);
  if (!snapshot.transitionLogic)
    throw new Error('Set up and apply playout transitions before exporting a coordinated package.');
  if (!snapshot.templates.length) throw new Error('Insert a template before exporting this set.');
  return buildCoordinatedExportArtifactsWithRuntime(
    {
      id: snapshot.id,
      name: snapshot.name,
      definition: snapshot.transitionLogic,
      templates: snapshot.templates.map((template) => ({
        id: template.id,
        name: template.name,
        project: resolveProjectSetTemplate(snapshot, template.id),
      })),
      componentAssets: componentLibraryFromTemplates(snapshot),
    },
    graphicRuntimeSource,
    profile,
  );
}

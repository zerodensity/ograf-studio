import type { ManifestAuthoringPrompts } from '@ograf-editor/ograf-types';
import type { Project } from '@ograf-editor/scene-model';

/** Attribute authored prompts to the original project, independently of the export profile. */
export function manifestAuthoringPrompts(
  sources: readonly {
    project: Project;
    id?: string;
    name?: string;
  }[],
): ManifestAuthoringPrompts | undefined {
  const templates = sources.flatMap(({ project, id, name }) =>
    project.authoringPrompts?.length
      ? [
          {
            ...(id === undefined ? {} : { templateId: id }),
            projectId: project.id,
            name: name ?? project.name,
            prompts: project.authoringPrompts.map(({ id, text }) => ({ id, text })),
          },
        ]
      : [],
  );
  return templates.length ? { version: 1, templates } : undefined;
}

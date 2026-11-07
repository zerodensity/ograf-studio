import { type FieldValue, type Project } from '@ograf-editor/scene-model';
import { getActiveComposition } from '../state/projectStore';
import {
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  type ProjectSetDocument,
} from '../state/projectSet';
import { rundownRowData } from '../state/testRundowns';
import { boardMoments } from './boardMoments';

export interface BoardCaptureMoment {
  template: string;
  project: Project;
  compositionId: string;
  label: string;
  frame: number;
  dataOverrides?: Record<string, FieldValue>;
}

/** Resolve active edits and per-template preview rows before rendering a board. */
export function boardCapturePlan(
  project: Project,
  activeCompositionId: string,
  projectSet: ProjectSetDocument | null,
  activeTemplateId: string | null,
  previewValues: Record<string, FieldValue>,
): BoardCaptureMoment[] {
  const set =
    projectSet && activeTemplateId
      ? saveProjectSetTemplateEdits(projectSet, activeTemplateId, project)
      : projectSet;
  const projects = set
    ? set.templates.map((template) => ({
        name: template.name,
        project: resolveProjectSetTemplate(set, template.id),
        active: template.id === activeTemplateId,
      }))
    : [{ name: project.name, project, active: true }];
  return projects.flatMap((item) => {
    const composition = item.active
      ? getActiveComposition(item.project, activeCompositionId)
      : item.project.compositions.find((entry) => entry.id === item.project.mainCompositionId)!;
    const data: Record<string, FieldValue> = {};
    if (item.active)
      for (const field of composition.dataFields)
        if (Object.hasOwn(previewValues, field.id)) data[field.key] = previewValues[field.id]!;
    const updates = (composition.testRundowns ?? []).flatMap((rundown) =>
      rundown.rows.map((row, index) => ({
        label: `${rundown.name} · row ${index + 1}`,
        data: rundownRowData(composition.dataFields, row),
      })),
    );
    return boardMoments(composition).flatMap((moment) => {
      const entries =
        moment.previewData && updates.length
          ? updates.map((update) => ({ label: `Update · ${update.label}`, data: update.data }))
          : [{ label: moment.label, ...(moment.previewData ? { data } : {}) }];
      return entries.map((entry) => ({
        template: item.name,
        project: item.project,
        compositionId: composition.id,
        label: entry.label,
        frame: moment.frame,
        ...(moment.previewData ? { dataOverrides: entry.data ?? {} } : {}),
      }));
    });
  });
}

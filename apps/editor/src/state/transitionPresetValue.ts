import {
  createComposition,
  createProject,
  type FieldDefinition,
  type FieldValue,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';

/** Validate structured preset values using the same field schema as saved templates. */
export function parseTransitionPresetValue(field: FieldDefinition, text: string): FieldValue {
  const value = JSON.parse(text) as FieldValue;
  const composition = createComposition({
    dataFields: [{ ...structuredClone(field), defaultValue: value }],
  });
  const project = createProject({ mainCompositionId: composition.id, compositions: [composition] });
  const result = validateProject(project);
  if (!result.valid) throw new Error(result.errors.join(' '));
  return value;
}

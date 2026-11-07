import {
  valueAtSourcePath,
  type FieldDefinition,
  type Project,
  type TestDataRundownRow,
} from '@ograf-editor/scene-model';
import type { AgentMeasureTextRequest, AgentMeasureTextResult } from './agentCapture';
import { onAirFrame } from './onAirFrame';

export interface RundownIssue {
  layerId?: string;
  message: string;
}
export interface RundownRowReport {
  rowId: string;
  issues: RundownIssue[];
}

/** Uses the shared renderer's measured text, including its font and modifier evaluation. */
export async function checkRundown(
  project: Project,
  compositionId: string,
  rows: TestDataRundownRow[],
  measure: (request: AgentMeasureTextRequest) => Promise<AgentMeasureTextResult>,
): Promise<RundownRowReport[]> {
  const source = project.compositions.find((item) => item.id === compositionId);
  if (!source) throw new Error('Template is no longer available.');
  const frame = onAirFrame(source);
  const reports: RundownRowReport[] = [];
  for (const row of rows) {
    const issues: RundownIssue[] = [];
    const working = structuredClone(project);
    const composition = working.compositions.find((item) => item.id === compositionId)!;
    for (const field of composition.dataFields) {
      if (Object.hasOwn(row.values, field.id))
        field.defaultValue = structuredClone(row.values[field.id]!);
      const visit = (definition: FieldDefinition, value: unknown, label: string) => {
        if (
          typeof value === 'string' &&
          definition.constraints.maxLength !== undefined &&
          [...value].length > definition.constraints.maxLength
        ) {
          const affected = composition.layers.filter((layer) =>
            layer.bindings.some((binding) => binding.fieldId === field.id),
          );
          const message = `${label} exceeds ${definition.constraints.maxLength} characters.`;
          if (affected.length)
            for (const layer of affected) issues.push({ layerId: layer.id, message });
          else issues.push({ message });
        }
        if (
          definition.type === 'object' &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          const record = value as Record<string, unknown>;
          for (const child of definition.properties)
            visit(child, record[child.key], `${label} · ${child.label}`);
        }
        if (definition.type === 'array' && Array.isArray(value) && definition.items)
          value.forEach((entry, index) =>
            visit(definition.items!, entry, `${label} · ${index + 1}`),
          );
      };
      visit(field, field.defaultValue, field.label);
    }
    for (const layer of composition.layers) {
      if (layer.element.type !== 'text' || !layer.isVisible || layer.isGuide || layer.isMaskOnly)
        continue;
      const binding = layer.bindings.find((candidate) => candidate.targetProperty === 'content');
      const field = composition.dataFields.find((candidate) => candidate.id === binding?.fieldId);
      if (!field) continue;
      const value = valueAtSourcePath(field.defaultValue, binding?.sourcePath);
      try {
        const result = await measure({
          project: working,
          compositionId,
          layerId: layer.id,
          frame,
          text: String(value ?? ''),
        });
        if (result.overflowsParent || result.clippedBy === 'parent' || result.degenerate)
          issues.push({
            layerId: layer.id,
            message: `${layer.name}: text exceeds or is clipped by its available space.`,
          });
        for (const modifier of layer.modifiers ?? []) {
          if (
            modifier.enabled &&
            modifier.type === 'max-text-width' &&
            modifier.params.mode === 'shrink' &&
            result.appliedFontSize <= modifier.params.minFontSize + 0.1 &&
            result.width > modifier.params.maxWidth
          )
            issues.push({
              layerId: layer.id,
              message: `${layer.name}: text fitting reached its minimum size.`,
            });
        }
      } catch (error) {
        issues.push({
          layerId: layer.id,
          message: `${layer.name}: measurement failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    reports.push({ rowId: row.id, issues });
  }
  return reports;
}

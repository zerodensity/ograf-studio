import type { FieldDefinition, FieldValue } from '@ograf-editor/scene-model';

/** Shared values and schemas can inherit while exposure remains a local final choice. */
export function applyFieldExposureOverrides(
  inherited: FieldDefinition,
  local: FieldDefinition,
): FieldDefinition {
  const next = structuredClone(inherited);
  if (typeof local.exposeToOgraf === 'boolean') next.exposeToOgraf = local.exposeToOgraf;
  next.properties = next.properties.map((property) => {
    const override = local.properties.find((item) => item.key === property.key);
    return override ? applyFieldExposureOverrides(property, override) : property;
  });
  if (next.items && local.items) next.items = applyFieldExposureOverrides(next.items, local.items);
  return next;
}

/** Retain authored exposure edits without pinning a merely resolved parent value. */
export function preserveFieldExposureEdits(
  source: FieldDefinition,
  previous: FieldDefinition | undefined,
  edited: FieldDefinition,
): FieldDefinition {
  const next = structuredClone(source);
  if (!Object.is(previous?.exposeToOgraf, edited.exposeToOgraf)) {
    if (typeof edited.exposeToOgraf === 'boolean') next.exposeToOgraf = edited.exposeToOgraf;
    else delete next.exposeToOgraf;
  }
  next.properties = next.properties.map((property) => {
    const edit = edited.properties.find((item) => item.key === property.key);
    const before = previous?.properties.find((item) => item.key === property.key);
    return edit ? preserveFieldExposureEdits(property, before, edit) : property;
  });
  if (next.items && edited.items)
    next.items = preserveFieldExposureEdits(next.items, previous?.items ?? undefined, edited.items);
  return next;
}

function hidden(field: FieldDefinition): boolean {
  return (
    field.exposeToOgraf === false ||
    (field.type === 'array' && field.items?.exposeToOgraf === false)
  );
}

function object(value: FieldValue): value is Record<string, FieldValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Public manifest edits win for public values; internal defaults come from the descriptor. */
function restoreExposureValue(
  source: FieldDefinition,
  publicValue: FieldValue,
  sourceValue: FieldValue,
): FieldValue {
  if (source.type === 'array' && source.items && Array.isArray(publicValue))
    return publicValue.map((entry, index) =>
      restoreExposureValue(
        source.items!,
        entry,
        Array.isArray(sourceValue)
          ? (sourceValue[index] ?? source.items!.defaultValue)
          : source.items!.defaultValue,
      ),
    );
  if (source.type !== 'object' || !object(publicValue)) return structuredClone(publicValue);
  const next = structuredClone(publicValue);
  for (const child of source.properties) {
    const original = object(sourceValue)
      ? (sourceValue[child.key] ?? child.defaultValue)
      : child.defaultValue;
    if (hidden(child)) next[child.key] = structuredClone(original);
    else if (Object.hasOwn(next, child.key))
      next[child.key] = restoreExposureValue(child, next[child.key]!, original);
  }
  return next;
}

/** Recover internal authoring fields without adding them to the public OGraf manifest. */
export function restoreFieldExposureDefinition(
  source: FieldDefinition,
  publicField?: FieldDefinition,
): FieldDefinition {
  if (!publicField) {
    const recovered = structuredClone(source);
    // The compiled package carries resolved defaults, not the original Brand Kit token table.
    delete recovered.defaultTokenId;
    recovered.properties = recovered.properties.map((property) =>
      restoreFieldExposureDefinition(property),
    );
    if (recovered.items) recovered.items = restoreFieldExposureDefinition(recovered.items);
    return recovered;
  }
  const next = structuredClone(publicField);
  if (typeof source.exposeToOgraf === 'boolean') next.exposeToOgraf = source.exposeToOgraf;
  if (source.generatedShaderParameter)
    next.generatedShaderParameter = structuredClone(source.generatedShaderParameter);
  next.defaultValue = restoreExposureValue(source, next.defaultValue, source.defaultValue);
  next.properties = next.properties.map((property) => {
    const original = source.properties.find((child) => child.key === property.key);
    return original ? restoreFieldExposureDefinition(original, property) : property;
  });
  for (const child of source.properties)
    if (hidden(child) && !next.properties.some((property) => property.key === child.key))
      next.properties.push(restoreFieldExposureDefinition(child));
  if (source.items && next.items)
    next.items = restoreFieldExposureDefinition(source.items, next.items);
  return next;
}

import { validateDataSimple } from 'ograf-form';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Resolve each object at its own data path, including main-form slot/state schemas. */
function project(schema, data, depth = 0) {
  if (!record(schema) || depth > 32) return schema;
  let result = { ...schema };
  const properties = { ...schema.properties };
  const required = new Set(schema.required ?? []);
  const visit = (branch, level = 0) => {
    if (!record(branch) || level > 32) return;
    const {
      properties: _properties,
      required: _required,
      allOf: _allOf,
      if: _if,
      then: _then,
      else: _else,
      ...plain
    } = branch;
    result = { ...result, ...plain };
    for (const [key, property] of Object.entries(branch.properties ?? {})) {
      properties[key] = { ...properties[key], ...property };
    }
    for (const key of branch.required ?? []) required.add(key);
    for (const child of branch.allOf ?? []) visit(child, level + 1);
    if (branch.if) {
      const matches = validateDataSimple(branch.if, data).errors.length === 0;
      visit(matches ? branch.then : branch.else, level + 1);
    }
  };
  visit(schema);
  delete result.allOf;
  delete result.if;
  delete result.then;
  delete result.else;
  if (schema.type === 'object' || Object.keys(properties).length) {
    result.properties = Object.fromEntries(
      Object.entries(properties).map(([key, property]) => [
        key,
        project(property, record(data) ? data[key] : undefined, depth + 1),
      ]),
    );
    if (required.size || schema.required) result.required = [...required];
  }
  if (result.items)
    result.items = project(result.items, Array.isArray(data) ? data[0] : undefined, depth + 1);
  return result;
}

export function resolveConditionalActionSchema(schema, data) {
  return project(schema, data);
}

/** Keep conditional keys known without treating unrelated, open-object context keys as fields. */
function possible(schema, depth = 0) {
  const result = { properties: {}, items: undefined };
  const sources = new Map();
  const itemSources = [];
  const visit = (branch, level = 0) => {
    if (!record(branch) || depth > 32 || level > 32) return;
    for (const [key, property] of Object.entries(branch.properties ?? {})) {
      const definitions = sources.get(key) ?? [];
      definitions.push(property);
      sources.set(key, definitions);
    }
    if (branch.items) itemSources.push(branch.items);
    for (const child of branch.allOf ?? []) visit(child, level + 1);
    visit(branch.then, level + 1);
    visit(branch.else, level + 1);
  };
  visit(schema);
  for (const [key, definitions] of sources)
    result.properties[key] = possible({ allOf: definitions }, depth + 1);
  if (itemSources.length) result.items = possible({ allOf: itemSources }, depth + 1);
  return result;
}

function normalize(current, before, known, data, previous) {
  if (current?.type === 'array' && Array.isArray(data))
    return data.map((entry, index) =>
      normalize(
        current.items,
        before?.items,
        known?.items,
        entry,
        Array.isArray(previous) ? previous[index] : undefined,
      ),
    );
  if (current?.type !== 'object' || !record(data)) return data;
  const result = { ...data };
  const properties = current.properties ?? {};
  const required = new Set(current.required ?? []);
  for (const key of Object.keys(result)) {
    if (
      !Object.hasOwn(properties, key) &&
      (current.additionalProperties === false || Object.hasOwn(known?.properties ?? {}, key))
    )
      delete result[key];
  }
  for (const [key, property] of Object.entries(properties)) {
    if (!Object.hasOwn(result, key)) {
      // Optional sparse fields belong to the caller. Merely rendering a form must not
      // populate object shells or select the first enum option and send an unintended patch.
      if (!required.has(key) && !Object.hasOwn(property, 'default')) continue;
      if (Object.hasOwn(property, 'default')) result[key] = copy(property.default);
      else if (property.type === 'object') result[key] = {};
    }
    if (property.gddType === 'select' && Array.isArray(property.enum) && property.enum.length) {
      const selectionChanged =
        before?.properties?.[key] &&
        (!same(before.properties[key].enum, property.enum) ||
          !same(before.properties[key].default, property.default));
      const valid = property.enum.some((choice) => same(choice, result[key]));
      if (!valid || (selectionChanged && same(result[key], previous?.[key])))
        result[key] = copy(
          property.enum.some((choice) => same(choice, property.default))
            ? property.default
            : property.enum[0],
        );
    }
    if (Object.hasOwn(result, key))
      result[key] = normalize(
        property,
        before?.properties?.[key],
        known?.properties?.[key],
        result[key],
        record(previous) ? previous[key] : undefined,
      );
  }
  return result;
}

/** Reconcile dependent selects and nested public defaults without resurrecting hidden fields. */
export function normalizeConditionalActionData(schema, next, previous) {
  if (!record(next)) return next;
  const known = possible(schema);
  const before = previous ? project(schema, previous) : undefined;
  let result = next;
  // A changed lane can first reset its state selector, then choose a different data branch.
  for (let iteration = 0; iteration < 8; iteration++) {
    const normalized = normalize(project(schema, result), before, known, result, previous);
    if (same(result, normalized)) return same(next, normalized) ? next : normalized;
    result = normalized;
  }
  return result;
}

const absent = (value, key) =>
  !record(value) || !Object.hasOwn(value, key) || value[key] === undefined;
const optional = (schema, key, property) =>
  !(schema.required ?? []).includes(key) && !Object.hasOwn(property, 'default');

/** The upstream form validates every rendered child, even absent optional fields. */
export function projectOptionalFormSchema(schema, data, depth = 0) {
  if (!record(schema) || depth > 32) return schema;
  const result = { ...schema };
  if (schema.type === 'object' && record(schema.properties))
    result.properties = Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([key, property]) => !(optional(schema, key, property) && absent(data, key)))
        .map(([key, property]) => [
          key,
          projectOptionalFormSchema(property, record(data) ? data[key] : undefined, depth + 1),
        ]),
    );
  // Arrays are complete field values. Keep their item schema and provided rows unchanged.
  return result;
}

/** Checkbox choices are separate from the payload; selecting one explicitly adds its value. */
export function optionalFormFields(schema, data, path = [], labels = [], depth = 0) {
  if (!record(schema) || depth > 32) return [];
  if (schema.type !== 'object' || !record(data)) return [];
  return Object.entries(schema.properties ?? {}).flatMap(([key, property]) => {
    if (
      !record(property) ||
      property.hidden ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      return [];
    const nextPath = [...path, key],
      nextLabels = [...labels, property.title || key];
    const included = !absent(data, key);
    return [
      ...(optional(schema, key, property)
        ? [{ path: nextPath, label: nextLabels.join(' / '), included, schema: property }]
        : []),
      ...(included ? optionalFormFields(property, data[key], nextPath, nextLabels, depth + 1) : []),
    ];
  });
}

function initialOptionalValue(schema, depth = 0) {
  if (!record(schema) || depth > 32) return null;
  if (Object.hasOwn(schema, 'default')) return copy(schema.default);
  if (Object.hasOwn(schema, 'const')) return copy(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length) return copy(schema.enum[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(
          ([key, property]) =>
            (schema.required ?? []).includes(key) || Object.hasOwn(property, 'default'),
        )
        .map(([key, property]) => [key, initialOptionalValue(property, depth + 1)]),
    );
  if (type === 'array') return [];
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer')
    return typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (schema.gddType === 'color-rrggbb') return '#000000';
  if (schema.gddType === 'color-rrggbbaa') return '#000000ff';
  return '';
}

export function setOptionalFormField(data, path, included, schema) {
  if (!path.length || path.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)))
    return data;
  const result = copy(data);
  let parent = result;
  for (const segment of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, segment)) return data;
    parent = parent[segment];
  }
  if (!record(parent)) return data;
  const key = path[path.length - 1];
  if (included) {
    if (!Object.hasOwn(parent, key)) parent[key] = initialOptionalValue(schema);
  } else delete parent[key];
  return result;
}

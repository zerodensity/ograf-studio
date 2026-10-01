import { scriptModuleName } from './scriptModules';

const properties = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity']);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate serialized scripting fields without compiling or executing user code. */
export function scriptingErrors(value: unknown, validateModuleNames = true): string[] {
  if (!record(value)) return [];
  const errors: string[] = [];
  if (
    value.expressionApiVersion !== undefined &&
    (typeof value.expressionApiVersion !== 'number' ||
      !Number.isInteger(value.expressionApiVersion) ||
      value.expressionApiVersion < 1)
  )
    errors.push('Expression API version must be a positive integer.');
  if (value.scripting !== undefined) {
    const settings = value.scripting;
    if (!record(settings)) errors.push('Scripting settings must be an object.');
    else {
      if (typeof settings.enabled !== 'boolean')
        errors.push('Scripting enabled must be a boolean.');
      if (typeof settings.source !== 'string') errors.push('Scripting source must be a string.');
      if (!Array.isArray(settings.modules)) errors.push('Scripting modules must be an array.');
      else {
        const names = new Set<string>();
        for (const file of settings.modules) {
          if (
            !record(file) ||
            typeof file.fileName !== 'string' ||
            typeof file.source !== 'string'
          ) {
            errors.push('Script modules must have string fileName and source fields.');
            continue;
          }
          if (!validateModuleNames) continue;
          try {
            const name = scriptModuleName(file.fileName);
            if (names.has(name)) errors.push('Duplicate module name: ' + name);
            names.add(name);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    }
  }
  for (const layer of Array.isArray(value.layers) ? value.layers : []) {
    if (!record(layer)) continue;
    for (const [field, type] of [
      ['expressions', 'string'],
      ['expressionsEnabled', 'boolean'],
    ] as const) {
      const entries = layer[field];
      if (entries === undefined) continue;
      if (!record(entries)) errors.push('Layer ' + field + ' must be an object.');
      else
        for (const [property, entry] of Object.entries(entries)) {
          if (!properties.has(property) || typeof entry !== type)
            errors.push(
              'Layer ' +
                field +
                '.' +
                property +
                ' must be a supported property with a ' +
                type +
                ' value.',
            );
        }
    }
  }
  for (const component of Array.isArray(value.components) ? value.components : [])
    errors.push(...scriptingErrors(component, validateModuleNames));
  for (const collection of Array.isArray(value.collections) ? value.collections : [])
    if (record(collection))
      errors.push(...scriptingErrors({ layers: collection.prototypeLayers }, validateModuleNames));
  return errors;
}

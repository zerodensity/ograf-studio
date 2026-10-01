import { createScriptConsole } from './scriptConsole';
import { transform } from 'sucrase';
import type { CompositionScripting } from './types';

const factories = new Map<
  string,
  (exports: object, require: (path: string) => object, console: Console) => void
>();
const libraries = new WeakMap<CompositionScripting, Record<string, object>>();
const reservedNames = new Set([
  'data',
  'comp',
  'timeline',
  'frame',
  'time',
  'thisLayer',
  'thisProperty',
  'value',
  'valueAtTime',
  'sourceRectAtTime',
  'layer',
  'layerById',
  'lerp',
  'clamp',
  'ease',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'transformOriginX',
  'transformOriginY',
  'modules',
  'scope',
  // A fixed vocabulary keeps project filenames portable across browser and Node hosts.
  ...(
    'globalThis Infinity NaN undefined Object Function Boolean Symbol Error AggregateError ' +
    'EvalError RangeError ReferenceError SyntaxError TypeError URIError Number BigInt Math Date ' +
    'String RegExp Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array ' +
    'Int32Array Uint32Array BigInt64Array BigUint64Array Float32Array Float64Array Map Set ' +
    'WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Atomics JSON Promise Reflect Proxy ' +
    'Intl WebAssembly WeakRef FinalizationRegistry console eval parseInt parseFloat isNaN ' +
    'isFinite decodeURI decodeURIComponent encodeURI encodeURIComponent'
  ).split(' '),
]);

/** Flat project files use their basename as the expression namespace. */
export function scriptModuleName(fileName: string): string {
  if (!/^[A-Za-z_$][\w$]*\.(?:m?js)$/.test(fileName))
    throw new Error('Use a JavaScript filename such as helpers.js (letters, digits, _ or $).');
  const name = fileName.replace(/\.(?:m?js)$/, '');
  if (reservedNames.has(name)) throw new Error('Reserved module name: ' + name);
  // Let the host reject reserved JavaScript words, rather than maintaining a keyword parser.
  new Function('"use strict"; const ' + name + ' = 0;');
  return name;
}

function factory(source: string) {
  const cached = factories.get(source);
  if (cached) return cached;
  const code = transform(source, {
    transforms: ['imports'],
    disableESTransforms: true,
  }).code;
  const execute = new Function('exports', 'require', 'console', code) as (
    exports: object,
    require: (path: string) => object,
    console: Console,
  ) => void;
  if (factories.size >= 128) factories.delete(factories.keys().next().value!);
  factories.set(source, execute);
  return execute;
}

export function scriptModuleSyntaxError(source: string): string | undefined {
  try {
    factory(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/** Immutable project settings own library state; unrelated compositions never share exports. */
export function scriptModules(settings?: CompositionScripting): Record<string, object> {
  if (!settings?.modules.length) return Object.create(null);
  const cached = libraries.get(settings);
  if (cached) return cached;
  const modules = Object.create(null) as Record<string, object>;
  const files = new Map<string, string>();
  for (const file of settings.modules) {
    const name = scriptModuleName(file.fileName);
    if (Object.hasOwn(modules, name)) throw new Error('Duplicate module name: ' + name);
    files.set(file.fileName, file.source);
    Object.defineProperty(modules, name, { enumerable: true, get: () => load(file.fileName) });
  }
  const loaded = new Map<string, object>();
  const failures = new Map<string, Error>();
  const loading = new Set<string>();
  const load = (fileName: string): object => {
    if (failures.has(fileName)) throw failures.get(fileName);
    if (loading.has(fileName))
      throw new Error('Circular module import: ' + [...loading, fileName].join(' -> '));
    if (loaded.has(fileName)) return loaded.get(fileName)!;
    const source = files.get(fileName);
    if (source === undefined)
      throw new Error('Module is not included in this composition: ' + fileName);
    loading.add(fileName);
    try {
      const exports = Object.create(null);
      factory(source)(
        exports,
        (path) => {
          if (!/^\.\/[A-Za-z_$][\w$]*\.(?:m?js)$/.test(path))
            throw new Error('Import a bundled file with a relative path, such as ./helpers.js.');
          return load(path.slice(2));
        },
        createScriptConsole(fileName),
      );
      const namespace = new Proxy(exports, {
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      loaded.set(fileName, namespace);
      return namespace;
    } catch (error) {
      const failure = new Error(
        fileName + ': ' + (error instanceof Error ? error.message : String(error)),
      );
      failures.set(fileName, failure);
      throw failure;
    } finally {
      loading.delete(fileName);
    }
  };
  Object.freeze(modules);
  libraries.set(settings, modules);
  return modules;
}

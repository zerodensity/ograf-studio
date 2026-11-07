const SINGLE_SCHEMA_KEYS = new Set([
  'additionalProperties',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);
const SCHEMA_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
  'dependentSchemas',
]);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const RESOURCE_KEYS = new Set([
  '$id',
  '$anchor',
  '$dynamicAnchor',
  '$dynamicRef',
  '$recursiveAnchor',
  '$recursiveRef',
]);
const pointerPart = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');

/** Enumerate schema positions only. Annotation/const/enum/default payloads are never schemas. */
function schemaChildren(value: Record<string, unknown>): Array<{
  holder: Record<string, unknown> | unknown[];
  key: string | number;
  schema: Record<string, unknown>;
  path: string;
}> {
  const children: ReturnType<typeof schemaChildren> = [];
  const append = (
    holder: Record<string, unknown> | unknown[],
    key: string | number,
    child: unknown,
    path: string,
  ) => {
    if (isRecord(child)) children.push({ holder, key, schema: child, path });
  };
  for (const [key, child] of Object.entries(value)) {
    if (SCHEMA_MAP_KEYS.has(key) && isRecord(child)) {
      for (const [name, entry] of Object.entries(child))
        append(child, name, entry, `/${key}/${pointerPart(name)}`);
    } else if ((SCHEMA_ARRAY_KEYS.has(key) || key === 'items') && Array.isArray(child)) {
      child.forEach((entry, index) => append(child, index, entry, `/${key}/${index}`));
    } else if (SINGLE_SCHEMA_KEYS.has(key) || key === 'items') {
      append(value, key, child, `/${key}`);
    } else if (key === 'dependencies' && isRecord(child)) {
      for (const [name, entry] of Object.entries(child))
        if (!Array.isArray(entry)) append(child, name, entry, `/${key}/${pointerPart(name)}`);
    }
  }
  return children;
}

/** Undo costly generated references, retaining annotations and every addressed fragment. */
function compactNamedDefinitions(root: Record<string, unknown>): void {
  // Moving an anchor or a nested resource changes reference resolution. The generated provider
  // schemas do not need those features; leave such documents to the conservative existing pass.
  const scoped = (node: Record<string, unknown>): boolean =>
    [...RESOURCE_KEYS].some((key) => Object.hasOwn(node, key)) ||
    schemaChildren(node).some((child) => scoped(child.schema));
  if (scoped(root)) return;
  const encoder = new TextEncoder();
  const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  const walk = (
    node: Record<string, unknown>,
    visit: (schema: Record<string, unknown>) => void,
  ) => {
    visit(node);
    for (const child of schemaChildren(node)) walk(child.schema, visit);
  };
  const pointer = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.startsWith('#/')) return;
    try {
      return decodeURIComponent(value.slice(1));
    } catch {
      return;
    }
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of ['definitions', '$defs']) {
      const definitions = root[key];
      if (!isRecord(definitions)) continue;
      const prefix = `/${key}/`;
      let addressedContainer = false;
      walk(root, (node) => {
        if (pointer(node.$ref) === `/${key}`) addressedContainer = true;
      });
      if (addressedContainer) continue;

      // Zod can emit multiple names for byte-identical leaves. Sharing the shortest destination
      // also keeps pointer suffixes valid (e.g. a reference to a definition's /properties/value).
      const groups = new Map<string, string[]>();
      for (const [name, definition] of Object.entries(definitions)) {
        const signature = JSON.stringify(definition);
        const names = groups.get(signature) ?? [];
        names.push(name);
        groups.set(signature, names);
      }
      const aliases = new Map<string, string>();
      for (const names of groups.values()) {
        names.sort(
          (a, b) => bytes(`${prefix}${pointerPart(a)}`) - bytes(`${prefix}${pointerPart(b)}`),
        );
        for (const alias of names.slice(1)) aliases.set(pointerPart(alias), pointerPart(names[0]!));
      }
      if (aliases.size) {
        changed = true;
        walk(root, (node) => {
          const target = pointer(node.$ref);
          if (!target?.startsWith(prefix)) return;
          const tail = target.slice(prefix.length),
            slash = tail.indexOf('/');
          const name = slash < 0 ? tail : tail.slice(0, slash);
          const canonical = aliases.get(name);
          if (canonical === undefined) return;
          const rewritten = `${prefix}${canonical}${slash < 0 ? '' : tail.slice(slash)}`;
          node.$ref =
            `#/${key}/` +
            rewritten.slice(prefix.length).split('/').map(encodeURIComponent).join('/');
        });
        for (const alias of aliases.keys())
          delete definitions[alias.replace(/~1/g, '/').replace(/~0/g, '~')];
      }

      type Reference = ReturnType<typeof schemaChildren>[number];
      const candidates = new Map<
        string,
        { definition: unknown; references: Reference[]; keep: boolean }
      >();
      for (const [name, definition] of Object.entries(definitions)) {
        if (typeof definition === 'boolean' || isRecord(definition))
          candidates.set(name, { definition, references: [], keep: false });
      }
      const collect = (node: Record<string, unknown>, reference?: Reference) => {
        const target = pointer(node.$ref);
        if (target?.startsWith(prefix)) {
          const tail = target.slice(prefix.length),
            slash = tail.indexOf('/');
          const escaped = slash < 0 ? tail : tail.slice(0, slash);
          const candidate = candidates.get(escaped.replace(/~1/g, '/').replace(/~0/g, '~'));
          if (candidate) {
            if (reference && slash < 0 && Object.keys(node).length === 1)
              candidate.references.push(reference);
            else candidate.keep = true;
          }
        }
        for (const child of schemaChildren(node)) collect(child.schema, child);
      };
      collect(root);
      for (const [name, candidate] of candidates) {
        const { definition, references, keep } = candidate;
        if (!references.length) continue;
        // Never expand a directly recursive destination. Other aliases are reconsidered after
        // each replacement so references newly exposed by a chain cannot become dangling.
        let recursive = false;
        if (isRecord(definition))
          walk(definition, (node) => {
            const target = pointer(node.$ref),
              self = prefix + pointerPart(name);
            if (target === self || target?.startsWith(self + '/')) recursive = true;
          });
        if (recursive) continue;
        // Count UTF-8 bytes, including the named definition when it can be pruned. A constraint
        // larger than a $ref can still be cheaper inline when it has only one or two consumers.
        const before =
          references.reduce((sum, reference) => sum + bytes(reference.schema), 0) +
          (keep ? 0 : bytes({ [name]: definition }) - 1);
        if (before <= references.length * bytes(definition)) continue;
        for (const reference of references)
          (reference.holder as Record<string | number, unknown>)[reference.key] =
            structuredClone(definition);
        if (!keep) delete definitions[name];
        changed = true;
        break;
      }
      if (!Object.keys(definitions).length) delete root[key];
    }
  }
}

/**
 * Move repeated, byte-identical schemas to the SAME root resource. References retain their base
 * URI; nested ID/anchor/dynamic scopes are deliberately opaque. Never replace a node addressed by
 * an existing pointer (or its ancestors), since a pointer may address a descendant schema rather
 * than merely follow a replacement $ref. Small nodes stay inline when reference overhead costs more.
 */
function deduplicateSchemas(root: Record<string, unknown>): void {
  const encoder = new TextEncoder();
  const wireBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  const hasUnevaluated = (node: Record<string, unknown>): boolean =>
    Object.hasOwn(node, 'unevaluatedProperties') ||
    Object.hasOwn(node, 'unevaluatedItems') ||
    schemaChildren(node).some((child) => hasUnevaluated(child.schema));
  // In later dialects an explicit open applicator also marks properties as evaluated.
  // Preserve it whenever this document can observe those annotations.
  const compactOpenSchemas = !hasUnevaluated(root);
  const protectedPaths = new Set<string>();
  const findPointers = (node: Record<string, unknown>, path = '') => {
    if (path && [...RESOURCE_KEYS].some((key) => Object.hasOwn(node, key))) return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
      try {
        const pointer = decodeURIComponent(node.$ref.slice(1));
        const segments = pointer.split('/');
        for (let length = 2; length <= segments.length; length++)
          protectedPaths.add(segments.slice(0, length).join('/'));
      } catch {
        /* Invalid existing references are left untouched, not repaired. */
      }
    }
    for (const child of schemaChildren(node)) findPointers(child.schema, path + child.path);
  };
  findPointers(root);
  const normalize = (node: Record<string, unknown>, path = '') => {
    if (path && [...RESOURCE_KEYS].some((key) => Object.hasOwn(node, key))) return;
    for (const child of schemaChildren(node)) {
      const childPath = path + child.path;
      normalize(child.schema, childPath);
      const allOf = child.schema.allOf;
      if (
        !protectedPaths.has(childPath) &&
        Object.keys(child.schema).length === 1 &&
        Array.isArray(allOf) &&
        allOf.length === 1 &&
        isRecord(allOf[0]) &&
        ![...RESOURCE_KEYS].some((key) => Object.hasOwn(allOf[0]!, key))
      ) {
        (child.holder as Record<string | number, unknown>)[child.key] = allOf[0];
      }
    }
    if (typeof node.$ref === 'string') return;
    if (
      compactOpenSchemas &&
      isRecord(node.additionalProperties) &&
      Object.keys(node.additionalProperties).length === 0 &&
      !protectedPaths.has(`${path}/additionalProperties`)
    )
      delete node.additionalProperties;
    for (const keyword of ['anyOf', 'oneOf']) {
      const branches = node[keyword];
      if (
        !Array.isArray(branches) ||
        branches.length < 2 ||
        protectedPaths.has(`${path}/${keyword}`) ||
        branches.some(
          (branch) =>
            !isRecord(branch) ||
            typeof branch.$ref === 'string' ||
            [...RESOURCE_KEYS].some((key) => Object.hasOwn(branch, key)),
        )
      )
        continue;
      const schemas = branches as Record<string, unknown>[];
      // An empty alternative already accepts every value. Pure enum/const alternatives add
      // no restriction. Keep annotated branches and newer evaluated-property semantics intact.
      if (
        compactOpenSchemas &&
        keyword === 'anyOf' &&
        schemas.some((branch) => Object.keys(branch).length === 0) &&
        schemas.every(
          (branch) =>
            Object.keys(branch).length === 0 ||
            (Object.keys(branch).length === 1 &&
              (Array.isArray(branch.enum) || Object.hasOwn(branch, 'const'))),
        )
      ) {
        delete node.anyOf;
        continue;
      }
      const type = schemas[0]!.type;
      if (
        typeof type === 'string' &&
        schemas.every((branch) => branch.type === type) &&
        (node.type === undefined || node.type === type)
      ) {
        node.type = type;
        for (const branch of schemas) delete branch.type;
      }
      const first = schemas[0]!.required;
      if (Array.isArray(first) && first.every((item) => typeof item === 'string')) {
        const common = first.filter((item) =>
          schemas.every(
            (branch) => Array.isArray(branch.required) && branch.required.includes(item),
          ),
        );
        if (common.length) {
          node.required = [
            ...new Set([...(Array.isArray(node.required) ? node.required : []), ...common]),
          ];
          for (const branch of schemas) {
            const required = (branch.required as string[]).filter((item) => !common.includes(item));
            if (required.length) branch.required = required;
            else delete branch.required;
          }
        }
      }
      // Strict object variants can share a property's constraint even if only some variants
      // declare it: all others reject that key. Keep an empty schema at each original allowed
      // property so additionalProperties:false keeps exactly the same allowed-key contract.
      if (
        schemas.every(
          (branch) =>
            branch.additionalProperties === false && !Object.hasOwn(branch, 'patternProperties'),
        ) &&
        (node.properties === undefined || isRecord(node.properties))
      ) {
        const properties = new Map<
          string,
          Array<{ holder: Record<string, unknown>; schema: unknown }>
        >();
        for (const branch of schemas) {
          if (!isRecord(branch.properties)) continue;
          for (const [name, schema] of Object.entries(branch.properties)) {
            const entries = properties.get(name) ?? [];
            entries.push({ holder: branch.properties, schema });
            properties.set(name, entries);
          }
        }
        const movable = (schema: unknown): boolean =>
          !isRecord(schema) ||
          (![...RESOURCE_KEYS].some((key) => Object.hasOwn(schema, key)) &&
            schemaChildren(schema).every((child) => movable(child.schema)));
        const saving = ([name, entries]: [
          string,
          Array<{ holder: Record<string, unknown>; schema: unknown }>,
        ]) =>
          entries.length * (wireBytes(entries[0]!.schema) - 2) -
          wireBytes({ [name]: entries[0]!.schema });
        // Pay the shared properties-container overhead with the largest saving first. Later
        // fields then see its actual marginal cost, making one pass stable on repeated calls.
        for (const [name, entries] of [...properties].sort((a, b) => saving(b) - saving(a))) {
          const common = entries[0]!.schema,
            signature = JSON.stringify(common);
          const previous = node.properties as Record<string, unknown> | undefined;
          if (
            entries.length < 2 ||
            !movable(common) ||
            entries.some((entry) => JSON.stringify(entry.schema) !== signature) ||
            (previous &&
              Object.hasOwn(previous, name) &&
              JSON.stringify(previous[name]) !== signature)
          )
            continue;
          const addition =
            previous === undefined
              ? wireBytes({ properties: { [name]: common } }) - 1
              : Object.hasOwn(previous, name)
                ? 0
                : wireBytes({ [name]: common }) - (Object.keys(previous).length ? 1 : 2);
          if (entries.length * (wireBytes(common) - 2) <= addition) continue;
          node.properties = { ...previous, [name]: common };
          for (const entry of entries) entry.holder[name] = {};
        }
      }
    }
  };
  normalize(root);
  type Candidate = {
    holder: Record<string, unknown> | unknown[];
    key: string | number;
    node: Record<string, unknown>;
  };
  const groups = new Map<string, Candidate[]>();
  const gather = (node: Record<string, unknown>, path = ''): boolean => {
    if (path && [...RESOURCE_KEYS].some((key) => Object.hasOwn(node, key))) return false;
    let movable = ![...RESOURCE_KEYS].some((key) => Object.hasOwn(node, key));
    for (const child of schemaChildren(node)) {
      const childPath = path + child.path;
      const childMovable = gather(child.schema, childPath);
      movable &&= childMovable;
      // Existing named definitions remain stable destinations for public fragment pointers.
      if (
        !childMovable ||
        protectedPaths.has(childPath) ||
        /^\/(definitions|\$defs)\/[^/]+$/.test(childPath)
      )
        continue;
      const signature = JSON.stringify(child.schema);
      // Even a short constrained scalar can save space when used by many operations. The
      // cost calculation below includes every reference and the new definition; unconstrained
      // scalar types remain inline because a reference is longer than their schema.
      if (signature.length < 20) continue;
      const list = groups.get(signature) ?? [];
      list.push({ holder: child.holder, key: child.key, node: child.schema });
      groups.set(signature, list);
    }
    return movable;
  };
  gather(root);
  const definitionKey =
    isRecord(root.$defs) || root.definitions === undefined ? '$defs' : 'definitions';
  let definitions = isRecord(root[definitionKey])
    ? (root[definitionKey] as Record<string, unknown>)
    : undefined;
  let nextName = Object.keys(definitions ?? {}).length;
  // Children are factored first. Then identical parents contain the same compact child refs.
  for (const [, original] of [...groups].sort(([left], [right]) => left.length - right.length)) {
    const current = new Map<string, Candidate[]>();
    for (const candidate of original) {
      const signature = JSON.stringify(candidate.node);
      const list = current.get(signature) ?? [];
      list.push(candidate);
      current.set(signature, list);
    }
    for (const [signature, candidates] of current) {
      if (candidates.length < 2) continue;
      const existing = Object.entries(definitions ?? {}).find(
        ([, value]) => JSON.stringify(value) === signature,
      );
      let name = existing?.[0] ?? nextName.toString(36);
      while (!existing && Object.hasOwn(definitions ?? {}, name)) name = (++nextName).toString(36);
      const reference = { $ref: `#/${definitionKey}/${pointerPart(name)}` };
      const referenceBytes = JSON.stringify(reference).length;
      const definitionCost = existing ? 0 : signature.length + JSON.stringify(name).length + 2;
      if (candidates.length * (signature.length - referenceBytes) - definitionCost < 24) continue;
      if (!definitions) root[definitionKey] = definitions = {};
      if (!existing) {
        definitions[name] = candidates[0]!.node;
        nextName++;
      }
      for (const candidate of candidates)
        (candidate.holder as Record<string | number, unknown>)[candidate.key] = { ...reference };
    }
  }
}

/**
 * Lossless provider-only compaction of generated draft-7 schemas. Canonical Zod validation is
 * untouched. Short reference labels have no public meaning, and string const/enum values already
 * imply their type. Object property names are always strings. Walk schema keywords only:
 * defaults, examples, const and enum are user DATA.
 */
export function compactProviderSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  // Identified/external/dynamic resources can be addressed from outside this document. Keep them
  // byte-for-byte structurally intact rather than guessing their registration URI or dialect.
  const unsupported = (node: Record<string, unknown>): boolean => {
    if (
      ['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor'].some((key) =>
        Object.hasOwn(node, key),
      )
    )
      return true;
    if (typeof node.$ref === 'string' && !node.$ref.startsWith('#')) return true;
    return schemaChildren(node).some((child) => unsupported(child.schema));
  };
  if (typeof copy.$id === 'string' || unsupported(copy)) return copy;
  const definitions = isRecord(copy.definitions) ? copy.definitions : undefined;
  // $defs is a standard schema container in newer drafts and an ordinary ignored annotation in
  // draft-7. JSON Pointer $refs resolve into it identically in both. Never merge an existing one.
  const shortDefinitions = definitions && copy.$defs === undefined;
  const names = new Map(
    Object.keys(definitions ?? {}).map((name, index) => [name, index.toString(36)]),
  );

  const visit = (value: unknown, references: Map<string, string>, root = false): unknown => {
    if (!isRecord(value)) return value;
    // A nested resource owns its fragment references; they do not address the outer definitions.
    const localReferences =
      !root && typeof value.$id === 'string' ? new Map<string, string>() : references;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        let decoded = child;
        try {
          decoded = decodeURIComponent(child);
        } catch {
          /* Preserve an invalid existing URI. */
        }
        const match = /^#\/definitions\/([^/]+)(.*)$/.exec(decoded);
        if (match) {
          const name = match[1]!.replace(/~1/g, '/').replace(/~0/g, '~');
          const renamed = localReferences.get(name);
          if (renamed !== undefined) {
            const suffix = match[2]!
              .split('/')
              .map((segment) => encodeURIComponent(segment))
              .join('/');
            value[key] = `#/${shortDefinitions ? '$defs' : 'definitions'}/${renamed}${suffix}`;
          }
        }
      } else if (SCHEMA_MAP_KEYS.has(key) && isRecord(child)) {
        value[key] = Object.fromEntries(
          Object.entries(child).map(([name, entry]) => [
            root && key === 'definitions' ? names.get(name)! : name,
            visit(entry, localReferences),
          ]),
        );
      } else if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
        value[key] = child.map((entry) => visit(entry, localReferences));
      } else if (key === 'items') {
        value[key] = Array.isArray(child)
          ? child.map((entry) => visit(entry, localReferences))
          : visit(child, localReferences);
      } else if (key === 'propertyNames' && isRecord(child)) {
        // propertyNames evaluates the object KEY itself, which is necessarily a string in JSON.
        if (child.type === 'string') delete child.type;
        const propertySchema = visit(child, localReferences) as Record<string, unknown>;
        if (Object.keys(propertySchema).length === 0) delete value[key];
        else value[key] = propertySchema;
      } else if (SINGLE_SCHEMA_KEYS.has(key)) {
        value[key] = visit(child, localReferences);
      } else if (key === 'dependencies' && isRecord(child)) {
        value[key] = Object.fromEntries(
          Object.entries(child).map(([name, entry]) => [
            name,
            Array.isArray(entry) ? entry : visit(entry, localReferences),
          ]),
        );
      }
    }
    if (
      value.type === 'string' &&
      (typeof value.const === 'string' ||
        (Array.isArray(value.enum) &&
          value.enum.length > 0 &&
          value.enum.every((entry) => typeof entry === 'string')))
    )
      delete value.type;
    return value;
  };
  const compact = visit(copy, names, true) as Record<string, unknown>;
  if (shortDefinitions) {
    compact.$defs = compact.definitions;
    delete compact.definitions;
  }
  compactNamedDefinitions(compact);
  deduplicateSchemas(compact);
  // Factoring a repeated parent can turn its child definition into a single-use schema.
  compactNamedDefinitions(compact);
  return compact;
}

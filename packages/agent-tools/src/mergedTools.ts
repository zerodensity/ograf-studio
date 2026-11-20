import * as z from 'zod/v4';
import type { AgentToolRecord } from './toolRecords';

/**
 * One listed tool that also does the work of earlier tools. The selector argument picks whose
 * handler and input rules apply; the first route is the tool's own and the default.
 */
export interface ToolMerge {
  into: string;
  selector: string;
  routes: Record<string, string>;
}

export const TOOL_MERGES: readonly ToolMerge[] = [
  {
    into: 'ograf_get_capabilities',
    selector: 'view',
    routes: { capabilities: 'ograf_get_capabilities', sessions: 'ograf_list_sessions' },
  },
  {
    into: 'ograf_get_project',
    selector: 'view',
    routes: {
      project: 'ograf_get_project',
      changes: 'ograf_get_changes',
      timeline: 'ograf_get_timeline',
    },
  },
  {
    into: 'ograf_inspect_scene',
    selector: 'mode',
    routes: { inspect: 'ograf_inspect_scene', query: 'ograf_query_scene' },
  },
  {
    into: 'ograf_capture',
    selector: 'mode',
    routes: { frame: 'ograf_capture', strip: 'ograf_render_strip', svg: 'ograf_render_frame' },
  },
  {
    into: 'ograf_validate_project',
    selector: 'check',
    routes: {
      project: 'ograf_validate_project',
      design: 'ograf_review_design',
      text: 'ograf_measure_text',
    },
  },
  {
    into: 'ograf_import_asset',
    selector: 'mode',
    routes: { asset: 'ograf_import_asset', 'svg-bundle': 'ograf_import_svg_bundle' },
  },
  {
    into: 'ograf_create_project',
    selector: 'mode',
    routes: { create: 'ograf_create_project', reset: 'ograf_reset_project' },
  },
  {
    into: 'ograf_save_project',
    selector: 'scope',
    routes: { template: 'ograf_save_project', set: 'ograf_save_template_set' },
  },
  {
    into: 'ograf_export_package',
    selector: 'scope',
    routes: { template: 'ograf_export_package', set: 'ograf_export_coordinated_package' },
  },
  {
    into: 'ograf_undo',
    selector: 'direction',
    routes: { undo: 'ograf_undo', redo: 'ograf_redo' },
  },
  {
    into: 'ograf_review_template_transfer',
    selector: 'step',
    routes: {
      review: 'ograf_review_template_transfer',
      preview: 'ograf_preview_template_transfer',
    },
  },
];

/** Earlier tool names that a listed tool now covers. They stay callable and leave tool lists. */
export const MERGED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_MERGES.flatMap((merge) => Object.values(merge.routes).filter((name) => name !== merge.into)),
);

export function listedToolRecords(records: readonly AgentToolRecord[]): AgentToolRecord[] {
  return records.filter((record) => !record.hidden);
}

function defaultOf(schema: z.ZodType): { value: unknown } | undefined {
  return schema instanceof z.ZodDefault ? { value: schema.def.defaultValue } : undefined;
}

function sameDefault(schemas: z.ZodType[]): { value: unknown } | undefined {
  const [first, ...rest] = schemas.map(defaultOf);
  return first &&
    rest.every((other) => other && JSON.stringify(other.value) === JSON.stringify(first.value))
    ? first
    : undefined;
}

function isRequired(schema: z.ZodType): boolean {
  return !schema.safeParse(undefined).success;
}

/**
 * The listed form of one argument. A default is applied here only when every route shares it;
 * otherwise each route applies its own, and a default its users agree on is shown as a note.
 */
function listedArgument(schemas: z.ZodType[], routeCount: number): z.ZodType {
  const schema = schemas[0]!;
  const inEveryRoute = schemas.length === routeCount;
  if (inEveryRoute && schemas.every(isRequired)) return schema;
  const shared = sameDefault(schemas);
  if (inEveryRoute && shared) return schema;
  const optional = (
    schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : schema
  ).optional();
  return shared ? optional.meta({ default: shared.value }) : optional;
}

interface Route {
  key: string;
  record: AgentToolRecord;
  input: z.ZodObject;
}

function mergedRecord(merge: ToolMerge, routes: Route[]): AgentToolRecord {
  const own = routes[0]!;
  const shapes = routes.map((route) => route.record.config.inputSchema);
  if (shapes.some((shape) => merge.selector in shape))
    throw new Error(`${merge.into} already has an argument named ${merge.selector}.`);

  const inputSchema: Record<string, z.ZodType> = {
    [merge.selector]: z.enum(routes.map((route) => route.key) as [string, ...string[]]).optional(),
  };
  for (const key of new Set(shapes.flatMap((shape) => Object.keys(shape)))) {
    const schemas = shapes.filter((shape) => key in shape).map((shape) => shape[key] as z.ZodType);
    inputSchema[key] = listedArgument(schemas, shapes.length);
  }

  const routeFor = (chosen: unknown, args: Record<string, unknown>): Route => {
    if (chosen !== undefined) return routes.find((route) => route.key === chosen)!;
    const accepting = routes.find((route) => route.input.safeParse(args).success);
    if (accepting) return accepting;
    // No route accepts the arguments: report against the one they fit best.
    const foreignKeys = (route: Route) =>
      Object.keys(args).filter((key) => !(key in route.record.config.inputSchema)).length;
    return [...routes].sort((a, b) => foreignKeys(a) - foreignKeys(b))[0]!;
  };

  return {
    name: merge.into,
    config: {
      ...own.record.config,
      description: [
        own.record.config.description,
        ...routes
          .slice(1)
          .map((route) => `${merge.selector}=${route.key}: ${route.record.config.description}`),
      ].join(' '),
      inputSchema,
    },
    async handler(raw) {
      const args = Object.fromEntries(
        Object.entries(raw).filter(([key, value]) => key !== merge.selector && value !== undefined),
      );
      const route = routeFor(raw[merge.selector], args);
      const misplaced = Object.keys(args).filter(
        (key) => !(key in route.record.config.inputSchema),
      );
      if (misplaced.length > 0) {
        const homes = routes
          .filter((other) => misplaced.some((key) => key in other.record.config.inputSchema))
          .map((other) => other.key);
        throw new Error(
          `${merge.into} ${merge.selector}=${route.key} does not take ${misplaced.join(', ')}. ` +
            `Use ${merge.selector}=${homes.join(' or ')}.`,
        );
      }
      const parsed = route.input.safeParse(args);
      if (!parsed.success)
        throw new Error(
          `${merge.into} ${merge.selector}=${route.key}: ${z.prettifyError(parsed.error)}`,
        );
      return route.record.handler(parsed.data as Record<string, unknown>);
    },
  };
}

/**
 * Replaces each surviving tool with its merged form, in place, and hides the tools it covers.
 * A hidden tool answers callers of its earlier name exactly as before. `reachable` limits the
 * covered tools to those a surface already offered.
 */
export function mergeToolRecords(
  records: AgentToolRecord[],
  reachable?: ReadonlySet<string>,
): AgentToolRecord[] {
  for (const merge of TOOL_MERGES) {
    // A surface that leaves a tool out, as the built-in chat does, simply has no such route.
    const routes = Object.entries(merge.routes).flatMap(([key, name]) => {
      const record = records.find((candidate) => candidate.name === name);
      return record && (name === merge.into || !reachable || reachable.has(name))
        ? [{ key, record, input: z.strictObject(record.config.inputSchema) }]
        : [];
    });
    if (routes[0]?.record.name !== merge.into || routes.length < 2) continue;
    records[records.indexOf(routes[0].record)] = mergedRecord(merge, routes);
    for (const route of routes.slice(1)) route.record.hidden = true;
  }
  return records;
}

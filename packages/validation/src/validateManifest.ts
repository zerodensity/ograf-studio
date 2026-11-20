import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import type { OGrafDiscovery, OGrafManifest } from '@ograf-editor/ograf-types';
import { OFFICIAL_OGRAF_SCHEMAS } from './officialSchemas';
import { isOutputLayer, OUTPUT_LAYER_ERROR } from '@ograf-editor/scene-model';
import { OGRAF_DISCOVERY_JSON_SCHEMA } from './discoverySchema';

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const BASE = 'https://ograf.ebu.io/v1/specification/json-schemas';
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.numberSchema, `${BASE}/lib/constraints/number.json`);
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.booleanSchema, `${BASE}/lib/constraints/boolean.json`);
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.gddBasicTypesSchema, `${BASE}/gdd/basic-types.json`);
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.gddTypesSchema, `${BASE}/gdd/gdd-types.json`);
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.gddObjectSchema, `${BASE}/gdd/object.json`);
ajv.addSchema(OFFICIAL_OGRAF_SCHEMAS.actionSchema, `${BASE}/lib/action.json`);
const validateFn = ajv.compile<OGrafManifest>(OFFICIAL_OGRAF_SCHEMAS.graphicsSchema);
const validateDiscovery = ajv.compile<OGrafDiscovery>(OGRAF_DISCOVERY_JSON_SCHEMA);
const CATALOG_LISTS = ['templates', 'slots', 'states', 'actions'] as const;
const REQUIRED_PACKAGE_ACTIONS = ['transition.take', 'transition.patch', 'transition.out'] as const;

function formatError(err: ErrorObject): string {
  const path = err.instancePath || '(root)';
  return `${path} ${err.message ?? 'is invalid'}`.trim();
}

function discoveryErrors(manifest: OGrafManifest): string[] {
  if (!Object.hasOwn(manifest, 'v_ografDiscovery')) return [];
  const discovery = manifest.v_ografDiscovery;
  if (!validateDiscovery(discovery))
    return (validateDiscovery.errors ?? []).map(
      (error) => `/v_ografDiscovery${error.instancePath} ${error.message ?? 'is invalid'}`,
    );
  if (discovery.kind === 'graphic') return [];
  const { catalog } = discovery;
  const errors: string[] = [];
  const report = (message: string) => errors.push(`/v_ografDiscovery/catalog ${message}`);
  if (catalog.id !== manifest.id) report('id must match the manifest id.');
  for (const name of CATALOG_LISTS) {
    const identifiers = catalog[name].map((entry) => entry.id);
    if (new Set(identifiers).size !== identifiers.length) report(`${name} must have unique ids.`);
  }
  const templates = new Set(catalog.templates.map((template) => template.id));
  const slots = new Set(catalog.slots.map((slot) => slot.id));
  const states = new Map(catalog.states.map((state) => [state.id, state]));
  for (const state of catalog.states) {
    if (!templates.has(state.templateId) || !slots.has(state.slotId))
      report(`state "${state.id}" references an unknown template or slot.`);
  }
  for (const slot of catalog.slots) {
    if (
      slot.stateIds.some((id) => states.get(id)?.slotId !== slot.id) ||
      catalog.states.some((state) => state.slotId === slot.id && !slot.stateIds.includes(state.id))
    )
      report(`slot "${slot.id}" must list exactly its own states.`);
    if (
      [...slot.requireOn, ...slot.blockWhileActive, ...(slot.layoutWhen ?? [])].some(
        (id) => !slots.has(id),
      )
    )
      report(`slot "${slot.id}" references an unknown dependency.`);
  }
  const actions = new Set(catalog.actions.map((action) => action.id));
  const manifestActions = new Set((manifest.customActions ?? []).map((action) => action.id));
  if (actions.size !== manifestActions.size || [...actions].some((id) => !manifestActions.has(id)))
    report('actions must match the manifest custom action ids.');
  if (REQUIRED_PACKAGE_ACTIONS.some((id) => !actions.has(id)))
    report('package Take, Patch and Out actions are required.');
  return errors;
}

/** Validates against the vendored canonical EBU schema and its complete local `$ref` closure. */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const valid = validateFn(manifest);
  const errors = (validateFn.errors ?? []).map(formatError);
  if (valid) errors.push(...discoveryErrors(manifest));
  if (manifest && typeof manifest === 'object' && 'v_layer' in manifest) {
    if (manifest.v_layer !== undefined && !isOutputLayer(manifest.v_layer))
      errors.push(`/v_layer ${OUTPUT_LAYER_ERROR}`);
  }
  return { valid: errors.length === 0, errors };
}

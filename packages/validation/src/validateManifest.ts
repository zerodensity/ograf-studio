import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import { OFFICIAL_OGRAF_SCHEMAS } from './officialSchemas';

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
const validateFn = ajv.compile(OFFICIAL_OGRAF_SCHEMAS.graphicsSchema);

function formatError(err: ErrorObject): string {
  const path = err.instancePath || '(root)';
  return `${path} ${err.message ?? 'is invalid'}`.trim();
}

/** Validates against the vendored canonical EBU schema and its complete local `$ref` closure. */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const valid = validateFn(manifest);
  if (valid) return { valid: true, errors: [] };
  return { valid: false, errors: (validateFn.errors ?? []).map(formatError) };
}

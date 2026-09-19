import type {
  Element,
  Paint,
  ShaderPaint,
  ShaderPaintSlot,
  ShaderElement,
  ShaderParameterDefinition,
  ShaderParameterValue,
} from './types';
import { normalizeShaderParameterValue, parseShaderParameters } from './shaderParameters';

export const MAX_SHADER_SOURCE_BYTES = 256 * 1024;
export const MAX_SHADER_NAME_LENGTH = 128;

export function isShaderPaint(value: unknown): value is ShaderPaint {
  return !!value && typeof value === 'object' && 'type' in value && value.type === 'shader';
}

export function getElementFill(element: Element): Paint | undefined {
  if (element.type === 'shader') return element;
  if (element.type === 'text') return element.fill ?? element.color;
  return 'fill' in element ? element.fill : undefined;
}

export function getElementShaderPaint(
  element: Element,
  slot: ShaderPaintSlot = 'fill',
): ShaderPaint | undefined {
  if (slot === 'stroke')
    return element.type === 'text' && isShaderPaint(element.strokePaint)
      ? element.strokePaint
      : undefined;
  const fill = getElementFill(element);
  return isShaderPaint(fill) ? fill : undefined;
}

export function getElementShaderPaints(
  element: Element,
): Array<{ slot: ShaderPaintSlot; paint: ShaderPaint }> {
  return (['fill', 'stroke'] as const).flatMap((slot) => {
    const paint = getElementShaderPaint(element, slot);
    return paint ? [{ slot, paint }] : [];
  });
}

export function hasElementShaderPaint(element: Element): boolean {
  return getElementShaderPaints(element).length > 0;
}

export function shaderPaintConflictsWithBinding(element: Element, target: string): boolean {
  return (
    (!!getElementShaderPaint(element) && (target === 'fill' || target.startsWith('fill.stops['))) ||
    (!!getElementShaderPaint(element, 'stroke') && target === 'strokePaint')
  );
}

export function createShaderPaint(overrides: Partial<ShaderPaint> = {}): ShaderPaint {
  return normalizeShaderElement(overrides);
}

/** Migrate deprecated shader objects without changing layer identity or geometry. */
export function migrateShaderElement(element: Element): Element {
  if (element.type !== 'shader') return element;
  return {
    type: 'rectangle',
    fill: createShaderPaint(element),
    strokeColor: 'transparent',
    strokeWidth: 0,
    borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
  };
}

export function migrateShaderBindingTarget(target: string): string {
  return target.startsWith('parameters.') ? `fill.${target}` : target;
}

/** Original minimal example; imported shaders retain their own licensing obligations. */
export const DEFAULT_SHADER_FRAGMENT_SOURCE = `#pragma ograf waveFrequency slider min(0.0) max(16.0) step(0.1)
const float waveFrequency = 8.0;
#pragma ograf backgroundColor color
vec3 backgroundColor = vec3(0.025, 0.045, 0.10);
#pragma ograf highlightColor color
vec3 highlightColor = vec3(0.10, 0.38, 0.55);

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = 0.5 + 0.5 * sin(uv.x * waveFrequency + uv.y * 4.0 - iTime);
  fragColor = vec4(mix(backgroundColor, highlightColor, wave * 0.6 + uv.y * 0.2), 1.0);
}`;

export interface ShaderInspection {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parameters: ShaderParameterDefinition[];
  adaptedSource: string;
}

const sourceInspections = new Map<string, { bytes: number; inspection: ShaderInspection }>();
let sourceInspectionBytes = 0;
const MAX_CACHED_SHADER_SOURCES = 32;
const MAX_CACHED_SHADER_BYTES = 8 * 1024 * 1024;

function copyShaderInspection(inspection: ShaderInspection): ShaderInspection {
  return {
    ...inspection,
    errors: [...inspection.errors],
    warnings: [...inspection.warnings],
    parameters: inspection.parameters.map((parameter) => ({
      ...parameter,
      defaultValue: Array.isArray(parameter.defaultValue)
        ? [...parameter.defaultValue]
        : parameter.defaultValue,
    })),
  };
}

/** Supply absent defaults without changing authored source or hiding malformed parameters. */
export function normalizeShaderElement(element: Partial<ShaderElement> = {}): ShaderElement {
  const name = typeof element.name === 'string' ? element.name.trim() : element.name;
  return {
    type: 'shader',
    ...(name === undefined || name === '' ? {} : { name }),
    fragmentSource: element.fragmentSource ?? DEFAULT_SHADER_FRAGMENT_SOURCE,
    speed: element.speed ?? 1,
    resolutionScale: element.resolutionScale ?? 1,
    parameters: element.parameters ? structuredClone(element.parameters) : {},
  };
}

/** Checks the supported input contract; GLSL syntax and GPU support are checked by WebGL. */
function inspectShaderSourceUncached(source: unknown): ShaderInspection {
  const errors: string[] = [];
  if (typeof source !== 'string' || !source.trim()) {
    return {
      valid: false,
      errors: ['Shader fragmentSource must be a non-empty string.'],
      warnings: [],
      parameters: [],
      adaptedSource: typeof source === 'string' ? source : '',
    };
  }
  if (new TextEncoder().encode(source).byteLength > MAX_SHADER_SOURCE_BYTES) {
    return {
      valid: false,
      errors: ['Shader source exceeds the 256 KB limit.'],
      warnings: [],
      parameters: [],
      adaptedSource: source,
    };
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
  if (!/\bvoid\s+mainImage\s*\(/.test(code)) {
    errors.push('Shader source must define void mainImage(out vec4 fragColor, in vec2 fragCoord).');
  }
  if (/\bvoid\s+main\s*\(/.test(code) || /^\s*#\s*version\b/m.test(code)) {
    errors.push('Provide the Image pass mainImage source without main() or a #version directive.');
  }
  if (/\buniform\b/.test(code)) {
    errors.push(
      'Custom uniform declarations are unsupported; iTime and iResolution are provided by the runtime.',
    );
  }
  const unsupported = [
    ...new Set(
      code.match(/\bi(?:Channel\w*|Mouse|Date|Frame|TimeDelta|SampleRate|FrameRate)\b/g) ?? [],
    ),
  ];
  if (unsupported.length) {
    errors.push(
      `Unsupported shader inputs: ${unsupported.join(', ')}. Only iTime and iResolution are provided; texture, audio and buffer passes are unsupported.`,
    );
  }
  const parsed = parseShaderParameters(source);
  errors.push(...parsed.errors);
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    parameters: parsed.parameters,
    adaptedSource: parsed.adaptedSource,
  };
}

/** Source contracts are immutable; keyed uniform updates must not reparse unchanged GLSL. */
export function inspectShaderSource(source: unknown): ShaderInspection {
  if (typeof source !== 'string' || source.length > MAX_SHADER_SOURCE_BYTES)
    return inspectShaderSourceUncached(source);
  const cached = sourceInspections.get(source);
  if (cached) return copyShaderInspection(cached.inspection);
  const inspection = inspectShaderSourceUncached(source);
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes <= MAX_SHADER_SOURCE_BYTES) {
    while (
      sourceInspections.size >= MAX_CACHED_SHADER_SOURCES ||
      sourceInspectionBytes + bytes > MAX_CACHED_SHADER_BYTES
    ) {
      const first = sourceInspections.keys().next().value;
      if (first === undefined) break;
      sourceInspectionBytes -= sourceInspections.get(first)!.bytes;
      sourceInspections.delete(first);
    }
    sourceInspections.set(source, { bytes, inspection });
    sourceInspectionBytes += bytes;
  }
  return copyShaderInspection(inspection);
}

export function resolveShaderParameters(
  element: ShaderElement,
): Record<string, ShaderParameterValue> {
  const inspection = inspectShaderSource(element.fragmentSource);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  const definitions = new Map(
    inspection.parameters.map((definition) => [definition.name, definition]),
  );
  const values = element.parameters ?? {};
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Shader parameters must be an object keyed by exposed symbol name.');
  for (const name of Object.keys(values)) {
    if (!definitions.has(name)) throw new Error(`Unknown shader parameter "${name}".`);
  }
  return Object.fromEntries(
    inspection.parameters.map((definition) => [
      definition.name,
      normalizeShaderParameterValue(
        definition,
        Object.prototype.hasOwnProperty.call(values, definition.name)
          ? values[definition.name]
          : definition.defaultValue,
      ),
    ]),
  );
}

export function inspectShaderElement(element: ShaderElement): ShaderInspection {
  const inspection = inspectShaderSource(element.fragmentSource);
  if (
    element.name !== undefined &&
    (typeof element.name !== 'string' || element.name.trim().length > MAX_SHADER_NAME_LENGTH)
  )
    inspection.errors.push(
      `Shader name must be a string of at most ${MAX_SHADER_NAME_LENGTH} characters.`,
    );
  const values = element.parameters ?? {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    inspection.errors.push('Shader parameters must be an object keyed by exposed symbol name.');
  } else {
    for (const [name, value] of Object.entries(values)) {
      const definition = inspection.parameters.find((entry) => entry.name === name);
      if (!definition) {
        inspection.errors.push(`Unknown shader parameter "${name}".`);
        continue;
      }
      try {
        const normalized = normalizeShaderParameterValue(definition, value);
        if (JSON.stringify(normalized) !== JSON.stringify(value))
          inspection.errors.push(
            `Shader parameter "${name}" value is outside its range or has an invalid authored type.`,
          );
      } catch (error) {
        inspection.errors.push((error as Error).message);
      }
    }
  }
  if (!Number.isFinite(element.speed) || element.speed < 0 || element.speed > 10) {
    inspection.errors.push('Shader speed must be a finite number from 0 to 10.');
  }
  if (
    !Number.isFinite(element.resolutionScale) ||
    element.resolutionScale < 0.25 ||
    element.resolutionScale > 1
  ) {
    inspection.errors.push('Shader resolutionScale must be a finite number from 0.25 to 1.');
  }
  inspection.valid = inspection.errors.length === 0;
  return inspection;
}

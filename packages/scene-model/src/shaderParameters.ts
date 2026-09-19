import type { ShaderParameterDefinition, ShaderParameterValue, ShaderPaintSlot } from './types';

interface Token {
  value: string;
  start: number;
  end: number;
}
interface Declaration {
  name: string;
  type?: string;
  start: number;
  end: number;
  expression: string;
  macro?: boolean;
  functionMacro?: boolean;
  conditional?: boolean;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;
const SUPPORTED_TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4']);
const RESERVED =
  /^(?:gl_|ograf)|^(?:iTime|iResolution|iChannel\w*|iMouse|iDate|iFrame|iTimeDelta|iSampleRate|iFrameRate|main|mainImage)$/;

function blank(value: string): string {
  return value.replace(/[^\r\n]/g, ' ');
}

/** Retain positions and line breaks so diagnostics still refer to the author's source. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\r\n]*/g, blank);
}

function tokens(source: string): Token[] {
  const result: Token[] = [];
  const expression =
    /[A-Za-z_][A-Za-z_0-9]*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|\+\+|--|<<=|>>=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|==|!=|<=|>=|&&|\|\||\S/g;
  for (const match of source.matchAll(expression)) {
    result.push({ value: match[0], start: match.index!, end: match.index! + match[0].length });
  }
  return result;
}

function literal(
  expression: string,
  declaredType?: string,
): { type: ShaderParameterDefinition['glslType']; value: ShaderParameterValue } | null {
  const input = expression.trim();
  const type =
    declaredType ??
    (input === 'true' || input === 'false'
      ? 'bool'
      : (/^vec[234]\s*\(/.exec(input)?.[0].slice(0, 4) ??
        (NUMBER.test(input) ? (/[.eE]/.test(input) ? 'float' : 'int') : '')));
  if (!SUPPORTED_TYPES.has(type)) return null;
  if (type === 'bool')
    return input === 'true' || input === 'false' ? { type, value: input === 'true' } : null;
  if (type === 'float' || type === 'int') {
    if (!NUMBER.test(input)) return null;
    const value = Number(input);
    if (
      !Number.isFinite(value) ||
      (type === 'int' && (!Number.isInteger(value) || /[.eE]/.test(input)))
    )
      return null;
    return { type, value };
  }
  const vector = /^(vec[234])\s*\(([^()]*)\)$/.exec(input);
  if (!vector || vector[1] !== type) return null;
  const components = vector[2]!.split(',').map((part) => part.trim());
  if (!components.every((part) => NUMBER.test(part))) return null;
  const values = components.map(Number);
  const count = Number(type.slice(-1));
  if (values.length === 1) while (values.length < count) values.push(values[0]!);
  if (values.length !== count || !values.every(Number.isFinite)) return null;
  return { type: type as ShaderParameterDefinition['glslType'], value: values };
}

function topLevelDeclarations(code: string, sourceTokens: Token[]): Declaration[] {
  const declarations: Declaration[] = [];
  let depth = 0;
  for (let i = 0; i < sourceTokens.length; i++) {
    const current = sourceTokens[i]!;
    if (current.value === '{') {
      depth++;
      continue;
    }
    if (current.value === '}') {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    let offset = i;
    if (sourceTokens[offset]?.value === 'const') offset++;
    if (['lowp', 'mediump', 'highp'].includes(sourceTokens[offset]?.value ?? '')) offset++;
    const type = sourceTokens[offset],
      name = sourceTokens[offset + 1];
    if (
      !type ||
      !name ||
      !IDENTIFIER.test(type.value) ||
      !IDENTIFIER.test(name.value) ||
      sourceTokens[offset + 2]?.value !== '='
    )
      continue;
    let endIndex = offset + 3;
    while (
      endIndex < sourceTokens.length &&
      sourceTokens[endIndex]!.value !== ';' &&
      sourceTokens[endIndex]!.value !== '{'
    )
      endIndex++;
    const end = sourceTokens[endIndex];
    if (!end || end.value !== ';') continue;
    declarations.push({
      name: name.value,
      type: type.value,
      start: current.start,
      end: end.end,
      expression: code.slice(sourceTokens[offset + 2]!.end, end.start),
    });
    i = endIndex;
  }
  return declarations;
}

export function parseShaderParameters(source: string): {
  parameters: ShaderParameterDefinition[];
  adaptedSource: string;
  errors: string[];
} {
  const code = withoutComments(source);
  const errors: string[] = [];
  const parameters: ShaderParameterDefinition[] = [];
  const replacements: { start: number; end: number; text: string }[] = [];
  const annotations: { name: string; control: string; options: string; conditional: boolean }[] =
    [];
  const macros: Declaration[] = [];
  const conditions: string[] = [];
  const conditionalStarts: number[] = [];
  const conditionalRanges: { start: number; end: number }[] = [];
  const undefinitions: string[] = [];
  let conditionalDepth = 0;
  const masked = code.replace(
    /^[ \t]*#[^\r\n]*(?:\\\r?\n[^\r\n]*)*/gm,
    (directive, start: number) => {
      const text = directive.trim();
      if (/^#\s*(?:if|ifdef|ifndef)\b/.test(text)) {
        conditions.push(text);
        conditionalDepth++;
        conditionalStarts.push(start);
      }
      if (/^#\s*(?:elif|else)\b/.test(text)) conditions.push(text);
      const annotation = /^#\s*pragma\s+ograf\b([\s\S]*)$/.exec(text);
      if (annotation) {
        const match = /^\s+([A-Za-z_][A-Za-z_0-9]*)\s+(\w+)([\s\S]*)$/.exec(annotation[1]!);
        if (!match || directive.includes('\\'))
          errors.push(
            'Use #pragma ograf SYMBOL CONTROL with optional min(number) max(number) step(number) on one line.',
          );
        else
          annotations.push({
            name: match[1]!,
            control: match[2]!,
            options: match[3]!,
            conditional: conditionalDepth > 0,
          });
        replacements.push({
          start,
          end: start + directive.length,
          text: blank(source.slice(start, start + directive.length)),
        });
      }
      const macro = /^#\s*define\s+([A-Za-z_][A-Za-z_0-9]*)([\s\S]*)$/.exec(text);
      if (macro)
        macros.push({
          name: macro[1]!,
          start,
          end: start + directive.length,
          expression: macro[2]!.trim(),
          macro: true,
          functionMacro: macro[2]!.startsWith('('),
          conditional: conditionalDepth > 0,
        });
      const undefinition = /^#\s*undef\s+(\w+)/.exec(text);
      if (undefinition) undefinitions.push(undefinition[1]!);
      if (/^#\s*endif\b/.test(text)) {
        conditionalDepth = Math.max(0, conditionalDepth - 1);
        conditionalRanges.push({
          start: conditionalStarts.pop() ?? 0,
          end: start + directive.length,
        });
      }
      return blank(directive);
    },
  );
  const sourceTokens = tokens(masked);
  const globals = topLevelDeclarations(masked, sourceTokens);
  for (const declaration of globals)
    declaration.conditional =
      conditionalRanges.some(
        (range) => declaration.start > range.start && declaration.start < range.end,
      ) || conditionalStarts.some((start) => declaration.start > start);
  const declarations = [...globals, ...macros];
  const selected = new Set<string>();
  const selectedDeclarations = new Map<string, Declaration>();
  for (const annotation of annotations) {
    const { name, control } = annotation;
    if (selected.has(name)) {
      errors.push(`Shader parameter "${name}" has duplicate ograf pragmas.`);
      continue;
    }
    selected.add(name);
    if (RESERVED.test(name) || name.includes('__')) {
      errors.push(`Shader parameter "${name}" is a reserved runtime or GLSL name.`);
      continue;
    }
    if (!['slider', 'color', 'toggle', 'vector2'].includes(control)) {
      errors.push(`Shader parameter "${name}" has unsupported control "${control}".`);
      continue;
    }
    const found = declarations.filter((declaration) => declaration.name === name);
    if (found.length !== 1) {
      errors.push(
        `Shader parameter "${name}" requires exactly one matching top-level literal-initialized declaration or object-like #define; found ${found.length}.`,
      );
      continue;
    }
    const declaration = found[0]!;
    if (undefinitions.includes(name)) {
      errors.push(`Shader parameter "${name}" cannot be undefined by preprocessing.`);
      continue;
    }
    if (annotation.conditional || declaration.conditional) {
      errors.push(
        `Shader parameter "${name}" cannot be declared inside conditional preprocessing.`,
      );
      continue;
    }
    if (declaration.functionMacro) {
      errors.push(`Shader parameter "${name}" cannot expose a function-like macro.`);
      continue;
    }
    const value = literal(declaration.expression, declaration.type);
    if (!value) {
      errors.push(
        `Shader parameter "${name}" needs a float, int, bool, or vec2/vec3/vec4 literal initializer; expressions, arrays, and multiple declarations are unsupported.`,
      );
      continue;
    }
    if (!(
      (control === 'slider' && (value.type === 'float' || value.type === 'int')) ||
      (control === 'color' && (value.type === 'vec3' || value.type === 'vec4')) ||
      (control === 'toggle' && value.type === 'bool') ||
      (control === 'vector2' && value.type === 'vec2')
    )) {
      errors.push(
        `Shader parameter "${name}": control ${control} is incompatible with ${value.type}.`,
      );
      continue;
    }
    const definition: ShaderParameterDefinition = {
      name,
      control: control as ShaderParameterDefinition['control'],
      glslType: value.type,
      defaultValue: value.value,
    };
    let tail = annotation.options.trim();
    const seen = new Set<string>();
    while (tail) {
      const option = /^(min|max|step)\s*\(\s*([^()]*)\s*\)(?:\s+|$)/.exec(tail);
      if (!option || !NUMBER.test(option[2]!.trim())) {
        errors.push(
          `Shader parameter "${name}" has invalid options; use min(number) max(number) step(number).`,
        );
        break;
      }
      const key = option[1] as 'min' | 'max' | 'step';
      if (seen.has(key)) errors.push(`Shader parameter "${name}" repeats ${key}.`);
      seen.add(key);
      definition[key] = Number(option[2]);
      tail = tail.slice(option[0].length).trim();
    }
    if (seen.size > 0 && (control === 'color' || control === 'toggle'))
      errors.push(`Shader parameter "${name}": ${control} does not accept numeric range options.`);
    for (const key of ['min', 'max', 'step'] as const) {
      const number = definition[key];
      if (
        number !== undefined &&
        (!Number.isFinite(number) || (value.type === 'int' && !Number.isInteger(number)))
      )
        errors.push(
          `Shader parameter "${name}" ${key} must be finite${value.type === 'int' ? ' and integer' : ''}.`,
        );
    }
    if (definition.step !== undefined && definition.step <= 0)
      errors.push(`Shader parameter "${name}" step must be positive.`);
    if (
      definition.min !== undefined &&
      definition.max !== undefined &&
      definition.min > definition.max
    )
      errors.push(`Shader parameter "${name}" min cannot exceed max.`);
    try {
      const normalized = normalizeShaderParameterValue(definition, value.value);
      if (JSON.stringify(normalized) !== JSON.stringify(value.value))
        errors.push(`Shader parameter "${name}" default value is outside its range.`);
    } catch (error) {
      errors.push((error as Error).message);
    }
    parameters.push(definition);
    selectedDeclarations.set(name, declaration);
    const replacement = `uniform ${value.type} ${name};`;
    replacements.push({
      start: declaration.start,
      end: declaration.end,
      text:
        replacement +
        (source.slice(declaration.start, declaration.end).match(/\r?\n/g) ?? []).join(''),
    });
  }

  const dependencies = (expression: string, visiting = new Set<string>()): Set<string> => {
    const result = new Set<string>();
    for (const token of tokens(expression)) {
      if (selectedDeclarations.has(token.value)) result.add(token.value);
      if (!IDENTIFIER.test(token.value) || visiting.has(token.value)) continue;
      const next = new Set(visiting).add(token.value);
      for (const declaration of declarations.filter((item) => item.name === token.value)) {
        for (const symbol of dependencies(declaration.expression, next)) result.add(symbol);
      }
    }
    return result;
  };
  for (const declaration of globals) {
    if (selectedDeclarations.has(declaration.name)) continue;
    const used = dependencies(declaration.expression);
    if (used.size)
      errors.push(
        `Shader parameter ${[...used].join(', ')} is required by global initializer "${declaration.name}". Move the dependent calculation inside a function before exposing it.`,
      );
  }
  for (const condition of conditions) {
    const used = dependencies(condition);
    if (used.size)
      errors.push(
        `Shader parameter ${[...used].join(', ')} is used by conditional preprocessing and must remain a compile-time constant.`,
      );
  }
  const outputArguments = new Map<string, Set<number>>();
  for (const macro of macros.filter((declaration) => declaration.functionMacro)) {
    const signature = /^\(([^()]*)\)([\s\S]*)$/.exec(macro.expression);
    if (!signature) continue;
    const argumentsList = signature[1]!.split(',').map((name) => name.trim());
    if (/(?:\+\+|--|[+*/%&|^<>-]?=(?!=))/.test(signature[2]!)) {
      outputArguments.set(macro.name, new Set(argumentsList.map((_, index) => index)));
    }
  }
  for (let index = 1; index < sourceTokens.length; index++) {
    if (sourceTokens[index]!.value !== '(' || !IDENTIFIER.test(sourceTokens[index - 1]!.value))
      continue;
    let end = index + 1,
      depth = 1;
    const argumentsList: Token[][] = [[]];
    for (; end < sourceTokens.length; end++) {
      const token = sourceTokens[end]!;
      if (token.value === '(') depth++;
      if (token.value === ')' && --depth === 0) break;
      if (token.value === ',' && depth === 1) argumentsList.push([]);
      else argumentsList[argumentsList.length - 1]!.push(token);
    }
    // Definition/prototype parameter qualifiers expose variables passed as writable arguments.
    const writable = argumentsList.flatMap((argument, argumentIndex) =>
      argument.some((token) => token.value === 'out' || token.value === 'inout')
        ? [argumentIndex]
        : [],
    );
    if (writable.length) outputArguments.set(sourceTokens[index - 1]!.value, new Set(writable));
  }
  for (let index = 0; index < sourceTokens.length; index++) {
    const writable = outputArguments.get(sourceTokens[index]!.value);
    if (!writable || sourceTokens[index + 1]?.value !== '(') continue;
    let depth = 0,
      argumentIndex = 0;
    for (let end = index + 2; end < sourceTokens.length; end++) {
      const token = sourceTokens[end]!;
      if (token.value === ')' && depth === 0) break;
      if (token.value === '(') depth++;
      if (token.value === ')') depth--;
      if (token.value === ',' && depth === 0) argumentIndex++;
      const used = dependencies(token.value);
      if (writable.has(argumentIndex) && used.size > 0)
        errors.push(
          `Shader parameter ${[...used].join(', ')} is passed to an out/inout argument and must remain read-only.`,
        );
    }
  }
  for (let index = 0; index < sourceTokens.length; index++) {
    const token = sourceTokens[index]!;
    if (token.value === 'case') {
      let end = index + 1;
      while (end < sourceTokens.length && sourceTokens[end]!.value !== ':') end++;
      const used = dependencies(
        sourceTokens
          .slice(index + 1, end)
          .map((item) => item.value)
          .join(' '),
      );
      if (used.size)
        errors.push(
          `Shader parameter ${[...used].join(', ')} is used by a switch case and must remain a compile-time constant.`,
        );
    }
    if (token.value === 'layout' && sourceTokens[index + 1]?.value === '(') {
      let end = index + 2;
      while (end < sourceTokens.length && sourceTokens[end]!.value !== ')') end++;
      const used = dependencies(
        sourceTokens
          .slice(index + 2, end)
          .map((item) => item.value)
          .join(' '),
      );
      if (used.size)
        errors.push(
          `Shader parameter ${[...used].join(', ')} is used by a layout qualifier and must remain a compile-time constant.`,
        );
    }
    if (token.value === '[') {
      let end = index + 1;
      while (end < sourceTokens.length && sourceTokens[end]!.value !== ']') end++;
      const used = dependencies(
        sourceTokens
          .slice(index + 1, end)
          .map((item) => item.value)
          .join(' '),
      );
      // Conservative: marked parameters inside brackets include array-size contexts.
      if (used.size)
        errors.push(
          `Shader parameter ${[...used].join(', ')} cannot be used in array sizes or indices in this parameter profile.`,
        );
    }
    if (token.value === 'const') {
      let end = index + 1;
      while (end < sourceTokens.length && sourceTokens[end]!.value !== ';') end++;
      const declaration = selectedDeclarations.get(sourceTokens[index + 2]?.value ?? '');
      if (declaration?.start === token.start) continue;
      const equal = sourceTokens.slice(index, end).findIndex((item) => item.value === '=');
      if (equal >= 0) {
        const used = dependencies(
          sourceTokens
            .slice(index + equal + 1, end)
            .map((item) => item.value)
            .join(' '),
        );
        if (used.size)
          errors.push(
            `Shader parameter ${[...used].join(', ')} is used by a const initializer; use a non-const local calculation.`,
          );
      }
    }
    const used = dependencies(token.value);
    if (used.size === 0) continue;
    const declaration = selectedDeclarations.get(token.value);
    if (declaration && token.start >= declaration.start && token.end <= declaration.end) continue;
    let next = index + 1;
    if (sourceTokens[next]?.value === '.') next += 2;
    if (sourceTokens[next]?.value === '[') {
      while (next < sourceTokens.length && sourceTokens[next]!.value !== ']') next++;
      next++;
    }
    if (
      ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '++', '--'].includes(
        sourceTokens[next]?.value ?? '',
      ) ||
      ['++', '--'].includes(sourceTokens[index - 1]?.value ?? '')
    )
      errors.push(
        `Shader parameter ${[...used].join(', ')} is written to; exposed variables must be read-only.`,
      );
  }
  for (const macro of macros) {
    if (selectedDeclarations.has(macro.name)) continue;
    const used = dependencies(macro.expression);
    if (used.size && /(?:\+\+|--|[+*/%&|^<>-]?=(?!=))/.test(macro.expression))
      errors.push(
        `Macro "${macro.name}" may write shader parameter ${[...used].join(', ')}; exposed variables must remain read-only.`,
      );
  }
  let adaptedSource = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    adaptedSource =
      adaptedSource.slice(0, replacement.start) +
      replacement.text +
      adaptedSource.slice(replacement.end);
  return { parameters, adaptedSource, errors: [...new Set(errors)] };
}

export function shaderParameterTarget(name: string, slot: ShaderPaintSlot = 'fill'): string {
  return `${slot === 'stroke' ? 'strokePaint' : 'fill'}.parameters.${name}`;
}

export function shaderColorToHex(value: readonly number[]): string {
  return (
    '#' +
    value
      .map((component) =>
        Math.round(Math.min(1, Math.max(0, component)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Normalize external values without coercing strings into numbers or booleans. */
export function normalizeShaderParameterValue(
  definition: ShaderParameterDefinition,
  input: unknown,
): ShaderParameterValue {
  let value = input;
  if (definition.control === 'color' && typeof value === 'string') {
    if (!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value))
      throw new Error(
        `Shader parameter "${definition.name}" requires a hexadecimal RGB or RGBA color.`,
      );
    const channels = value
      .slice(1)
      .match(/../g)!
      .map((channel) => Number.parseInt(channel, 16) / 255);
    if (definition.glslType === 'vec4' && channels.length === 3) channels.push(1);
    value = channels;
  }
  if (
    definition.control === 'vector2' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const vector = value as Record<string, unknown>;
    value = [vector.x, vector.y];
  }
  const clamp = (number: number) =>
    Math.max(
      definition.min ?? (definition.control === 'color' ? 0 : -Infinity),
      Math.min(definition.max ?? (definition.control === 'color' ? 1 : Infinity), number),
    );
  if (definition.glslType === 'bool') {
    if (typeof value !== 'boolean')
      throw new Error(`Shader parameter "${definition.name}" requires a boolean.`);
    return value;
  }
  if (definition.glslType === 'float' || definition.glslType === 'int') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (definition.glslType === 'int' && !Number.isInteger(value))
    )
      throw new Error(
        `Shader parameter "${definition.name}" requires a finite ${definition.glslType === 'int' ? 'integer' : 'number'}.`,
      );
    const normalized = clamp(value);
    if (
      (definition.glslType === 'int' && (normalized < -2147483648 || normalized > 2147483647)) ||
      !Number.isFinite(Math.fround(normalized))
    )
      throw new Error(
        `Shader parameter "${definition.name}" is outside the GLSL ${definition.glslType} range.`,
      );
    return normalized;
  }
  const count = Number(definition.glslType.slice(-1));
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    !value.every((component) => typeof component === 'number' && Number.isFinite(component))
  )
    throw new Error(
      `Shader parameter "${definition.name}" requires ${count} finite numeric components.`,
    );
  const normalized = value.map(clamp);
  if (!normalized.every((component) => Number.isFinite(Math.fround(component))))
    throw new Error(`Shader parameter "${definition.name}" is outside the GLSL float range.`);
  return normalized;
}

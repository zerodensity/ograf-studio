import {
  normalizeDesignTokenValue,
  syncDesignToken,
  typographyPresetsErrors,
  syncTypographyPresets,
  backgroundStylesErrors as validateBackgroundStyles,
  isMediaPaint,
  isShaderPaint,
  paintToCss,
  type Composition,
  type DesignSystem,
  type DesignToken,
  type DesignTokenType,
  type Project,
} from '@ograf-editor/scene-model';

const TOKEN_TYPES: readonly DesignTokenType[] = [
  'color',
  'number',
  'text',
  'font-family',
  'font-weight',
];
const MAX_TOKENS = 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Master themes share primitive tokens, never composition-specific pack restore/palette IDs. */
export function validateTemplateSetBrandKit(kit: unknown): string[] {
  if (!record(kit)) return ['Master Brand Kit must be an object.'];
  const errors: string[] = [];
  if (
    Object.keys(kit).some(
      (key) =>
        !['name', 'tokens', 'typography', 'backgrounds', 'defaultBackgroundStyleId'].includes(key),
    )
  )
    errors.push('Master Brand Kit contains an unsupported property.');
  if (kit.typography !== undefined) errors.push(...typographyPresetsErrors(kit.typography));
  if (kit.backgrounds !== undefined) errors.push(...backgroundStylesErrors(kit.backgrounds));
  if (
    kit.defaultBackgroundStyleId !== undefined &&
    kit.defaultBackgroundStyleId !== null &&
    (!Array.isArray(kit.backgrounds) ||
      !kit.backgrounds.some((style) => record(style) && style.id === kit.defaultBackgroundStyleId))
  )
    errors.push('The default background must reference a defined background style.');
  if (typeof kit.name !== 'string' || !kit.name.trim() || kit.name.length > 256)
    errors.push('Master Brand Kit name must contain 1 to 256 characters.');
  if (!Array.isArray(kit.tokens)) return [...errors, 'Master Brand Kit tokens must be an array.'];
  if (kit.tokens.length > MAX_TOKENS)
    return [...errors, `Master Brand Kit supports at most ${MAX_TOKENS} tokens.`];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const token of kit.tokens) {
    if (!record(token)) {
      errors.push('Master Brand Kit tokens must be objects.');
      continue;
    }
    if (
      Object.keys(token).some(
        (key) => !['id', 'key', 'name', 'type', 'value', 'description'].includes(key),
      )
    )
      errors.push('Master Brand Kit token contains an unsupported property.');
    if (typeof token.id !== 'string' || !/^[-A-Za-z0-9_.]{1,100}$/.test(token.id))
      errors.push('Master Brand Kit token IDs must be simple identifiers of 1 to 100 characters.');
    else {
      if (ids.has(token.id)) errors.push(`Duplicate master Brand Kit token ID: ${token.id}.`);
      ids.add(token.id);
    }
    if (
      typeof token.key !== 'string' ||
      token.key.length > 128 ||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token.key)
    )
      errors.push('Master Brand Kit token keys must be safe identifiers of 1 to 128 characters.');
    else {
      if (keys.has(token.key)) errors.push(`Duplicate master Brand Kit token key: ${token.key}.`);
      keys.add(token.key);
    }
    if (typeof token.name !== 'string' || !token.name.trim() || token.name.length > 256)
      errors.push('Master Brand Kit token names must contain 1 to 256 characters.');
    if (typeof token.description !== 'string' || token.description.length > 4096)
      errors.push(
        'Master Brand Kit token descriptions must be strings of at most 4096 characters.',
      );
    if (!TOKEN_TYPES.includes(token.type as DesignTokenType)) {
      errors.push(`Unsupported master Brand Kit token type: ${String(token.type)}.`);
      continue;
    }
    try {
      normalizeDesignTokenValue(token.type as DesignTokenType, token.value as string | number);
      if (typeof token.value === 'number' && !Number.isFinite(token.value))
        errors.push('Master Brand Kit numeric values must be finite.');
      if (typeof token.value === 'string' && token.value.length > 16384)
        errors.push('Master Brand Kit text values must contain at most 16384 characters.');
      if (
        token.type === 'font-family' &&
        (typeof token.value !== 'string' || !token.value.trim() || token.value.length > 1024)
      )
        errors.push('Master Brand Kit font families must contain 1 to 1024 characters.');
      if (
        token.type === 'font-weight' &&
        (typeof token.value !== 'number' ||
          !Number.isInteger(token.value) ||
          token.value < 1 ||
          token.value > 1000)
      )
        errors.push('Master Brand Kit font weights must be whole numbers between 1 and 1000.');
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  return errors;
}

function checkedKit(kit: DesignSystem): DesignSystem {
  const errors = validateTemplateSetBrandKit(kit);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    name: kit.name.trim(),
    tokens: kit.tokens.map((token) => ({
      ...token,
      name: token.name.trim(),
      description: token.description.trim(),
      value: normalizeDesignTokenValue(token.type, token.value),
    })),
    ...(kit.typography !== undefined ? { typography: structuredClone(kit.typography) } : {}),
    ...(kit.backgrounds !== undefined ? { backgrounds: structuredClone(kit.backgrounds) } : {}),
    ...(kit.defaultBackgroundStyleId !== undefined
      ? { defaultBackgroundStyleId: kit.defaultBackgroundStyleId }
      : {}),
  };
}

export function sharedBrandKitFromProject(project: Project): DesignSystem {
  const main = project.compositions.find(
    (composition) => composition.id === project.mainCompositionId,
  );
  if (!main) throw new Error('The template has no main composition.');
  return checkedKit({
    name: main.designSystem.name,
    tokens: structuredClone(main.designSystem.tokens),
    ...(main.designSystem.typography
      ? { typography: structuredClone(main.designSystem.typography) }
      : {}),
    ...(main.designSystem.backgrounds
      ? { backgrounds: structuredClone(main.designSystem.backgrounds) }
      : {}),
    ...(main.designSystem.defaultBackgroundStyleId !== undefined
      ? { defaultBackgroundStyleId: main.designSystem.defaultBackgroundStyleId }
      : {}),
  });
}

function remapTokenReferences(composition: Composition, remap: Map<string, string>): void {
  const layers = [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ];
  const fields = [
    ...composition.dataFields,
    ...composition.components.flatMap((component) => component.dataFields),
  ];
  for (const layer of layers)
    for (const binding of layer.designTokenBindings)
      binding.tokenId = remap.get(binding.tokenId) ?? binding.tokenId;
  for (const field of fields)
    if (field.defaultTokenId)
      field.defaultTokenId = remap.get(field.defaultTokenId) ?? field.defaultTokenId;
  for (const link of composition.designSystem.stylePackColors ?? []) {
    link.sourceTokenId = remap.get(link.sourceTokenId) ?? link.sourceTokenId;
    if (link.targetTokenId)
      link.targetTokenId = remap.get(link.targetTokenId) ?? link.targetTokenId;
  }
  // Removal of a previously applied style pack must not restore stale pre-adoption token IDs.
  const restore = composition.designSystem.stylePackRestore;
  for (const item of restore?.tokens ?? [])
    item.token.id = remap.get(item.token.id) ?? item.token.id;
  for (const layer of restore?.layers ?? [])
    for (const property of layer.properties)
      for (const binding of property.bindings)
        binding.tokenId = remap.get(binding.tokenId) ?? binding.tokenId;
  for (const field of restore?.fields ?? [])
    if (field.defaultTokenId)
      field.defaultTokenId = remap.get(field.defaultTokenId) ?? field.defaultTokenId;
}

/**
 * Explicit adoption maps compatible semantic KEYS onto stable shared IDs, never display names.
 * Override presence is explicit; a value equal to today's master can still be an override.
 * Materialized properties keep each child portable without a CSS/runtime theme dependency.
 */
export function resolveTemplateSetBrandKit(
  project: Project,
  sharedKit: DesignSystem,
  overrideTokenIds: readonly string[] = [],
  styleOverrides: {
    typography?: readonly string[];
    backgrounds?: readonly string[];
    background?: boolean;
  } = {},
): Project {
  const kit = checkedKit(sharedKit);
  const sharedIds = new Set(kit.tokens.map((token) => token.id));
  if (!Array.isArray(overrideTokenIds) || overrideTokenIds.some((id) => !sharedIds.has(id)))
    throw new Error('Brand Kit overrides must reference shared token IDs.');
  const overrides = new Set(overrideTokenIds);
  const next = structuredClone(project);
  for (const composition of next.compositions) {
    const original = composition.designSystem.tokens;
    const remap = new Map<string, string>();
    const effective = new Map<string, DesignToken>();
    for (const shared of kit.tokens) {
      const byId = original.find((token) => token.id === shared.id);
      const byKey = original.filter((token) => token.key === shared.key);
      if (byKey.length > 1 || (byId && byKey[0] && byKey[0] !== byId))
        throw new Error(
          `Brand Kit token identity collision in ${composition.name}: ${shared.key}.`,
        );
      const local = byId ?? byKey[0];
      if (local && local.type !== shared.type && (!byId || overrides.has(shared.id)))
        throw new Error(
          `Brand Kit token ${shared.key} has an incompatible local type in ${composition.name}.`,
        );
      if (local) remap.set(local.id, shared.id);
      effective.set(shared.id, {
        ...shared,
        value:
          overrides.has(shared.id) && local
            ? normalizeDesignTokenValue(shared.type, local.value)
            : shared.value,
      });
    }
    const valueErrors = validateTemplateSetBrandKit({
      name: kit.name,
      tokens: [...effective.values()],
    });
    if (valueErrors.length) throw new Error(valueErrors.join(' '));
    remapTokenReferences(composition, remap);
    const placed = new Set<string>();
    composition.designSystem.tokens = original.map((token) => {
      const id = remap.get(token.id);
      if (!id) return token;
      placed.add(id);
      return { ...effective.get(id)! };
    });
    for (const shared of kit.tokens)
      if (!placed.has(shared.id))
        composition.designSystem.tokens.push({ ...effective.get(shared.id)! });
    composition.designSystem.name = kit.name;
    const mergeStyles = <T extends { id: string }>(
      local: T[],
      shared: T[],
      overridden: readonly string[],
    ) => [
      ...local.filter((item) => !shared.some((style) => style.id === item.id)),
      ...shared.map((style) =>
        structuredClone(
          overridden.includes(style.id)
            ? (local.find((item) => item.id === style.id) ?? style)
            : style,
        ),
      ),
    ];
    if (kit.typography !== undefined || composition.designSystem.typography !== undefined)
      composition.designSystem.typography = mergeStyles(
        composition.designSystem.typography ?? [],
        kit.typography ?? [],
        styleOverrides.typography ?? [],
      );
    if (kit.backgrounds !== undefined || composition.designSystem.backgrounds !== undefined)
      composition.designSystem.backgrounds = mergeStyles(
        composition.designSystem.backgrounds ?? [],
        kit.backgrounds ?? [],
        styleOverrides.backgrounds ?? [],
      );
    if (kit.defaultBackgroundStyleId !== undefined)
      composition.designSystem.defaultBackgroundStyleId = kit.defaultBackgroundStyleId;
    if (
      composition.id === next.mainCompositionId &&
      !styleOverrides.background &&
      kit.defaultBackgroundStyleId !== undefined
    ) {
      if (kit.defaultBackgroundStyleId === null) {
        delete composition.backgroundStyleId;
        delete composition.backgroundPaint;
        delete composition.backgroundPaintOverridden;
      } else {
        composition.backgroundStyleId = kit.defaultBackgroundStyleId;
        delete composition.backgroundPaintOverridden;
      }
    }

    // Palette parents run first. Afterwards explicit master/override child swatches take precedence
    // over composition-local derived colors, while links to unrelated local swatches remain live.
    const paletteTargets = new Set(
      (composition.designSystem.stylePackColors ?? []).map((link) => link.targetTokenId),
    );
    const ordered = [...kit.tokens].sort(
      (a, b) => Number(paletteTargets.has(a.id)) - Number(paletteTargets.has(b.id)),
    );
    for (const shared of ordered) {
      const token = composition.designSystem.tokens.find((item) => item.id === shared.id)!;
      token.value = effective.get(shared.id)!.value;
      syncDesignToken(composition, token.id);
      for (const component of composition.components)
        syncDesignToken(
          {
            ...composition,
            layers: component.layers,
            dataFields: component.dataFields,
            components: [],
            designSystem: { ...composition.designSystem, stylePackColors: undefined },
          },
          token.id,
        );
    }
    syncTypographyPresets(composition);
    syncCompositionBackgroundStyle(composition);
  }
  enforceBackgroundMediaProfile(next);
  return next;
}

export function backgroundStylesErrors(styles: unknown): string[] {
  return validateBackgroundStyles(styles);
}

export function syncCompositionBackgroundStyle(composition: Composition) {
  if (!composition.backgroundStyleId || composition.backgroundPaintOverridden) return;
  const style = composition.designSystem.backgrounds?.find(
    (item) => item.id === composition.backgroundStyleId,
  );
  if (!style) throw new Error(`Background style not found: ${composition.backgroundStyleId}`);
  composition.backgroundPaint = structuredClone(style.paint);
}

export function changedSharedStyleIds(
  before: Project,
  after: Project,
  kit: DesignSystem,
  kind: 'typography' | 'backgrounds',
): string[] {
  return (kit[kind] ?? [])
    .filter((shared) =>
      after.compositions.some((composition) => {
        const old = before.compositions
          .find((item) => item.id === composition.id)
          ?.designSystem[kind]?.find((item) => item.id === shared.id);
        const next = composition.designSystem[kind]?.find((item) => item.id === shared.id);
        return old && next && JSON.stringify(old) !== JSON.stringify(next);
      }),
    )
    .map((style) => style.id);
}

export function enforceBackgroundMediaProfile(project: Project) {
  if (project.compositions.some((composition) => isMediaPaint(composition.backgroundPaint))) {
    project.supportsRealTime = true;
    project.supportsNonRealTime = false;
  }
}

/** Detect edits against the previously resolved child, not against the latest master value. */
export function changedSharedBrandTokenIds(
  before: Project,
  after: Project,
  kit: DesignSystem,
): string[] {
  const changed = new Set<string>();
  for (const composition of after.compositions) {
    const previous = before.compositions.find((item) => item.id === composition.id);
    if (!previous) continue;
    for (const shared of kit.tokens) {
      const oldToken = previous.designSystem.tokens.find((token) => token.id === shared.id);
      const token = composition.designSystem.tokens.find((item) => item.id === shared.id);
      if (oldToken && token && token.value !== oldToken.value) changed.add(shared.id);
    }
  }
  return kit.tokens.filter((token) => changed.has(token.id)).map((token) => token.id);
}

function cssString(value: string): string {
  const escaped = [...value]
    .map((character) => {
      const point = character.codePointAt(0)!;
      return point < 32 || point === 127 || ['\\', '"', '<', '>'].includes(character)
        ? `\\${point.toString(16)} `
        : character;
    })
    .join('');
  return `"${escaped}"`;
}

/** Safe, generated custom properties only: no imported CSS, selectors, URLs or executable code. */
export function generateBrandKitCss(brandKit: DesignSystem): string {
  const kit = checkedKit(brandKit);
  const declarations = kit.tokens.map((token) => {
    const key = token.key.replace(
      /[^A-Za-z0-9_-]/g,
      (character) => `\\${character.charCodeAt(0).toString(16)} `,
    );
    const value =
      typeof token.value === 'number' || token.type === 'color'
        ? String(token.value)
        : cssString(token.value);
    return `  --${key}: ${value};`;
  });
  const ident = (value: string) =>
    value.replace(/[^A-Za-z0-9_-]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
  for (const preset of kit.typography ?? [])
    for (const [property, value] of Object.entries(preset.properties)) {
      const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      const cssValue =
        property === 'fontFamily'
          ? cssString(String(value))
          : typeof value === 'number'
            ? `${value}${['fontSize', 'letterSpacing'].includes(property) ? 'px' : ''}`
            : String(value);
      declarations.push(`  --typography-${ident(preset.id)}-${cssProperty}: ${cssValue};`);
    }
  for (const style of kit.backgrounds ?? []) {
    if (isShaderPaint(style.paint) || isMediaPaint(style.paint)) {
      declarations.push(`  /* Background ${style.id} uses the OGraf paint renderer. */`);
      continue;
    }
    const value = [...paintToCss(style.paint)]
      .map((character) =>
        character.charCodeAt(0) < 32 || ';{}<>'.includes(character)
          ? `\\${character.charCodeAt(0).toString(16)} `
          : character,
      )
      .join('');
    declarations.push(`  --background-${ident(style.id)}: ${value};`);
  }
  return `:root {\n${declarations.join('\n')}\n}`;
}

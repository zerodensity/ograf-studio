import { init, parse } from 'es-module-lexer';

/** Inspect bytes without evaluating the provider: every v1 bundle must be a single ESM file. */
export async function assertRendererPluginModule(source: string): Promise<void> {
  await init;
  let imports;
  let exports;
  try {
    [imports, exports] = parse(source);
  } catch {
    throw new Error('Renderer plugin source could not be parsed as an ESM module.');
  }
  if (imports.length)
    throw new Error(
      'Renderer plugins must be self-contained: imports and import.meta are not supported. Bundle dependencies into renderer.js.',
    );
  if (!exports.some((entry) => entry.n === 'default'))
    throw new Error('Renderer plugins must default-export an API v1 provider object.');
}

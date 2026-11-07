import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Builds a dependency-free editable function expression; never executes it in Studio. */
export async function buildBreakoutFunctionSource(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./gameFunction.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'BreakoutFunctionModule',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  });
  const javascript = result.outputFiles?.[0]?.text;
  if (!javascript) throw new Error('The PRISM BREAKER function bundle is empty.');
  return `(() => {\n${javascript}\nreturn BreakoutFunctionModule.default;\n})()`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Provide the destination .js file.');
  const source = await buildBreakoutFunctionSource();
  await writeFile(output, source, 'utf8');
  console.log(
    `Saved PRISM BREAKER expression (${new TextEncoder().encode(source).byteLength} bytes).`,
  );
}

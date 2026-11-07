import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Bundle the editable template function. This helper never executes it in Studio's page. */
export async function buildVectorfallFunctionSource(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./gameFunction.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'VectorfallFunctionModule',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  });
  const javascript = result.outputFiles?.[0]?.text;
  if (!javascript) throw new Error('The VECTORFALL function bundle is empty.');
  return `(() => {\n${javascript}\nreturn VectorfallFunctionModule.default;\n})()`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output)
    throw new Error('Provide the destination .js file for the editable function expression.');
  const source = await buildVectorfallFunctionSource();
  await writeFile(output, source, 'utf8');
  console.log(
    `Saved VECTORFALL function expression (${new TextEncoder().encode(source).byteLength} bytes).`,
  );
}

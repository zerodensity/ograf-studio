import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

// Keep browser and MCP export independent of filesystem access at packaging time.
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const output = new URL(
  '../packages/codegen/src/studioRuntimeLicense.generated.ts',
  import.meta.url,
);
const raw = `// Generated from the repository LICENSE by scripts/generateStudioRuntimeLicense.mjs.\nexport const STUDIO_RUNTIME_LICENSE_TEXT =\n  ${JSON.stringify(license)};\n`;
const path = fileURLToPath(output);
const expected = await format(raw, { ...(await resolveConfig(path)), filepath: path });
if (process.argv.includes('--check')) {
  const actual = await readFile(output, 'utf8').catch(() => '');
  if (actual.replace(/\r\n/g, '\n') !== expected)
    throw new Error('The embedded Studio runtime license is stale. Run npm run license:generate.');
  console.log('Embedded Studio runtime license matches LICENSE.');
} else {
  await writeFile(output, expected, 'utf8');
  console.log('Generated Studio runtime license from LICENSE.');
}

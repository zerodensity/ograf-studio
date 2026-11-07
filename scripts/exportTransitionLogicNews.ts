import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTransitionLogicNewsExample } from '../apps/editor/src/examples/transitionLogicNews';
import { createProjectSetArchive } from '../apps/editor/src/state/projectSet';

const requestedPath = process.argv[2];
if (!requestedPath) throw new Error('Usage: tsx scripts/exportTransitionLogicNews.ts <output.ogs>');
const output = resolve(requestedPath);
if (!output.toLowerCase().endsWith('.ogs'))
  throw new Error('The output filename must end in .ogs.');
const archive = await createProjectSetArchive(createTransitionLogicNewsExample());
await writeFile(output, new Uint8Array(await archive.arrayBuffer()), { flag: 'wx' });
console.log(`Created ${output} (${archive.size} bytes).`);

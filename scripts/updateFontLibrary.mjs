// Refresh this curated snapshot from its reviewed Google Fonts revision; --check is offline.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const revision = '6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec';
const entries = [
  [
    'inter',
    'Inter[opsz,wght].ttf',
    '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
    '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
  ],
  [
    'lora',
    'Lora[wght].ttf',
    '822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7',
    '1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716',
  ],
  [
    'oswald',
    'Oswald[wght].ttf',
    '5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817',
    '0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652',
  ],
  [
    'nunito',
    'Nunito[wght].ttf',
    'bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207',
    '580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65',
  ],
];
const base = new URL('../apps/editor/src/assets/font-library/', import.meta.url);
for (const [id, upstreamFile, fontHash, licenseHash] of entries) {
  for (const [name, remote, expected] of [
    [`${id}.ttf`, upstreamFile, fontHash],
    [`${id}-OFL.txt`, 'OFL.txt', licenseHash],
  ]) {
    const target = new URL(name, base);
    let data;
    if (process.argv.includes('--refresh')) {
      const response = await fetch(
        `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/${id}/${encodeURIComponent(remote)}`,
      );
      if (!response.ok) throw new Error(`Could not download ${id}/${remote}: ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
    } else data = await readFile(target);
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== expected) throw new Error(`Hash mismatch for ${name}: ${actual}`);
    if (process.argv.includes('--refresh')) await writeFile(target, data);
  }
}
console.log(`Font library verified: ${entries.length} families at ${revision}`);

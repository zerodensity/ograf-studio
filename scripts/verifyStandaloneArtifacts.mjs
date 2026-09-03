import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = [
  { file: 'OGrafStudioServer.exe', format: 'pe', architecture: 'x64' },
  { file: 'OGrafStudioServer-macos-x64', format: 'mach-o', architecture: 'x64' },
  { file: 'OGrafStudioServer-macos-arm64', format: 'mach-o', architecture: 'arm64' },
  { file: 'OGrafStudioServer-linux-x64', format: 'elf', architecture: 'x64' },
  { file: 'OGrafStudioServer-linux-arm64', format: 'elf', architecture: 'arm64' },
];

const expectedMachine = {
  'mach-o:x64': 0x01000007,
  'mach-o:arm64': 0x0100000c,
  'elf:x64': 0x3e,
  'elf:arm64': 0xb7,
};

for (const artifact of artifacts) {
  const path = resolve(repositoryRoot, 'release', artifact.file);
  const data = await readFile(path);
  if (data.length < 10_000_000) throw new Error(`${artifact.file} is unexpectedly small.`);
  if (artifact.format === 'pe' && data.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${artifact.file} is not a Windows PE executable.`);
  }
  if (artifact.format === 'mach-o') {
    if (!data.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) {
      throw new Error(`${artifact.file} is not a little-endian 64-bit Mach-O executable.`);
    }
    if (data.readUInt32LE(4) !== expectedMachine[`${artifact.format}:${artifact.architecture}`]) {
      throw new Error(`${artifact.file} has the wrong Mach-O architecture.`);
    }
  }
  if (artifact.format === 'elf') {
    if (!data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error(`${artifact.file} is not an ELF executable.`);
    }
    if (data[4] !== 2 || data[5] !== 1) {
      throw new Error(`${artifact.file} is not a little-endian 64-bit ELF executable.`);
    }
    if (data.readUInt16LE(18) !== expectedMachine[`${artifact.format}:${artifact.architecture}`]) {
      throw new Error(`${artifact.file} has the wrong ELF architecture.`);
    }
  }
  for (const embeddedText of [
    'OGraf Studio',
    '0.11',
    'standalone server',
    'https://github.com/zerodensity/ograf-studio',
    '<!doctype html>',
  ]) {
    if (!data.includes(Buffer.from(embeddedText))) {
      throw new Error(`${artifact.file} does not contain ${JSON.stringify(embeddedText)}.`);
    }
  }
  console.log(
    JSON.stringify({
      file: artifact.file,
      format: artifact.format,
      architecture: artifact.architecture,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    }),
  );
}

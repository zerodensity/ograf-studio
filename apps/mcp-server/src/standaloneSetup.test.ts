import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportBundledAuthoringSkill, formatStandaloneSetupPrompt } from './standaloneSetup';

describe('standalone authoring setup', () => {
  it('prints client instructions with the running build path, selected port and skill locations', () => {
    const executable = '/home/operator/My Studio/OGrafStudioServer-linux-x64';
    const prompt = formatStandaloneSetupPrompt(executable, 4400);
    expect(prompt).toContain(JSON.stringify(executable));
    expect(prompt).toContain('http://127.0.0.1:4400/health');
    expect(prompt).toContain('http://127.0.0.1:4400/mcp');
    expect(prompt).not.toContain('127.0.0.1:4318');
    expect(prompt).toContain('--export-skill');
    expect(prompt).toContain('~/.agents/skills/ograf-authoring');
    expect(prompt).toContain('~/.claude/skills/ograf-authoring');
    expect(prompt).toContain('Upload a skill');
    expect(prompt).toContain('ograf_get_capabilities');
  });

  it('exports exact archive bytes and preserves an existing destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ograf-bundled-skill-'));
    const source = join(directory, 'embedded.zip');
    const destination = join(directory, 'ograf-authoring.zip');
    try {
      const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
      await writeFile(source, bytes);
      await exportBundledAuthoringSkill(source, destination);
      expect(await readFile(destination)).toEqual(bytes);
      await writeFile(source, Buffer.from('different'));
      await expect(exportBundledAuthoringSkill(source, destination)).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(await readFile(destination)).toEqual(bytes);
    } finally {
      await rm(source, { force: true });
      await rm(destination, { force: true });
      await rmdir(directory);
    }
  });
});

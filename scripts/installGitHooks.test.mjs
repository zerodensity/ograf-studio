import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { installSkillHook } from './installGitHooks.mjs';

// These tests assert which file Git writes, so they run real Git against throwaway repositories.
// They must not see the developer's config or, when run from a hook, the enclosing repository.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
const emptyConfigDir = mkdtempSync(join(tmpdir(), 'ograf-hooks-config-'));
process.on('exit', () => rmSync(emptyConfigDir, { recursive: true, force: true }));
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = join(emptyConfigDir, 'gitconfig');
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

const GUARD = '#!/bin/sh\n# OGRAF_AUTHORING_SKILL_GUARD\n';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const guardPath = (checkout) => resolve(checkout, '.githooks').replaceAll('\\', '/');
const effective = (checkout) => {
  try {
    return git(checkout, 'config', '--get', 'core.hooksPath');
  } catch {
    return '';
  }
};

function repository(t, { worktreeConfig = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ograf-hooks-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});
  const main = join(base, 'main');
  mkdirSync(join(main, '.githooks'), { recursive: true });
  writeFileSync(join(main, '.githooks', 'pre-push'), GUARD);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '.');
  git(main, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'x');
  if (worktreeConfig) git(main, 'config', 'extensions.worktreeConfig', 'true');
  const sharedConfigPath = join(main, '.git', 'config');
  return {
    base,
    main,
    addWorktree(name) {
      const path = join(base, name);
      git(main, 'worktree', 'add', '-q', '--detach', path);
      return path;
    },
    setShared: (value) => git(main, 'config', '--local', 'core.hooksPath', value),
    setOverride: (checkout, value) =>
      git(checkout, 'config', '--worktree', 'core.hooksPath', value),
    override: (checkout) => git(checkout, 'config', '--worktree', '--get', 'core.hooksPath'),
    sharedConfig: () => readFileSync(sharedConfigPath, 'utf8'),
  };
}

function customHooks(repo) {
  const path = join(repo.base, 'custom-hooks');
  mkdirSync(path);
  writeFileSync(join(path, 'pre-push'), '#!/bin/sh\nexit 0\n');
  return path.replaceAll('\\', '/');
}

test('a worktree overriding another worktree guard moves its override, not the shared config', (t) => {
  const repo = repository(t);
  const other = repo.addWorktree('other');
  const worktree = repo.addWorktree('worktree');
  repo.setShared(guardPath(other));
  repo.setOverride(worktree, guardPath(other));
  const shared = repo.sharedConfig();

  installSkillHook(worktree);

  assert.equal(repo.sharedConfig(), shared);
  assert.equal(repo.override(worktree), guardPath(worktree));
  assert.equal(effective(repo.main), guardPath(other));
});

test('repeat runs in a worktree that already has its guard write nothing', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');
  repo.setOverride(worktree, guardPath(repo.main));
  installSkillHook(worktree);
  const log = t.mock.method(console, 'log', () => {});

  installSkillHook(worktree);

  assert.equal(log.mock.callCount(), 0);
  assert.equal(repo.override(worktree), guardPath(worktree));
});

test('a worktree inheriting another worktree guard gains an override, leaving the shared config', (t) => {
  const repo = repository(t);
  const other = repo.addWorktree('other');
  const worktree = repo.addWorktree('worktree');
  repo.setShared(guardPath(other));
  const shared = repo.sharedConfig();

  installSkillHook(worktree);

  assert.equal(repo.sharedConfig(), shared);
  assert.equal(repo.override(worktree), guardPath(worktree));
});

test('a worktree with no hook configured gets the guard for itself alone', (t) => {
  const repo = repository(t);
  const sibling = repo.addWorktree('sibling');
  const worktree = repo.addWorktree('worktree');
  const shared = repo.sharedConfig();

  installSkillHook(worktree);

  assert.equal(effective(worktree), guardPath(worktree));
  assert.equal(repo.sharedConfig(), shared);
  assert.equal(effective(repo.main), '');
  assert.equal(effective(sibling), '');
});

test('the main checkout gets its guard in its own config when worktree config is on', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');
  const shared = repo.sharedConfig();

  installSkillHook(repo.main);

  assert.equal(effective(repo.main), guardPath(repo.main));
  assert.equal(repo.sharedConfig(), shared);
  assert.equal(effective(worktree), '');
});

test('a plain clone with no hook configured gets the guard in .git/config', (t) => {
  const repo = repository(t, { worktreeConfig: false });

  installSkillHook(repo.main);

  assert.equal(git(repo.main, 'config', '--local', 'core.hooksPath'), guardPath(repo.main));
});

test('without worktree config the main checkout still installs while worktrees exist', (t) => {
  const repo = repository(t, { worktreeConfig: false });
  const worktree = repo.addWorktree('worktree');

  installSkillHook(repo.main);

  assert.equal(git(repo.main, 'config', '--local', 'core.hooksPath'), guardPath(repo.main));
  assert.equal(effective(worktree), guardPath(repo.main));
});

test('without worktree config a linked worktree warns instead of writing the shared config', (t) => {
  const repo = repository(t, { worktreeConfig: false });
  const worktree = repo.addWorktree('worktree');
  const shared = repo.sharedConfig();
  const warn = t.mock.method(console, 'warn', () => {});

  installSkillHook(worktree);

  assert.equal(repo.sharedConfig(), shared);
  assert.equal(effective(worktree), '');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /hooks:install from the main checkout/);
});

test('without worktree config a linked worktree already guarded by the main checkout stays quiet', (t) => {
  const repo = repository(t, { worktreeConfig: false });
  const worktree = repo.addWorktree('worktree');
  repo.setShared(guardPath(repo.main));
  const shared = repo.sharedConfig();
  const warn = t.mock.method(console, 'warn', () => {});

  installSkillHook(worktree);

  assert.equal(repo.sharedConfig(), shared);
  assert.equal(warn.mock.callCount(), 0);
});

test('custom hooks in a worktree override are refused and preserved', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');
  const custom = customHooks(repo);
  repo.setOverride(worktree, custom);
  const shared = repo.sharedConfig();

  assert.throws(() => installSkillHook(worktree), /custom Git hooks were preserved/);

  assert.equal(repo.override(worktree), custom);
  assert.equal(repo.sharedConfig(), shared);
});

test('custom hooks in the shared config are refused and preserved', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');
  const custom = customHooks(repo);
  repo.setShared(custom);
  const shared = repo.sharedConfig();

  assert.throws(() => installSkillHook(worktree), /custom Git hooks were preserved/);
  assert.throws(() => installSkillHook(repo.main), /custom Git hooks were preserved/);

  assert.equal(effective(worktree), custom);
  assert.equal(repo.sharedConfig(), shared);
});

test('a missing hooks path that this script did not write is refused and preserved', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');

  for (const missing of ['.husky', `${repo.base.replaceAll('\\', '/')}/gone/hooks`]) {
    repo.setOverride(worktree, missing);
    assert.throws(() => installSkillHook(worktree), /custom Git hooks were preserved/);
    assert.equal(repo.override(worktree), missing);
  }
});

test('a relative .githooks path already gives each checkout its own guard', (t) => {
  const repo = repository(t);
  const worktree = repo.addWorktree('worktree');
  repo.setShared('.githooks');
  const shared = repo.sharedConfig();

  installSkillHook(worktree);

  assert.equal(repo.sharedConfig(), shared);
  assert.throws(() => repo.override(worktree));
});

test('a guard path left behind by a removed worktree is repaired in this checkout only', (t) => {
  const repo = repository(t);
  const removed = repo.addWorktree('removed');
  const worktree = repo.addWorktree('worktree');
  repo.setShared(guardPath(removed));
  repo.setOverride(worktree, guardPath(removed));
  git(repo.main, 'worktree', 'remove', removed);
  const shared = repo.sharedConfig();

  installSkillHook(worktree);

  assert.equal(repo.override(worktree), guardPath(worktree));
  assert.equal(repo.sharedConfig(), shared);
  assert.equal(effective(repo.main), guardPath(removed));
});

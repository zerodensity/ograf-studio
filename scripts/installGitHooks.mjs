import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
const readConfig = (root, ...args) => {
  try {
    return git(root, 'config', ...args);
  } catch {
    return ''; // `git config --get` exits non-zero for an unset key.
  }
};

function hasGuard(root, hooksPath) {
  try {
    return readFileSync(resolve(root, hooksPath, 'pre-push'), 'utf8').includes(
      'OGRAF_AUTHORING_SKILL_GUARD',
    );
  } catch {
    return false;
  }
}

// This script only writes absolute `<checkout>/.githooks` paths, so one whose directory is gone is
// a guard whose checkout was removed or moved. Any other missing path remains user-owned.
const isOrphanedGuardPath = (hooksPath) =>
  isAbsolute(hooksPath) && basename(hooksPath) === '.githooks' && !existsSync(hooksPath);

// The `git config` scope for this checkout's guard, or null when it may not write one. `--local` is
// the `.git/config` that the main checkout and every worktree without an override share, so it must
// never hold a path into a removable worktree. With extensions.worktreeConfig on, every checkout has
// a private `--worktree` file instead. Without it, only the main checkout may write `--local`,
// because it cannot be removed from under the others.
function checkoutScope(root) {
  if (readConfig(root, '--type=bool', '--get', 'extensions.worktreeConfig') === 'true')
    return '--worktree';
  const [gitDir, commonDir] = git(root, 'rev-parse', '--git-dir', '--git-common-dir').split(
    /\r?\n/,
  );
  return resolve(root, gitDir) === resolve(root, commonDir) ? '--local' : null;
}

export function installSkillHook(root = repoRoot) {
  try {
    git(root, 'rev-parse', '--git-dir');
  } catch {
    return;
  }
  const desired = resolve(root, '.githooks').replaceAll('\\', '/');
  const current = readConfig(root, '--get', 'core.hooksPath');
  if (current === desired || current === '.githooks') return;
  const guarded = Boolean(current) && hasGuard(root, current);
  if (current && !guarded && !isOrphanedGuardPath(current))
    throw new Error(
      'Existing custom Git hooks were preserved. Chain the skill --check-push command in your pre-push hook before building.',
    );
  const scope = checkoutScope(root);
  if (!scope) {
    if (!guarded)
      console.warn(
        'Skipped the skill archive pre-push guard: this linked worktree has no Git config of its own. Run npm run hooks:install from the main checkout.',
      );
    return;
  }
  git(root, 'config', scope, 'core.hooksPath', desired);
  console.log('Installed the skill archive pre-push guard.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  installSkillHook();

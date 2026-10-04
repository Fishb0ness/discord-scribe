// Enables the versioned git hooks. Never fails: installs from a tarball or inside another repo are fine.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

try {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (realpathSync(top) === realpathSync(process.cwd())) {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
    console.log('git hooks enabled (.githooks)');
  }
} catch {
  // Not a git checkout (or git is missing): nothing to do.
}

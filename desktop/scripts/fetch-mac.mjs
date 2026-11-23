// Downloads the newest successful macOS build from GitHub Actions
// (.github/workflows/desktop-macos.yml) into desktop/release/macos, where
// scripts/build-site.mjs picks it up. Needs the GitHub CLI, signed in (`gh auth login`).
//
//   npm run desktop:mac:fetch [-- <run id>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'desktop/release/macos');
const gh = (...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const run =
  process.argv[2] ??
  gh('run', 'list', '--workflow', 'desktop-macos.yml', '--status', 'success', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId');
if (!run) {
  console.error('No successful macOS build yet. Run the "Desktop app (macOS)" workflow on GitHub first.');
  process.exit(1);
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
gh('run', 'download', run, '--name', 'smart-tasks-macos', '--dir', dir);
console.log(`macOS build from run ${run} → ${dir}`);
console.log(gh('run', 'view', run, '--json', 'headBranch,headSha,createdAt', '--jq', '"\\(.headBranch) @ \\(.headSha[0:7]), \\(.createdAt)"'));

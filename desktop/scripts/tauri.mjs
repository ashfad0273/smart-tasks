// Runs the Tauri CLI for the desktop app with a build environment that works
// on this setup:
//  - adds ~/.cargo/bin to PATH (rustup doesn't always put it there)
//  - (Windows) keeps Cargo's target dir on a path without spaces, because MinGW's
//    windres (used to embed the exe icon and version info) breaks on them
//  - points the updater signing step at the private key kept outside the repo
//
//   node desktop/scripts/tauri.mjs dev | build [...args]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env };

env.PATH = [join(homedir(), '.cargo', 'bin'), env.PATH ?? env.Path ?? ''].join(delimiter);
delete env.Path;

if (!env.CARGO_TARGET_DIR && /\s/.test(root)) {
  env.CARGO_TARGET_DIR = join(env.LOCALAPPDATA ?? homedir(), 'smart-tasks-build', 'target');
}

// Updater signing key: generated once with `npm run desktop:keygen`, never committed.
const keyFile = env.SMART_TASKS_UPDATER_KEY ?? join(homedir(), '.smart-tasks', 'updater.key');
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, 'utf8').trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
}

const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: join(root, 'desktop'),
  env,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);

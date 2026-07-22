#!/usr/bin/env node
/**
 * Run a package script across workspaces using the invoking package manager
 * (npm or pnpm). Usage: node scripts/ws.mjs <script> [...extraArgs]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!script) {
  console.error('Usage: node scripts/ws.mjs <script> [...args]');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ua = process.env.npm_config_user_agent || '';
const isPnpm = ua.includes('pnpm') || Boolean(process.env.PNPM_SCRIPT_SRC_DIR);

const command = isPnpm ? 'pnpm' : 'npm';
const args = isPnpm
  ? ['--parallel', '-r', 'run', script, ...extraArgs]
  : ['run', script, '--workspaces', '--if-present', ...extraArgs];

const child = spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

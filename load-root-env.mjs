import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/** Load repo-root `.env` then `.env.local` into `process.env` (local wins). */
export function loadRootEnv() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(repoRoot, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (name === '.env.local' || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
  return repoRoot;
}

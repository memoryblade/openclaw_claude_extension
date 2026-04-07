import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Resolve a working directory for a subprocess:
 *
 * - dir is undefined/empty → process.cwd()
 * - dir is an absolute path → use as-is, create if missing
 * - dir is a relative path → resolve against root (defaults to process.cwd()),
 *   create if missing
 */
export function resolveWorkingDir(dir?: string, root?: string): string {
  if (!dir) {
    return process.cwd();
  }

  const resolved = isAbsolute(dir) ? dir : resolve(root ?? process.cwd(), dir);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

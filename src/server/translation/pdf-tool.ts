import 'server-only';

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { setPriority } from 'os';
import path from 'path';

import { serverEnv } from '@/lib/env';

/**
 * Runs translator/pdf_kannada.py, which reads an analysis PDF's paragraphs
 * and writes its Kannada copy.
 *
 * A separate short-lived process rather than part of the translation engine:
 * an 80 MB PDF can take a few hundred megabytes for a minute, and the engine,
 * which holds its model in memory all day, is capped tightly enough that this
 * would push it over. Started at a low priority, below the website.
 */

/** Must match FORMAT in translator/pdf_kannada.py. */
export const PDF_FORMAT = 4;

/** Python, or the packages the script needs, are not installed (yet). */
export class PdfToolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfToolUnavailableError';
  }
}

/** Where deploy/setup-translator.sh builds the engine's environment. */
const SERVER_PYTHON = '/opt/avk-translator/venv/bin/python';

export function pythonPath(): string {
  const configured = serverEnv().TRANSLATOR_PYTHON;
  if (configured) return configured;
  if (existsSync(SERVER_PYTHON)) return SERVER_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export function runPdfTool(args: string[], timeoutMs = 60 * 60_000): Promise<void> {
  const script = path.join(process.cwd(), 'translator', 'pdf_kannada.py');
  return new Promise((resolve, reject) => {
    const child = execFile(
      pythonPath(),
      [script, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = String(stderr || error.message).trim().split('\n').slice(-4).join(' ').slice(0, 600);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || /No module named|ModuleNotFoundError/.test(detail)) {
          reject(new PdfToolUnavailableError(`The PDF tool cannot run yet: ${detail || 'Python was not found'}`));
          return;
        }
        reject(new Error(`pdf_kannada ${args[0]} failed: ${detail}`));
      },
    );
    if (child.pid) {
      try {
        setPriority(child.pid, 15);
      } catch {
        // Not permitted here; it simply runs at normal priority.
      }
    }
  });
}

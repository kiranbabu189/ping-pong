const IGNORE = [
  /api-pingpong/,
  /\/node_modules\//,
  /\/\.vite\/deps\//,
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  /webpack\/bootstrap/,
  /<anonymous>/,
  /^\s*at (new )?Promise/,
  /^\s*at (async )?Promise\./,
];

/**
 * Capture a trimmed call stack showing which app code started the request.
 * Frames from this library, node_modules and bundler runtimes are dropped.
 */
export function captureInitiator(max = 8): string[] {
  const stack = new Error().stack;
  if (!stack) return [];
  const lines = stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const frames = lines.filter((l) => !IGNORE.some((re) => re.test(l))).map(cleanFrame);
  return (frames.length ? frames : lines.map(cleanFrame)).slice(0, max);
}

function cleanFrame(line: string): string {
  return line
    .replace(/^at\s+/, '')
    .replace(/\?t=\d+/, '') // vite HMR timestamps
    .replace(/\?v=[0-9a-f]+/, '')
    .replace(/https?:\/\/[^/]+/, ''); // drop origin for readability
}

/** Best-effort "file:line" from the top frame. */
export function shortInitiator(frames: string[]): string {
  const f = frames[0];
  if (!f) return '';
  const m = /([^/\s():]+:\d+)(?::\d+)?\)?$/.exec(f);
  return m ? m[1] : f;
}

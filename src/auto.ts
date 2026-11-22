import { init } from './index';
import type { PingPongOptions } from './core/types';

export * from './index';

// Zero-config entry: `import 'api-pingpong/auto'`.
// Optional config: set `window.API_PINGPONG_OPTIONS = {...}` before this import runs.
init((globalThis as { API_PINGPONG_OPTIONS?: PingPongOptions }).API_PINGPONG_OPTIONS);

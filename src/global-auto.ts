// Script-tag build that starts immediately:
// <script src="https://unpkg.com/api-pingpong/dist/api-pingpong.auto.global.js"></script>
// Options: data-* attributes on the script tag, or window.API_PINGPONG_OPTIONS.
import { init, destroy, getInstance } from './index';
import type { PingPongOptions } from './core/types';

function optionsFromScriptTag(): PingPongOptions {
  const s = document.currentScript as HTMLScriptElement | null;
  if (!s) return {};
  const d = s.dataset;
  const o: PingPongOptions = {};
  if (d.position) o.position = d.position as PingPongOptions['position'];
  if (d.open) o.open = d.open !== 'false';
  if (d.hotkey) o.hotkey = d.hotkey === 'false' ? false : d.hotkey;
  if (d.trackFieldUsage) o.trackFieldUsage = d.trackFieldUsage !== 'false';
  if (d.redact) o.redact = d.redact !== 'false';
  return o;
}

if (typeof window !== 'undefined') {
  init({ ...optionsFromScriptTag(), ...((window as { API_PINGPONG_OPTIONS?: PingPongOptions }).API_PINGPONG_OPTIONS ?? {}) });
}

export { init, destroy, getInstance };

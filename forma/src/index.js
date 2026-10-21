import { Forma } from './core/forma.js';
export { Forma };
export { FormaError } from './gl/context.js';

export function createForma(container, options) { return new Forma(container, options); }

createForma.supported = function supported() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch (_) { return false; }
};

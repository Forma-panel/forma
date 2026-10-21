// WebGL2 上下文与底层资源。对应 v7 的 37–43、327–370 行。

export class FormaError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new FormaError('no-webgl2', '浏览器不支持 WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new FormaError('no-float-target', '显卡不支持浮点渲染目标 (EXT_color_buffer_float)');
  return gl;
}

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new FormaError('shader', gl.getShaderInfoLog(s));
  return s;
}

export function program(gl, vs, fs) {
  const p = gl.createProgram();
  const a = compile(gl, gl.VERTEX_SHADER, vs), b = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, a); gl.attachShader(p, b);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new FormaError('shader', gl.getProgramInfoLog(p));
  gl.deleteShader(a); gl.deleteShader(b);
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

export function nearestTex(gl) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}

// 内容画布原样上传：直通 alpha，一个画布像素对应一滴液体
export function uploadCanvas(gl, tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
}

export function makeTarget(gl, w, h, ifmt = gl.RGBA16F, fmt = gl.RGBA) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}

export function freeTarget(gl, t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

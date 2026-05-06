export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL2 inte tillgängligt i denna webbläsare.');
  return gl;
}

export function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    gl.deleteShader(sh);
    throw new Error('shader compile error: ' + log);
  }
  return sh;
}

export function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || '';
    throw new Error('program link error: ' + log);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return p;
}

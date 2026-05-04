import { link } from './gl';

export interface ShapeProgram {
  prog: WebGLProgram;
  uViewport: WebGLUniformLocation;
  uTranslate: WebGLUniformLocation;
  uZoom: WebGLUniformLocation;
  aPosColor: number;
  aNormal: number;
  aWidth: number;
}

export function createShapeProgram(gl: WebGL2RenderingContext): ShapeProgram {
  const vs = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 a_pos;     // world coords
  layout(location = 1) in vec4 a_color;
  layout(location = 2) in vec2 a_normal;  // unit normal in world space
  layout(location = 3) in float a_width;  // half-width in pixels
  uniform vec2 u_viewport; // canvas size in CSS pixels
  uniform vec2 u_translate;
  uniform float u_zoom;    // pixels per world unit
  out vec4 v_color;
  void main() {
    // World -> screen pixel: p = a_pos * u_zoom + u_translate
    vec2 screen = a_pos * u_zoom + u_translate;
    // Offset along screen-space normal by halfwidth pixels.
    // a_normal is unit in world; in screen the same direction is unit too (uniform scale).
    screen += a_normal * a_width;
    // Screen px -> NDC: (px / vp) * 2 - 1, with Y flipped.
    vec2 ndc = (screen / u_viewport) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_color = a_color;
  }`;

  const fs = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  out vec4 frag;
  void main() {
    frag = v_color;
  }`;

  const prog = link(gl, vs, fs);
  return {
    prog,
    uViewport: gl.getUniformLocation(prog, 'u_viewport')!,
    uTranslate: gl.getUniformLocation(prog, 'u_translate')!,
    uZoom: gl.getUniformLocation(prog, 'u_zoom')!,
    aPosColor: 0,
    aNormal: 2,
    aWidth: 3,
  };
}

export interface GridProgram {
  prog: WebGLProgram;
  uViewport: WebGLUniformLocation;
  uTranslate: WebGLUniformLocation;
  uZoom: WebGLUniformLocation;
  uDpr: WebGLUniformLocation;
  uColor: WebGLUniformLocation;
}

export function createGridProgram(gl: WebGL2RenderingContext): GridProgram {
  const vs = `#version 300 es
  precision highp float;
  // Fullscreen triangle: 3 verts, no buffer needed
  void main() {
    vec2 p = vec2(
      (gl_VertexID == 1) ? 3.0 : -1.0,
      (gl_VertexID == 2) ? 3.0 : -1.0
    );
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  // Fragment: figure out world coord per pixel and dot-render the grid.
  const fs = `#version 300 es
  precision highp float;
  uniform vec2 u_viewport;
  uniform vec2 u_translate;
  uniform float u_zoom;
  uniform float u_dpr;
  uniform vec4 u_color;
  out vec4 frag;
  void main() {
    // gl_FragCoord is in physical pixels with origin bottom-left.
    vec2 px = vec2(gl_FragCoord.x, u_viewport.y * u_dpr - gl_FragCoord.y) / u_dpr;
    // px -> world
    vec2 w = (px - u_translate) / u_zoom;
    vec2 g = w - floor(w + 0.5);
    float distGrid = length(g) * u_zoom;
    // Dots: small filled circles every grid unit.
    float dot = smoothstep(1.6, 0.6, distGrid);
    frag = vec4(u_color.rgb, u_color.a * dot);
  }`;

  const prog = link(gl, vs, fs);
  return {
    prog,
    uViewport: gl.getUniformLocation(prog, 'u_viewport')!,
    uTranslate: gl.getUniformLocation(prog, 'u_translate')!,
    uZoom: gl.getUniformLocation(prog, 'u_zoom')!,
    uDpr: gl.getUniformLocation(prog, 'u_dpr')!,
    uColor: gl.getUniformLocation(prog, 'u_color')!,
  };
}

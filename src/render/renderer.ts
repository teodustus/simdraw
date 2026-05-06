import type { CircuitDoc, ComponentInstance, Wire, Probe } from '../circuit/types';
import { getSymbol, type SymbolSpec, type Prim } from '../symbols/library';
import { createGL } from './gl';
import { createGridProgram, createShapeProgram, type GridProgram, type ShapeProgram } from './programs';
import { ShapeBatch, type RGBA } from './batch';
import { transformPoint, pinWorld } from './transform';
import { View } from './view';

export interface SimResults {
  nodeVoltages: Map<string, number>;
  branchCurrents: Map<string, number>;
  ok: boolean;
  message?: string;
}

export interface RenderInput {
  doc: CircuitDoc;
  view: View;
  selection: Set<string>;
  highlightedNet?: string | null;
  ghost?: { kind: ComponentInstance['kind']; x: number; y: number; rotation: ComponentInstance['rotation']; flipped: boolean } | null;
  wireDraft?: { points: Array<{ x: number; y: number }>; cursor: { x: number; y: number } | null } | null;
  junctions?: Array<{ x: number; y: number }>;
  sim?: SimResults | null;
  /** map from "x,y" grid key → netId, used by voltage probes */
  pointToNet?: Map<string, string>;
  /** animation: turn on flowing dots along wires when sim has currents */
  animateFlow?: boolean;
  /** map componentId → branch current (for animation; usually duplicates sim) */
  netCurrents?: Map<string, number>;
}

const COLORS = {
  bg: [0.043, 0.071, 0.125, 1] as RGBA,
  grid: [0.18, 0.24, 0.36, 0.9] as RGBA,
  wire: [0.85, 0.92, 1.0, 1] as RGBA,
  symbol: [0.85, 0.92, 1.0, 1] as RGBA,
  symbolSel: [0.49, 0.95, 0.63, 1] as RGBA,
  pin: [0.49, 0.95, 0.63, 1] as RGBA,
  ghost: [0.49, 0.95, 0.63, 0.55] as RGBA,
  draft: [0.49, 0.95, 0.63, 0.85] as RGBA,
  led_on: [1.0, 0.45, 0.45, 1] as RGBA,
};

export class Renderer {
  private gl: WebGL2RenderingContext;
  private shape: ShapeProgram;
  private grid: GridProgram;
  private posBuf: WebGLBuffer;
  private nrmBuf: WebGLBuffer;
  private widBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private batch = new ShapeBatch();

  private textCanvas: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;

  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.gl = createGL(canvas);
    this.shape = createShapeProgram(this.gl);
    this.grid = createGridProgram(this.gl);

    const gl = this.gl;
    this.posBuf = gl.createBuffer()!;
    this.nrmBuf = gl.createBuffer()!;
    this.widBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.widBuf);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(...COLORS.bg);

    const tc = document.createElement('canvas');
    tc.style.position = 'fixed';
    tc.style.inset = '0';
    tc.style.width = '100%';
    tc.style.height = '100%';
    tc.style.pointerEvents = 'none';
    tc.style.zIndex = '1';
    tc.style.touchAction = 'none';
    document.body.appendChild(tc);
    this.textCanvas = tc;
    this.tctx = tc.getContext('2d')!;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.textCanvas.width = Math.round(w * dpr);
    this.textCanvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(input: RenderInput): void {
    this.resize();
    const gl = this.gl;
    const { doc, view, selection, ghost, wireDraft, junctions, sim } = input;

    this.batch.reset();
    buildScene(this.batch, doc, selection, sim ?? null);

    if (ghost) {
      const sym = getSymbol(ghost.kind);
      drawSymbolPrims(this.batch, sym, ghost.x, ghost.y, ghost.rotation, ghost.flipped, COLORS.ghost, 2);
    }
    if (wireDraft && wireDraft.points.length > 0) {
      const pts = wireDraft.points.slice();
      if (wireDraft.cursor) {
        const last = pts[pts.length - 1];
        const c = wireDraft.cursor;
        if (last.x !== c.x && last.y !== c.y) {
          this.batch.addLine(last.x, last.y, c.x, last.y, COLORS.draft, 2);
          this.batch.addLine(c.x, last.y, c.x, c.y, COLORS.draft, 2);
        } else if (last.x !== c.x || last.y !== c.y) {
          this.batch.addLine(last.x, last.y, c.x, c.y, COLORS.draft, 2);
        }
      }
      for (let i = 0; i < pts.length - 1; i++) {
        this.batch.addLine(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y, COLORS.draft, 2);
      }
    }
    if (junctions) {
      for (const j of junctions) this.batch.addDisc(j.x, j.y, 0.18, COLORS.pin, 12);
    }

    this.upload();

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.grid.prog);
    gl.uniform2f(this.grid.uViewport, this.cssW, this.cssH);
    gl.uniform2f(this.grid.uTranslate, view.tx, view.ty);
    gl.uniform1f(this.grid.uZoom, view.zoom);
    gl.uniform1f(this.grid.uDpr, this.dpr);
    gl.uniform4f(this.grid.uColor, COLORS.grid[0], COLORS.grid[1], COLORS.grid[2], COLORS.grid[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.shape.prog);
    gl.uniform2f(this.shape.uViewport, this.cssW, this.cssH);
    gl.uniform2f(this.shape.uTranslate, view.tx, view.ty);
    gl.uniform1f(this.shape.uZoom, view.zoom);
    gl.bindVertexArray(this.vao);
    if (this.batch.count() > 0) {
      gl.drawElements(gl.TRIANGLES, this.batch.count(), gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);

    this.renderText(input);
  }

  private upload(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.positionsArray(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.normalsArray(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.widBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.widthsArray(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.batch.indicesArray(), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  private renderText(input: RenderInput): void {
    const ctx = this.tctx;
    const { doc, view, sim, pointToNet } = input;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const c of doc.components) {
      const sym = getSymbol(c.kind);
      const top = transformPoint(
        (sym.bbox.minX + sym.bbox.maxX) / 2,
        sym.bbox.maxY + 0.8,
        c.rotation,
        c.flipped,
      );
      const center = view.worldToScreen(c.x + top.x, c.y + top.y);
      const designator = c.label || `${sym.designator}${shortId(c.id)}`;
      const valStr = formatValue(c, sym);
      ctx.fillStyle = '#8a96b1';
      ctx.fillText(designator, center.x, center.y);
      if (valStr) {
        ctx.fillStyle = '#e6edf7';
        ctx.fillText(valStr, center.x, center.y + 12);
      }

      if (sim?.ok) {
        const i = sim.branchCurrents.get(c.id);
        if (i !== undefined && Math.abs(i) > 1e-9) {
          ctx.fillStyle = '#7cf3a0';
          ctx.fillText(formatCurrent(i), center.x, center.y + 26);
        }
      }
    }

    // Animated flow dots along wires
    if (input.animateFlow && sim?.ok && pointToNet) {
      drawFlowDots(ctx, view, doc, sim, pointToNet, performance.now() / 1000);
    }

    // Probes (drawn last so they sit on top of flow dots)
    if (doc.probes && doc.probes.length > 0) {
      for (const pr of doc.probes) {
        drawProbe(ctx, view, pr, doc, sim ?? null, pointToNet);
      }
    }
  }
}

function drawFlowDots(
  ctx: CanvasRenderingContext2D,
  view: View,
  doc: CircuitDoc,
  sim: SimResults,
  pointToNet: Map<string, string>,
  time: number,
): void {
  // Compute max current per net by walking each component's pins.
  const netCurrent = new Map<string, number>();
  for (const c of doc.components) {
    const i = sim.branchCurrents.get(c.id);
    if (i === undefined) continue;
    const mag = Math.abs(i);
    if (mag < 1e-6) continue;
    const sym = getSymbol(c.kind);
    for (const pin of sym.pins) {
      const wp = pinWorld(c, pin.x, pin.y);
      const key = `${Math.round(wp.x)},${Math.round(wp.y)}`;
      const net = pointToNet.get(key);
      if (!net) continue;
      const prev = netCurrent.get(net) ?? 0;
      if (mag > prev) netCurrent.set(net, mag);
    }
  }

  ctx.save();
  for (const w of doc.wires) {
    if (w.points.length < 2) continue;
    const startKey = `${Math.round(w.points[0].x)},${Math.round(w.points[0].y)}`;
    const net = pointToNet.get(startKey);
    if (!net) continue;
    const I = netCurrent.get(net) ?? 0;
    if (I < 1e-6) continue;

    // Speed grows with log of current; clamp so 1mA → ~0.4 cycle/s, 1A → ~1.4
    const speed = Math.max(0.2, Math.min(1.5, 0.4 + Math.log10(I * 1000 + 1) * 0.25));
    const phase = (time * speed) % 1;
    const alpha = Math.min(0.95, 0.4 + Math.log10(I * 1000 + 1) * 0.15);
    ctx.fillStyle = `rgba(124, 243, 160, ${alpha})`;
    ctx.shadowColor = `rgba(124, 243, 160, 0.6)`;
    ctx.shadowBlur = 6;

    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      const aScreen = view.worldToScreen(a.x, a.y);
      const bScreen = view.worldToScreen(b.x, b.y);
      const len = Math.hypot(bScreen.x - aScreen.x, bScreen.y - aScreen.y);
      if (len < 8) continue;
      const dotsPerSegment = Math.max(1, Math.floor(len / 50));
      for (let d = 0; d < dotsPerSegment; d++) {
        const t = (phase + d / dotsPerSegment) % 1;
        const px = aScreen.x + (bScreen.x - aScreen.x) * t;
        const py = aScreen.y + (bScreen.y - aScreen.y) * t;
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawProbe(
  ctx: CanvasRenderingContext2D,
  view: View,
  pr: Probe,
  doc: CircuitDoc,
  sim: SimResults | null,
  pointToNet: Map<string, string> | undefined,
): void {
  const screen = view.worldToScreen(pr.x, pr.y);

  // Compute label
  let label = '';
  let value = '';
  if (pr.kind === 'voltage') {
    label = `V@(${pr.x},${pr.y})`;
    if (sim?.ok && pointToNet) {
      const key = `${pr.x},${pr.y}`;
      const net = pointToNet.get(key);
      if (net !== undefined) {
        const v = sim.nodeVoltages.get(net) ?? 0;
        value = formatSI(v, 'V');
      } else {
        value = '— flytande';
      }
    } else {
      value = '?';
    }
  } else {
    const c = doc.components.find((x) => x.id === pr.componentId);
    label = c ? c.label || `${getSymbol(c.kind).designator}` : 'I=?';
    if (sim?.ok && c) {
      const i = sim.branchCurrents.get(c.id) ?? 0;
      value = formatSI(Math.abs(i), 'A');
    } else {
      value = '?';
    }
  }

  // Anchor dot
  ctx.fillStyle = '#ffb44a';
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0b1220';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Label box, offset from anchor so it doesn't cover the wire
  const offsetX = 10;
  const offsetY = -28;
  const text = pr.kind === 'voltage' ? value : `I=${value}`;
  const sub = pr.kind === 'voltage' ? 'V' : label;

  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padding = 6;
  const width = Math.max(ctx.measureText(text).width, ctx.measureText(sub).width) + padding * 2;
  const height = 30;
  const x = screen.x + offsetX;
  const y = screen.y + offsetY;

  // Rounded box
  ctx.fillStyle = 'rgba(11, 18, 32, 0.92)';
  ctx.strokeStyle = '#ffb44a';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 6);
  ctx.fill();
  ctx.stroke();

  // Sub-label and value
  ctx.fillStyle = '#8a96b1';
  ctx.font = '500 9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(sub, x + padding, y + 3);
  ctx.fillStyle = '#ffb44a';
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(text, x + padding, y + 14);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ------------------------------ Scene builders ------------------------------ */

function buildScene(
  batch: ShapeBatch,
  doc: CircuitDoc,
  selection: Set<string>,
  sim: SimResults | null,
): void {
  for (const w of doc.wires) drawWire(batch, w);

  for (const c of doc.components) {
    const sym = getSymbol(c.kind);
    const sel = selection.has(c.id);
    const baseColor = sel ? COLORS.symbolSel : COLORS.symbol;
    drawSymbolPrims(batch, sym, c.x, c.y, c.rotation, c.flipped, baseColor, 2.5);

    if (c.kind === 'led' && sim?.ok) {
      const i = sim.branchCurrents.get(c.id);
      if (i !== undefined && i > 1e-6) {
        const triLocal = [1.5, -0.8, 1.5, 0.8, 2.5, 0];
        const out: number[] = [];
        for (let k = 0; k < triLocal.length; k += 2) {
          const t = transformPoint(triLocal[k], triLocal[k+1], c.rotation, c.flipped);
          out.push(c.x + t.x, c.y + t.y);
        }
        batch.addPolyFill(out, COLORS.led_on);
      }
    }

    for (const p of sym.pins) {
      const wp = pinWorld(c, p.x, p.y);
      batch.addDisc(wp.x, wp.y, 0.16, COLORS.pin, 12);
    }
  }
}

function drawWire(batch: ShapeBatch, w: Wire): void {
  for (let i = 0; i < w.points.length - 1; i++) {
    batch.addLine(w.points[i].x, w.points[i].y, w.points[i+1].x, w.points[i+1].y, COLORS.wire, 2.5);
  }
}

function drawSymbolPrims(
  batch: ShapeBatch,
  sym: SymbolSpec,
  cx: number,
  cy: number,
  rotation: ComponentInstance['rotation'],
  flipped: boolean,
  color: RGBA,
  widthPx: number,
): void {
  const tr = (lx: number, ly: number) => {
    const t = transformPoint(lx, ly, rotation, flipped);
    return { x: cx + t.x, y: cy + t.y };
  };

  for (const p of sym.prims) {
    drawPrim(batch, p, tr, color, widthPx);
  }
}

function drawPrim(
  batch: ShapeBatch,
  p: Prim,
  tr: (x: number, y: number) => { x: number; y: number },
  color: RGBA,
  widthPx: number,
): void {
  if (p.type === 'line') {
    const a = tr(p.x1, p.y1), b = tr(p.x2, p.y2);
    batch.addLine(a.x, a.y, b.x, b.y, color, widthPx);
  } else if (p.type === 'poly') {
    const out: number[] = [];
    for (let i = 0; i < p.pts.length; i += 2) {
      const t = tr(p.pts[i], p.pts[i+1]);
      out.push(t.x, t.y);
    }
    if (p.closed) {
      batch.addPolyFill(out, color);
      batch.addPolyline(out, color, widthPx, true);
    } else {
      batch.addPolyline(out, color, widthPx, false);
    }
  } else if (p.type === 'circle') {
    const c = tr(p.cx, p.cy);
    if (p.fill) batch.addDisc(c.x, c.y, p.r, color, 16);
    else batch.addCircle(c.x, c.y, p.r, color, widthPx, 24);
  } else if (p.type === 'arc') {
    const segs = 16;
    const da = (p.a1 - p.a0) / segs;
    let prev = tr(p.cx + Math.cos(p.a0) * p.r, p.cy + Math.sin(p.a0) * p.r);
    for (let i = 1; i <= segs; i++) {
      const a = p.a0 + i * da;
      const next = tr(p.cx + Math.cos(a) * p.r, p.cy + Math.sin(a) * p.r);
      batch.addLine(prev.x, prev.y, next.x, next.y, color, widthPx);
      prev = next;
    }
  }
}

function shortId(id: string): string {
  return id.slice(-3);
}

function formatValue(c: ComponentInstance, sym: SymbolSpec): string {
  if (c.kind === 'switch') return c.value >= 0.5 ? 'closed' : 'open';
  if (c.kind === 'npn' || c.kind === 'pnp') return `β=${c.value}`;
  if (c.kind === 'nmos' || c.kind === 'pmos') return `Vth=${c.value}V`;
  if (c.kind === 'ground') return '';
  return formatSI(c.value, sym.unit);
}

function formatSI(value: number, unit: string): string {
  if (!isFinite(value)) return '—';
  const a = Math.abs(value);
  if (a === 0) return `0${unit}`;
  const prefixes = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ] as const;
  for (const [scale, p] of prefixes) {
    if (a >= scale) {
      const v = value / scale;
      const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
      return `${s}${p}${unit}`;
    }
  }
  return `${value.toExponential(2)}${unit}`;
}

function formatCurrent(i: number): string {
  return `I=${formatSI(Math.abs(i), 'A')}`;
}

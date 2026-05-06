/** A batched buffer of colored "thick lines" and filled triangles in world space.
 *  Lines are expanded to quads in JS so we work around WebGL's 1px line limit
 *  consistently across mobile GPUs. */

export type RGBA = [number, number, number, number];

export class ShapeBatch {
  /** Per-vertex layout: x, y, r, g, b, a -> 6 floats. */
  private positions: number[] = [];
  /** Per-vertex screen-space normal offsets in pixels: nx, ny -> 2 floats. */
  private normals: number[] = [];
  /** Per-vertex screen-space "extra" half-width in pixels (0 for fills). */
  private widths: number[] = [];
  private indices: number[] = [];
  private vertexCount = 0;

  reset(): void {
    this.positions.length = 0;
    this.normals.length = 0;
    this.widths.length = 0;
    this.indices.length = 0;
    this.vertexCount = 0;
  }

  /** Push a single vertex with world position, screen-space offset normal, and color. */
  private vertex(x: number, y: number, nx: number, ny: number, halfWidthPx: number, color: RGBA): number {
    this.positions.push(x, y, color[0], color[1], color[2], color[3]);
    this.normals.push(nx, ny);
    this.widths.push(halfWidthPx);
    return this.vertexCount++;
  }

  /** Add a straight thick line segment in world coords with screen-space width in px. */
  addLine(x1: number, y1: number, x2: number, y2: number, color: RGBA, widthPx = 2): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal (perpendicular) in world direction; renderer scales by zoom for screen-space.
    const nx = -dy / len;
    const ny = dx / len;
    const half = widthPx * 0.5;
    const a = this.vertex(x1, y1, nx, ny, half, color);
    const b = this.vertex(x1, y1, -nx, -ny, half, color);
    const c = this.vertex(x2, y2, -nx, -ny, half, color);
    const d = this.vertex(x2, y2, nx, ny, half, color);
    this.indices.push(a, b, c, a, c, d);
  }

  /** Connected polyline (no joins, just consecutive segments). Closed if `closed`. */
  addPolyline(pts: ArrayLike<number>, color: RGBA, widthPx = 2, closed = false): void {
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      this.addLine(pts[i*2], pts[i*2+1], pts[(i+1)*2], pts[(i+1)*2+1], color, widthPx);
    }
    if (closed && n > 1) {
      this.addLine(pts[(n-1)*2], pts[(n-1)*2+1], pts[0], pts[1], color, widthPx);
    }
  }

  /** Stroked circle (32 segments). */
  addCircle(cx: number, cy: number, r: number, color: RGBA, widthPx = 2, segments = 32): void {
    const step = (Math.PI * 2) / segments;
    let px = cx + r, py = cy;
    for (let i = 1; i <= segments; i++) {
      const a = i * step;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      this.addLine(px, py, x, y, color, widthPx);
      px = x; py = y;
    }
  }

  addArc(cx: number, cy: number, r: number, a0: number, a1: number, color: RGBA, widthPx = 2, segments = 16): void {
    const step = (a1 - a0) / segments;
    let px = cx + Math.cos(a0) * r;
    let py = cy + Math.sin(a0) * r;
    for (let i = 1; i <= segments; i++) {
      const a = a0 + i * step;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      this.addLine(px, py, x, y, color, widthPx);
      px = x; py = y;
    }
  }

  /** Filled disc tessellated as triangle fan (no screen-space stroke). */
  addDisc(cx: number, cy: number, r: number, color: RGBA, segments = 24): void {
    const center = this.vertex(cx, cy, 0, 0, 0, color);
    const first = this.vertex(cx + r, cy, 0, 0, 0, color);
    let prev = first;
    const step = (Math.PI * 2) / segments;
    for (let i = 1; i <= segments; i++) {
      const a = i * step;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const v = (i === segments) ? first : this.vertex(x, y, 0, 0, 0, color);
      this.indices.push(center, prev, v);
      prev = v;
    }
  }

  /** Filled convex polygon (triangle fan). */
  addPolyFill(pts: ArrayLike<number>, color: RGBA): void {
    const n = pts.length / 2;
    if (n < 3) return;
    const i0 = this.vertex(pts[0], pts[1], 0, 0, 0, color);
    let prev = this.vertex(pts[2], pts[3], 0, 0, 0, color);
    for (let i = 2; i < n; i++) {
      const v = this.vertex(pts[i*2], pts[i*2+1], 0, 0, 0, color);
      this.indices.push(i0, prev, v);
      prev = v;
    }
  }

  positionsArray(): Float32Array { return new Float32Array(this.positions); }
  normalsArray(): Float32Array { return new Float32Array(this.normals); }
  widthsArray(): Float32Array { return new Float32Array(this.widths); }
  indicesArray(): Uint32Array { return new Uint32Array(this.indices); }
  count(): number { return this.indices.length; }
}

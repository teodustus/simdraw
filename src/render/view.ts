/** Pan/zoom state mapping world (grid) coords <-> screen pixels. */
export class View {
  /** translation in CSS pixels */
  tx = 0;
  ty = 0;
  /** zoom: pixels per grid unit. 1 grid unit = GRID_SPACING world units. */
  zoom = 24;

  /** world (grid) unit -> screen pixel */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.zoom + this.tx, y: wy * this.zoom + this.ty };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.tx) / this.zoom, y: (sy - this.ty) / this.zoom };
  }

  /** Round a world coordinate to nearest grid integer. */
  snap(x: number): number {
    return Math.round(x);
  }

  /** Zoom keeping a screen point fixed in world space. */
  zoomAt(sx: number, sy: number, factor: number, min = 8, max = 120): void {
    const next = Math.max(min, Math.min(max, this.zoom * factor));
    if (next === this.zoom) return;
    const w = this.screenToWorld(sx, sy);
    this.zoom = next;
    const after = this.worldToScreen(w.x, w.y);
    this.tx += sx - after.x;
    this.ty += sy - after.y;
  }
}

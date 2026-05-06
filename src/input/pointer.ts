import { View } from '../render/view';

export type Tool = 'select' | 'place' | 'wire' | 'erase';

export interface PointerHandler {
  onTap(wx: number, wy: number, tap: TapInfo): void;
  onLongPress(wx: number, wy: number): void;
  onDragStart(wx: number, wy: number): void;
  onDragMove(wx: number, wy: number): void;
  onDragEnd(wx: number, wy: number): void;
  onHover(wx: number, wy: number): void;
  /** triggered for every UI change to ensure a render */
  onChange(): void;
}

export interface TapInfo {
  /** screen pixel coordinates */
  sx: number;
  sy: number;
}

interface ActivePointer {
  id: number;
  startSx: number;
  startSy: number;
  sx: number;
  sy: number;
  startTime: number;
  /** world coords */
  wx: number;
  wy: number;
  movedBeyondSlop: boolean;
}

const TAP_SLOP_PX = 10;
const LONG_PRESS_MS = 450;
const TAP_MAX_MS = 250;

export class PointerInput {
  private pointers = new Map<number, ActivePointer>();
  private dragging = false;
  /** in two-finger gesture mode (pan/zoom) */
  private gesture: null | { lastDist: number; lastMid: { x: number; y: number } } = null;
  private longPressTimer: number | null = null;

  constructor(
    private el: HTMLElement,
    private view: View,
    private handler: PointerHandler,
  ) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
    el.addEventListener('pointerleave', this.onUp, { passive: false });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  detach(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('pointerleave', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
  }

  private toWorld(e: PointerEvent | { clientX: number; clientY: number }): { sx: number; sy: number; wx: number; wy: number } {
    const rect = this.el.getBoundingClientRect();
    const sx = (e as { clientX: number }).clientX - rect.left;
    const sy = (e as { clientY: number }).clientY - rect.top;
    const w = this.view.screenToWorld(sx, sy);
    return { sx, sy, wx: w.x, wy: w.y };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button > 0 && e.pointerType !== 'touch') return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const { sx, sy, wx, wy } = this.toWorld(e);
    const p: ActivePointer = {
      id: e.pointerId,
      startSx: sx, startSy: sy,
      sx, sy,
      startTime: performance.now(),
      wx, wy,
      movedBeyondSlop: false,
    };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      this.cancelLongPress();
      const [p1, p2] = Array.from(this.pointers.values());
      this.gesture = {
        lastDist: Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy),
        lastMid: { x: (p1.sx + p2.sx) / 2, y: (p1.sy + p2.sy) / 2 },
      };
      if (this.dragging) {
        this.handler.onDragEnd(p.wx, p.wy);
        this.dragging = false;
      }
    } else if (this.pointers.size === 1) {
      // Schedule long-press
      this.longPressTimer = window.setTimeout(() => {
        const cur = this.pointers.get(e.pointerId);
        if (cur && !cur.movedBeyondSlop && !this.dragging) {
          this.handler.onLongPress(cur.wx, cur.wy);
          this.handler.onChange();
        }
        this.longPressTimer = null;
      }, LONG_PRESS_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
    e.preventDefault();
    const p = this.pointers.get(e.pointerId);
    const { sx, sy, wx, wy } = this.toWorld(e);
    if (!p) {
      this.handler.onHover(wx, wy);
      return;
    }
    p.sx = sx; p.sy = sy; p.wx = wx; p.wy = wy;
    const dx = sx - p.startSx;
    const dy = sy - p.startSy;
    if (!p.movedBeyondSlop && Math.hypot(dx, dy) > TAP_SLOP_PX) {
      p.movedBeyondSlop = true;
      this.cancelLongPress();
    }

    if (this.pointers.size === 2 && this.gesture) {
      const [p1, p2] = Array.from(this.pointers.values());
      const dist = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
      const mid = { x: (p1.sx + p2.sx) / 2, y: (p1.sy + p2.sy) / 2 };
      const factor = dist / Math.max(this.gesture.lastDist, 1e-6);
      this.view.zoomAt(mid.x, mid.y, factor);
      this.view.tx += mid.x - this.gesture.lastMid.x;
      this.view.ty += mid.y - this.gesture.lastMid.y;
      this.gesture.lastDist = dist;
      this.gesture.lastMid = mid;
      this.handler.onChange();
      return;
    }

    if (this.pointers.size === 1 && p.movedBeyondSlop) {
      if (!this.dragging) {
        this.dragging = true;
        this.handler.onDragStart(p.wx, p.wy);
      }
      this.handler.onDragMove(p.wx, p.wy);
      this.handler.onChange();
    } else {
      this.handler.onHover(p.wx, p.wy);
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    this.el.releasePointerCapture?.(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();

    if (this.gesture && this.pointers.size < 2) {
      this.gesture = null;
      // Don't fire tap when ending a multitouch gesture
      this.handler.onChange();
      return;
    }

    if (this.dragging) {
      this.handler.onDragEnd(p.wx, p.wy);
      this.dragging = false;
      this.handler.onChange();
      return;
    }

    if (!p.movedBeyondSlop && performance.now() - p.startTime < TAP_MAX_MS) {
      this.handler.onTap(p.wx, p.wy, { sx: p.sx, sy: p.sy });
      this.handler.onChange();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.view.zoomAt(sx, sy, factor);
    this.handler.onChange();
  };

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}

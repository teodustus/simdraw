import type { CircuitDoc, ComponentInstance, ComponentKind, Rotation, Wire } from './types';
import { getSymbol } from '../symbols/library';
import { pinWorld } from '../render/transform';

let counter = 0;
const TIME_BASE = Date.now();

export function nextId(prefix: string): string {
  counter++;
  return `${prefix}_${(TIME_BASE % 1e6).toString(36)}${counter.toString(36)}`;
}

export function makeComponent(
  kind: ComponentKind,
  x: number,
  y: number,
  rotation: Rotation = 0,
  flipped = false,
): ComponentInstance {
  const sym = getSymbol(kind);
  return {
    id: nextId(kind),
    kind,
    x: Math.round(x),
    y: Math.round(y),
    rotation,
    flipped,
    value: sym.defaultValue,
  };
}

export function bboxOfComponentWorld(c: ComponentInstance): { x: number; y: number; w: number; h: number } {
  const sym = getSymbol(c.kind);
  const corners = [
    [sym.bbox.minX, sym.bbox.minY],
    [sym.bbox.maxX, sym.bbox.minY],
    [sym.bbox.maxX, sym.bbox.maxY],
    [sym.bbox.minX, sym.bbox.maxY],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lx, ly] of corners) {
    const wp = pinWorld(c, lx, ly);
    if (wp.x < minX) minX = wp.x;
    if (wp.x > maxX) maxX = wp.x;
    if (wp.y < minY) minY = wp.y;
    if (wp.y > maxY) maxY = wp.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Does a world-space (px) coordinate hit this component's bounding box?
 *  bbox is expanded by `padding` grid units to ease touch use. */
export function hitComponent(c: ComponentInstance, wx: number, wy: number, padding = 0.5): boolean {
  const b = bboxOfComponentWorld(c);
  return wx >= b.x - padding && wx <= b.x + b.w + padding && wy >= b.y - padding && wy <= b.y + b.h + padding;
}

export function rotateCW(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

export function findComponentAt(doc: CircuitDoc, wx: number, wy: number, padding = 0.5): ComponentInstance | null {
  for (let i = doc.components.length - 1; i >= 0; i--) {
    const c = doc.components[i];
    if (hitComponent(c, wx, wy, padding)) return c;
  }
  return null;
}

export function findPinAt(doc: CircuitDoc, wx: number, wy: number, tolerance = 0.5): { component: ComponentInstance; pinName: string; x: number; y: number } | null {
  let best: { component: ComponentInstance; pinName: string; x: number; y: number; d: number } | null = null;
  for (const c of doc.components) {
    const sym = getSymbol(c.kind);
    for (const p of sym.pins) {
      const wp = pinWorld(c, p.x, p.y);
      const d = Math.hypot(wp.x - wx, wp.y - wy);
      if (d <= tolerance && (!best || d < best.d)) {
        best = { component: c, pinName: p.name, x: Math.round(wp.x), y: Math.round(wp.y), d };
      }
    }
  }
  return best;
}

export function addWireSegment(doc: CircuitDoc, wire: Wire, p: { x: number; y: number }): void {
  const last = wire.points[wire.points.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  if (last && last.x !== p.x && last.y !== p.y) {
    // Insert L-shape: push intermediate corner first
    wire.points.push({ x: p.x, y: last.y });
  }
  wire.points.push({ x: p.x, y: p.y });
  if (!doc.wires.includes(wire)) doc.wires.push(wire);
}

export function startWire(start: { x: number; y: number }): Wire {
  return { id: nextId('w'), points: [{ x: start.x, y: start.y }] };
}

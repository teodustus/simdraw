import type { CircuitDoc, ComponentInstance, Wire } from '../circuit/types';
import { getSymbol } from '../symbols/library';
import { pinWorld } from '../render/transform';

export interface PinRef {
  componentId: string;
  pinName: string;
  /** integer grid coords of the pin */
  x: number;
  y: number;
}

export interface Netlist {
  /** map "x,y" -> netId (a representative grid key) */
  pointToNet: Map<string, string>;
  /** netId -> list of pins on that net */
  nets: Map<string, PinRef[]>;
  /** netId for each component pin: key "componentId|pinName" */
  pinNets: Map<string, string>;
  /** true junction points (3+ wire segments meeting OR wire-meets-pin midpoint) */
  junctions: Array<{ x: number; y: number }>;
  /** the netId selected as ground (or null if no ground component placed) */
  groundNet: string | null;
}

const key = (x: number, y: number) => `${x},${y}`;

/* ---------- Union-Find on string keys ---------- */
class UF {
  parent = new Map<string, string>();
  rank = new Map<string, number>();
  add(k: string): void {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      this.rank.set(k, 0);
    }
  }
  find(k: string): string {
    let p = this.parent.get(k);
    if (p === undefined) { this.add(k); return k; }
    while (true) {
      const next = this.parent.get(p) as string;
      if (next === p) break;
      const gp = this.parent.get(next) as string;
      this.parent.set(p, gp);
      p = gp;
    }
    this.parent.set(k, p);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    const sa = this.rank.get(ra)!;
    const sb = this.rank.get(rb)!;
    if (sa < sb) this.parent.set(ra, rb);
    else if (sa > sb) this.parent.set(rb, ra);
    else { this.parent.set(rb, ra); this.rank.set(ra, sa + 1); }
  }
}

/** Walk integer points from (x1,y1) to (x2,y2) along axis-aligned segment.
 *  If diagonal, just emits endpoints (we still rely on snap-to-grid in input). */
function* walk(x1: number, y1: number, x2: number, y2: number): Generator<{ x: number; y: number }> {
  const ix1 = Math.round(x1), iy1 = Math.round(y1);
  const ix2 = Math.round(x2), iy2 = Math.round(y2);
  if (ix1 === ix2 && iy1 === iy2) { yield { x: ix1, y: iy1 }; return; }
  if (ix1 === ix2) {
    const sy = iy1 < iy2 ? 1 : -1;
    for (let y = iy1; y !== iy2; y += sy) yield { x: ix1, y };
    yield { x: ix1, y: iy2 };
    return;
  }
  if (iy1 === iy2) {
    const sx = ix1 < ix2 ? 1 : -1;
    for (let x = ix1; x !== ix2; x += sx) yield { x, y: iy1 };
    yield { x: ix2, y: iy1 };
    return;
  }
  // Diagonal: just endpoints
  yield { x: ix1, y: iy1 };
  yield { x: ix2, y: iy2 };
}

export function buildNetlist(doc: CircuitDoc): Netlist {
  const uf = new UF();
  const allPins: PinRef[] = [];
  const pinKeysByPin: string[] = []; // parallel to allPins

  // Component pins
  for (const c of doc.components) {
    const sym = getSymbol(c.kind);
    for (const p of sym.pins) {
      const wp = pinWorld(c, p.x, p.y);
      const ix = Math.round(wp.x), iy = Math.round(wp.y);
      const k = key(ix, iy);
      uf.add(k);
      const ref: PinRef = { componentId: c.id, pinName: p.name, x: ix, y: iy };
      allPins.push(ref);
      pinKeysByPin.push(k);
    }
  }

  // Wires: union along all integer points
  // Also count segment endpoints/throughs for junction detection.
  const segHits = new Map<string, number>(); // count of segment endpoints meeting at point
  const throughCount = new Map<string, number>(); // count of "through" passes (pin lies on midpoint of a wire)
  for (const w of doc.wires) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i+1];
      const pts = Array.from(walk(a.x, a.y, b.x, b.y));
      // Increment endpoint counts at segment ends
      const ka = key(pts[0].x, pts[0].y);
      const kb = key(pts[pts.length-1].x, pts[pts.length-1].y);
      segHits.set(ka, (segHits.get(ka) || 0) + 1);
      segHits.set(kb, (segHits.get(kb) || 0) + 1);
      // Track interior points so pins can latch onto them
      for (let j = 0; j < pts.length; j++) {
        const k = key(pts[j].x, pts[j].y);
        uf.add(k);
        if (j > 0) uf.union(key(pts[j-1].x, pts[j-1].y), k);
        if (j > 0 && j < pts.length - 1) {
          throughCount.set(k, (throughCount.get(k) || 0) + 1);
        }
      }
    }
  }

  // Find ground net
  let groundKey: string | null = null;
  for (const c of doc.components) {
    if (c.kind === 'ground') {
      const sym = getSymbol(c.kind);
      const wp = pinWorld(c, sym.pins[0].x, sym.pins[0].y);
      groundKey = key(Math.round(wp.x), Math.round(wp.y));
      break;
    }
  }

  // Build nets map
  const nets = new Map<string, PinRef[]>();
  const pinNets = new Map<string, string>();
  for (let i = 0; i < allPins.length; i++) {
    const ref = allPins[i];
    const root = uf.find(pinKeysByPin[i]);
    let arr = nets.get(root);
    if (!arr) { arr = []; nets.set(root, arr); }
    arr.push(ref);
    pinNets.set(`${ref.componentId}|${ref.pinName}`, root);
  }

  const groundNet = groundKey ? uf.find(groundKey) : null;

  // pointToNet for every grid point we know
  const pointToNet = new Map<string, string>();
  for (const k of uf.parent.keys()) {
    pointToNet.set(k, uf.find(k));
  }

  // Junctions: any point with more than 2 segment hits, OR any pin-on-wire intersection,
  // OR any point where wire endpoints touch a pin location.
  const junctions: Array<{ x: number; y: number }> = [];
  const pinKeySet = new Set(pinKeysByPin);
  for (const [k, count] of segHits) {
    if (count >= 3) {
      const [x, y] = k.split(',').map(Number);
      junctions.push({ x, y });
    } else if (count >= 1 && pinKeySet.has(k) && pinsAt(allPins, k).length === 1 && segHits.get(k)! >= 2) {
      // wire endpoint on a single pin already shows the pin disc; skip duplicate
    }
  }
  // Pins lying on a wire mid-point ("through") create T-junction visual marker
  for (const [k, count] of throughCount) {
    if (count >= 1 && pinKeySet.has(k)) {
      const [x, y] = k.split(',').map(Number);
      junctions.push({ x, y });
    }
  }

  return {
    pointToNet,
    nets,
    pinNets,
    junctions,
    groundNet,
  };
}

function pinsAt(allPins: PinRef[], k: string): PinRef[] {
  return allPins.filter(p => key(p.x, p.y) === k);
}

/** Helper: net of a specific pin */
export function netOf(nl: Netlist, c: ComponentInstance, pinName: string): string | undefined {
  return nl.pinNets.get(`${c.id}|${pinName}`);
}

/** Whether two wires would extend each other (both pass through point p). Used by editor. */
export function wirePointsAt(wires: Wire[], x: number, y: number): boolean {
  for (const w of wires) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i+1];
      for (const p of walk(a.x, a.y, b.x, b.y)) {
        if (p.x === x && p.y === y) return true;
      }
    }
  }
  return false;
}

import type { ComponentKind } from '../circuit/types';

/**
 * Symbols are defined in a local "symbol grid" with 1 unit = 1 grid cell.
 * The symbol's origin (0,0) sits on a grid point. Pin positions are integer
 * grid coordinates relative to origin and snap cleanly to the world grid.
 *
 * Drawings are vector primitives: lines, polylines, circles, arcs, triangles.
 * The renderer flattens them into batched buffers.
 */

export interface PinSpec {
  name: string;
  /** electrical role used by simulator */
  role?: 'plus' | 'minus' | 'gate' | 'base' | 'collector' | 'emitter' | 'drain' | 'source' | 'a' | 'b' | 'gnd' | 'vcc';
  x: number;
  y: number;
}

export type Prim =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'poly'; pts: number[]; closed?: boolean }
  | { type: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { type: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number };

export interface SymbolSpec {
  kind: ComponentKind;
  name: string;
  /** default value (ohms, volts, farads, henries) */
  defaultValue: number;
  /** SI unit suffix for display */
  unit: string;
  /** designator prefix (R, C, L, V, D, ...) */
  designator: string;
  pins: PinSpec[];
  prims: Prim[];
  /** bounding box in grid units, used for hit-testing and palette */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

const TAU = Math.PI * 2;

function bboxFromPrims(pins: PinSpec[], prims: Prim[]): SymbolSpec['bbox'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of pins) ext(p.x, p.y);
  for (const p of prims) {
    if (p.type === 'line') { ext(p.x1, p.y1); ext(p.x2, p.y2); }
    else if (p.type === 'poly') {
      for (let i = 0; i < p.pts.length; i += 2) ext(p.pts[i], p.pts[i+1]);
    }
    else if (p.type === 'circle' || p.type === 'arc') {
      ext(p.cx - p.r, p.cy - p.r); ext(p.cx + p.r, p.cy + p.r);
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  return { minX, minY, maxX, maxY };
}

function mk(spec: Omit<SymbolSpec, 'bbox'>): SymbolSpec {
  return { ...spec, bbox: bboxFromPrims(spec.pins, spec.prims) };
}

/* --------------------------- Symbol definitions --------------------------- */
/* All symbols are 4 grid units long horizontally, with pins at x=0 and x=4. */

const RESISTOR: SymbolSpec = mk({
  kind: 'resistor',
  name: 'Resistor',
  defaultValue: 1000,
  unit: 'Ω',
  designator: 'R',
  pins: [
    { name: '1', role: 'a', x: 0, y: 0 },
    { name: '2', role: 'b', x: 4, y: 0 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
    { type: 'line', x1: 3, y1: 0, x2: 4, y2: 0 },
    // zigzag
    { type: 'poly', pts: [
      1, 0, 1.25, -0.5, 1.5, 0.5, 1.75, -0.5, 2, 0.5, 2.25, -0.5, 2.5, 0.5, 2.75, -0.5, 3, 0,
    ] },
  ],
});

const CAPACITOR: SymbolSpec = mk({
  kind: 'capacitor',
  name: 'Capacitor',
  defaultValue: 1e-6,
  unit: 'F',
  designator: 'C',
  pins: [
    { name: '1', role: 'a', x: 0, y: 0 },
    { name: '2', role: 'b', x: 4, y: 0 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.85, y2: 0 },
    { type: 'line', x1: 2.15, y1: 0, x2: 4, y2: 0 },
    { type: 'line', x1: 1.85, y1: -0.8, x2: 1.85, y2: 0.8 },
    { type: 'line', x1: 2.15, y1: -0.8, x2: 2.15, y2: 0.8 },
  ],
});

const INDUCTOR: SymbolSpec = mk({
  kind: 'inductor',
  name: 'Inductor',
  defaultValue: 1e-3,
  unit: 'H',
  designator: 'L',
  pins: [
    { name: '1', role: 'a', x: 0, y: 0 },
    { name: '2', role: 'b', x: 4, y: 0 },
  ],
  prims: (() => {
    const ps: Prim[] = [
      { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
      { type: 'line', x1: 3, y1: 0, x2: 4, y2: 0 },
    ];
    for (let i = 0; i < 4; i++) {
      ps.push({ type: 'arc', cx: 1.25 + i * 0.5, cy: 0, r: 0.25, a0: Math.PI, a1: 0 });
    }
    return ps;
  })(),
});

const BATTERY: SymbolSpec = mk({
  kind: 'battery',
  name: 'Battery',
  defaultValue: 9,
  unit: 'V',
  designator: 'V',
  pins: [
    { name: '+', role: 'plus', x: 0, y: 0 },
    { name: '-', role: 'minus', x: 4, y: 0 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.7, y2: 0 },
    { type: 'line', x1: 2.3, y1: 0, x2: 4, y2: 0 },
    // long plate (+)
    { type: 'line', x1: 1.7, y1: -1, x2: 1.7, y2: 1 },
    // short plate (-)
    { type: 'line', x1: 2.3, y1: -0.5, x2: 2.3, y2: 0.5 },
    // little + sign
    { type: 'line', x1: 1.2, y1: -1.4, x2: 1.6, y2: -1.4 },
    { type: 'line', x1: 1.4, y1: -1.6, x2: 1.4, y2: -1.2 },
  ],
});

const LED: SymbolSpec = mk({
  kind: 'led',
  name: 'LED',
  defaultValue: 2.0, // Vf typical
  unit: 'V',
  designator: 'D',
  pins: [
    { name: 'A', role: 'plus', x: 0, y: 0 },   // anode
    { name: 'K', role: 'minus', x: 4, y: 0 },  // cathode
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.5, y2: 0 },
    { type: 'line', x1: 2.5, y1: 0, x2: 4, y2: 0 },
    // triangle pointing right
    { type: 'poly', pts: [1.5, -0.8, 1.5, 0.8, 2.5, 0], closed: true },
    // cathode bar
    { type: 'line', x1: 2.5, y1: -0.8, x2: 2.5, y2: 0.8 },
    // emission arrows
    { type: 'line', x1: 1.6, y1: -1.3, x2: 2.2, y2: -1.9 },
    { type: 'line', x1: 2.2, y1: -1.9, x2: 1.95, y2: -1.7 },
    { type: 'line', x1: 2.2, y1: -1.9, x2: 2.0, y2: -2.0 },
    { type: 'line', x1: 2.1, y1: -1.3, x2: 2.7, y2: -1.9 },
    { type: 'line', x1: 2.7, y1: -1.9, x2: 2.45, y2: -1.7 },
    { type: 'line', x1: 2.7, y1: -1.9, x2: 2.5, y2: -2.0 },
  ],
});

const DIODE: SymbolSpec = mk({
  kind: 'diode',
  name: 'Diode',
  defaultValue: 0.7,
  unit: 'V',
  designator: 'D',
  pins: [
    { name: 'A', role: 'plus', x: 0, y: 0 },
    { name: 'K', role: 'minus', x: 4, y: 0 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.5, y2: 0 },
    { type: 'line', x1: 2.5, y1: 0, x2: 4, y2: 0 },
    { type: 'poly', pts: [1.5, -0.8, 1.5, 0.8, 2.5, 0], closed: true },
    { type: 'line', x1: 2.5, y1: -0.8, x2: 2.5, y2: 0.8 },
  ],
});

const SWITCH: SymbolSpec = mk({
  kind: 'switch',
  name: 'Switch',
  defaultValue: 0, // 0 = open, 1 = closed
  unit: '',
  designator: 'SW',
  pins: [
    { name: '1', role: 'a', x: 0, y: 0 },
    { name: '2', role: 'b', x: 4, y: 0 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
    { type: 'line', x1: 3, y1: 0, x2: 4, y2: 0 },
    { type: 'circle', cx: 1, cy: 0, r: 0.18, fill: true },
    { type: 'circle', cx: 3, cy: 0, r: 0.18, fill: true },
    // open lever (drawn upward to indicate "off"); state shown via overlay
    { type: 'line', x1: 1, y1: 0, x2: 2.8, y2: -1.2 },
  ],
});

const GROUND: SymbolSpec = mk({
  kind: 'ground',
  name: 'Ground',
  defaultValue: 0,
  unit: '',
  designator: 'GND',
  pins: [{ name: '1', role: 'gnd', x: 0, y: 0 }],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 0, y2: 1 },
    { type: 'line', x1: -1.2, y1: 1, x2: 1.2, y2: 1 },
    { type: 'line', x1: -0.8, y1: 1.4, x2: 0.8, y2: 1.4 },
    { type: 'line', x1: -0.4, y1: 1.8, x2: 0.4, y2: 1.8 },
  ],
});

const VCC: SymbolSpec = mk({
  kind: 'vcc',
  name: 'Vcc',
  defaultValue: 5,
  unit: 'V',
  designator: 'VCC',
  pins: [{ name: '1', role: 'vcc', x: 0, y: 0 }],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 0, y2: -1 },
    { type: 'circle', cx: 0, cy: -1.4, r: 0.4 },
  ],
});

// NPN bipolar transistor: pins at C(top), B(left), E(bottom)
const NPN: SymbolSpec = mk({
  kind: 'npn',
  name: 'NPN',
  defaultValue: 100, // beta
  unit: '',
  designator: 'Q',
  pins: [
    { name: 'C', role: 'collector', x: 3, y: -2 },
    { name: 'B', role: 'base', x: 0, y: 0 },
    { name: 'E', role: 'emitter', x: 3, y: 2 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.5, y2: 0 },
    { type: 'line', x1: 1.5, y1: -1, x2: 1.5, y2: 1 },
    { type: 'circle', cx: 2.2, cy: 0, r: 1.4 },
    { type: 'line', x1: 1.5, y1: -0.5, x2: 3, y2: -2 },
    { type: 'line', x1: 1.5, y1: 0.5, x2: 3, y2: 2 },
    // arrow on emitter pointing OUT (NPN)
    { type: 'poly', pts: [2.6, 1.4, 2.95, 1.95, 2.3, 1.7], closed: true },
  ],
});

const PNP: SymbolSpec = mk({
  kind: 'pnp',
  name: 'PNP',
  defaultValue: 100,
  unit: '',
  designator: 'Q',
  pins: [
    { name: 'C', role: 'collector', x: 3, y: 2 },
    { name: 'B', role: 'base', x: 0, y: 0 },
    { name: 'E', role: 'emitter', x: 3, y: -2 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.5, y2: 0 },
    { type: 'line', x1: 1.5, y1: -1, x2: 1.5, y2: 1 },
    { type: 'circle', cx: 2.2, cy: 0, r: 1.4 },
    { type: 'line', x1: 1.5, y1: -0.5, x2: 3, y2: -2 },
    { type: 'line', x1: 1.5, y1: 0.5, x2: 3, y2: 2 },
    // arrow on emitter pointing IN (PNP)
    { type: 'poly', pts: [1.7, -0.7, 2.1, -1.0, 2.0, -0.45], closed: true },
  ],
});

const NMOS: SymbolSpec = mk({
  kind: 'nmos',
  name: 'NMOS',
  defaultValue: 2, // Vth (V)
  unit: 'V',
  designator: 'M',
  pins: [
    { name: 'D', role: 'drain', x: 3, y: -2 },
    { name: 'G', role: 'gate', x: 0, y: 0 },
    { name: 'S', role: 'source', x: 3, y: 2 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.4, y2: 0 },
    { type: 'line', x1: 1.4, y1: -1.2, x2: 1.4, y2: 1.2 },
    { type: 'line', x1: 1.8, y1: -1.2, x2: 1.8, y2: -0.4 },
    { type: 'line', x1: 1.8, y1: -0.4, x2: 3, y2: -0.4 },
    { type: 'line', x1: 3, y1: -0.4, x2: 3, y2: -2 },
    { type: 'line', x1: 1.8, y1: 1.2, x2: 1.8, y2: 0.4 },
    { type: 'line', x1: 1.8, y1: 0.4, x2: 3, y2: 0.4 },
    { type: 'line', x1: 3, y1: 0.4, x2: 3, y2: 2 },
    // arrow on body pointing IN (NMOS)
    { type: 'poly', pts: [1.8, 0, 2.3, -0.25, 2.3, 0.25], closed: true },
  ],
});

const PMOS: SymbolSpec = mk({
  kind: 'pmos',
  name: 'PMOS',
  defaultValue: -2,
  unit: 'V',
  designator: 'M',
  pins: [
    { name: 'D', role: 'drain', x: 3, y: 2 },
    { name: 'G', role: 'gate', x: 0, y: 0 },
    { name: 'S', role: 'source', x: 3, y: -2 },
  ],
  prims: [
    { type: 'line', x1: 0, y1: 0, x2: 1.4, y2: 0 },
    { type: 'line', x1: 1.4, y1: -1.2, x2: 1.4, y2: 1.2 },
    { type: 'line', x1: 1.8, y1: -1.2, x2: 1.8, y2: -0.4 },
    { type: 'line', x1: 1.8, y1: -0.4, x2: 3, y2: -0.4 },
    { type: 'line', x1: 3, y1: -0.4, x2: 3, y2: -2 },
    { type: 'line', x1: 1.8, y1: 1.2, x2: 1.8, y2: 0.4 },
    { type: 'line', x1: 1.8, y1: 0.4, x2: 3, y2: 0.4 },
    { type: 'line', x1: 3, y1: 0.4, x2: 3, y2: 2 },
    // arrow on body pointing OUT (PMOS)
    { type: 'poly', pts: [2.3, 0, 1.8, -0.25, 1.8, 0.25], closed: true },
  ],
});

const MOTOR: SymbolSpec = mk({
  kind: 'motor',
  name: 'DC Motor',
  defaultValue: 5, // ohm winding resistance
  unit: 'Ω',
  designator: 'M',
  pins: [
    { name: '1', role: 'a', x: 0, y: 0 },
    { name: '2', role: 'b', x: 4, y: 0 },
  ],
  prims: (() => {
    const prims: Prim[] = [
      { type: 'line', x1: 0, y1: 0, x2: 0.6, y2: 0 },
      { type: 'line', x1: 3.4, y1: 0, x2: 4, y2: 0 },
      { type: 'circle', cx: 2, cy: 0, r: 1.4 },
    ];
    // letter "M"
    prims.push({ type: 'poly', pts: [1.4, 0.6, 1.4, -0.6, 2.0, 0.2, 2.6, -0.6, 2.6, 0.6] });
    return prims;
  })(),
});

const ALL: SymbolSpec[] = [
  BATTERY, SWITCH, RESISTOR, CAPACITOR, INDUCTOR, LED, DIODE,
  NPN, PNP, NMOS, PMOS, MOTOR, GROUND, VCC,
];

const BY_KIND = new Map<ComponentKind, SymbolSpec>(ALL.map(s => [s.kind, s]));

export function getSymbol(kind: ComponentKind): SymbolSpec {
  const s = BY_KIND.get(kind);
  if (!s) throw new Error(`unknown symbol: ${kind}`);
  return s;
}

export function allSymbols(): SymbolSpec[] {
  return ALL;
}

export { TAU };

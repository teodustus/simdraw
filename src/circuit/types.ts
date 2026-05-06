export type ComponentKind =
  | 'battery'
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'led'
  | 'diode'
  | 'switch'
  | 'npn'
  | 'pnp'
  | 'nmos'
  | 'pmos'
  | 'motor'
  | 'ground'
  | 'vcc';

export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentInstance {
  id: string;
  kind: ComponentKind;
  /** grid coordinates of the component anchor (origin of the symbol) */
  x: number;
  y: number;
  rotation: Rotation;
  flipped: boolean;
  /** primary numeric value (resistance, voltage, capacitance, ...) */
  value: number;
  /** optional human label like "R1", "BAT" */
  label?: string;
}

/** A wire is a chain of grid points connected by orthogonal segments. */
export interface Wire {
  id: string;
  points: Array<{ x: number; y: number }>;
}

export interface CircuitDoc {
  version: 1;
  components: ComponentInstance[];
  wires: Wire[];
  /** pan/zoom for the view, restored on load */
  view?: { tx: number; ty: number; zoom: number };
}

export function emptyDoc(): CircuitDoc {
  return { version: 1, components: [], wires: [] };
}

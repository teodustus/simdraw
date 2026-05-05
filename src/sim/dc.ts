import type { CircuitDoc, ComponentInstance } from '../circuit/types';
import { buildNetlist, netOf, type Netlist } from './netlist';
import { solve } from './linsolve';

export interface DCResult {
  ok: boolean;
  message?: string;
  /** netId -> voltage */
  nodeVoltages: Map<string, number>;
  /** componentId -> current (A) flowing from primary "+" pin (pin0) into the component */
  branchCurrents: Map<string, number>;
}

const R_OPEN = 1e9;     // very high resistance for "open" branches (1 GΩ)
const R_SHORT = 1e-3;   // very low resistance for closed switches / saturated transistors

const VBE_ON = 0.65;
const VCE_SAT = 0.2;

const VF_LED_DEFAULT = 2.0;
const VF_DIODE_DEFAULT = 0.7;

interface DeviceState {
  /** for diodes/LEDs: 'on' = forward, 'off' = blocking */
  /** for switches: 'closed' / 'open' */
  /** for BJTs: 'cutoff' / 'active' (linear gain) / 'saturation' */
  /** for MOSFETs: 'on' / 'off' (we collapse to switch for v1) */
  mode: string;
}

/** Compute DC operating point. Iterative: pick device states, build linear MNA, solve, refine. */
export function simulateDC(doc: CircuitDoc): DCResult {
  const nl = buildNetlist(doc);
  if (!nl.groundNet) {
    return {
      ok: false,
      message: 'Lägg till en jordsymbol (GND) för att kunna simulera.',
      nodeVoltages: new Map(),
      branchCurrents: new Map(),
    };
  }

  // Initial states
  const states = new Map<string, DeviceState>();
  for (const c of doc.components) {
    states.set(c.id, initialState(c));
  }

  let last: DCResult | null = null;
  for (let iter = 0; iter < 30; iter++) {
    const r = solveLinear(doc, nl, states);
    if (!r.ok) {
      return r;
    }
    const changed = updateStates(doc, nl, states, r);
    last = r;
    if (!changed) break;
  }
  return last ?? { ok: false, message: 'Kunde inte konvergera.', nodeVoltages: new Map(), branchCurrents: new Map() };
}

function initialState(c: ComponentInstance): DeviceState {
  switch (c.kind) {
    case 'switch':   return { mode: c.value >= 0.5 ? 'closed' : 'open' };
    case 'led':
    case 'diode':    return { mode: 'on' };
    case 'npn':
    case 'pnp':      return { mode: 'cutoff' };
    case 'nmos':
    case 'pmos':     return { mode: 'off' };
    default:         return { mode: 'n/a' };
  }
}

function solveLinear(doc: CircuitDoc, nl: Netlist, states: Map<string, DeviceState>): DCResult {
  // Assign indices to nets except ground
  const netIndex = new Map<string, number>();
  let nIdx = 0;
  for (const netId of nl.nets.keys()) {
    if (netId === nl.groundNet) continue;
    netIndex.set(netId, nIdx++);
  }

  // Voltage source extra variables
  type VSource = { plusNet: string; minusNet: string; V: number; ownerId: string };
  const vsources: VSource[] = [];

  // Resistive stamps
  const stamps: Array<{ a: string; b: string; G: number; ownerId: string }> = [];

  for (const c of doc.components) {
    const s = states.get(c.id)!;
    switch (c.kind) {
      case 'resistor': {
        const a = netOf(nl, c, '1'), b = netOf(nl, c, '2');
        if (!a || !b) break;
        stamps.push({ a, b, G: 1 / Math.max(c.value, 1e-9), ownerId: c.id });
        break;
      }
      case 'motor': {
        const a = netOf(nl, c, '1'), b = netOf(nl, c, '2');
        if (!a || !b) break;
        stamps.push({ a, b, G: 1 / Math.max(c.value, 1e-3), ownerId: c.id });
        break;
      }
      case 'capacitor': {
        // open at DC
        const a = netOf(nl, c, '1'), b = netOf(nl, c, '2');
        if (!a || !b) break;
        stamps.push({ a, b, G: 1 / R_OPEN, ownerId: c.id });
        break;
      }
      case 'inductor': {
        // short at DC
        const a = netOf(nl, c, '1'), b = netOf(nl, c, '2');
        if (!a || !b) break;
        stamps.push({ a, b, G: 1 / R_SHORT, ownerId: c.id });
        break;
      }
      case 'switch': {
        const a = netOf(nl, c, '1'), b = netOf(nl, c, '2');
        if (!a || !b) break;
        const G = s.mode === 'closed' ? 1 / R_SHORT : 1 / R_OPEN;
        stamps.push({ a, b, G, ownerId: c.id });
        break;
      }
      case 'led':
      case 'diode': {
        const a = netOf(nl, c, 'A'), b = netOf(nl, c, 'K');
        if (!a || !b) break;
        if (s.mode === 'on') {
          // Ideal PWL: V_A - V_K = Vf when conducting. Series resistance is
          // assumed by external parts of the circuit; adding a parallel R here
          // would force a huge constant current through the parallel branch
          // and ruin the model.
          const Vf = c.kind === 'led' ? (c.value || VF_LED_DEFAULT) : (c.value || VF_DIODE_DEFAULT);
          vsources.push({ plusNet: a, minusNet: b, V: Vf, ownerId: c.id });
        } else {
          stamps.push({ a, b, G: 1 / R_OPEN, ownerId: c.id });
        }
        break;
      }
      case 'battery': {
        const a = netOf(nl, c, '+'), b = netOf(nl, c, '-');
        if (!a || !b) break;
        vsources.push({ plusNet: a, minusNet: b, V: c.value, ownerId: c.id });
        break;
      }
      case 'vcc': {
        const a = netOf(nl, c, '1');
        if (!a) break;
        vsources.push({ plusNet: a, minusNet: nl.groundNet!, V: c.value, ownerId: c.id });
        break;
      }
      case 'ground': {
        // already used to find groundNet; nothing to stamp
        break;
      }
      case 'npn': {
        const C = netOf(nl, c, 'C');
        const B = netOf(nl, c, 'B');
        const E = netOf(nl, c, 'E');
        if (!C || !B || !E) break;
        if (s.mode === 'cutoff') {
          // all off: high resistance B-E and C-E
          stamps.push({ a: B, b: E, G: 1 / R_OPEN, ownerId: c.id + ':be' });
          stamps.push({ a: C, b: E, G: 1 / R_OPEN, ownerId: c.id + ':ce' });
        } else if (s.mode === 'saturation') {
          // VCE = VCE_SAT (VS), VBE = VBE_ON (VS)
          vsources.push({ plusNet: C, minusNet: E, V: VCE_SAT, ownerId: c.id });
          vsources.push({ plusNet: B, minusNet: E, V: VBE_ON, ownerId: c.id + ':be' });
        } else {
          // active: VBE = VBE_ON (VS), Ic = beta * Ib via dependent source.
          // For v1 we simplify to: VBE = VBE_ON (VS); collector behaves as current source proportional to base current,
          // but linear MNA can't add a CCCS without extension. Instead approximate with saturation if drive sufficient:
          // we leave 'active' empty and rely on iteration to land on saturation/cutoff. Treat as cutoff for stamping.
          stamps.push({ a: B, b: E, G: 1 / R_OPEN, ownerId: c.id + ':be' });
          stamps.push({ a: C, b: E, G: 1 / R_OPEN, ownerId: c.id + ':ce' });
        }
        break;
      }
      case 'pnp': {
        const C = netOf(nl, c, 'C');
        const B = netOf(nl, c, 'B');
        const E = netOf(nl, c, 'E');
        if (!C || !B || !E) break;
        if (s.mode === 'cutoff') {
          stamps.push({ a: E, b: B, G: 1 / R_OPEN, ownerId: c.id + ':eb' });
          stamps.push({ a: E, b: C, G: 1 / R_OPEN, ownerId: c.id + ':ec' });
        } else if (s.mode === 'saturation') {
          vsources.push({ plusNet: E, minusNet: C, V: VCE_SAT, ownerId: c.id });
          vsources.push({ plusNet: E, minusNet: B, V: VBE_ON, ownerId: c.id + ':eb' });
        } else {
          stamps.push({ a: E, b: B, G: 1 / R_OPEN, ownerId: c.id + ':eb' });
          stamps.push({ a: E, b: C, G: 1 / R_OPEN, ownerId: c.id + ':ec' });
        }
        break;
      }
      case 'nmos': {
        const D = netOf(nl, c, 'D');
        const G = netOf(nl, c, 'G');
        const Sn = netOf(nl, c, 'S');
        if (!D || !G || !Sn) break;
        // Gate is high-impedance
        stamps.push({ a: G, b: Sn, G: 1 / R_OPEN, ownerId: c.id + ':gs' });
        const r = s.mode === 'on' ? R_SHORT : R_OPEN;
        stamps.push({ a: D, b: Sn, G: 1 / r, ownerId: c.id });
        break;
      }
      case 'pmos': {
        const D = netOf(nl, c, 'D');
        const G = netOf(nl, c, 'G');
        const Sn = netOf(nl, c, 'S');
        if (!D || !G || !Sn) break;
        stamps.push({ a: G, b: Sn, G: 1 / R_OPEN, ownerId: c.id + ':gs' });
        const r = s.mode === 'on' ? R_SHORT : R_OPEN;
        stamps.push({ a: D, b: Sn, G: 1 / r, ownerId: c.id });
        break;
      }
    }
  }

  const N = nIdx + vsources.length;
  if (N === 0) {
    // Nothing to solve, all-ground
    return {
      ok: true,
      nodeVoltages: new Map([[nl.groundNet!, 0]]),
      branchCurrents: new Map(),
    };
  }

  const A: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const z: number[] = new Array<number>(N).fill(0);

  for (const s of stamps) {
    const ia = netIndex.get(s.a);
    const ib = netIndex.get(s.b);
    if (ia !== undefined) A[ia][ia] += s.G;
    if (ib !== undefined) A[ib][ib] += s.G;
    if (ia !== undefined && ib !== undefined) {
      A[ia][ib] -= s.G;
      A[ib][ia] -= s.G;
    }
  }

  for (let k = 0; k < vsources.length; k++) {
    const v = vsources[k];
    const ia = netIndex.get(v.plusNet);
    const ib = netIndex.get(v.minusNet);
    const row = nIdx + k;
    if (ia !== undefined) {
      A[ia][row] += 1;
      A[row][ia] += 1;
    }
    if (ib !== undefined) {
      A[ib][row] -= 1;
      A[row][ib] -= 1;
    }
    z[row] = v.V;
  }

  const x = solve(A, z);
  if (!x) {
    return {
      ok: false,
      message: 'Singulär matris — kontrollera kortslutningar eller lösa noder.',
      nodeVoltages: new Map(),
      branchCurrents: new Map(),
    };
  }

  const nodeVoltages = new Map<string, number>();
  nodeVoltages.set(nl.groundNet!, 0);
  for (const [netId, idx] of netIndex) nodeVoltages.set(netId, x[idx]);

  // Compute branch currents per component
  const branchCurrents = new Map<string, number>();
  for (let k = 0; k < vsources.length; k++) {
    const v = vsources[k];
    const I = x[nIdx + k];
    // Aggregate current into the originating component (could be diode + extra rail; first wins).
    const owner = v.ownerId.split(':')[0];
    if (!branchCurrents.has(owner)) branchCurrents.set(owner, I);
  }
  for (const c of doc.components) {
    if (branchCurrents.has(c.id)) continue;
    const a = primaryNet(nl, c, 0);
    const b = primaryNet(nl, c, 1);
    if (!a || !b) continue;
    const va = nodeVoltages.get(a) ?? 0;
    const vb = nodeVoltages.get(b) ?? 0;
    const G = conductanceOf(c, states);
    if (G > 0) branchCurrents.set(c.id, (va - vb) * G);
  }

  return { ok: true, nodeVoltages, branchCurrents };
}

function primaryNet(nl: Netlist, c: ComponentInstance, i: 0 | 1): string | undefined {
  switch (c.kind) {
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'switch':
    case 'motor':
      return netOf(nl, c, i === 0 ? '1' : '2');
    case 'led':
    case 'diode':
      return netOf(nl, c, i === 0 ? 'A' : 'K');
    case 'battery':
      return netOf(nl, c, i === 0 ? '+' : '-');
    case 'vcc':
      return i === 0 ? netOf(nl, c, '1') : nl.groundNet ?? undefined;
    default:
      return undefined;
  }
}

function conductanceOf(c: ComponentInstance, states: Map<string, DeviceState>): number {
  const s = states.get(c.id);
  switch (c.kind) {
    case 'resistor': return 1 / Math.max(c.value, 1e-9);
    case 'motor':    return 1 / Math.max(c.value, 1e-3);
    case 'capacitor': return 1 / R_OPEN;
    case 'inductor': return 1 / R_SHORT;
    case 'switch':   return s?.mode === 'closed' ? 1 / R_SHORT : 1 / R_OPEN;
    case 'led':
    case 'diode':    return s?.mode === 'on' ? 0 : 1 / R_OPEN;
    default:         return 0;
  }
}

function updateStates(
  doc: CircuitDoc,
  nl: Netlist,
  states: Map<string, DeviceState>,
  r: DCResult,
): boolean {
  let changed = false;
  for (const c of doc.components) {
    const s = states.get(c.id)!;
    let nextMode = s.mode;
    switch (c.kind) {
      case 'switch': {
        nextMode = c.value >= 0.5 ? 'closed' : 'open';
        break;
      }
      case 'led':
      case 'diode': {
        const a = netOf(nl, c, 'A'), b = netOf(nl, c, 'K');
        if (!a || !b) break;
        const va = r.nodeVoltages.get(a) ?? 0;
        const vb = r.nodeVoltages.get(b) ?? 0;
        const I = r.branchCurrents.get(c.id) ?? 0;
        if (s.mode === 'on') {
          // Should remain on if current is positive (anode->cathode)
          if (I < -1e-9) nextMode = 'off';
        } else {
          // Off: should turn on if forward voltage exceeds Vf
          const Vf = c.kind === 'led' ? (c.value || VF_LED_DEFAULT) : (c.value || VF_DIODE_DEFAULT);
          if (va - vb > Vf + 1e-3) nextMode = 'on';
        }
        break;
      }
      case 'npn': {
        const C = netOf(nl, c, 'C');
        const B = netOf(nl, c, 'B');
        const E = netOf(nl, c, 'E');
        if (!C || !B || !E) break;
        const vc = r.nodeVoltages.get(C) ?? 0;
        const vb = r.nodeVoltages.get(B) ?? 0;
        const ve = r.nodeVoltages.get(E) ?? 0;
        const VBE = vb - ve;
        const VCE = vc - ve;
        if (VBE >= VBE_ON - 1e-3 && VCE > VCE_SAT - 1e-3) nextMode = 'saturation';
        else nextMode = 'cutoff';
        break;
      }
      case 'pnp': {
        const C = netOf(nl, c, 'C');
        const B = netOf(nl, c, 'B');
        const E = netOf(nl, c, 'E');
        if (!C || !B || !E) break;
        const vc = r.nodeVoltages.get(C) ?? 0;
        const vb = r.nodeVoltages.get(B) ?? 0;
        const ve = r.nodeVoltages.get(E) ?? 0;
        const VEB = ve - vb;
        const VEC = ve - vc;
        if (VEB >= VBE_ON - 1e-3 && VEC > VCE_SAT - 1e-3) nextMode = 'saturation';
        else nextMode = 'cutoff';
        break;
      }
      case 'nmos': {
        const G = netOf(nl, c, 'G');
        const S = netOf(nl, c, 'S');
        if (!G || !S) break;
        const vg = r.nodeVoltages.get(G) ?? 0;
        const vs = r.nodeVoltages.get(S) ?? 0;
        const VGS = vg - vs;
        nextMode = VGS >= c.value ? 'on' : 'off';
        break;
      }
      case 'pmos': {
        const G = netOf(nl, c, 'G');
        const S = netOf(nl, c, 'S');
        if (!G || !S) break;
        const vg = r.nodeVoltages.get(G) ?? 0;
        const vs = r.nodeVoltages.get(S) ?? 0;
        const VGS = vg - vs;
        nextMode = VGS <= c.value ? 'on' : 'off'; // Vth is negative for PMOS
        break;
      }
    }
    if (nextMode !== s.mode) {
      s.mode = nextMode;
      changed = true;
    }
  }
  return changed;
}

import type { CircuitDoc, ComponentInstance, ComponentKind, Rotation, Wire } from './circuit/types';
import { getSymbol } from './symbols/library';

let counter = 0;
function id(prefix: string): string {
  counter++;
  return `${prefix}_${counter.toString(36)}`;
}

function comp(
  kind: ComponentKind,
  x: number,
  y: number,
  opts: { rotation?: Rotation; flipped?: boolean; value?: number; label?: string } = {},
): ComponentInstance {
  const sym = getSymbol(kind);
  return {
    id: id(kind),
    kind,
    x,
    y,
    rotation: opts.rotation ?? 0,
    flipped: opts.flipped ?? false,
    value: opts.value ?? sym.defaultValue,
    label: opts.label,
  };
}

function wire(...pts: Array<[number, number]>): Wire {
  return { id: id('w'), points: pts.map(([x, y]) => ({ x, y })) };
}

export interface Demo {
  id: string;
  name: string;
  description: string;
  doc: CircuitDoc;
  /** A short hint to show after loading: what to do next. */
  hint?: string;
}

/* =============================== Demo 1 =============================== */
/* Battery (+ on right via rot 180) → Switch → R → LED → GND ← Battery -.   */

function helloLed(): CircuitDoc {
  counter = 0;
  return {
    version: 1,
    components: [
      comp('battery', 4, 0, { rotation: 180, value: 9, label: 'BAT' }),
      comp('switch',  6, 0, { value: 1, label: 'SW1' }),
      comp('resistor', 12, 0, { value: 470, label: 'R1' }),
      comp('led',      18, 0, { value: 2.1, label: 'LED1' }),
      comp('ground',   0, 3, { label: 'GND' }),
    ],
    wires: [
      wire([4, 0], [6, 0]),                       // BAT+ -> SW
      wire([10, 0], [12, 0]),                     // SW -> R
      wire([16, 0], [18, 0]),                     // R -> LED A
      wire([22, 0], [22, 3], [0, 3]),             // LED K -> GND
      wire([0, 0], [0, 3]),                       // BAT- -> GND
    ],
    view: { tx: 80, ty: 220, zoom: 26 },
  };
}

/* =============================== Demo 2 =============================== */
/* Spänningsdelare: BAT+ → R1 → V_mid → R2 → GND.                         */

function voltageDivider(): CircuitDoc {
  counter = 0;
  return {
    version: 1,
    components: [
      comp('battery', 4, 0, { rotation: 180, value: 9, label: 'BAT' }),
      comp('resistor', 6, 0, { value: 10000, label: 'R1' }),
      comp('resistor', 10, 0, { rotation: 90, value: 10000, label: 'R2' }),
      comp('ground',   10, 6, { label: 'GND' }),
    ],
    wires: [
      wire([4, 0], [6, 0]),                  // BAT+ -> R1 (R1.pin2 = R2.pin1 share grid point)
      wire([10, 4], [10, 6]),                // R2 pin2 -> GND
      wire([0, 0], [0, 6], [10, 6]),         // BAT- -> GND
    ],
    view: { tx: 80, ty: 240, zoom: 26 },
  };
}

/* =============================== Demo 3 =============================== */
/* NPN-transistor som switch driver LED via R_load. Bas-styrning via R_b. */

function transistorSwitch(): CircuitDoc {
  counter = 0;
  return {
    version: 1,
    components: [
      comp('battery', 4, 0, { rotation: 180, value: 9, label: 'BAT' }),
      comp('switch',  6, 0, { value: 1, label: 'IN' }),
      comp('resistor', 10, 0, { value: 10000, label: 'Rb' }),
      // NPN: pins B (0,0), C (3,-2), E (3,2). Place at (16, 4) so B (16,4), C (19,2), E (19,6).
      comp('npn', 16, 4, { value: 100, label: 'Q1' }),
      // Base pull-down 100 kΩ — keeps base low when IN is open. Rot 90 → pin1 (16,6), pin2 (16,10).
      comp('resistor', 16, 6, { rotation: 90, value: 100000, label: 'Rb_pd' }),
      // Load chain on the upper rail.
      comp('resistor', 8, -4, { value: 470, label: 'R_load' }),
      comp('led',      14, -4, { value: 2.1, label: 'LED1' }),
      comp('ground', 0, 12, { label: 'GND' }),
    ],
    wires: [
      wire([4, 0], [6, 0]),                  // BAT+ -> SW
      wire([14, 0], [16, 0], [16, 4]),       // Rb pin2 -> NPN base
      wire([16, 4], [16, 6]),                // base -> Rb_pd pin1
      wire([16, 10], [16, 12], [0, 12]),     // Rb_pd pin2 -> GND
      wire([4, 0], [4, -4], [8, -4]),        // BAT+ up to R_load pin1
      wire([12, -4], [14, -4]),              // R_load pin2 -> LED A
      wire([18, -4], [19, -4], [19, 2]),     // LED K -> NPN C
      wire([19, 6], [19, 12], [16, 12]),     // NPN E -> GND rail
      wire([0, 0], [0, 12]),                 // BAT- -> GND
    ],
    view: { tx: 60, ty: 240, zoom: 20 },
  };
}

/* =============================== Demo 4 =============================== */
/* NMOS som motor-driver. Gate-spänning via switch styr om motorn snurrar. */

function mosfetMotor(): CircuitDoc {
  counter = 0;
  return {
    version: 1,
    components: [
      comp('battery', 4, 0, { rotation: 180, value: 7.2, label: 'BAT' }),
      comp('switch', 6, 0, { value: 1, label: 'GO' }),
      comp('resistor', 10, 0, { value: 10000, label: 'Rg' }),
      // Motor on the upper rail
      comp('motor', 8, -4, { value: 4, label: 'M1' }),
      // NMOS — pins G(16,4), D(19,2), S(19,6).
      comp('nmos', 16, 4, { value: 2, label: 'Q_drv' }),
      // Pull-down 100 kΩ between gate and ground; rot 90 → pin1 (16,6), pin2 (16,10).
      comp('resistor', 16, 6, { rotation: 90, value: 100000, label: 'Rpd' }),
      comp('ground', 0, 12, { label: 'GND' }),
    ],
    wires: [
      wire([4, 0], [6, 0]),                  // BAT+ → SW pin1
      wire([14, 0], [16, 0], [16, 4]),       // Rg pin2 → NMOS gate
      wire([16, 4], [16, 6]),                // gate → Rpd pin1
      wire([4, 0], [4, -4], [8, -4]),        // BAT+ up to motor pin1
      wire([12, -4], [19, -4], [19, 2]),     // motor pin2 → NMOS drain
      wire([16, 10], [16, 12], [0, 12]),     // Rpd pin2 → GND rail
      wire([19, 6], [19, 12], [16, 12]),     // NMOS source → GND rail
      wire([0, 0], [0, 12]),                 // BAT- → GND rail
    ],
    view: { tx: 60, ty: 220, zoom: 20 },
  };
}

export const DEMOS: Demo[] = [
  {
    id: 'hello-led',
    name: 'Hej LED',
    description: 'Den enklaste belysningskretsen: batteri, strömställare, motstånd och en lysdiod. Tryck Simulera för att tända.',
    doc: helloLed(),
    hint: 'Tryck "▶ Simulera" så lyser LED:en. Tap-och-håll på strömställaren för att vippa av/på.',
  },
  {
    id: 'voltage-divider',
    name: 'Spänningsdelare',
    description: 'Två motstånd i serie ger en delad spänning på mittpunkten. Byter du värdena ändras delningen.',
    doc: voltageDivider(),
    hint: 'Tryck ▶ Simulera. Mittspänningen mellan motstånden ska bli ungefär halva batterispänningen (~4,5 V).',
  },
  {
    id: 'transistor-switch',
    name: 'Transistor som switch',
    description: 'En NPN-transistor använder en liten basström för att styra en mycket större ström genom en LED. Grunden för att låta en mikrokontroller styra större laster.',
    doc: transistorSwitch(),
    hint: 'IN-strömställaren styr basen via Rb. Rb_pd håller basen låg när IN är öppen. Med IN stängd leder transistorn och LED:en lyser.',
  },
  {
    id: 'mosfet-motor',
    name: 'MOSFET-styrd motor',
    description: 'En NMOS-transistor styr en likströmsmotor. Kärnan i en RC-bils motor-driver: lite gate-spänning släpper på flera ampere genom motorn.',
    doc: mosfetMotor(),
    hint: 'GO-strömställaren styr gaten. När den är stängd får gaten ~7 V via Rg, NMOS leder och motorn snurrar. Rpd håller gaten låg när GO är öppen.',
  },
];

export function findDemo(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}

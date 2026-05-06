import { describe, it, expect } from 'vitest';
import { DEMOS, findDemo } from '../src/demos';
import { simulateDC } from '../src/sim/dc';
import { buildNetlist } from '../src/sim/netlist';

describe('Demo circuits — structural', () => {
  it('contains a non-empty list of demos', () => {
    expect(DEMOS.length).toBeGreaterThanOrEqual(3);
    for (const d of DEMOS) {
      expect(d.id).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.doc.version).toBe(1);
      expect(d.doc.components.length).toBeGreaterThan(0);
    }
  });

  it('every demo has a ground component (simulator requires it)', () => {
    for (const d of DEMOS) {
      const hasGround = d.doc.components.some((c) => c.kind === 'ground');
      expect(hasGround, `${d.id} missing ground`).toBe(true);
    }
  });

  it('every demo netlist contains a ground net', () => {
    for (const d of DEMOS) {
      const nl = buildNetlist(d.doc);
      expect(nl.groundNet, `${d.id} groundNet should exist`).not.toBeNull();
    }
  });
});

describe('Demo circuits — simulation results', () => {
  it('"Hej LED" lights up the LED with sensible current', () => {
    const demo = findDemo('hello-led')!;
    const r = simulateDC(demo.doc);
    expect(r.ok).toBe(true);
    const led = demo.doc.components.find((c) => c.kind === 'led')!;
    const i = r.branchCurrents.get(led.id) ?? 0;
    // 9V battery, ~2.1V Vf, 470Ω resistor, ~1Ω diode dynamic resistance.
    // Expected current ~ (9 - 2.1) / (470 + 1) ≈ 14.6 mA.
    expect(i).toBeGreaterThan(0.005);
    expect(i).toBeLessThan(0.030);
  });

  it('"Spänningsdelare" puts ~half the supply on the midpoint', () => {
    const demo = findDemo('voltage-divider')!;
    const r = simulateDC(demo.doc);
    expect(r.ok).toBe(true);
    // R1 and R2 are equal => mid voltage ~ Vbat/2 = 4.5 V.
    // Find the net that connects R1.pin2 to R2.pin1; we can read it via netlist.
    const nl = buildNetlist(demo.doc);
    const r1 = demo.doc.components.find((c) => c.label === 'R1')!;
    const midNet = nl.pinNets.get(`${r1.id}|2`)!;
    const v = r.nodeVoltages.get(midNet) ?? 0;
    expect(v).toBeGreaterThan(4.0);
    expect(v).toBeLessThan(5.0);
  });

  it('"Transistor som switch" turns the LED on when the switch is closed', () => {
    const demo = findDemo('transistor-switch')!;
    // Default state: switch closed (value=1) → LED should conduct.
    const r1 = simulateDC(demo.doc);
    expect(r1.ok).toBe(true);
    const led = demo.doc.components.find((c) => c.kind === 'led')!;
    const iOn = r1.branchCurrents.get(led.id) ?? 0;
    expect(Math.abs(iOn)).toBeGreaterThan(0.001);

    // Open the switch and re-simulate → LED current should drop sharply.
    const sw = demo.doc.components.find((c) => c.kind === 'switch')!;
    sw.value = 0;
    const r2 = simulateDC(demo.doc);
    expect(r2.ok).toBe(true);
    const iOff = Math.abs(r2.branchCurrents.get(led.id) ?? 0);
    expect(iOff).toBeLessThan(iOn / 100);
    sw.value = 1; // restore
  });

  it('"MOSFET-styrd motor" passes current through the motor when GO is closed', () => {
    const demo = findDemo('mosfet-motor')!;
    const motor = demo.doc.components.find((c) => c.kind === 'motor')!;
    const sw = demo.doc.components.find((c) => c.label === 'GO')!;

    // Switch closed → gate driven high → motor should run.
    sw.value = 1;
    const rOn = simulateDC(demo.doc);
    expect(rOn.ok).toBe(true);
    const iOn = Math.abs(rOn.branchCurrents.get(motor.id) ?? 0);
    expect(iOn).toBeGreaterThan(0.05); // > 50 mA through motor

    // Switch open → gate pulled low → motor essentially off.
    sw.value = 0;
    const rOff = simulateDC(demo.doc);
    expect(rOff.ok).toBe(true);
    const iOff = Math.abs(rOff.branchCurrents.get(motor.id) ?? 0);
    expect(iOff).toBeLessThan(iOn / 50);
    sw.value = 1; // restore
  });
});

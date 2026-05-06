import { describe, it, expect, beforeEach } from 'vitest';
import { createApp, type RendererLike } from '../src/app';
import type { RenderInput } from '../src/render/renderer';
import { findDemo } from '../src/demos';

class StubRenderer implements RendererLike {
  lastInput: RenderInput | null = null;
  render(input: RenderInput): void {
    this.lastInput = input;
  }
}

beforeEach(() => {
  document.body.innerHTML = `
    <canvas id="stage"></canvas>
    <div id="ui-root"></div>
  `;
  localStorage.clear();
});

describe('Probe flow', () => {
  it('adds a voltage probe when tapping a wire grid point with the probe tool', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    // Load Hello LED so we have wires to probe
    const demo = findDemo('hello-led')!;
    const docCopy = JSON.parse(JSON.stringify(demo.doc));
    app.setDoc(docCopy);

    app.setTool('probe');
    expect(app.getTool()).toBe('probe');

    // Tap the wire between BAT+ and switch (runs along y=0 between x=4 and x=6)
    app.handler.onTap(5, 0, { sx: 0, sy: 0 });

    const probes = app.getDoc().probes ?? [];
    expect(probes.length).toBe(1);
    expect(probes[0].kind).toBe('voltage');
  });

  it('adds a current probe when tapping inside a component body', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    const demo = findDemo('hello-led')!;
    const docCopy = JSON.parse(JSON.stringify(demo.doc));
    app.setDoc(docCopy);

    app.setTool('probe');

    // The resistor sits at world (12..16, 0). Tap on its center.
    app.handler.onTap(14, 0, { sx: 0, sy: 0 });

    const probes = app.getDoc().probes ?? [];
    expect(probes.length).toBe(1);
    expect(probes[0].kind).toBe('current');
    expect(probes[0].componentId).toBeTruthy();
  });

  it('removes a probe when tapping near it again', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    const demo = findDemo('hello-led')!;
    app.setDoc(JSON.parse(JSON.stringify(demo.doc)));
    app.setTool('probe');

    app.handler.onTap(5, 0, { sx: 0, sy: 0 });
    expect(app.getDoc().probes).toHaveLength(1);

    // Tap close to the same probe — should remove it
    app.handler.onTap(5.2, 0.1, { sx: 0, sy: 0 });
    expect(app.getDoc().probes).toHaveLength(0);
  });

  it('voltage probe resolves to a real net voltage after simulation', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    const demo = findDemo('hello-led')!;
    app.setDoc(JSON.parse(JSON.stringify(demo.doc)));
    app.setTool('probe');

    // Probe right at battery + pin (4, 0)
    app.handler.onTap(4, 0, { sx: 0, sy: 0 });

    const sim = app.runSim()!;
    expect(sim.ok).toBe(true);

    // The render input contains pointToNet which the probe uses to resolve.
    const input = renderer.lastInput!;
    expect(input.pointToNet).toBeDefined();
    const probe = app.getDoc().probes![0];
    const key = `${probe.x},${probe.y}`;
    const net = input.pointToNet!.get(key);
    expect(net).toBeDefined();
    const v = sim.nodeVoltages.get(net!) ?? 0;
    // Battery+ should be near +9 V (above ground)
    expect(v).toBeGreaterThan(8);
    expect(v).toBeLessThan(10);
  });

  it('does NOT animate flow in the render input when sim has not been run', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });
    app.invalidate('test');
    expect(renderer.lastInput?.animateFlow).toBeFalsy();
  });

  it('marks animateFlow=true after a successful sim with current', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });
    const demo = findDemo('hello-led')!;
    app.setDoc(JSON.parse(JSON.stringify(demo.doc)));
    app.runSim();
    expect(renderer.lastInput?.animateFlow).toBe(true);
  });
});

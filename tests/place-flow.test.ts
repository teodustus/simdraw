import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import type { RendererLike } from '../src/app';
import type { RenderInput } from '../src/render/renderer';

class StubRenderer implements RendererLike {
  rendered = 0;
  lastInput: RenderInput | null = null;
  render(input: RenderInput): void {
    this.rendered++;
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

describe('Place flow (regression: tap on canvas after picking a chip places a component)', () => {
  it('places a battery on the board when palette chip is tapped then canvas is tapped', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    // 1. Pick "battery" via palette (the actual UI button).
    const chip = document.querySelector('.chip[data-kind="battery"]') as HTMLButtonElement | null;
    expect(chip, 'battery chip should exist in palette').toBeTruthy();
    chip!.click();

    expect(app.getTool()).toBe('place');
    expect(app.getPickedKind()).toBe('battery');
    expect(app.getDoc().components).toHaveLength(0);

    // 2. Tap the canvas at world coords (5, 5).
    app.handler.onTap(5, 5, { sx: 100, sy: 100 });

    // The component is added at the snapped grid coords.
    expect(app.getDoc().components).toHaveLength(1);
    expect(app.getDoc().components[0].kind).toBe('battery');
    expect(app.getDoc().components[0].x).toBe(5);
    expect(app.getDoc().components[0].y).toBe(5);
  });

  it('keeps the place tool active so the user can drop multiple of the same component', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    (document.querySelector('.chip[data-kind="resistor"]') as HTMLButtonElement).click();
    app.handler.onTap(0, 0, { sx: 0, sy: 0 });
    app.handler.onTap(10, 0, { sx: 0, sy: 0 });
    app.handler.onTap(20, 0, { sx: 0, sy: 0 });

    expect(app.getDoc().components).toHaveLength(3);
    expect(app.getDoc().components.every((c) => c.kind === 'resistor')).toBe(true);
  });

  it('switches to select after pressing Escape (does not consume taps anymore)', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    (document.querySelector('.chip[data-kind="led"]') as HTMLButtonElement).click();
    expect(app.getTool()).toBe('place');

    // Simulate the toolbar select button being clicked (same path Escape would take).
    app.setTool('select');
    expect(app.getTool()).toBe('select');

    app.handler.onTap(7, 7, { sx: 0, sy: 0 });
    expect(app.getDoc().components).toHaveLength(0);
  });
});

describe('Wire flow (regression: two pin taps connect components)', () => {
  it('completes a wire when the second tap lands on a pin', () => {
    const renderer = new StubRenderer();
    const app = createApp({
      renderer,
      viewport: { width: 800, height: 600 },
      storage: null,
      scheduleFrame: (cb) => cb(),
      enableFlowAnimation: false,
    });

    // Place two batteries 8 grid units apart.
    (document.querySelector('.chip[data-kind="battery"]') as HTMLButtonElement).click();
    app.handler.onTap(0, 0, { sx: 0, sy: 0 });   // pins at (0,0) and (4,0)
    app.handler.onTap(8, 0, { sx: 0, sy: 0 });   // pins at (8,0) and (12,0)

    expect(app.getDoc().components).toHaveLength(2);

    // Switch to wire tool, tap on the right pin of left battery, then left pin of right battery.
    app.setTool('wire');
    app.handler.onTap(4, 0, { sx: 0, sy: 0 });
    app.handler.onTap(8, 0, { sx: 0, sy: 0 });

    expect(app.getDoc().wires).toHaveLength(1);
    const w = app.getDoc().wires[0];
    expect(w.points[0]).toEqual({ x: 4, y: 0 });
    expect(w.points[w.points.length - 1]).toEqual({ x: 8, y: 0 });
  });
});

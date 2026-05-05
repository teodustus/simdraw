import { describe, it, expect, beforeEach } from 'vitest';
import { UI } from '../src/ui/ui';

const noop = () => {};
const stubCallbacks = {
  onSelectTool: noop,
  onPick: noop,
  onRotate: noop,
  onDelete: noop,
  onClear: noop,
  onUndo: noop,
  onSimulate: noop,
  onSave: noop,
  onExport: noop,
  onImport: noop,
  onLoadDemo: noop,
  onChangeValue: noop,
  onChangeLabel: noop,
  onToggleSwitch: noop,
};

beforeEach(() => {
  document.body.innerHTML = `
    <canvas id="stage"></canvas>
    <div id="ui-root"></div>
  `;
});

describe('UI overlay (regression: pointer events must reach canvas)', () => {
  it('only puts toolbar and palette inside #ui-root', () => {
    new UI(stubCallbacks);
    const root = document.getElementById('ui-root')!;
    const children = Array.from(root.children) as HTMLElement[];

    // Original bug: a flex-grow spacer div was inserted between toolbar and palette
    // and inherited pointer-events:auto from `#ui-root > *`, intercepting taps in
    // the middle of the screen so components never got placed on the canvas.
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      const isToolbar = child.classList.contains('toolbar');
      const isPalette = child.classList.contains('palette');
      expect(isToolbar || isPalette,
        `unexpected child of #ui-root: <${child.tagName.toLowerCase()} class="${child.className}">`
      ).toBe(true);
    }
  });

  it('produces a palette chip for each component in the library', () => {
    new UI(stubCallbacks);
    const palette = document.querySelector('#ui-root .palette');
    expect(palette).toBeTruthy();
    const chips = palette!.querySelectorAll('.chip');
    expect(chips.length).toBeGreaterThan(5);
    // ensure chips carry their kind in dataset for tap tests
    for (const chip of Array.from(chips)) {
      expect((chip as HTMLElement).dataset.kind).toBeTruthy();
    }
  });
});

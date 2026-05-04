import './style.css';
import { Renderer, type RenderInput, type SimResults } from './render/renderer';
import { View } from './render/view';
import { PointerInput, type PointerHandler } from './input/pointer';
import { UI } from './ui/ui';
import {
  emptyDoc,
  type CircuitDoc,
  type ComponentInstance,
  type ComponentKind,
  type Wire,
} from './circuit/types';
import {
  addWireSegment,
  findComponentAt,
  findPinAt,
  makeComponent,
  rotateCW,
  startWire,
} from './circuit/edits';
import { buildNetlist } from './sim/netlist';
import { simulateDC } from './sim/dc';
import { exportJSON, importJSON, loadDoc, saveDoc } from './storage/storage';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const view = new View();
let doc: CircuitDoc = loadDoc();
if (doc.view) {
  view.tx = doc.view.tx;
  view.ty = doc.view.ty;
  view.zoom = doc.view.zoom;
} else {
  view.tx = window.innerWidth / 2;
  view.ty = window.innerHeight / 2;
}

let tool: 'select' | 'place' | 'wire' | 'erase' = 'select';
let pickedKind: ComponentKind | null = null;
let placeRotation: 0 | 90 | 180 | 270 = 0;
let placeFlipped = false;

const selection = new Set<string>();
let hoverWorld: { x: number; y: number } | null = null;
let dragging: null | { kind: 'component'; id: string; offsetX: number; offsetY: number; startX: number; startY: number } = null;
let wireDraft: { wire: Wire | null; cursor: { x: number; y: number } | null } = { wire: null, cursor: null };
let lastSim: SimResults | null = null;
let history: string[] = [];

function pushUndo(): void {
  history.push(JSON.stringify(doc));
  if (history.length > 50) history.shift();
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  doc = JSON.parse(prev) as CircuitDoc;
  selection.clear();
  ui.setState({ selection: null });
  invalidate('undo');
}

function persist(): void {
  doc.view = { tx: view.tx, ty: view.ty, zoom: view.zoom };
  saveDoc(doc);
}

const ui = new UI({
  onSelectTool(t) {
    tool = t;
    pickedKind = null;
    wireDraft = { wire: null, cursor: null };
    ui.setState({ tool, pickedKind, message: null });
    invalidate();
  },
  onPick(kind) {
    pickedKind = kind;
    tool = 'place';
    placeRotation = 0;
    placeFlipped = false;
    ui.setState({ tool, pickedKind });
    invalidate();
  },
  onRotate() {
    if (tool === 'place') {
      placeRotation = rotateCW(placeRotation);
      invalidate();
      return;
    }
    const sel = currentSelection();
    if (sel) {
      pushUndo();
      sel.rotation = rotateCW(sel.rotation);
      persist();
      invalidate('rotate');
    }
  },
  onDelete() {
    if (selection.size === 0) return;
    pushUndo();
    doc.components = doc.components.filter(c => !selection.has(c.id));
    selection.clear();
    ui.setState({ selection: null });
    persist();
    invalidate('delete');
  },
  onClear() {
    if (!confirm('Rensa hela ritningen?')) return;
    pushUndo();
    doc = emptyDoc();
    selection.clear();
    ui.setState({ selection: null, message: null });
    lastSim = null;
    persist();
    invalidate('clear');
  },
  onUndo: undo,
  onSimulate() {
    runSim();
  },
  onSave() {
    persist();
    ui.showToast('Sparat lokalt');
  },
  onExport() {
    const blob = new Blob([exportJSON(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'krets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  onImport(text) {
    if (!text) return;
    const parsed = importJSON(text);
    if (!parsed) {
      ui.showToast('Kunde inte läsa filen');
      return;
    }
    pushUndo();
    doc = parsed;
    if (doc.view) {
      view.tx = doc.view.tx;
      view.ty = doc.view.ty;
      view.zoom = doc.view.zoom;
    }
    selection.clear();
    ui.setState({ selection: null });
    persist();
    invalidate('import');
    ui.showToast('Krets inläst');
  },
  onChangeValue(c, v) {
    c.value = v;
    persist();
    invalidate('value');
  },
  onChangeLabel(c, label) {
    c.label = label || undefined;
    persist();
    invalidate('label');
  },
  onToggleSwitch(c) {
    c.value = c.value >= 0.5 ? 0 : 1;
    ui.setState({ selection: c });
    persist();
    invalidate('toggle');
  },
});

function currentSelection(): ComponentInstance | null {
  if (selection.size === 0) return null;
  const id = selection.values().next().value;
  return doc.components.find(c => c.id === id) ?? null;
}

const pointerHandler: PointerHandler = {
  onTap(wx, wy) {
    const sx = view.snap(wx), sy = view.snap(wy);
    if (tool === 'place' && pickedKind) {
      pushUndo();
      const c = makeComponent(pickedKind, sx, sy, placeRotation, placeFlipped);
      doc.components.push(c);
      persist();
      invalidate('place');
      return;
    }
    if (tool === 'wire') {
      const pin = findPinAt(doc, wx, wy, 0.6);
      const target = pin ? { x: pin.x, y: pin.y } : { x: sx, y: sy };
      if (!wireDraft.wire) {
        wireDraft = { wire: startWire(target), cursor: null };
      } else {
        addWireSegment(doc, wireDraft.wire, target);
        if (pin) {
          // landed on pin: finish
          finishWire();
        }
      }
      invalidate('wire');
      return;
    }
    if (tool === 'erase') {
      pushUndo();
      const hit = findComponentAt(doc, wx, wy);
      if (hit) {
        doc.components = doc.components.filter(c => c.id !== hit.id);
      } else {
        // delete a wire if click is near a segment
        const idx = findNearestWireIndex(wx, wy, 0.5);
        if (idx >= 0) doc.wires.splice(idx, 1);
      }
      persist();
      invalidate('erase');
      return;
    }
    // select tool
    const hit = findComponentAt(doc, wx, wy);
    selection.clear();
    if (hit) selection.add(hit.id);
    ui.setState({ selection: hit ?? null, message: null });
    invalidate('select');
  },
  onLongPress(wx, wy) {
    // Long press on switch to toggle, or on component to bring up properties.
    const hit = findComponentAt(doc, wx, wy);
    if (hit?.kind === 'switch') {
      hit.value = hit.value >= 0.5 ? 0 : 1;
      ui.setState({ selection: hit });
      persist();
      invalidate('toggle');
      return;
    }
    if (hit) {
      selection.clear();
      selection.add(hit.id);
      ui.setState({ selection: hit });
      invalidate('select');
    }
  },
  onDragStart(wx, wy) {
    if (tool === 'wire' || tool === 'place' || tool === 'erase') return;
    const hit = findComponentAt(doc, wx, wy);
    if (hit) {
      pushUndo();
      selection.clear();
      selection.add(hit.id);
      dragging = {
        kind: 'component',
        id: hit.id,
        offsetX: wx - hit.x,
        offsetY: wy - hit.y,
        startX: hit.x,
        startY: hit.y,
      };
      ui.setState({ selection: hit });
      invalidate('drag-start');
    } else {
      // pan canvas
      dragging = null;
      panFrom(wx, wy);
    }
  },
  onDragMove(wx, wy) {
    if (dragging?.kind === 'component') {
      const c = doc.components.find(x => x.id === dragging!.id);
      if (c) {
        c.x = view.snap(wx - dragging.offsetX);
        c.y = view.snap(wy - dragging.offsetY);
        invalidate('drag-move');
      }
      return;
    }
    if (panState) {
      const screen = view.worldToScreen(wx, wy);
      const lastScreen = view.worldToScreen(panState.wx, panState.wy);
      view.tx += screen.x - lastScreen.x;
      view.ty += screen.y - lastScreen.y;
      panState = { wx, wy };
      invalidate();
    }
  },
  onDragEnd(_wx, _wy) {
    if (dragging?.kind === 'component') {
      persist();
    }
    dragging = null;
    panState = null;
    invalidate('drag-end');
  },
  onHover(wx, wy) {
    hoverWorld = { x: wx, y: wy };
    if (tool === 'place' && pickedKind) invalidate();
    if (tool === 'wire' && wireDraft.wire) {
      const sx = view.snap(wx), sy = view.snap(wy);
      wireDraft.cursor = { x: sx, y: sy };
      invalidate();
    }
  },
  onChange() {
    invalidate();
  },
};

let panState: null | { wx: number; wy: number } = null;
function panFrom(wx: number, wy: number): void {
  panState = { wx, wy };
}

function findNearestWireIndex(wx: number, wy: number, tolerance: number): number {
  for (let i = doc.wires.length - 1; i >= 0; i--) {
    const w = doc.wires[i];
    for (let j = 0; j < w.points.length - 1; j++) {
      const a = w.points[j], b = w.points[j+1];
      const d = pointToSegmentDistance(wx, wy, a.x, a.y, b.x, b.y);
      if (d <= tolerance) return i;
    }
  }
  return -1;
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function finishWire(): void {
  if (wireDraft.wire && wireDraft.wire.points.length > 1) {
    pushUndo();
    doc.wires.push(wireDraft.wire);
    persist();
  }
  wireDraft = { wire: null, cursor: null };
  invalidate('wire-end');
}

new PointerInput(canvas, view, pointerHandler);

function runSim(): void {
  const r = simulateDC(doc);
  lastSim = r;
  if (!r.ok) {
    ui.showToast(r.message || 'Simulering misslyckades');
    ui.setState({ message: r.message ?? 'Fel' });
  } else {
    ui.setState({ message: null });
  }
  invalidate('sim');
}

let frameRequested = false;
let lastReason: string | null = null;
function invalidate(reason?: string): void {
  if (reason) lastReason = reason;
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    drawFrame();
    if (lastReason) {
      // Re-run sim if structure changed and a previous sim exists, but cheaply only on demand.
      lastReason = null;
    }
  });
}

function drawFrame(): void {
  const nl = buildNetlist(doc);
  const ghost = (tool === 'place' && pickedKind && hoverWorld)
    ? {
        kind: pickedKind,
        x: view.snap(hoverWorld.x),
        y: view.snap(hoverWorld.y),
        rotation: placeRotation,
        flipped: placeFlipped,
      }
    : null;
  const draftPoints = wireDraft.wire ? wireDraft.wire.points : [];
  const input: RenderInput = {
    doc,
    view,
    selection,
    junctions: nl.junctions,
    ghost,
    wireDraft: wireDraft.wire ? { points: draftPoints, cursor: wireDraft.cursor } : null,
    sim: lastSim,
  };
  renderer.render(input);
}

window.addEventListener('resize', () => invalidate('resize'));
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === 's' || e.key === 'S') {
    tool = 'select';
    ui.setState({ tool: 'select' });
    invalidate();
  } else if (e.key === 'w' || e.key === 'W') {
    tool = 'wire';
    ui.setState({ tool: 'wire' });
    invalidate();
  } else if (e.key === 'e' || e.key === 'E') {
    tool = 'erase';
    ui.setState({ tool: 'erase' });
    invalidate();
  }
  else if (e.key === 'r' || e.key === 'R') {
    if (tool === 'place') { placeRotation = rotateCW(placeRotation); invalidate(); }
    else {
      const sel = currentSelection();
      if (sel) { pushUndo(); sel.rotation = rotateCW(sel.rotation); persist(); invalidate(); }
    }
  } else if (e.key === 'Escape') {
    pickedKind = null;
    tool = 'select';
    wireDraft = { wire: null, cursor: null };
    selection.clear();
    ui.setState({ tool: 'select', pickedKind: null, selection: null });
    invalidate();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selection.size > 0) {
      pushUndo();
      doc.components = doc.components.filter(c => !selection.has(c.id));
      selection.clear();
      ui.setState({ selection: null });
      persist();
      invalidate();
    }
  } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    undo();
  } else if (e.key === ' ') {
    e.preventDefault();
    runSim();
  } else if (e.key === 'Enter' && tool === 'wire' && wireDraft.wire) {
    finishWire();
  }
});

// Initial draw
invalidate('init');

// PWA service worker is auto-registered by vite-plugin-pwa.

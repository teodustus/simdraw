import './style.css';
import { Renderer } from './render/renderer';
import { PointerInput } from './input/pointer';
import { createApp } from './app';
import { rotateCW } from './circuit/edits';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const app = createApp({
  renderer,
  viewport: { width: window.innerWidth, height: window.innerHeight },
});

new PointerInput(canvas, app.view, app.handler);

window.addEventListener('resize', () => app.invalidate('resize'));
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === 's' || e.key === 'S') {
    app.setTool('select');
  } else if (e.key === 'w' || e.key === 'W') {
    app.setTool('wire');
  } else if (e.key === 'e' || e.key === 'E') {
    app.setTool('erase');
  } else if (e.key === 'r' || e.key === 'R') {
    if (app.getTool() === 'place') {
      app.invalidate('rotate-place');
    } else {
      const sel = Array.from(app.getSelection())[0];
      if (sel) {
        const c = app.getDoc().components.find((x) => x.id === sel);
        if (c) {
          c.rotation = rotateCW(c.rotation);
          app.invalidate('rotate');
        }
      }
    }
  } else if (e.key === 'Escape') {
    app.setTool('select');
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    const ids = Array.from(app.getSelection());
    if (ids.length) {
      const doc = app.getDoc();
      doc.components = doc.components.filter((c) => !ids.includes(c.id));
      app.getSelection().clear();
      app.invalidate('delete');
    }
  } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    app.undo();
  } else if (e.key === ' ') {
    e.preventDefault();
    app.runSim();
  }
});

app.invalidate('init');

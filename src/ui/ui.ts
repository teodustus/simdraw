import type { ComponentInstance, ComponentKind } from '../circuit/types';
import { allSymbols, getSymbol } from '../symbols/library';
import { symbolSvg } from './icons';

export interface UICallbacks {
  onSelectTool(tool: 'select' | 'place' | 'wire' | 'erase'): void;
  onPick(kind: ComponentKind): void;
  onRotate(): void;
  onDelete(): void;
  onClear(): void;
  onUndo(): void;
  onSimulate(): void;
  onSave(): void;
  onExport(): void;
  onImport(text: string): void;
  onChangeValue(c: ComponentInstance, value: number): void;
  onChangeLabel(c: ComponentInstance, label: string): void;
  onToggleSwitch(c: ComponentInstance): void;
}

export interface UIState {
  tool: 'select' | 'place' | 'wire' | 'erase';
  pickedKind: ComponentKind | null;
  selection: ComponentInstance | null;
  simRunning: boolean;
  message: string | null;
}

export class UI {
  root: HTMLElement;
  toolbar: HTMLDivElement;
  palette: HTMLDivElement;
  panel: HTMLDivElement;
  toast: HTMLDivElement;

  state: UIState = {
    tool: 'select',
    pickedKind: null,
    selection: null,
    simRunning: false,
    message: null,
  };

  constructor(private cb: UICallbacks) {
    this.root = document.getElementById('ui-root')!;
    this.root.innerHTML = '';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'toolbar';
    this.root.appendChild(this.toolbar);

    this.palette = document.createElement('div');
    this.palette.className = 'palette';
    this.root.appendChild(this.palette);

    this.panel = document.createElement('div');
    this.panel.className = 'panel hidden';
    document.body.appendChild(this.panel);

    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    document.body.appendChild(this.toast);

    this.buildToolbar();
    this.buildPalette();
    this.render();
  }

  private buildToolbar(): void {
    this.toolbar.innerHTML = '';
    const btn = (label: string, onClick: () => void, opts?: { primary?: boolean; danger?: boolean; id?: string }): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'btn' + (opts?.primary ? ' primary' : '') + (opts?.danger ? ' danger' : '');
      b.innerHTML = label;
      if (opts?.id) b.dataset.id = opts.id;
      b.addEventListener('click', onClick);
      return b;
    };

    const select = btn('✦', () => this.cb.onSelectTool('select'), { id: 'tool-select' });
    select.title = 'Markera (S)';
    const wire = btn('〰', () => this.cb.onSelectTool('wire'), { id: 'tool-wire' });
    wire.title = 'Ledning (W)';
    const erase = btn('×', () => this.cb.onSelectTool('erase'), { id: 'tool-erase' });
    erase.title = 'Radera (E)';
    const rotate = btn('↻', () => this.cb.onRotate());
    rotate.title = 'Rotera (R)';
    const del = btn('🗑', () => this.cb.onDelete());
    del.title = 'Ta bort markerad (Del)';
    this.toolbar.append(select, wire, erase, rotate, del);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.toolbar.appendChild(spacer);

    const sim = btn('▶ Simulera', () => this.cb.onSimulate(), { primary: true, id: 'tool-sim' });
    sim.title = 'DC-simulering (Space)';
    const save = btn('💾', () => this.cb.onSave());
    save.title = 'Spara';
    const exp = btn('⇪', () => this.cb.onExport());
    exp.title = 'Exportera JSON';
    const imp = btn('⇩', () => this.cb.onImport(''));
    imp.title = 'Importera JSON';
    imp.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.addEventListener('change', () => {
        const file = inp.files?.[0];
        if (!file) return;
        file.text().then(t => this.cb.onImport(t));
      });
      inp.click();
    }, { capture: true } as AddEventListenerOptions);
    const clear = btn('Rensa', () => this.cb.onClear(), { danger: true });
    this.toolbar.append(sim, save, exp, imp, clear);
  }

  private buildPalette(): void {
    this.palette.innerHTML = '';
    for (const sym of allSymbols()) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.kind = sym.kind;
      chip.innerHTML = `${symbolSvg(sym.kind, 36)}<div class="lbl">${sym.name}</div>`;
      chip.addEventListener('click', () => this.cb.onPick(sym.kind));
      this.palette.appendChild(chip);
    }
  }

  setState(patch: Partial<UIState>): void {
    Object.assign(this.state, patch);
    this.render();
  }

  showToast(msg: string, durationMs = 1800): void {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    window.setTimeout(() => this.toast.classList.remove('show'), durationMs);
  }

  private render(): void {
    // Highlight tool
    for (const id of ['tool-select', 'tool-wire', 'tool-erase']) {
      const btn = this.toolbar.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (btn) btn.classList.toggle('active', this.state.tool === id.replace('tool-', ''));
    }
    // Highlight palette pick
    for (const chip of Array.from(this.palette.children) as HTMLElement[]) {
      chip.classList.toggle('active', this.state.pickedKind === chip.dataset.kind);
    }

    // Properties panel
    const sel = this.state.selection;
    if (!sel) {
      this.panel.classList.add('hidden');
      return;
    }
    this.panel.classList.remove('hidden');
    const sym = getSymbol(sel.kind);
    this.panel.innerHTML = '';

    const h = document.createElement('h3');
    h.textContent = `${sym.name}`;
    this.panel.appendChild(h);

    const labelRow = document.createElement('div');
    labelRow.className = 'row';
    const lblLabel = document.createElement('label');
    lblLabel.textContent = 'Etikett';
    const lblIn = document.createElement('input');
    lblIn.type = 'text';
    lblIn.value = sel.label || '';
    lblIn.placeholder = `${sym.designator}…`;
    lblIn.addEventListener('input', () => this.cb.onChangeLabel(sel, lblIn.value));
    labelRow.append(lblLabel, lblIn);
    this.panel.appendChild(labelRow);

    if (sel.kind === 'switch') {
      const tog = document.createElement('button');
      tog.className = 'btn primary';
      tog.style.width = '100%';
      tog.textContent = sel.value >= 0.5 ? 'Stängd (klicka för att öppna)' : 'Öppen (klicka för att stänga)';
      tog.addEventListener('click', () => this.cb.onToggleSwitch(sel));
      this.panel.appendChild(tog);
    } else if (sel.kind === 'ground') {
      // No value
    } else {
      const row = document.createElement('div');
      row.className = 'row';
      const valLabel = document.createElement('label');
      valLabel.textContent = `Värde (${sym.unit || '—'})`;
      const valIn = document.createElement('input');
      valIn.type = 'number';
      valIn.step = 'any';
      valIn.value = String(sel.value);
      valIn.addEventListener('input', () => {
        const v = parseFloat(valIn.value);
        if (Number.isFinite(v)) this.cb.onChangeValue(sel, v);
      });
      row.append(valLabel, valIn);
      this.panel.appendChild(row);
    }

    if (this.state.message) {
      const m = document.createElement('div');
      m.className = 'results err';
      m.textContent = this.state.message;
      this.panel.appendChild(m);
    }
  }
}

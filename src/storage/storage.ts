import { emptyDoc, type CircuitDoc } from '../circuit/types';

const KEY = 'simdraw:doc:v1';

export function loadDoc(): CircuitDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDoc();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) return parsed as CircuitDoc;
  } catch {
    // ignore
  }
  return emptyDoc();
}

export function saveDoc(doc: CircuitDoc): void {
  localStorage.setItem(KEY, JSON.stringify(doc));
}

export function exportJSON(doc: CircuitDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function importJSON(text: string): CircuitDoc | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.components) && Array.isArray(parsed.wires)) {
      return parsed as CircuitDoc;
    }
  } catch {
    // ignore
  }
  return null;
}

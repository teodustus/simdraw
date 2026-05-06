import type { ComponentKind } from '../circuit/types';
import { getSymbol, type SymbolSpec, type Prim } from '../symbols/library';

/** Render a small SVG of a symbol for the palette. */
export function symbolSvg(kind: ComponentKind, size = 36): string {
  const sym = getSymbol(kind);
  const padding = 1;
  const w = sym.bbox.maxX - sym.bbox.minX + padding * 2;
  const h = Math.max(sym.bbox.maxY - sym.bbox.minY, 2) + padding * 2;
  const minX = sym.bbox.minX - padding;
  const minY = (sym.bbox.maxY + sym.bbox.minY - h) / 2;
  const lines = primitivesToSvg(sym);
  const aspect = w / h;
  const svgH = Math.round(size / aspect);
  return `<svg viewBox="${minX} ${minY} ${w} ${h}" width="${size}" height="${svgH}" preserveAspectRatio="xMidYMid meet" stroke="#cbd6ee" fill="none" stroke-width="0.18" stroke-linecap="round" stroke-linejoin="round">${lines}</svg>`;
}

function primitivesToSvg(sym: SymbolSpec): string {
  const out: string[] = [];
  for (const p of sym.prims) out.push(primToSvg(p));
  for (const pin of sym.pins) {
    out.push(`<circle cx="${pin.x}" cy="${pin.y}" r="0.15" fill="#7cf3a0" stroke="none" />`);
  }
  return out.join('');
}

function primToSvg(p: Prim): string {
  if (p.type === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" />`;
  if (p.type === 'circle') {
    const fill = p.fill ? '#cbd6ee' : 'none';
    return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${fill}" />`;
  }
  if (p.type === 'arc') {
    const x0 = p.cx + Math.cos(p.a0) * p.r;
    const y0 = p.cy + Math.sin(p.a0) * p.r;
    const x1 = p.cx + Math.cos(p.a1) * p.r;
    const y1 = p.cy + Math.sin(p.a1) * p.r;
    const large = Math.abs(p.a1 - p.a0) > Math.PI ? 1 : 0;
    const sweep = p.a1 > p.a0 ? 1 : 0;
    return `<path d="M ${x0} ${y0} A ${p.r} ${p.r} 0 ${large} ${sweep} ${x1} ${y1}" />`;
  }
  // poly
  const pts: string[] = [];
  for (let i = 0; i < p.pts.length; i += 2) pts.push(`${p.pts[i]},${p.pts[i+1]}`);
  if (p.closed) {
    return `<polygon points="${pts.join(' ')}" fill="rgba(203,214,238,0.2)" />`;
  }
  return `<polyline points="${pts.join(' ')}" />`;
}

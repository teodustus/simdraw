/** Dense LU solver with partial pivoting for small systems (< 200 unknowns). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  if (n === 0) return [];
  // Make copies to avoid mutating caller
  const M = A.map(r => r.slice());
  const x = b.slice();

  for (let k = 0; k < n; k++) {
    // pivot
    let maxRow = k;
    let maxVal = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k]);
      if (v > maxVal) { maxVal = v; maxRow = i; }
    }
    if (maxVal < 1e-18) return null; // singular
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow], M[k]];
      [x[k], x[maxRow]] = [x[maxRow], x[k]];
    }
    const pivot = M[k][k];
    for (let i = k + 1; i < n; i++) {
      const factor = M[i][k] / pivot;
      if (factor === 0) continue;
      for (let j = k; j < n; j++) M[i][j] -= factor * M[k][j];
      x[i] -= factor * x[k];
    }
  }
  // back-substitution
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * out[j];
    out[i] = s / M[i][i];
  }
  return out;
}

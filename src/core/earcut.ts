export type P2 = [number, number];

const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function inTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  const eps = -1e-9;
  return cross(a, b, p) >= eps && cross(b, c, p) >= eps && cross(c, a, p) >= eps;
}

/** Triangulates a simple polygon (no holes) by ear clipping; returns index triples. */
export function earcut(poly: P2[]): [number, number, number][] {
  let idx = poly.map((_, i) => i);
  const signed = poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (signed < 0) idx.reverse();
  const out: [number, number, number][] = [];
  while (idx.length > 3) {
    const n = idx.length;
    let clipped = false;
    for (let k = 0; k < n && !clipped; k++) {
      const [i, j, l] = [idx[(k + n - 1) % n], idx[k], idx[(k + 1) % n]];
      const [a, b, c] = [poly[i], poly[j], poly[l]];
      if (cross(a, b, c) <= 1e-9) continue;
      const blocked = idx.some((m) => {
        if (m === i || m === j || m === l) return false;
        const p = poly[m];
        const same = (q: P2) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
        return !same(a) && !same(b) && !same(c) && inTriangle(p, a, b, c);
      });
      if (blocked) continue;
      out.push([i, j, l]);
      idx = idx.filter((_, q) => q !== k);
      clipped = true;
    }
    if (!clipped) {
      // Only straight (collinear) corners are left to remove; they carry no area.
      const k = idx.findIndex((_, q) => Math.abs(cross(poly[idx[(q + n - 1) % n]], poly[idx[q]], poly[idx[(q + 1) % n]])) <= 1e-9);
      if (k < 0) break;
      idx = idx.filter((_, q) => q !== k);
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

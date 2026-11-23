import { bounds, dist, edges } from './measure';
import type { Model, Vec3 } from './types';

export type ViewId = 'front' | 'side' | 'plan';
export type P2 = [number, number];

export interface Dim2D {
  a: P2;
  b: P2;
  label: string;
  value: number;
  /** True for the overall width/height of the view, drawn outside the outline. */
  extent?: 'h' | 'v';
}

export interface View2D {
  id: ViewId;
  segs: [P2, P2][];
  dims: Dim2D[];
  w: number;
  h: number;
}

/** Axis indices (horizontal, vertical) and their names for each view. */
const AXES: Record<ViewId, [number, number, string, string]> = {
  front: [0, 2, 'X', 'Z'],
  side: [1, 2, 'Y', 'Z'],
  plan: [0, 1, 'X', 'Y'],
};

export const VIEWS: ViewId[] = ['front', 'side', 'plan'];

/** Orthographic wireframe of the model, shifted so its lower-left corner is (0, 0). */
export function project(model: Model, id: ViewId): View2D {
  const [i, j, hn, vn] = AXES[id];
  const { min, max } = bounds(model);
  const to2 = (p: Vec3): P2 => [p[i] - min[i], p[j] - min[j]];
  const w = max[i] - min[i];
  const h = max[j] - min[j];

  const seen = new Set<string>();
  const segs: [P2, P2][] = [];
  const r = (n: number) => Math.round(n * 1000);
  for (const [p, q] of edges(model)) {
    const a = to2(p);
    const b = to2(q);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) continue;
    const ka = `${r(a[0])},${r(a[1])}`;
    const kb = `${r(b[0])},${r(b[1])}`;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segs.push([a, b]);
  }

  const dims: Dim2D[] = [
    { a: [0, 0], b: [w, 0], label: hn, value: w, extent: 'h' },
    { a: [0, 0], b: [0, h], label: vn, value: h, extent: 'v' },
  ];
  const seenDim = new Set<string>();
  for (const d of model.dims) {
    const value = dist(d.a, d.b);
    const a = to2(d.a);
    const b = to2(d.b);
    // Only dimensions that appear at true length in this view.
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < value * 0.999) continue;
    if (seenDim.has(d.label)) continue;
    seenDim.add(d.label);
    dims.push({ a, b, label: d.label, value });
  }
  return { id, segs, dims, w, h };
}

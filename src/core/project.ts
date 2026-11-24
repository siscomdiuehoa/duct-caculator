import { dimShape, dimStyle, outward, stack, type DimShape, type DimStyle } from './dimension';
import { bounds, dist, edges, flanges } from './measure';
import type { Model, Panel, Vec3 } from './types';

export type ViewId = 'front' | 'side' | 'plan';
export type P2 = [number, number];

export interface Dim2D {
  a: P2;
  b: P2;
  label: string;
  value: number;
  /** True for the overall width/height of the view. */
  extent?: 'h' | 'v';
  /** Extension lines, dimension line, arrowheads and text anchor, clear of the outline. */
  shape: DimShape;
}

export interface View2D {
  id: ViewId;
  segs: [P2, P2][];
  flangeSegs: [P2, P2][];
  dims: Dim2D[];
  w: number;
  h: number;
  /** Drawing extent including the dimensions: [minX, minY, maxX, maxY]. */
  box: [number, number, number, number];
  style: DimStyle;
}

/** Axis indices (horizontal, vertical) and their names for each view. */
const AXES: Record<ViewId, [number, number, string, string]> = {
  front: [0, 2, 'X', 'Z'],
  side: [1, 2, 'Y', 'Z'],
  plan: [0, 1, 'X', 'Y'],
};

export const VIEWS: ViewId[] = ['front', 'side', 'plan'];

/**
 * Orthographic wireframe of the model, shifted so its lower-left corner is (0, 0).
 * The overall size includes the flanges, as that is what has to fit on site.
 */
export function project(model: Model, id: ViewId, flange = 0, size?: number): View2D {
  const [i, j, hn, vn] = AXES[id];
  const rings = flanges(model, flange);
  const { min, max } = bounds({ ...model, panels: [...model.panels, ...rings] });
  const to2 = (p: Vec3): P2 => [p[i] - min[i], p[j] - min[j]];
  const w = max[i] - min[i];
  const h = max[j] - min[j];

  const r = (n: number) => Math.round(n * 1000);
  const outline = (panels: Panel[]): [P2, P2][] => {
    const seen = new Set<string>();
    const out: [P2, P2][] = [];
    for (const [p, q] of edges(panels)) {
      const a = to2(p);
      const b = to2(q);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) continue;
      const ka = `${r(a[0])},${r(a[1])}`;
      const kb = `${r(b[0])},${r(b[1])}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
    return out;
  };
  const segs = outline(model.panels);
  const flangeSegs = outline(rings);

  const raw: Omit<Dim2D, 'shape'>[] = [
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
    raw.push({ a, b, label: d.label, value });
  }

  // An overall size that a named dimension already gives is not repeated.
  const same = (p: Omit<Dim2D, 'shape'>, q: Omit<Dim2D, 'shape'>) =>
    Math.abs(Math.abs(p.b[0] - p.a[0]) - Math.abs(q.b[0] - q.a[0])) < 1e-6 &&
    Math.abs(Math.abs(p.b[1] - p.a[1]) - Math.abs(q.b[1] - q.a[1])) < 1e-6;
  for (let k = raw.length - 1; k >= 0; k--) {
    if (raw[k].extent && raw.some((o) => !o.extent && same(o, raw[k]))) raw.splice(k, 1);
  }

  const st = dimStyle(size ?? Math.max(w, h));
  const centre = [w / 2, h / 2];
  const sides = raw.map((d) => (d.extent === 'h' ? [0, -1] : d.extent === 'v' ? [-1, 0] : outward(d.a, d.b, centre)));
  const offs = stack(
    raw.map((d, k) => ({ n: sides[k], len: d.value })),
    st,
  );
  const dims: Dim2D[] = raw.map((d, k) => ({ ...d, shape: dimShape(d.a, d.b, sides[k], offs[k], st) }));

  const box: View2D['box'] = [0, 0, w, h];
  const grow = (p: number[], rx = 0, ry = rx) => {
    box[0] = Math.min(box[0], p[0] - rx);
    box[1] = Math.min(box[1], p[1] - ry);
    box[2] = Math.max(box[2], p[0] + rx);
    box[3] = Math.max(box[3], p[1] + ry);
  };
  for (const { shape } of dims) {
    shape.ext.forEach(([p, q]) => (grow(p), grow(q)));
    grow(shape.line[0]);
    grow(shape.line[1]);
    // Room for text of about nine characters, turned to the dimension's angle.
    const r = (shape.angle * Math.PI) / 180;
    const half = 2.7 * st.text;
    grow(shape.text, Math.abs(Math.cos(r)) * half + Math.abs(Math.sin(r)) * st.text, Math.abs(Math.sin(r)) * half + Math.abs(Math.cos(r)) * st.text);
  }
  return { id, segs, flangeSegs, dims, w, h, box, style: st };
}

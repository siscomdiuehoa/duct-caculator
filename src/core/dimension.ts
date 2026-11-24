/**
 * Dimension geometry following ISO 129-1 / ASME Y14.5 drawing practice:
 * thin extension lines that start a small gap off the part and run a little past the
 * dimension line, a dimension line parallel to the measured feature and kept clear of the
 * part, filled arrowheads, text above the line reading from the bottom or the right,
 * and shorter dimensions nearer the part than longer ones.
 *
 * Works on 2D and 3D points alike (plain number arrays).
 */
export type V = number[];

const sub = (a: V, b: V): V => a.map((x, i) => x - b[i]);
const add = (a: V, b: V): V => a.map((x, i) => x + b[i]);
const mul = (a: V, k: number): V => a.map((x) => x * k);
const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i], 0);
const len = (a: V) => Math.hypot(...a);
const unit = (a: V): V => mul(a, 1 / (len(a) || 1));

/** Drawing proportions, all derived from one unit `t` that scales with the drawing. */
export interface DimStyle {
  t: number;
  /** Space between the part and the start of an extension line. */
  gap: number;
  /** How far an extension line runs past the dimension line. */
  over: number;
  arrow: number;
  /** Distance of the first dimension line from the part, and between stacked ones. */
  first: number;
  step: number;
  /** Text height. */
  text: number;
}

export function dimStyle(size: number): DimStyle {
  const t = Math.max(size, 1) / 28;
  return { t, gap: 0.3 * t, over: 0.5 * t, arrow: 0.9 * t, first: 2.4 * t, step: 2.4 * t, text: 1.25 * t };
}

export interface DimShape {
  ext: [V, V][];
  line: [V, V];
  /** Filled triangles, tip first. */
  arrows: [V, V, V][];
  /** Anchor of the text (baseline centre in 2D, centre of the line in 3D). */
  text: V;
  /** Text rotation in degrees (2D only), kept within (-90, 90] so it never reads upside down. */
  angle: number;
}

/**
 * Side of the part a dimension goes on: away from the centre, perpendicular to the measured
 * line, and snapped to a coordinate axis whenever the line itself is axis-aligned.
 */
export function outward(a: V, b: V, centre: V): V {
  const u = unit(sub(b, a));
  const mid = a.map((x, i) => (x + b[i]) / 2);
  let d = sub(mid, centre);
  d = sub(d, mul(u, dot(d, u)));
  if (len(d) < 1e-6) {
    if (a.length === 2) d = [-u[1], u[0]];
    else {
      const cross = (p: V, q: V): V => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      d = cross(u, [0, 0, 1]);
      if (len(d) < 1e-6) d = cross(u, [1, 0, 0]);
    }
  }
  const aligned = u.filter((c) => Math.abs(c) > 1e-6).length === 1;
  if (!aligned) return unit(d);
  let k = 0;
  d.forEach((c, i) => {
    if (Math.abs(c) > Math.abs(d[k])) k = i;
  });
  return d.map((c, i) => (i === k ? Math.sign(c) || 1 : 0));
}

/** Distance of each dimension line from the part: dimensions on the same side stack, shortest first. */
export function stack(items: { n: V; len: number }[], st: DimStyle): number[] {
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    const key = it.n.map((c) => c.toFixed(2)).join(',');
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out = new Array<number>(items.length).fill(st.first);
  for (const ids of groups.values()) {
    ids.sort((p, q) => items[p].len - items[q].len);
    ids.forEach((id, k) => (out[id] = st.first + k * st.step));
  }
  return out;
}

export function dimShape(a: V, b: V, side: V, off: number, st: DimStyle): DimShape {
  const u = unit(sub(b, a));
  const n = unit(sub(side, mul(u, dot(side, u))));
  const pa = add(a, mul(n, off));
  const pb = add(b, mul(n, off));
  const ext: [V, V][] = [
    [add(a, mul(n, st.gap)), add(a, mul(n, off + st.over))],
    [add(b, mul(n, st.gap)), add(b, mul(n, off + st.over))],
  ];
  const wing = st.arrow / 4;
  const arrow = (tip: V, dir: V): [V, V, V] => {
    const base = add(tip, mul(dir, st.arrow));
    return [tip, add(base, mul(n, wing)), sub(base, mul(n, wing))];
  };
  const mid = a.map((_, i) => (pa[i] + pb[i]) / 2);

  let angle = 0;
  let text = mid;
  if (a.length === 2) {
    angle = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    const r = (angle * Math.PI) / 180;
    text = add(mid, mul([-Math.sin(r), Math.cos(r)], st.t * 0.3));
  }
  return { ext, line: [pa, pb], arrows: [arrow(pa, u), arrow(pb, mul(u, -1))], text, angle };
}

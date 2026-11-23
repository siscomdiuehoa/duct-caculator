import type { Model, Panel, Vec3 } from './types';

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const dist = (p: Vec3, q: Vec3): number => Math.hypot(...sub(p, q));

function triArea(p: Vec3, q: Vec3, r: Vec3): number {
  const u = sub(q, p);
  const v = sub(r, p);
  return 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
}

/** Triangles of every panel, as a flat list of corner triples. */
export function triangles(panels: Panel[]): [Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3][] = [];
  for (const { a, b, tris } of panels) {
    if (tris) {
      out.push(...tris);
      continue;
    }
    for (let i = 0; i + 1 < a.length; i++) {
      out.push([a[i], a[i + 1], b[i + 1]], [a[i], b[i + 1], b[i]]);
    }
  }
  return out;
}

/** Sheet area in mm². */
export function area(model: Model): number {
  return triangles(model.panels).reduce((s, [p, q, r]) => s + triArea(p, q, r), 0);
}

/** Sheet weight in kg for thickness in mm and density in kg/m³. */
export function weightKg(model: Model, thicknessMm: number, density: number): number {
  return (area(model) / 1e6) * (thicknessMm / 1e3) * density;
}

/** Visible edges: both rails of every panel plus its rungs, or the panel's explicit lines. */
export function edges(panels: Panel[]): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (const { a, b, lines, rungs } of panels) {
    if (lines) {
      out.push(...lines);
      continue;
    }
    if (!a.length) continue;
    for (let i = 0; i + 1 < a.length; i++) out.push([a[i], a[i + 1]], [b[i], b[i + 1]]);
    for (const i of rungs ?? [0, a.length - 1]) out.push([a[i], b[i]]);
  }
  return out;
}

export function bounds(model: Model): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { a, b, tris } of model.panels) {
    for (const p of [...a, ...b, ...(tris ?? []).flat()]) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  return { min, max };
}

const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const unit = (u: Vec3): Vec3 => {
  const l = Math.hypot(...u) || 1;
  return [u[0] / l, u[1] / l, u[2] / l];
};

/** Unit normal of a flat loop (Newell's method). */
export function loopNormal(loop: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return unit(n);
}

/**
 * Flat flange frames of the given width around every opening, in the plane of the opening.
 * Each edge moves outwards by the width and neighbouring edges meet in a mitre, which gives
 * square corners on rectangles and a concentric ring on round collars.
 */
export function flanges(model: Model, width: number): Panel[] {
  if (!(width > 0)) return [];
  return model.openings.map((loop, k) => {
    const n = loopNormal(loop);
    const m = loop.length;
    const centre = loop.reduce<Vec3>((c, p) => [c[0] + p[0] / m, c[1] + p[1] / m, c[2] + p[2] / m], [0, 0, 0]);
    const outward = (i: number): Vec3 => unit(cross(sub(loop[(i + 1) % m], loop[i]), n));
    // Pick the side of the first edge that faces away from the centre; the loop is convex.
    const mid0 = loop[0].map((v, j) => (v + loop[1 % m][j]) / 2) as Vec3;
    const sign = dot(outward(0), sub(mid0, centre)) < 0 ? -1 : 1;
    const outer = loop.map((c, i): Vec3 => {
      if (m > 8) {
        // Round collar: push each point straight out from the centre so the rim stays a true circle.
        const d = sub(c, centre);
        const f = width / (Math.hypot(...d) || 1);
        return [c[0] + f * d[0], c[1] + f * d[1], c[2] + f * d[2]];
      }
      const o1 = outward((i + m - 1) % m);
      const o2 = outward(i);
      const f = (sign * width) / (1 + dot(o1, o2));
      return [c[0] + f * (o1[0] + o2[0]), c[1] + f * (o1[1] + o2[1]), c[2] + f * (o1[2] + o2[2])];
    });
    // Corners of a rectangular flange are visible edges; a round flange is just two circles.
    const rungs = m <= 8 ? loop.map((_, i) => i) : [];
    return { name: `flange-${k}`, a: [...loop, loop[0]], b: [...outer, outer[0]], rungs };
  });
}

/** Total length of flange profile needed: the perimeter of every opening, in mm. */
export function flangeLength(model: Model): number {
  return model.openings.reduce((s, loop) => s + loop.reduce((t, c, i) => t + dist(c, loop[(i + 1) % loop.length]), 0), 0);
}

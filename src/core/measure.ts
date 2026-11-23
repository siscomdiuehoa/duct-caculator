import type { Model, Vec3 } from './types';

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const dist = (p: Vec3, q: Vec3): number => Math.hypot(...sub(p, q));

function triArea(p: Vec3, q: Vec3, r: Vec3): number {
  const u = sub(q, p);
  const v = sub(r, p);
  return 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
}

/** Triangles of every panel, as a flat list of corner triples. */
export function triangles(model: Model): [Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3][] = [];
  for (const { a, b } of model.panels) {
    for (let i = 0; i + 1 < a.length; i++) {
      out.push([a[i], a[i + 1], b[i + 1]], [a[i], b[i + 1], b[i]]);
    }
  }
  return out;
}

/** Sheet area in mm². */
export function area(model: Model): number {
  return triangles(model).reduce((s, [p, q, r]) => s + triArea(p, q, r), 0);
}

/** Sheet weight in kg for thickness in mm and density in kg/m³. */
export function weightKg(model: Model, thicknessMm: number, density: number): number {
  return (area(model) / 1e6) * (thicknessMm / 1e3) * density;
}

/** Outline edges: both rails of every panel plus its two end rungs. */
export function edges(model: Model): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (const { a, b } of model.panels) {
    for (let i = 0; i + 1 < a.length; i++) out.push([a[i], a[i + 1]], [b[i], b[i + 1]]);
    out.push([a[0], b[0]], [a[a.length - 1], b[b.length - 1]]);
  }
  return out;
}

export function bounds(model: Model): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { a, b } of model.panels) {
    for (const p of [...a, ...b]) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  return { min, max };
}

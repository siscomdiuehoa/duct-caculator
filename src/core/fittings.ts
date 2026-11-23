import type { Dim, FittingDef, Model, Panel, ParamDef, Params, Vec3 } from './types';

const ARC_STEPS = 48;

const size = (key: string, def: number, max = 5000): ParamDef => ({ key, def, min: 1, max, step: 1 });

/** Four panels joining consecutive rectangular sections (corners in loop order). */
function sweep(sections: Vec3[][], names: string[]): Panel[] {
  return [0, 1, 2, 3].map((k) => ({
    name: names[k],
    a: sections.map((s) => s[k]),
    b: sections.map((s) => s[(k + 1) % 4]),
  }));
}

const rect = (x0: number, x1: number, y0: number, y1: number, z: number): Vec3[] => [
  [x0, y0, z],
  [x1, y0, z],
  [x1, y1, z],
  [x0, y1, z],
];

const quad = (name: string, p: Vec3, q: Vec3, r: Vec3, s: Vec3): Panel => ({ name, a: [p, q], b: [s, r] });

const SIDES = ['front', 'right', 'back', 'left'];

function baseValidate(def: ParamDef[], p: Params): string | null {
  for (const d of def) {
    const v = p[d.key];
    if (!Number.isFinite(v) || v < d.min || v > d.max) return 'err.range';
  }
  return null;
}

const straight: FittingDef = {
  id: 'straight',
  params: [size('W', 400), size('H', 300), size('L', 1000, 20000)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, L }): Model {
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [W, 0, 0], b: [W, H, 0], label: 'H' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
    ];
    return { panels: sweep([rect(0, W, 0, H, 0), rect(0, W, 0, H, L)], SIDES), dims };
  },
};

const reducer: FittingDef = {
  id: 'reducer',
  params: [size('W1', 400), size('H1', 300), size('W2', 200), size('H2', 200), size('L', 500, 20000)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W1, H1, W2, H2, L }): Model {
    const dx = (W1 - W2) / 2;
    const dy = (H1 - H2) / 2;
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W1, 0, 0], label: 'W1' },
      { a: [W1, 0, 0], b: [W1, H1, 0], label: 'H1' },
      { a: [dx, dy, L], b: [dx + W2, dy, L], label: 'W2' },
      { a: [dx + W2, dy, L], b: [dx + W2, dy + H2, L], label: 'H2' },
      { a: [Math.min(0, dx), 0, 0], b: [Math.min(0, dx), 0, L], label: 'L' },
    ];
    return {
      panels: sweep([rect(0, W1, 0, H1, 0), rect(dx, dx + W2, dy, dy + H2, L)], SIDES),
      dims,
    };
  },
};

const elbow90: FittingDef = {
  id: 'elbow90',
  params: [size('W', 400), size('H', 300), size('R', 200)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, R }): Model {
    // Inlet lies in the X-Y plane at z = 0; the bend turns towards +X around (W + R, y, 0).
    const cx = W + R;
    const at = (r: number, t: number, y: number): Vec3 => [cx - r * Math.cos(t), y, r * Math.sin(t)];
    const sections: Vec3[][] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = (Math.PI / 2) * (i / ARC_STEPS);
      sections.push([at(R + W, t, 0), at(R, t, 0), at(R, t, H), at(R + W, t, H)]);
    }
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [0, 0, 0], b: [0, H, 0], label: 'H' },
      { a: [cx, 0, 0], b: at(R, Math.PI / 4, 0), label: 'R' },
    ];
    return { panels: sweep(sections, ['front', 'inner', 'back', 'outer']), dims };
  },
};

const tee: FittingDef = {
  id: 'tee',
  params: [size('W', 400), size('H', 300), size('L', 1000, 20000), size('Wb', 300), size('Lb', 250)],
  validate(p) {
    return baseValidate(this.params, p) ?? (p.Wb >= p.L ? 'err.branch' : null);
  },
  build({ W, H, L, Wb, Lb }): Model {
    // Main duct runs along Z; the branch leaves the x = W wall, centred, with the same depth H.
    const z1 = (L - Wb) / 2;
    const z2 = z1 + Wb;
    const xb = W + Lb;
    const panels: Panel[] = [
      quad('left', [0, 0, 0], [0, H, 0], [0, H, L], [0, 0, L]),
      quad('front', [0, 0, 0], [W, 0, 0], [W, 0, L], [0, 0, L]),
      quad('back', [0, H, 0], [W, H, 0], [W, H, L], [0, H, L]),
      quad('right-low', [W, 0, 0], [W, H, 0], [W, H, z1], [W, 0, z1]),
      quad('right-high', [W, 0, z2], [W, H, z2], [W, H, L], [W, 0, L]),
      quad('branch-low', [W, 0, z1], [xb, 0, z1], [xb, H, z1], [W, H, z1]),
      quad('branch-high', [W, 0, z2], [xb, 0, z2], [xb, H, z2], [W, H, z2]),
      quad('branch-front', [W, 0, z1], [xb, 0, z1], [xb, 0, z2], [W, 0, z2]),
      quad('branch-back', [W, H, z1], [xb, H, z1], [xb, H, z2], [W, H, z2]),
    ];
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [0, 0, 0], b: [0, H, 0], label: 'H' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
      { a: [xb, 0, z1], b: [xb, 0, z2], label: 'Wb' },
      { a: [W, 0, z2], b: [xb, 0, z2], label: 'Lb' },
    ];
    return { panels, dims };
  },
};

export const FITTINGS: FittingDef[] = [straight, elbow90, reducer, tee];

export function getFitting(id: string): FittingDef | undefined {
  return FITTINGS.find((f) => f.id === id);
}

export function defaults(f: FittingDef): Params {
  return Object.fromEntries(f.params.map((d) => [d.key, d.def]));
}

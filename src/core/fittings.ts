import { earcut, type P2 } from './earcut';
import { loopNormal } from './measure';
import type { Dim, FittingDef, Model, Panel, ParamDef, Params, Vec3 } from './types';

const ARC_STEPS = 48;
/** Points around a round collar; a multiple of 4 so the quadrant points exist. */
const ROUND_STEPS = 64;

const size = (key: string, def: number, max = 5000): ParamDef => ({ key, def, min: 1, max, step: 1 });
/** A length that may be zero, such as a tangent straight. */
const length = (key: string, def: number, max = 5000): ParamDef => ({ key, def, min: 0, max, step: 1 });
const count = (key: string, def: number, max: number, min = 1): ParamDef => ({ key, def, min, max, step: 1, kind: 'count' });
const named = (d: ParamDef, label: string): ParamDef => ({ ...d, label });

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

/** Removes repeated consecutive points, including a last point equal to the first. */
function dedupe(pts: P2[]): P2[] {
  const same = (p: P2, q: P2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
  const out = pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Points on a circle of radius r around (cx, cz), from angle t0 to t1 inclusive. */
function arc(cx: number, cz: number, r: number, t0: number, t1: number, steps = ARC_STEPS): P2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / steps;
    return [cx + r * Math.cos(t), cz + r * Math.sin(t)] as P2;
  });
}

/** A flat plate bounded by one simple loop. */
function plate(name: string, loop: Vec3[]): Panel {
  const n = loopNormal(loop);
  const ax = n.map(Math.abs);
  // Triangulate in the coordinate plane the plate is most nearly parallel to.
  const [i, j] = ax[0] >= ax[1] && ax[0] >= ax[2] ? [1, 2] : ax[1] >= ax[2] ? [2, 0] : [0, 1];
  const tris = earcut(loop.map((p) => [p[i], p[j]] as P2)).map(([a, b, c]) => [loop[a], loop[b], loop[c]] as [Vec3, Vec3, Vec3]);
  return { name, a: [], b: [], tris, lines: loop.map((p, k) => [p, loop[(k + 1) % loop.length]] as [Vec3, Vec3]) };
}

/**
 * A rectangle (centre cx, cy, size w x h) and a concentric circle sampled at the same angles,
 * with the rectangle corners included, so the two can be joined by straight rungs.
 */
function rectRound(cx: number, cy: number, w: number, h: number, r: number) {
  const tau = Math.PI * 2;
  const norm = (t: number) => ((t % tau) + tau) % tau;
  const cornerAngles = [Math.atan2(h, w), Math.atan2(h, -w), Math.atan2(-h, -w), Math.atan2(-h, w)].map(norm);
  const angles = [...Array.from({ length: ROUND_STEPS }, (_, k) => (tau * k) / ROUND_STEPS), ...cornerAngles]
    .sort((a, b) => a - b)
    .filter((t, k, all) => k === 0 || t - all[k - 1] > 1e-9);
  const rect = angles.map((t): P2 => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const d = Math.min(Math.abs(c) > 1e-12 ? w / 2 / Math.abs(c) : Infinity, Math.abs(s) > 1e-12 ? h / 2 / Math.abs(s) : Infinity);
    return [cx + d * c, cy + d * s];
  });
  const circ = angles.map((t): P2 => [cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  const find = (t: number) => angles.findIndex((u) => Math.abs(u - t) < 1e-9);
  return { rect, circ, corners: cornerAngles.map(find), quadrants: [0, 1, 2, 3].map((q) => find((q * tau) / 4)) };
}

const closed = <T>(loop: T[]): T[] => [...loop, loop[0]];

/** A flat plate between an outer rectangle and an inner circle: a panel face with a round hole. */
function holedPlate(name: string, outer: Vec3[], inner: Vec3[]): Panel {
  const a = closed(outer);
  const b = closed(inner);
  const lines: [Vec3, Vec3][] = inner.map((p, k) => [p, inner[(k + 1) % inner.length]]);
  return { name, a, b, lines };
}

/** A round collar: a cylinder between two circles, with its four quadrant lines as edges. */
function collar(name: string, base: Vec3[], end: Vec3[], quadrants: number[]): Panel {
  return { name, a: closed(base), b: closed(end), rungs: quadrants };
}

const xz = (p: P2, y: number): Vec3 => [p[0], y, p[1]];
/** A wall swept through depth H along a path drawn in the X-Z plane. */
const wall = (name: string, path: P2[], H: number): Panel => ({ name, a: path.map((p) => xz(p, 0)), b: path.map((p) => xz(p, H)) });

/**
 * Trunk with two side branches in the X-Z plane, depth H along Y. Inlet A (width W1) sits at the
 * bottom; each side wall turns outwards through radius R into a branch of width W2 that runs a
 * further E. With W3 > 0 a neck of width W3 continues up to outlet C at height L; otherwise the
 * top is closed flat across both branches.
 */
function branchCross({ W1, W2, W3, H, L, R, E }: { W1: number; W2: number; W3: number; H: number; L: number; R: number; E: number }): Model {
  const a = W1 / 2;
  const xe = a + R + E;
  const zt = R + W2;
  const arcR = arc(a + R, 0, R, Math.PI, Math.PI / 2);
  const arcL = arcR.map(([x, z]): P2 => [-x, z]).reverse();
  const top: P2[] = W3 > 0 ? [[xe, zt], [W3 / 2, zt], [W3 / 2, L], [-W3 / 2, L], [-W3 / 2, zt], [-xe, zt]] : [[xe, zt], [-xe, zt]];
  const outline = dedupe([[-a, 0], ...arcR, [xe, R], ...top, [-xe, R], ...arcL]);
  const panels: Panel[] = [
    plate('front', outline.map((p) => xz(p, 0))),
    plate('back', outline.map((p) => xz(p, H))),
    wall('arc-right', arcR, H),
    wall('arc-left', arcL, H),
  ];
  if (E > 0) panels.push(wall('branch-right', [[a + R, R], [xe, R]], H), wall('branch-left', [[-xe, R], [-a - R, R]], H));
  if (W3 > 0) {
    panels.push(
      wall('top-right', [[xe, zt], [W3 / 2, zt]], H),
      wall('neck-right', [[W3 / 2, zt], [W3 / 2, L]], H),
      wall('top-left', [[-W3 / 2, zt], [-xe, zt]], H),
      wall('neck-left', [[-W3 / 2, L], [-W3 / 2, zt]], H),
    );
  } else {
    panels.push(wall('top', [[xe, zt], [-xe, zt]], H));
  }
  const mouth = (p: P2, q: P2): Vec3[] => [xz(p, 0), xz(q, 0), xz(q, H), xz(p, H)];
  const openings = [mouth([-a, 0], [a, 0]), mouth([xe, R], [xe, zt]), mouth([-xe, zt], [-xe, R])];
  if (W3 > 0) openings.push(mouth([W3 / 2, L], [-W3 / 2, L]));
  const mid = arcR[ARC_STEPS / 2];
  const dims: Dim[] = [
    { a: [-a, 0, 0], b: [a, 0, 0], label: 'W1' },
    { a: [a, 0, 0], b: [a, H, 0], label: 'H' },
    { a: [xe, 0, R], b: [xe, 0, zt], label: 'W2' },
    { a: [a + R, 0, 0], b: xz(mid, 0), label: 'R' },
  ];
  if (W3 > 0) dims.push({ a: [-W3 / 2, 0, L], b: [W3 / 2, 0, L], label: 'W3' }, { a: [-xe, 0, 0], b: [-xe, 0, L], label: 'L' });
  if (E > 0) dims.push({ a: [a + R, 0, R], b: [xe, 0, R], label: 'E' });
  return { panels, dims, openings };
}

function baseValidate(def: ParamDef[], p: Params): string | null {
  for (const d of def) {
    const v = p[d.key];
    if (!Number.isFinite(v) || v < d.min || v > d.max) return 'err.range';
    if (d.kind === 'count' && !Number.isInteger(v)) return 'err.range';
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
    const ends = [rect(0, W, 0, H, 0), rect(0, W, 0, H, L)];
    return { panels: sweep(ends, SIDES), dims, openings: ends };
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
    const ends = [rect(0, W1, 0, H1, 0), rect(dx, dx + W2, dy, dy + H2, L)];
    return { panels: sweep(ends, SIDES), dims, openings: ends };
  },
};

const elbow90: FittingDef = {
  id: 'elbow90',
  params: [size('W', 500), size('H', 300), size('R', 225), length('A', 60), length('B', 60)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, R, A, B }): Model {
    // Inlet A faces -X at x = 0. After a straight of length A the duct bends upwards in the
    // X-Z plane around (A, y, H + R), then runs straight for B to outlet B, which faces +Z.
    // H lies in the bend plane; W is the depth along Y.
    const zc = H + R;
    const top = zc + B;
    const at = (r: number, t: number, y: number): Vec3 => [A + r * Math.sin(t), y, zc - r * Math.cos(t)];
    const ring = (f: (r: number, y: number) => Vec3): Vec3[] => [f(R + H, 0), f(R, 0), f(R, W), f(R + H, W)];
    const inlet = ring((r, y) => [0, y, zc - r]);
    const outlet = ring((r, y) => [A + r, y, top]);
    const sections: Vec3[][] = [inlet];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = (Math.PI / 2) * (i / ARC_STEPS);
      sections.push(ring((r, y) => at(r, t, y)));
    }
    sections.push(outlet);
    const xm = A + R + H / 2;
    const dims: Dim[] = [
      { a: [0, 0, H / 2], b: [0, W, H / 2], label: 'W A' },
      { a: [0, 0, 0], b: [0, 0, H], label: 'H A' },
      { a: [xm, 0, top], b: [xm, W, top], label: 'W B' },
      { a: [A + R, 0, top], b: [A + R + H, 0, top], label: 'H B' },
      { a: [A, 0, zc], b: at(R, Math.PI / 4, 0), label: 'R' },
    ];
    if (A > 0) dims.push({ a: [0, 0, 0], b: [A, 0, 0], label: 'A' });
    if (B > 0) dims.push({ a: [A + R + H, 0, zc], b: [A + R + H, 0, top], label: 'B' });
    return {
      panels: sweep(sections, ['front', 'inner', 'back', 'outer']),
      dims,
      openings: [inlet, outlet],
    };
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
    const openings: Vec3[][] = [
      rect(0, W, 0, H, 0),
      rect(0, W, 0, H, L),
      [
        [xb, 0, z1],
        [xb, H, z1],
        [xb, H, z2],
        [xb, 0, z2],
      ],
    ];
    return { panels, dims, openings };
  },
};

const offsetS: FittingDef = {
  id: 'offsetS',
  params: [size('W', 400), size('H', 300), named(length('S', 200), 'p.S'), size('L', 800, 20000)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, S, L }): Model {
    // The section stays level and slides S along X on a half-cosine, so both ends are square.
    const sections = Array.from({ length: ARC_STEPS + 1 }, (_, k) => {
      const z = (L * k) / ARC_STEPS;
      const x = (S * (1 - Math.cos((Math.PI * k) / ARC_STEPS))) / 2;
      return rect(x, x + W, 0, H, z);
    });
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [W, 0, 0], b: [W, H, 0], label: 'H' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
    ];
    if (S > 0) dims.push({ a: [0, 0, L], b: [S, 0, L], label: 'S' });
    return { panels: sweep(sections, SIDES), dims, openings: [sections[0], sections[ARC_STEPS]] };
  },
};

const squareElbow: FittingDef = {
  id: 'squareElbow',
  params: [size('W', 500), size('H', 300), length('A', 100), length('B', 100)],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, A, B }): Model {
    // Same frame as the radius elbow, with a mitred corner instead of the bend.
    const top = H + B;
    const ring = (outer: P2, inner: P2): Vec3[] => [xz(outer, 0), xz(inner, 0), xz(inner, W), xz(outer, W)];
    const sections = [ring([0, 0], [0, H]), ring([A + H, 0], [A, H]), ring([A + H, top], [A, top])];
    const panels = sweep(sections, ['front', 'inner', 'back', 'outer']).map((p, k) => ({
      ...p,
      // The mitre line is a crease on the inner and outer wraps, not on the flat cheeks.
      rungs: k % 2 === 1 ? [0, 1, 2] : [0, 2],
    }));
    const dims: Dim[] = [
      { a: [0, 0, H / 2], b: [0, W, H / 2], label: 'W A' },
      { a: [0, 0, 0], b: [0, 0, H], label: 'H A' },
      { a: [A, 0, top], b: [A + H, 0, top], label: 'H B' },
    ];
    if (A > 0) dims.push({ a: [0, 0, 0], b: [A, 0, 0], label: 'A' });
    if (B > 0) dims.push({ a: [A + H, 0, H], b: [A + H, 0, top], label: 'B' });
    return { panels, dims, openings: [sections[0], sections[2]] };
  },
};

const tapRound: FittingDef = {
  id: 'tapRound',
  params: [size('W', 300), size('H', 200), named(size('D', 200), 'p.D'), named(size('L', 150), 'p.tapL')],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, D, L }): Model {
    // Rectangular foot on the duct at z = 0, rising to a round neck of diameter D at z = L.
    const r = D / 2;
    const { rect: base, circ, corners } = rectRound(W / 2, H / 2, W, H, r);
    const foot = base.map(([x, y]): Vec3 => [x, y, 0]);
    const neck = circ.map(([x, y]): Vec3 => [x, y, L]);
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [W, 0, 0], b: [W, H, 0], label: 'H' },
      { a: [W / 2 - r, H / 2, L], b: [W / 2 + r, H / 2, L], label: 'D' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
    ];
    return {
      panels: [{ name: 'transition', a: closed(foot), b: closed(neck), rungs: corners }],
      dims,
      openings: [rect(0, W, 0, H, 0), neck],
    };
  },
};

const tapRect: FittingDef = {
  id: 'tapRect',
  params: [named(size('W', 300), 'p.neckW'), size('H', 200), named(length('E', 100), 'p.E'), named(size('L', 150), 'p.tapL')],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W, H, E, L }): Model {
    // Foot W + E long on the duct; the leading side slopes back over E to the W wide neck.
    const foot = rect(0, W + E, 0, H, 0);
    const neck = rect(E, W + E, 0, H, L);
    const dims: Dim[] = [
      { a: [E, 0, L], b: [W + E, 0, L], label: 'W' },
      { a: [W + E, 0, L], b: [W + E, H, L], label: 'H' },
      { a: [W + E, 0, 0], b: [W + E, 0, L], label: 'L' },
    ];
    if (E > 0) dims.push({ a: [0, 0, 0], b: [E, 0, 0], label: 'E' });
    return { panels: sweep([foot, neck], SIDES), dims, openings: [foot, neck] };
  },
};

const silencer: FittingDef = {
  id: 'silencer',
  params: [
    named(size('W', 400), 'p.mouthW'),
    named(size('H', 300), 'p.mouthH'),
    named(size('Wt', 600), 'p.Wt'),
    named(size('Ht', 500), 'p.Ht'),
    size('L', 900, 20000),
  ],
  validate(p) {
    return baseValidate(this.params, p) ?? (p.W >= p.Wt || p.H >= p.Ht ? 'err.mouth' : null);
  },
  build({ W, H, Wt, Ht, L }): Model {
    // Casing Wt x Ht x L along Z, with a centred W x H mouth in each end plate.
    const x0 = (Wt - W) / 2;
    const y0 = (Ht - H) / 2;
    const mouth = (z: number) => rect(x0, x0 + W, y0, y0 + H, z);
    const frame = (name: string, z: number): Panel => ({ name, a: closed(rect(0, Wt, 0, Ht, z)), b: closed(mouth(z)), rungs: [] });
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [Wt, 0, 0], label: 'Wt' },
      { a: [Wt, 0, 0], b: [Wt, Ht, 0], label: 'Ht' },
      { a: [x0, y0, L], b: [x0 + W, y0, L], label: 'W' },
      { a: [x0 + W, y0, L], b: [x0 + W, y0 + H, L], label: 'H' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
    ];
    return {
      panels: [...sweep([rect(0, Wt, 0, Ht, 0), rect(0, Wt, 0, Ht, L)], SIDES), frame('end-in', 0), frame('end-out', L)],
      dims,
      openings: [mouth(0), mouth(L)],
    };
  },
};

const plenum: FittingDef = {
  id: 'plenum',
  params: [
    named(size('W', 600), 'p.boxW'),
    named(size('L', 600), 'p.boxL'),
    named(size('H', 300), 'p.boxH'),
    named(size('D', 250), 'p.D'),
    named(length('C', 100), 'p.C'),
  ],
  validate(p) {
    return baseValidate(this.params, p) ?? (p.D >= Math.min(p.W, p.L) ? 'err.collar' : null);
  },
  build({ W, L, H, D, C }): Model {
    // Open bottom W x L for the diffuser, round collar on the top plate.
    const r = D / 2;
    const { rect: edge, circ, quadrants } = rectRound(W / 2, L / 2, W, L, r);
    const at = (pts: P2[], z: number) => pts.map(([x, y]): Vec3 => [x, y, z]);
    const panels: Panel[] = [
      ...sweep([rect(0, W, 0, L, 0), rect(0, W, 0, L, H)], SIDES),
      holedPlate('top', at(edge, H), at(circ, H)),
    ];
    if (C > 0) panels.push(collar('collar', at(circ, H), at(circ, H + C), quadrants));
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [W, 0, 0], b: [W, L, 0], label: 'L' },
      { a: [0, 0, 0], b: [0, 0, H], label: 'H' },
      { a: [W / 2 - r, L / 2, H + C], b: [W / 2 + r, L / 2, H + C], label: 'D' },
    ];
    if (C > 0) dims.push({ a: [W / 2 + r, L / 2, H], b: [W / 2 + r, L / 2, H + C], label: 'C' });
    // The bottom takes the diffuser and the collar takes flexible duct, so neither has a flange.
    return { panels, dims, openings: [rect(0, W, 0, L, 0), at(circ, H + C)], bare: [0, 1] };
  },
};

const fcuBox: FittingDef = {
  id: 'fcuBox',
  params: [
    named(size('W', 1000), 'p.fcuW'),
    named(size('H', 250), 'p.boxH'),
    named(size('L', 400), 'p.fcuL'),
    named(count('n', 3, 8), 'p.n'),
    named(count('nL', 0, 4, 0), 'p.nL'),
    named(count('nR', 0, 4, 0), 'p.nR'),
    named(size('D', 200), 'p.D'),
    named(length('C', 100), 'p.C'),
  ],
  validate(p) {
    const e = baseValidate(this.params, p);
    if (e) return e;
    const fits = (count: number, width: number) => count === 0 || p.D < Math.min(width / count, p.H);
    return fits(p.n, p.W) && fits(p.nL, p.L) && fits(p.nR, p.L) ? null : 'err.collar';
  },
  build({ W, H, L, n, nL, nR, D, C }): Model {
    // Box W long (X) x L deep (Y) x H high (Z). The FCU side y = 0 is open; the far face y = L
    // carries n round collars at equal spacing, and each end may carry more (nL at x = 0,
    // nR at x = W). Collars take flexible duct, so only the FCU side has a flange.
    const r = D / 2;
    const panels: Panel[] = [
      quad('bottom', [0, 0, 0], [W, 0, 0], [W, L, 0], [0, L, 0]),
      quad('top', [0, 0, H], [W, 0, H], [W, L, H], [0, L, H]),
    ];
    const openings: Vec3[][] = [[[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]]];
    /** A face of the given width split into `count` equal plates, each with a centred collar. */
    const face = (name: string, count: number, width: number, place: (u: number, z: number, out: number) => Vec3) => {
      if (count === 0) {
        panels.push(quad(name, place(0, 0, 0), place(width, 0, 0), place(width, H, 0), place(0, H, 0)));
        return;
      }
      const step = width / count;
      for (let i = 0; i < count; i++) {
        const { rect: edge, circ, quadrants } = rectRound(step * (i + 0.5), H / 2, step, H, r);
        const at = (pts: P2[], out: number) => pts.map(([u, z]) => place(u, z, out));
        panels.push(holedPlate(`${name}-${i}`, at(edge, 0), at(circ, 0)));
        if (C > 0) panels.push(collar(`${name}-collar-${i}`, at(circ, 0), at(circ, C), quadrants));
        openings.push(at(circ, C));
      }
    };
    face('face', n, W, (u, z, out) => [u, L + out, z]);
    face('end-left', nL, L, (u, z, out) => [-out, u, z]);
    face('end-right', nR, L, (u, z, out) => [W + out, u, z]);
    const cx = W / n / 2;
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [0, 0, 0], b: [0, 0, H], label: 'H' },
      { a: [W, 0, 0], b: [W, L, 0], label: 'L' },
      { a: [cx - r, L + C, H / 2], b: [cx + r, L + C, H / 2], label: 'D' },
    ];
    if (C > 0) dims.push({ a: [cx + r, L, H / 2], b: [cx + r, L + C, H / 2], label: 'C' });
    return { panels, dims, openings, bare: openings.map((_, k) => k).slice(1) };
  },
};

const bullhead: FittingDef = {
  id: 'bullhead',
  params: [
    named(size('W1', 400), 'p.cA'),
    named(size('W2', 300), 'p.bW2'),
    named(size('H', 300), 'p.depth'),
    named(length('R', 150), 'p.cR'),
    named(length('E', 100), 'p.Eb'),
  ],
  validate(p) {
    return baseValidate(this.params, p);
  },
  build({ W1, W2, H, R, E }): Model {
    return branchCross({ W1, W2, W3: 0, H, L: 0, R, E });
  },
};

const cross90: FittingDef = {
  id: 'cross90',
  params: [
    named(size('W1', 420), 'p.cA'),
    named(size('W2', 240), 'p.cB'),
    named(size('W3', 360), 'p.cC'),
    named(size('H', 250), 'p.depth'),
    named(size('L', 680), 'p.cL'),
    named(length('R', 200), 'p.cR'),
    named(length('E', 0), 'p.Eb'),
  ],
  validate(p) {
    const e = baseValidate(this.params, p);
    if (e) return e;
    if (p.L <= p.R + p.W2) return 'err.crossL';
    if (p.W3 / 2 >= p.W1 / 2 + p.R + p.E) return 'err.crossW3';
    return null;
  },
  build(p): Model {
    return branchCross({ W1: p.W1, W2: p.W2, W3: p.W3, H: p.H, L: p.L, R: p.R, E: p.E });
  },
};

const cross3: FittingDef = {
  id: 'cross3',
  params: [size('W', 400), size('H', 300), size('L', 1000, 20000), size('Wb', 300), size('Lb', 250)],
  validate(p) {
    return baseValidate(this.params, p) ?? (p.Wb >= p.L ? 'err.branch' : null);
  },
  build({ W, H, L, Wb, Lb }): Model {
    // The tee with a second branch on the opposite wall, both centred.
    const z1 = (L - Wb) / 2;
    const z2 = z1 + Wb;
    const xr = W + Lb;
    const xl = -Lb;
    const branch = (side: string, x0: number, x1: number): Panel[] => [
      quad(`${side}-low`, [x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]),
      quad(`${side}-high`, [x0, 0, z2], [x1, 0, z2], [x1, H, z2], [x0, H, z2]),
      quad(`${side}-front`, [x0, 0, z1], [x1, 0, z1], [x1, 0, z2], [x0, 0, z2]),
      quad(`${side}-back`, [x0, H, z1], [x1, H, z1], [x1, H, z2], [x0, H, z2]),
    ];
    const panels: Panel[] = [
      quad('front', [0, 0, 0], [W, 0, 0], [W, 0, L], [0, 0, L]),
      quad('back', [0, H, 0], [W, H, 0], [W, H, L], [0, H, L]),
      quad('left-wall-low', [0, 0, 0], [0, H, 0], [0, H, z1], [0, 0, z1]),
      quad('left-wall-high', [0, 0, z2], [0, H, z2], [0, H, L], [0, 0, L]),
      quad('right-wall-low', [W, 0, 0], [W, H, 0], [W, H, z1], [W, 0, z1]),
      quad('right-wall-high', [W, 0, z2], [W, H, z2], [W, H, L], [W, 0, L]),
      ...branch('right', W, xr),
      ...branch('left', xl, 0),
    ];
    const end = (x: number): Vec3[] => [
      [x, 0, z1],
      [x, H, z1],
      [x, H, z2],
      [x, 0, z2],
    ];
    const dims: Dim[] = [
      { a: [0, 0, 0], b: [W, 0, 0], label: 'W' },
      { a: [0, 0, 0], b: [0, H, 0], label: 'H' },
      { a: [0, 0, 0], b: [0, 0, L], label: 'L' },
      { a: [xr, 0, z1], b: [xr, 0, z2], label: 'Wb' },
      { a: [W, 0, z2], b: [xr, 0, z2], label: 'Lb' },
    ];
    return { panels, dims, openings: [rect(0, W, 0, H, 0), rect(0, W, 0, H, L), end(xr), end(xl)] };
  },
};

export const FITTINGS: FittingDef[] = [
  straight,
  offsetS,
  elbow90,
  reducer,
  squareElbow,
  tapRound,
  tapRect,
  silencer,
  plenum,
  fcuBox,
  tee,
  bullhead,
  cross3,
  cross90,
];

export function getFitting(id: string): FittingDef | undefined {
  return FITTINGS.find((f) => f.id === id);
}

export function defaults(f: FittingDef): Params {
  return Object.fromEntries(f.params.map((d) => [d.key, d.def]));
}

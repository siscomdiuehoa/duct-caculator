import { describe, expect, it } from 'vitest';
import { toDxf } from './dxf';
import { earcut } from './earcut';
import { FITTINGS, defaults, getFitting } from './fittings';
import { fromJson, newDesign, toJson } from './io';
import { area, bounds, edges, flangedOpenings, flangeLength, flanges } from './measure';
import { project, VIEWS } from './project';

const build = (id: string, p?: Record<string, number>) => {
  const f = getFitting(id)!;
  return f.build({ ...defaults(f), ...p });
};
const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want) / want).toBeLessThan(tol);
const PI = Math.PI;

describe('earcut', () => {
  it('splits an L shape into triangles covering its area', () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    const sum = earcut(L).reduce((s, [a, b, c]) => {
      const [p, q, r] = [L[a], L[b], L[c]];
      return s + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }, 0);
    expect(sum).toBeCloseTo(4 + 2, 9);
  });
});

describe('every fitting', () => {
  it('builds its defaults into a finite model with openings and labels it can draw', () => {
    expect(FITTINGS).toHaveLength(14);
    for (const f of FITTINGS) {
      const p = defaults(f);
      expect(f.validate(p), f.id).toBeNull();
      const m = f.build(p);
      expect(area(m), f.id).toBeGreaterThan(0);
      expect(m.openings.length, f.id).toBeGreaterThanOrEqual(2);
      const { min, max } = bounds(m);
      expect([...min, ...max].every(Number.isFinite), f.id).toBe(true);
      expect(new Set(m.dims.map((d) => d.label)).size, f.id).toBe(m.dims.length);
      expect(flanges(m, 30), f.id).toHaveLength(flangedOpenings(m).length);
      for (const v of VIEWS) expect(project(m, v, 30).segs.length, `${f.id} ${v}`).toBeGreaterThan(0);
      expect(toDxf(m, 30)).toContain('EOF');
      expect(fromJson(toJson({ ...newDesign(f.id) })).fitting).toBe(f.id);
    }
  });
});

describe('sheet area by hand', () => {
  it('S offset: two flat cheeks W x L plus two side walls H x curve length', () => {
    const [W, H, S, L] = [400, 300, 200, 800];
    let curve = 0;
    for (let i = 0, n = 20000; i < n; i++) {
      const z = (L * (i + 0.5)) / n;
      curve += (L / n) * Math.hypot(1, ((S * PI) / (2 * L)) * Math.sin((PI * z) / L));
    }
    close(area(build('offsetS')), 2 * W * L + 2 * H * curve, 0.001);
    expect(area(build('offsetS', { S: 0 }))).toBeCloseTo(2 * (W + H) * L, 6);
  });
  it('square elbow: two L-shaped cheeks and the inner and outer wraps', () => {
    // 500 deep, 300 in the bend plane, straights 100 and 100.
    const cheek = 300 * (100 + 300 + 100);
    const inner = 500 * (100 + 100);
    const outer = 500 * (100 + 300 + 300 + 100);
    expect(area(build('squareElbow'))).toBeCloseTo(2 * cheek + inner + outer, 6);
  });
  it('rectangular tap: two trapezoids, a square back and a sloped front', () => {
    const [W, H, E, L] = [300, 200, 100, 150];
    expect(area(build('tapRect'))).toBeCloseTo(L * (2 * W + E) + H * L + H * Math.hypot(L, E), 6);
  });
  it('round tap flattens to the foot plate minus the neck', () => {
    close(area(build('tapRound', { W: 300, H: 200, D: 100, L: 1e-6, base: 0, neck: 0 })), 300 * 200 - PI * 50 * 50, 0.002);
  });
  it('round tap includes straight rectangular base and round collar', () => {
    const m = build('tapRound');
    expect(area({ ...m, panels: m.panels.filter(p => ['front', 'right', 'back', 'left'].includes(p.name)) })).toBeCloseTo(2 * (600 + 450) * 50, 5);
    close(area({ ...m, panels: m.panels.filter(p => p.name === 'neck') }), Math.PI * 315 * 50, 0.002);
    expect(project(m, 'front', 32).h).toBeCloseTo(320, 6);
    expect(getFitting('tapRound')!.validate({ ...defaults(getFitting('tapRound')!), base: 200, neck: 120 })).toBe('err.tapLengths');
  });
  it('silencer: casing plus two end plates with the mouth cut out', () => {
    expect(area(build('silencer'))).toBeCloseTo(2 * (600 + 500) * 900 + 2 * (600 * 500 - 400 * 300), 6);
  });
  it('plenum: four sides, top plate less the collar hole, and the collar', () => {
    const [W, L, H, D, C] = [600, 600, 300, 250, 100];
    close(area(build('plenum', { D })), 2 * (W + L) * H + W * L - (PI * D * D) / 4 + PI * D * C, 0.002);
  });
  it('plenum: accounts for multiple collars on top and sides', () => {
    const D = 100, C = 80, n = 5;
    const m = build('plenum', { D, C, nTop: 2, nFront: 2, nRight: 1 });
    close(area(m), 2 * (600 + 600) * 300 + 600 * 600 - n * PI * D * D / 4 + n * PI * D * C, 0.002);
    expect(m.openings).toHaveLength(1 + n);
    expect(flanges(m, 32)).toEqual([]);
    expect(getFitting('plenum')!.validate({ ...defaults(getFitting('plenum')!), W: 10, nTop: 3 })).toBe('err.collar');
  });
  it('plenum: makes a 200 by 120 ellipse on a 130 mm wide top face', () => {
    const m = build('plenum', { W: 130, L: 1120, H: 300, D: 200, C: 100 });
    const rim = m.openings[1];
    const span = (axis: 0 | 1) => Math.max(...rim.map((p) => p[axis])) - Math.min(...rim.map((p) => p[axis]));
    expect(span(0)).toBeCloseTo(120, 6);
    expect(span(1)).toBeCloseTo(200, 6);
    const a = 100, b = 60;
    const circumference = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const want = 2 * (130 + 1120) * 300 + 130 * 1120 - PI * a * b + circumference * 100;
    close(area(m), want, 0.003);
    expect(getFitting('plenum')!.validate({ ...defaults(getFitting('plenum')!), W: 130, L: 1120 })).toBeNull();
  });
  it('spreads two top collars along the long side of a narrow plenum', () => {
    const m = build('plenum', { W: 130, L: 1200, H: 300, D: 200, nTop: 2 });
    const center = (rim: number[][], axis: number) => (Math.max(...rim.map(p => p[axis])) + Math.min(...rim.map(p => p[axis]))) / 2;
    expect(center(m.openings[1], 0)).toBeCloseTo(65);
    expect(center(m.openings[2], 0)).toBeCloseTo(65);
    expect(center(m.openings[1], 1)).toBeCloseTo(300);
    expect(center(m.openings[2], 1)).toBeCloseTo(900);
    expect(Math.max(...m.openings[1].map(p => p[0])) - Math.min(...m.openings[1].map(p => p[0]))).toBeCloseTo(120);
  });
  it('FCU box: four closed faces, the collar face with n holes, and n collars', () => {
    const [W, H, L, n, D, C] = [1000, 250, 400, 3, 200, 100];
    close(area(build('fcuBox')), 2 * W * L + 2 * L * H + W * H - (n * PI * D * D) / 4 + n * PI * D * C, 0.002);
    // Two more collars on each end: four more holes and four more collars.
    close(
      area(build('fcuBox', { nL: 2, nR: 2 })),
      2 * W * L + 2 * L * H + W * H - ((n + 4) * PI * D * D) / 4 + (n + 4) * PI * D * C,
      0.002,
    );
  });
  it('cross: the tee with a second branch opposite', () => {
    const [W, H, L, Wb, Lb] = [400, 300, 1000, 300, 250];
    expect(area(build('cross3'))).toBeCloseTo(2 * W * L + 2 * H * L - 2 * H * Wb + 2 * (2 * Lb * H + 2 * Lb * Wb), 6);
  });
  it('90 degree cross: cheeks from the outline, walls from the path lengths', () => {
    const [W1, W2, W3, H, L, R, E] = [420, 240, 360, 250, 680, 200, 0];
    const xe = W1 / 2 + R + E;
    const cheek = W1 * R + 2 * (R * R - (PI * R * R) / 4) + 2 * xe * W2 + W3 * (L - R - W2);
    const walls = 2 * H * ((PI * R) / 2 + E) + 2 * H * (xe - W3 / 2 + L - R - W2);
    close(area(build('cross90')), 2 * cheek + walls, 0.002);
  });
  it('bullhead tee: the same with the top closed across both branches', () => {
    const [W1, W2, H, R, E] = [400, 300, 300, 150, 100];
    const xe = W1 / 2 + R + E;
    const cheek = W1 * R + 2 * (R * R - (PI * R * R) / 4) + 2 * xe * W2;
    const walls = 2 * H * ((PI * R) / 2 + E) + H * 2 * xe;
    close(area(build('bullhead')), 2 * cheek + walls, 0.002);
  });
});

describe('overall sizes', () => {
  it('90 degree cross spans the branches and reaches L', () => {
    expect(project(build('cross90'), 'front')).toMatchObject({ w: 820, h: 680 });
  });
  it('plenum stands H + C tall', () => {
    expect(project(build('plenum'), 'front')).toMatchObject({ w: 600, h: 400 });
  });
  it('FCU box reaches L + C deep', () => {
    expect(project(build('fcuBox'), 'plan')).toMatchObject({ w: 1000, h: 500 });
  });
  it('FCU box end collars stick out C on each side that has them', () => {
    expect(project(build('fcuBox', { nL: 1 }), 'plan').w).toBeCloseTo(1100, 6);
    expect(project(build('fcuBox', { nL: 1, nR: 2 }), 'plan').w).toBeCloseTo(1200, 6);
  });
});

describe('flanges on round collars', () => {
  it('do not add flanges to either end of the round tap', () => {
    const m = build('tapRound');
    expect(flanges(m, 30)).toEqual([]);
    expect(flangeLength(m)).toBe(0);
  });
  it('are left off the FCU box collars; only the FCU side has one', () => {
    const m = build('fcuBox', { nL: 1, nR: 2 });
    expect(m.openings).toHaveLength(1 + 3 + 1 + 2);
    expect(flanges(m, 30)).toHaveLength(1);
    expect(flangeLength(m)).toBeCloseTo(2 * (1000 + 250), 6);
  });
  it('are left off the diffuser plenum at both ends', () => {
    const m = build('plenum');
    expect(flanges(m, 30)).toEqual([]);
    expect(flangeLength(m)).toBe(0);
    expect(project(m, 'front', 30)).toMatchObject({ w: 600, h: 400 });
  });
});

describe('drawing', () => {
  it('shows no seam or triangulation lines on flat plates', () => {
    // The cross cheek is one plate: its visible edges are only its outline.
    const m = build('cross90', { R: 0 });
    const front = m.panels.find((p) => p.name === 'front')!;
    expect(edges([front])).toHaveLength(8);
  });
  it('rejects collars larger than their face and a cross neck wider than the branches', () => {
    expect(getFitting('plenum')!.validate({ ...defaults(getFitting('plenum')!), D: 600 })).toBeNull();
    expect(getFitting('fcuBox')!.validate({ ...defaults(getFitting('fcuBox')!), n: 5 })).toBe('err.collar');
    expect(getFitting('fcuBox')!.validate({ ...defaults(getFitting('fcuBox')!), n: 2.5 })).toBe('err.range');
    expect(getFitting('fcuBox')!.validate({ ...defaults(getFitting('fcuBox')!), nL: 1 })).toBeNull();
    expect(getFitting('fcuBox')!.validate({ ...defaults(getFitting('fcuBox')!), nR: 2 })).toBe('err.collar');
    expect(getFitting('cross90')!.validate({ ...defaults(getFitting('cross90')!), W3: 900 })).toBe('err.crossW3');
    expect(getFitting('cross90')!.validate({ ...defaults(getFitting('cross90')!), L: 400 })).toBe('err.crossL');
    expect(getFitting('silencer')!.validate({ ...defaults(getFitting('silencer')!), W: 600 })).toBe('err.mouth');
  });
});

describe('round flange rim', () => {
  it('stays a true circle, so overall sizes come out round', () => {
    // Neither opening adds a flange to the foot or neck.
    expect(project(build('tapRound'), 'side', 30).w).toBeCloseTo(450, 6);
  });
});

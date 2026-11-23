import { describe, expect, it } from 'vitest';
import { toDxf } from './dxf';
import { FITTINGS, defaults, getFitting } from './fittings';
import { fromJson, newDesign, toCsv, toJson } from './io';
import { area, flangeLength, flanges, weightKg } from './measure';
import { project } from './project';

const build = (id: string, p?: Record<string, number>) => {
  const f = getFitting(id)!;
  return f.build({ ...defaults(f), ...p });
};
const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want) / want).toBeLessThan(tol);

describe('area and weight', () => {
  it('straight 400x300x1000', () => {
    expect(area(build('straight'))).toBeCloseTo(1_400_000, 6);
    expect(weightKg(build('straight'), 0.8, 7850)).toBeCloseTo(8.792, 6);
  });
  it('reducer 400x300 to 200x200 over 500', () => {
    const want = 2 * 300 * Math.hypot(500, 50) + 2 * 250 * Math.hypot(500, 100);
    close(area(build('reducer')), want, 0.001);
  });
  it('elbow W400 H300 R200', () => {
    const want = (Math.PI / 2) * 300 * (200 + 600) + 2 * (Math.PI / 4) * (600 ** 2 - 200 ** 2);
    close(area(build('elbow90')), want, 0.005);
  });
  it('tee 400x300x1000 with 300x250 branch', () => {
    expect(area(build('tee'))).toBeCloseTo(1_400_000 - 300 * 300 + 2 * 250 * 300 + 2 * 250 * 300, 6);
  });
});

describe('flanges', () => {
  it('frames every opening with a ring of the given width', () => {
    const m = build('straight');
    const rings = flanges(m, 30);
    expect(rings).toHaveLength(2);
    // 460 x 360 outer minus 400 x 300 inner, twice.
    expect(area({ ...m, panels: rings })).toBeCloseTo(2 * (460 * 360 - 400 * 300), 6);
    expect(flanges(build('tee'), 30)).toHaveLength(3);
    expect(flanges(build('elbow90'), 30)).toHaveLength(2);
  });
  it('gives no flange for zero width and never changes the sheet area', () => {
    expect(flanges(build('straight'), 0)).toEqual([]);
    expect(area(build('straight'))).toBeCloseTo(1_400_000, 6);
  });
  it('measures the flange profile length as the opening perimeters', () => {
    expect(flangeLength(build('straight'))).toBeCloseTo(2 * 1400, 6);
    expect(flangeLength(build('tee'))).toBeCloseTo(2 * 1400 + 2 * (300 + 300), 6);
    expect(flangeLength(build('elbow90'))).toBeCloseTo(2 * 1400, 6);
  });
  it('shows in the views without changing their extents', () => {
    const plain = project(build('straight'), 'front');
    const flanged = project(build('straight'), 'front', 30);
    expect(plain.flangeSegs).toEqual([]);
    expect(flanged).toMatchObject({ w: 400, h: 1000 });
    const xs = flanged.flangeSegs.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-30, 6);
    expect(Math.max(...xs)).toBeCloseTo(430, 6);
  });
});

describe('validation', () => {
  it('accepts every default', () => {
    for (const f of FITTINGS) expect(f.validate(defaults(f))).toBeNull();
  });
  it('rejects zero, negative and non-numeric values', () => {
    const f = getFitting('straight')!;
    for (const bad of [0, -5, NaN, Infinity]) expect(f.validate({ ...defaults(f), W: bad })).toBe('err.range');
  });
  it('rejects a tee branch as wide as the main duct is long', () => {
    const f = getFitting('tee')!;
    expect(f.validate({ ...defaults(f), Wb: 1000 })).toBe('err.branch');
  });
});

describe('projection', () => {
  it('gives true extents for the straight duct', () => {
    const m = build('straight');
    expect(project(m, 'front')).toMatchObject({ w: 400, h: 1000 });
    expect(project(m, 'side')).toMatchObject({ w: 300, h: 1000 });
    expect(project(m, 'plan')).toMatchObject({ w: 400, h: 300 });
  });
  it('elbow front view spans W + R both ways', () => {
    expect(project(build('elbow90'), 'front')).toMatchObject({ w: 600, h: 600 });
  });
  it('lists fitting dimensions only in views that show them at true length', () => {
    const labels = (v: 'front' | 'plan') => project(build('straight'), v).dims.map((d) => d.label);
    expect(labels('front')).toEqual(['X', 'Z', 'W', 'L']);
    expect(labels('plan')).toEqual(['X', 'Y', 'W', 'H']);
  });
});

describe('dxf', () => {
  it('is a framed R12 file with outline lines at 1:1', () => {
    const dxf = toDxf(build('straight'));
    expect(dxf.startsWith('0\nSECTION\n')).toBe(true);
    expect(dxf.endsWith('0\nEOF\n')).toBe(true);
    const lines = dxf.split('\n');
    const xs: number[] = [];
    lines.forEach((l, i) => {
      if (l === 'OUTLINE' && lines[i + 3] === '10') xs.push(+lines[i + 4], +lines[i + 10]);
    });
    expect(Math.min(...xs)).toBe(0);
    // Front view is 400 wide; the side view sits to its right.
    expect(xs.filter((x) => x <= 400).length).toBeGreaterThan(0);
    expect(xs).toContain(400);
    expect(dxf).toContain('Z 1000');
    expect(dxf).not.toContain('FLANGE');
  });
  it('puts flanges on their own yellow layer', () => {
    expect(toDxf(build('straight'), 30)).toContain('LINE\n8\nFLANGE\n62\n2\n');
    expect(toDxf(build('straight'), 30)).toContain('LINE\n8\nOUTLINE\n62\n4\n');
  });
});

describe('json and csv', () => {
  it('round-trips a design', () => {
    const d = newDesign('tee');
    d.params.L = 1234;
    expect(fromJson(toJson(d))).toEqual(d);
  });
  it('rejects foreign or broken files', () => {
    for (const bad of ['nope', '{}', '[]', 'null', '{"app":"siscom-duct","fitting":"x","params":{}}'])
      expect(() => fromJson(bad)).toThrow();
    const d = JSON.parse(toJson(newDesign('straight')));
    d.params.W = -1;
    expect(() => fromJson(JSON.stringify(d))).toThrow();
    d.params.W = '400';
    expect(() => fromJson(JSON.stringify(d))).toThrow();
  });
  it('reads files saved before flanges existed', () => {
    const d = JSON.parse(toJson(newDesign('straight')));
    delete d.flange;
    expect(fromJson(JSON.stringify(d)).flange).toBe(30);
    d.flange = -1;
    expect(() => fromJson(JSON.stringify(d))).toThrow();
  });
  it('writes weight to csv', () => {
    expect(toCsv(newDesign('straight'), 'Straight')).toContain('"weight (kg)",8.792');
  });
});

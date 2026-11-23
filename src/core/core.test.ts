import { describe, expect, it } from 'vitest';
import { toDxf } from './dxf';
import { FITTINGS, defaults, getFitting } from './fittings';
import { fromJson, newDesign, toCsv, toJson } from './io';
import { area, weightKg } from './measure';
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
      if (l === 'OUTLINE' && lines[i + 1] === '10') xs.push(+lines[i + 2], +lines[i + 8]);
    });
    expect(Math.min(...xs)).toBe(0);
    // Front view is 400 wide; the side view sits to its right.
    expect(xs.filter((x) => x <= 400).length).toBeGreaterThan(0);
    expect(xs).toContain(400);
    expect(dxf).toContain('Z 1000');
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
  it('writes weight to csv', () => {
    expect(toCsv(newDesign('straight'), 'Straight')).toContain('"weight (kg)",8.792');
  });
});

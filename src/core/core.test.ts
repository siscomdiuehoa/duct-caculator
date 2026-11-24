import { describe, expect, it } from 'vitest';
import { toDxf } from './dxf';
import { FITTINGS, defaults, getFitting } from './fittings';
import { fromJson, lowPressureThickness, newDesign, toCsv, toJson, totals } from './io';
import { area, flangeLength, flanges, weightKg } from './measure';
import { project } from './project';

const build = (id: string, p?: Record<string, number>) => {
  const f = getFitting(id)!;
  return f.build({ ...defaults(f), ...p });
};
const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want) / want).toBeLessThan(tol);

describe('DW/144 low-pressure sheet thickness', () => {
  it.each([[400, 0.58], [401, 0.75], [1000, 0.75], [1001, 0.95], [2500, 0.95], [2501, 1.15], [3000, 1.15], [3001, null]])
  ('selects the thickness for a %i mm longest side', (width, expected) => {
    expect(lowPressureThickness('straight', { W: width, H: 300, L: 1000 })).toBe(expected);
  });
  it('uses the largest rectangular opening of a reducer', () => {
    expect(lowPressureThickness('reducer', { W1: 300, H1: 200, W2: 1100, H2: 300, L: 500 })).toBe(0.95);
  });
  it('leaves unsupported equipment boxes for manual selection', () => {
    expect(lowPressureThickness('fcuBox', defaults(getFitting('fcuBox')!))).toBeNull();
  });
});

describe('area and weight', () => {
  it('calculates quantity, seam allowance and flat flange area', () => {
    const d = { ...newDesign('straight'), quantity: 2, includeExtras: true, flangeKgPerM: 0.5, seamAllowanceMm: 20, seamLengthM: 4 };
    const result = totals(d);
    expect(result.flangeArea).toBeCloseTo(0.195584);
    expect(result.sheetArea).toBeCloseTo(3.155584);
    expect(result.flangeLength).toBeCloseTo(5.6);
    expect(result.weight).toBeCloseTo(3.155584 * 0.00058 * 7850);
    expect(toCsv(d, 'Straight')).toContain('"quantity",2');
    expect(totals({ ...d, includeExtras: false }).sheetArea).toBeCloseTo(2.8);
  });
  it('straight 400x300x1000', () => {
    expect(area(build('straight'))).toBeCloseTo(1_400_000, 6);
    expect(weightKg(build('straight'), 0.8, 7850)).toBeCloseTo(8.792, 6);
  });
  it('reducer 400x300 to 200x200 over 500', () => {
    const want = 2 * 300 * Math.hypot(500, 50) + 2 * 250 * Math.hypot(500, 100);
    close(area(build('reducer')), want, 0.001);
  });
  it('elbow 500x300, R225, straights 60 and 60', () => {
    // Two cheeks (straight + quarter annulus + straight), then inner and outer wraps 500 wide.
    const cheek = 60 * 300 + (Math.PI / 4) * (525 ** 2 - 225 ** 2) + 60 * 300;
    const want = 2 * cheek + 500 * (60 + (Math.PI / 2) * 225 + 60) + 500 * (60 + (Math.PI / 2) * 525 + 60);
    close(area(build('elbow90', { R: 225 })), want, 0.001);
  });
  it('elbow without straights is the plain quarter bend', () => {
    const want = 2 * (Math.PI / 4) * (525 ** 2 - 225 ** 2) + 500 * (Math.PI / 2) * (225 + 525);
    close(area(build('elbow90', { R: 225, A: 0, B: 0 })), want, 0.001);
  });
  it('calculates a 45 degree elbow and its outlet correctly', () => {
    const theta = Math.PI / 4;
    const want = 2 * (120 * 300 + theta / 2 * (525 ** 2 - 225 ** 2)) + 500 * (240 + theta * (225 + 525));
    const model = build('elbow90', { R: 225, angle: 45 });
    close(area(model), want, 0.001);
    expect(flangeLength(model)).toBeCloseTo(3200, 6);
    expect(model.openings[1][0][0] - model.openings[1][1][0]).toBeCloseTo(300 * Math.sin(theta), 6);
    expect(model.openings[1][0][2] - model.openings[1][1][2]).toBeCloseTo(-300 * Math.cos(theta), 6);
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
    expect(flangeLength(build('elbow90'))).toBeCloseTo(2 * 1600, 6);
  });
  it('counts in the overall size of each view', () => {
    const plain = project(build('straight'), 'front');
    const flanged = project(build('straight'), 'front', 30);
    expect(plain.flangeSegs).toEqual([]);
    expect(plain).toMatchObject({ w: 400, h: 1000 });
    expect(flanged).toMatchObject({ w: 460, h: 1000 });
    const xs = flanged.flangeSegs.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(460, 6);
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
  it('elbow 500x300 R225 with 60 straights measures 585 x 500 x 585', () => {
    const m = build('elbow90', { R: 225 });
    expect(project(m, 'front')).toMatchObject({ w: 585, h: 585 });
    expect(project(m, 'side')).toMatchObject({ w: 500, h: 585 });
    expect(project(m, 'plan')).toMatchObject({ w: 585, h: 500 });
    // With 30 mm flanges: the outlet flange adds 30 in X, the inlet flange 30 below in Z, both 30 each side in Y.
    expect(project(m, 'front', 30)).toMatchObject({ w: 615, h: 615 });
    expect(project(m, 'side', 30)).toMatchObject({ w: 560, h: 615 });
  });
  it('elbow views carry the size of each opening', () => {
    const dims = (v: 'front' | 'side' | 'plan') =>
      Object.fromEntries(project(build('elbow90', { R: 225 }), v).dims.map((d) => [d.label, Math.round(d.value * 10) / 10]));
    expect(dims('front')).toEqual({ X: 585, Z: 585, 'H A': 300, 'H B': 300, R: 225, A: 60, B: 60 });
    expect(dims('side')).toEqual({ Z: 585, 'W A': 500, 'H A': 300, 'W B': 500, B: 60 });
    expect(dims('plan')).toEqual({ X: 585, 'W A': 500, 'W B': 500, 'H B': 300, A: 60 });
  });
  it('lists fitting dimensions only in views that show them at true length', () => {
    const labels = (v: 'front' | 'plan') => project(build('straight'), v).dims.map((d) => d.label);
    // The overall sizes equal W, L and H here, so they are not drawn a second time.
    expect(labels('front')).toEqual(['W', 'L']);
    expect(labels('plan')).toEqual(['W', 'H']);
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
    expect(dxf).toContain('L 1000');
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
    expect(fromJson(JSON.stringify(d)).flange).toBe(32);
    d.flange = -1;
    expect(() => fromJson(JSON.stringify(d))).toThrow();
  });
  it('opens legacy radius elbows at 90 degrees', () => {
    const d = JSON.parse(toJson(newDesign('elbow90')));
    delete d.params.angle;
    expect(fromJson(JSON.stringify(d)).params.angle).toBe(90);
  });
  it('opens a legacy plenum with one top collar', () => {
    const d = JSON.parse(toJson(newDesign('plenum')));
    for (const k of ['nTop', 'nFront', 'nBack', 'nLeft', 'nRight']) delete d.params[k];
    expect(fromJson(JSON.stringify(d)).params).toMatchObject({ nTop: 1, nFront: 0, nBack: 0, nLeft: 0, nRight: 0 });
  });
  it('opens a legacy round tap without adding straight sections', () => {
    const d = JSON.parse(toJson(newDesign('tapRound')));
    delete d.params.base;
    delete d.params.neck;
    expect(fromJson(JSON.stringify(d)).params).toMatchObject({ base: 0, neck: 0 });
  });
  it('writes weight to csv', () => {
    expect(toCsv(newDesign('straight'), 'Straight')).toContain('"weight (kg)",6.374');
  });
});

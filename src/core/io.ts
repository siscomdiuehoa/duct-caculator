import { defaults, getFitting } from './fittings';
import { area, flangeLength, flanges } from './measure';
import type { Params } from './types';

export interface Design {
  fitting: string;
  params: Params;
  thickness: number;
  density: number;
  quantity: number;
  includeExtras: boolean;
  flangeKgPerM: number;
  seamAllowanceMm: number;
  seamLengthM: number;
  /** Flange width in mm; 0 means no flange. */
  flange: number;
}

export const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;
export type Unit = keyof typeof UNITS;

export const DEFAULT_THICKNESS = 0.75;
export const DEFAULT_DENSITY = 7850;
export const DEFAULT_FLANGE = 32;

/** User-selected sheet gauges, grouped by DW/144 low-pressure size ranges. */
export function lowPressureThickness(fitting: string, params: Params): number | null {
  if (!['straight', 'reducer', 'elbow90', 'squareElbow', 'offsetS', 'tee', 'bullhead', 'cross90', 'cross3'].includes(fitting)) return null;
  const def = getFitting(fitting);
  if (!def || def.validate(params)) return null;
  const openings = def.build(params).openings.filter((opening) => opening.length === 4);
  if (!openings.length) return null;
  const longest = Math.max(...openings.flatMap((opening) => opening.map((p, i) => {
    const q = opening[(i + 1) % opening.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  })));
  if (longest <= 400 + 1e-7) return 0.58;
  if (longest <= 1000 + 1e-7) return 0.75;
  if (longest <= 2500 + 1e-7) return 0.95;
  if (longest <= 3000 + 1e-7) return 1.15;
  return null;
}

export function newDesign(fitting: string): Design {
  const f = getFitting(fitting);
  if (!f) throw new Error('unknown fitting');
  const params = defaults(f);
  return { fitting, params, thickness: lowPressureThickness(fitting, params) ?? DEFAULT_THICKNESS, density: DEFAULT_DENSITY, flange: DEFAULT_FLANGE, quantity: 1, includeExtras: false, flangeKgPerM: 0, seamAllowanceMm: 0, seamLengthM: 0 };
}

/** Approximate flange as a flat sheet ring of the same thickness as the duct. */
export function totals(d: Design) {
  const model = getFitting(d.fitting)!.build(d.params);
  const qty = d.quantity;
  const flangeM = d.flange > 0 ? flangeLength(model) / 1000 : 0;
  const seamArea = d.includeExtras ? d.seamAllowanceMm / 1000 * d.seamLengthM : 0;
  const rings = d.includeExtras ? flanges(model, d.flange) : [];
  const flangeArea = rings.length ? area({ ...model, panels: rings }) / 1e6 : 0;
  const sheetArea = area(model) / 1e6 + seamArea + flangeArea;
  return { sheetArea: sheetArea * qty, flangeArea: flangeArea * qty, weight: sheetArea * d.thickness / 1000 * d.density * qty, flangeLength: flangeM * qty };
}

export function toJson(d: Design): string {
  return JSON.stringify({ app: 'siscom-duct', version: 1, ...d }, null, 2);
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Parses a saved design; throws when the text is not a buildable design. */
export function fromJson(text: string): Design {
  const o = JSON.parse(text);
  const f = o && o.app === 'siscom-duct' && typeof o.fitting === 'string' ? getFitting(o.fitting) : undefined;
  if (!f || typeof o.params !== 'object' || o.params === null) throw new Error('not a design');
  const params: Params = {};
  for (const d of f.params) {
    const legacyField = (f.id === 'elbow90' && d.key === 'angle') || (f.id === 'plenum' && ['nTop', 'nFront', 'nBack', 'nLeft', 'nRight'].includes(d.key)) || (f.id === 'tapRound' && ['base', 'neck'].includes(d.key));
    const v = legacyField && o.params[d.key] === undefined ? (f.id === 'tapRound' ? 0 : d.def) : o.params[d.key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < d.min) throw new Error('bad param');
    params[d.key] = v;
  }
  if (f.validate(params) || !positive(o.thickness) || !positive(o.density)) throw new Error('bad design');
  // Files saved before flanges existed have no flange field.
  const flange = o.flange === undefined ? DEFAULT_FLANGE : o.flange;
  if (typeof flange !== 'number' || !Number.isFinite(flange) || flange < 0) throw new Error('bad flange');
  const quantity = o.quantity === undefined ? 1 : o.quantity;
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('bad quantity');
  const extra = (key: string) => {
    const v = o[key] === undefined ? 0 : o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('bad extra');
    return v;
  };
  if (o.includeExtras !== undefined && typeof o.includeExtras !== 'boolean') throw new Error('bad extras flag');
  return { fitting: f.id, params, thickness: o.thickness, density: o.density, flange, quantity, includeExtras: o.includeExtras === true, flangeKgPerM: extra('flangeKgPerM'), seamAllowanceMm: extra('seamAllowanceMm'), seamLengthM: extra('seamLengthM') };
}

/** Result sheet as CSV (with BOM so Excel reads UTF-8). All lengths in mm. */
export function toCsv(d: Design, name: string): string {
  const f = getFitting(d.fitting)!;
  const result = totals(d);
  const rows: [string, string | number][] = [
    ['fitting', name],
    ...f.params.map((p): [string, number] => [`${p.key} (${p.kind === 'angle' ? 'deg' : p.kind === 'count' ? 'count' : 'mm'})`, d.params[p.key]]),
    ['thickness (mm)', d.thickness],
    ['density (kg/m3)', d.density],
    ['quantity', d.quantity],
    ['include flange and seam', d.includeExtras ? 1 : 0],
    ['seam allowance width (mm)', d.seamAllowanceMm],
    ['seam length per item (m)', d.seamLengthM],
    ['flange width (mm)', d.flange],
    ['flange length (m)', +result.flangeLength.toFixed(3)],
    ['flange sheet area (m2)', +result.flangeArea.toFixed(4)],
    ['sheet area (m2)', +result.sheetArea.toFixed(4)],
    ['weight (kg)', +result.weight.toFixed(3)],
  ];
  return '﻿' + rows.map(([k, v]) => `"${String(k).replace(/"/g, '""')}",${typeof v === 'number' ? v : `"${v.replace(/"/g, '""')}"`}`).join('\r\n') + '\r\n';
}

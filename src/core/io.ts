import { defaults, getFitting } from './fittings';
import { area, flangeLength, weightKg } from './measure';
import type { Params } from './types';

export interface Design {
  fitting: string;
  params: Params;
  thickness: number;
  density: number;
  /** Flange width in mm; 0 means no flange. */
  flange: number;
}

export const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;
export type Unit = keyof typeof UNITS;

export const DEFAULT_THICKNESS = 0.8;
export const DEFAULT_DENSITY = 7850;
export const DEFAULT_FLANGE = 30;

export function newDesign(fitting: string): Design {
  const f = getFitting(fitting);
  if (!f) throw new Error('unknown fitting');
  return { fitting, params: defaults(f), thickness: DEFAULT_THICKNESS, density: DEFAULT_DENSITY, flange: DEFAULT_FLANGE };
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
    const v = o.params[d.key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < d.min) throw new Error('bad param');
    params[d.key] = o.params[d.key];
  }
  if (f.validate(params) || !positive(o.thickness) || !positive(o.density)) throw new Error('bad design');
  // Files saved before flanges existed have no flange field.
  const flange = o.flange === undefined ? DEFAULT_FLANGE : o.flange;
  if (typeof flange !== 'number' || !Number.isFinite(flange) || flange < 0) throw new Error('bad flange');
  return { fitting: f.id, params, thickness: o.thickness, density: o.density, flange };
}

/** Result sheet as CSV (with BOM so Excel reads UTF-8). All lengths in mm. */
export function toCsv(d: Design, name: string): string {
  const f = getFitting(d.fitting)!;
  const model = f.build(d.params);
  const rows: [string, string | number][] = [
    ['fitting', name],
    ...f.params.map((p): [string, number] => [`${p.key} (mm)`, d.params[p.key]]),
    ['thickness (mm)', d.thickness],
    ['density (kg/m3)', d.density],
    ['flange width (mm)', d.flange],
    ['flange length (m)', d.flange > 0 ? +(flangeLength(model) / 1e3).toFixed(3) : 0],
    ['area (m2)', +(area(model) / 1e6).toFixed(4)],
    ['weight (kg)', +weightKg(model, d.thickness, d.density).toFixed(3)],
  ];
  return '﻿' + rows.map(([k, v]) => `"${String(k).replace(/"/g, '""')}",${typeof v === 'number' ? v : `"${v.replace(/"/g, '""')}"`}`).join('\r\n') + '\r\n';
}

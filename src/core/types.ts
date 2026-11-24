export type Vec3 = [number, number, number];

/**
 * A sheet surface. By default it is ruled between two rails with the same number of points,
 * outlined by both rails and the rungs at their two ends.
 */
export interface Panel {
  name: string;
  a: Vec3[];
  b: Vec3[];
  /** Explicit triangles, for flat plates that are not a ruled strip. Replaces the ruled triangles. */
  tris?: [Vec3, Vec3, Vec3][];
  /** Explicit visible edges. Replaces the rails and rungs. */
  lines?: [Vec3, Vec3][];
  /** Rail indices whose rungs are visible edges (creases); defaults to the two ends. */
  rungs?: number[];
}

/** A dimension line between two points; its value is the distance in mm. */
export interface Dim {
  a: Vec3;
  b: Vec3;
  label: string;
}

export interface Model {
  panels: Panel[];
  dims: Dim[];
  /** Open ends, each as four corners in loop order; a flange frames each one. */
  openings: Vec3[][];
  /** Indices of openings that take no flange, such as a diffuser neck or a collar for flexible duct. */
  bare?: number[];
}

export interface ParamDef {
  key: string;
  def: number;
  min: number;
  max: number;
  step: number;
  /** A whole count rather than a length, so it is never converted between units. */
  kind?: 'count' | 'angle';
  /** i18n key of the field label when it differs from p.<key>. */
  label?: string;
}

export type Params = Record<string, number>;

export interface FittingDef {
  id: string;
  params: ParamDef[];
  /** Returns an i18n message key when the params cannot be built, else null. */
  validate(p: Params): string | null;
  build(p: Params): Model;
}

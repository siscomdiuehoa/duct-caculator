export type Vec3 = [number, number, number];

/** A ruled sheet surface between two rails with the same number of points. */
export interface Panel {
  name: string;
  a: Vec3[];
  b: Vec3[];
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
}

export interface ParamDef {
  key: string;
  def: number;
  min: number;
  max: number;
  step: number;
}

export type Params = Record<string, number>;

export interface FittingDef {
  id: string;
  params: ParamDef[];
  /** Returns an i18n message key when the params cannot be built, else null. */
  validate(p: Params): string | null;
  build(p: Params): Model;
}

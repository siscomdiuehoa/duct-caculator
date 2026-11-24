import { project, VIEWS, type P2 } from './project';
import type { Model } from './types';

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
export const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** AutoCAD colour index per layer: cyan body, yellow flanges, green dimensions. */
const ACI: Record<string, string> = { OUTLINE: '4', FLANGE: '2', DIM: '3' };

/** 2D drawing of the three views as an R12 ASCII DXF, 1 unit = 1 mm. */
export function toDxf(model: Model, flange = 0): string {
  // One reference size for all three views so text and arrows match across the sheet.
  const size = Math.max(...VIEWS.flatMap((id) => {
    const v = project(model, id, flange);
    return [v.w, v.h];
  }));
  const views = VIEWS.map((id) => project(model, id, flange, size));
  const [front, side, plan] = views;
  const margin = views[0].style.t * 3;
  // Boxes include the dimensions, so the views never collide with each other's dimensions.
  const origin: P2[] = [
    [0, 0],
    [front.box[2] + margin - side.box[0], 0],
    [0, front.box[1] - margin - plan.box[3]],
  ];

  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (layer: string, a: P2, b: P2) =>
    out.push('0', 'LINE', '8', layer, '62', ACI[layer], '10', n(a[0]), '20', n(a[1]), '30', '0', '11', n(b[0]), '21', n(b[1]), '31', '0');
  const arrow = (p: P2[]) => {
    const pts = [p[0], p[1], p[2], p[2]];
    out.push('0', 'SOLID', '8', 'DIM', '62', ACI.DIM);
    pts.forEach((q, i) => out.push(`${10 + i}`, n(q[0]), `${20 + i}`, n(q[1]), `${30 + i}`, '0'));
  };
  // Centred on its anchor (justification 1) so the text sits in the middle of the dimension line.
  const text = (p: P2, s: string, h: number, rot: number) =>
    out.push('0', 'TEXT', '8', 'DIM', '62', ACI.DIM, '10', n(p[0]), '20', n(p[1]), '30', '0', '40', n(h), '1', s, '50', n(rot), '72', '1', '11', n(p[0]), '21', n(p[1]), '31', '0');

  views.forEach((v, k) => {
    const [ox, oy] = origin[k];
    const at = (p: number[]): P2 => [p[0] + ox, p[1] + oy];
    for (const [a, b] of v.segs) line('OUTLINE', at(a), at(b));
    for (const [a, b] of v.flangeSegs) line('FLANGE', at(a), at(b));
    for (const d of v.dims) {
      const { shape } = d;
      for (const [a, b] of shape.ext) line('DIM', at(a), at(b));
      line('DIM', at(shape.line[0]), at(shape.line[1]));
      for (const tri of shape.arrows) arrow(tri.map(at));
      text(at(shape.text), `${d.label} ${fmt(d.value)}`, v.style.text, shape.angle);
    }
  });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

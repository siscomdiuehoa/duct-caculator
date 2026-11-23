import { project, VIEWS, type P2 } from './project';
import type { Model } from './types';

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
export const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** AutoCAD colour index per layer: cyan body, yellow flanges, green dimensions. */
const ACI: Record<string, string> = { OUTLINE: '4', FLANGE: '2', DIM: '3' };

/** 2D drawing of the three views as an R12 ASCII DXF, 1 unit = 1 mm. */
export function toDxf(model: Model, flange = 0): string {
  const views = VIEWS.map((id) => project(model, id, flange));
  const [front, , plan] = views;
  const big = Math.max(...views.flatMap((v) => [v.w, v.h]));
  const th = big / 40;
  const gap = th * 8 + flange * 2;
  const origin: P2[] = [
    [0, 0],
    [front.w + gap, 0],
    [0, -gap - plan.h],
  ];

  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (layer: string, a: P2, b: P2) =>
    out.push('0', 'LINE', '8', layer, '62', ACI[layer], '10', n(a[0]), '20', n(a[1]), '30', '0', '11', n(b[0]), '21', n(b[1]), '31', '0');
  const text = (p: P2, s: string, rot = 0) =>
    out.push('0', 'TEXT', '8', 'DIM', '62', ACI.DIM, '10', n(p[0]), '20', n(p[1]), '30', '0', '40', n(th), '1', s, '50', n(rot));

  views.forEach((v, k) => {
    const [ox, oy] = origin[k];
    const at = (p: P2): P2 => [p[0] + ox, p[1] + oy];
    for (const [a, b] of v.segs) line('OUTLINE', at(a), at(b));
    for (const [a, b] of v.flangeSegs) line('FLANGE', at(a), at(b));
    for (const d of v.dims) {
      const label = `${d.label} ${fmt(d.value)}`;
      if (d.extent === 'h') {
        const y = -th * 2 - flange;
        line('DIM', at([0, y]), at([v.w, y]));
        line('DIM', at([0, 0]), at([0, y - th / 2]));
        line('DIM', at([v.w, 0]), at([v.w, y - th / 2]));
        text(at([v.w / 2 - th * 2, y - th * 1.5]), label);
      } else if (d.extent === 'v') {
        const x = -th * 2 - flange;
        line('DIM', at([x, 0]), at([x, v.h]));
        line('DIM', at([0, 0]), at([x - th / 2, 0]));
        line('DIM', at([0, v.h]), at([x - th / 2, v.h]));
        text(at([x - th / 2, v.h / 2 - th * 2]), label, 90);
      } else {
        text(at([(d.a[0] + d.b[0]) / 2 + th / 2, (d.a[1] + d.b[1]) / 2 + th / 2]), label);
      }
    }
  });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

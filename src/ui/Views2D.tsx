import { project, VIEWS, type View2D } from '../core/project';
import type { Model } from '../core/types';

interface Props {
  model: Model;
  flange: number;
  title: (id: View2D['id']) => string;
  dimText: (label: string, mm: number) => string;
}

function View({ view, dimText }: { view: View2D; dimText: Props['dimText'] }) {
  const { style: st, box } = view;
  const fs = st.text;
  const m = st.t * 0.6;
  // SVG y grows downwards, drawings grow upwards.
  const y = (v: number) => view.h - v;
  const pt = (p: number[]) => `${p[0]} ${y(p[1])}`;
  return (
    <svg viewBox={`${box[0] - m} ${y(box[3]) - m} ${box[2] - box[0] + 2 * m} ${box[3] - box[1] + 2 * m}`} role="img">
      {view.segs.map(([a, b], i) => (
        <line key={i} className="outline" x1={a[0]} y1={y(a[1])} x2={b[0]} y2={y(b[1])} />
      ))}
      {view.flangeSegs.map(([a, b], i) => (
        <line key={`f${i}`} className="flange" x1={a[0]} y1={y(a[1])} x2={b[0]} y2={y(b[1])} />
      ))}
      {view.dims.map((d) => {
        const { shape } = d;
        const anchor = pt(shape.text);
        return (
          <g key={d.label} className="dim">
            <path d={[...shape.ext, shape.line].map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('')} />
            {shape.arrows.map((tri, i) => (
              <polygon key={i} points={tri.map(pt).join(' ')} style={{ fill: 'var(--cad-dim)', stroke: 'none' }} />
            ))}
            <text
              x={shape.text[0]}
              y={y(shape.text[1])}
              fontSize={fs}
              textAnchor="middle"
              transform={shape.angle ? `rotate(${-shape.angle} ${anchor})` : undefined}
            >
              {dimText(d.label, d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Views2D({ model, flange, title, dimText }: Props) {
  return (
    <>
      {VIEWS.map((id) => (
        <figure className="card view" key={id}>
          <figcaption>{title(id)}</figcaption>
          <View view={project(model, id, flange)} dimText={dimText} />
        </figure>
      ))}
    </>
  );
}

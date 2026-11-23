import { project, VIEWS, type View2D } from '../core/project';
import type { Model } from '../core/types';

interface Props {
  model: Model;
  flange: number;
  title: (id: View2D['id']) => string;
  dimText: (label: string, mm: number) => string;
}

function View({ view, dimText }: { view: View2D; dimText: Props['dimText'] }) {
  const s = Math.max(view.w, view.h);
  const pad = s * 0.24;
  const fs = s * 0.055;
  const off = s * 0.08;
  // SVG y grows downwards, drawings grow upwards.
  const y = (v: number) => view.h - v;
  return (
    <svg viewBox={`${-pad} ${-pad * 0.6} ${view.w + pad * 1.5} ${view.h + pad * 1.6}`} role="img">
      {view.segs.map(([a, b], i) => (
        <line key={i} className="outline" x1={a[0]} y1={y(a[1])} x2={b[0]} y2={y(b[1])} />
      ))}
      {view.flangeSegs.map(([a, b], i) => (
        <line key={`f${i}`} className="flange" x1={a[0]} y1={y(a[1])} x2={b[0]} y2={y(b[1])} />
      ))}
      {view.dims.map((d) => {
        const text = dimText(d.label, d.value);
        if (d.extent === 'h')
          return (
            <g key="eh" className="dim">
              <path d={`M0 ${y(0) + off}H${view.w}M0 ${y(0)}V${y(0) + off * 1.3}M${view.w} ${y(0)}V${y(0) + off * 1.3}`} />
              <text x={view.w / 2} y={y(0) + off + fs * 1.2} fontSize={fs} textAnchor="middle">
                {text}
              </text>
            </g>
          );
        if (d.extent === 'v')
          return (
            <g key="ev" className="dim">
              <path d={`M${-off} ${y(0)}V${y(view.h)}M0 ${y(0)}H${-off * 1.3}M0 ${y(view.h)}H${-off * 1.3}`} />
              <text
                x={-off - fs * 0.4}
                y={y(view.h / 2)}
                fontSize={fs}
                textAnchor="middle"
                transform={`rotate(-90 ${-off - fs * 0.4} ${y(view.h / 2)})`}
              >
                {text}
              </text>
            </g>
          );
        return (
          <g key={d.label}>
            <line className="mark" x1={d.a[0]} y1={y(d.a[1])} x2={d.b[0]} y2={y(d.b[1])} />
          <text
            className="label"
            x={(d.a[0] + d.b[0]) / 2}
            y={y((d.a[1] + d.b[1]) / 2)}
            fontSize={fs * 0.8}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {text}
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

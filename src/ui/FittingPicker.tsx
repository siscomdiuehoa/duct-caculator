import { useEffect, useId, useRef, useState } from 'react';
import { defaults, FITTINGS, getFitting } from '../core/fittings';
import { edges } from '../core/measure';

const iconCache = new Map<string, { d: string; view: string }>();

/** Isometric line drawing of a fitting at its default size, used as its icon. */
function iconPath(id: string) {
  const hit = iconCache.get(id);
  if (hit) return hit;
  const f = getFitting(id)!;
  const lines = edges(f.build(defaults(f)).panels);
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const pts = lines.map(([p, q]) => [p, q].map(([x, y, z]) => [(x - y) * c, (x + y) * s - z]));
  const xs = pts.flat().map((p) => p[0]);
  const ys = pts.flat().map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
  const k = 100 / size;
  const r = (v: number) => Math.round(v * 10) / 10;
  const d = pts.map(([a, b]) => `M${r((a[0] - x0) * k)} ${r((a[1] - y0) * k)}L${r((b[0] - x0) * k)} ${r((b[1] - y0) * k)}`).join('');
  const out = { d, view: `-6 -6 112 ${r((Math.max(...ys) - y0) * k) + 12}` };
  iconCache.set(id, out);
  return out;
}

export function FittingIcon({ id }: { id: string }) {
  const { d, view } = iconPath(id);
  return (
    <svg className="fitting-icon" viewBox={view} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d={d} />
    </svg>
  );
}

interface Props {
  value: string;
  label: string;
  name: (id: string) => string;
  onChange: (id: string) => void;
}

/** Drop-down list of fitting types, each with a small drawing of its shape. */
export function FittingPicker({ value, label, name, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => FITTINGS.findIndex((f) => f.id === value));
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setActive(FITTINGS.findIndex((f) => f.id === value));
    setOpen(true);
  };
  const choose = (i: number) => {
    onChange(FITTINGS[i].id);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const last = FITTINGS.length - 1;
    if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className="picker" ref={box}>
      <button
        type="button"
        className="picker-button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <FittingIcon id={value} />
        <span>{name(value)}</span>
        <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d={open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
        </svg>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" id={listId} ref={list} aria-label={label}>
          {FITTINGS.map((f, i) => (
            <li
              key={f.id}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={f.id === value}
              className={`${i === active ? 'active' : ''} ${f.id === value ? 'current' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <FittingIcon id={f.id} />
              <span>{name(f.id)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

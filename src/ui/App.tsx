import { useEffect, useMemo, useRef, useState } from 'react';
import { toDxf } from '../core/dxf';
import { defaults, getFitting } from '../core/fittings';
import { DEFAULT_FLANGE, fromJson, newDesign, toCsv, toJson, UNITS, type Design, type Unit } from '../core/io';
import { area, flangeLength, weightKg } from '../core/measure';
import type { Model } from '../core/types';
import { translate, type Lang } from '../i18n';
import { FittingPicker } from './FittingPicker';
import { Viewer3D, type Preset } from './Viewer3D';
import { Views2D } from './Views2D';

type Tab = 'params' | 'views' | 'library';
interface Saved {
  id: string;
  name: string;
  design: Design;
}

const STEP: Record<Unit, number> = { mm: 1, cm: 1, m: 0.1, in: 1 };
const PRESETS: Preset[] = ['iso', 'front', 'side', 'plan'];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`siscom-duct.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(`siscom-duct.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const trim = (v: number, digits = 4) => String(+v.toFixed(digits));

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface FieldProps {
  label: string;
  value: number;
  /** Size of one display unit in stored units. */
  factor: number;
  step: number;
  suffix: string;
  min: number;
  max: number;
  errText: string;
  onChange: (v: number) => void;
}

function Field({ label, value, factor, step, suffix, min, max, errText, onChange }: FieldProps) {
  const shown = trim(value / factor);
  const [text, setText] = useState(shown);
  const parsed = Number(text.trim().replace(',', '.'));
  const typed = text.trim() !== '' && Number.isFinite(parsed);
  // Follow outside changes (unit switch, reset, opened file) unless the text already means the same value.
  useEffect(() => {
    if (!typed || Math.abs(parsed * factor - value) > 1e-9) setText(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const bad = !typed || value < min || value > max;
  const edit = (t: string) => {
    setText(t);
    const v = Number(t.trim().replace(',', '.'));
    if (t.trim() !== '' && Number.isFinite(v)) onChange(v * factor);
  };
  const bump = (dir: number) => {
    const next = Math.max(min / factor, +(value / factor + dir * step).toFixed(6));
    setText(trim(next));
    onChange(next * factor);
  };
  return (
    <label className={bad ? 'field bad' : 'field'}>
      <span>{label}</span>
      <div className="input">
        <button type="button" onClick={() => bump(-1)} aria-label={`− ${label}`}>
          −
        </button>
        <input inputMode="decimal" value={text} onChange={(e) => edit(e.target.value)} aria-invalid={bad} />
        <em>{suffix}</em>
        <button type="button" onClick={() => bump(1)} aria-label={`+ ${label}`}>
          +
        </button>
      </div>
      {!typed && <small>{errText}</small>}
    </label>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (load<string>('lang', 'vi') === 'en' ? 'en' : 'vi'));
  const [unit, setUnit] = useState<Unit>(() => {
    const u = load<string>('unit', 'mm');
    return u in UNITS ? (u as Unit) : 'mm';
  });
  const [design, setDesign] = useState<Design>(() => newDesign('elbow90'));
  const [tab, setTab] = useState<Tab>('params');
  const [preset, setPreset] = useState<Preset>('iso');
  const [frame, setFrame] = useState(0);
  const [showDims, setShowDims] = useState(true);
  const [notice, setNotice] = useState('');
  const [library, setLibrary] = useState<Saved[]>(() => {
    const v = load<unknown>('library', []);
    return Array.isArray(v) ? (v as Saved[]) : [];
  });
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const t = translate(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    store('lang', lang);
  }, [lang]);
  useEffect(() => void store('unit', unit), [unit]);

  const fitting = getFitting(design.fitting)!;
  const problem =
    fitting.validate(design.params) ??
    (design.thickness > 0 && design.density > 0 && design.flange >= 0 && design.flange <= 200 ? null : 'err.range');

  // Keep showing the last buildable shape while the input is invalid.
  const last = useRef<{ model: Model; design: Design } | null>(null);
  const current = useMemo(() => {
    if (!problem) last.current = { model: fitting.build(design.params), design };
    return last.current!;
  }, [design, fitting, problem]);
  const { model } = current;

  const factor = UNITS[unit];
  const dimText = (label: string, mm: number) => `${label} ${trim(mm / factor, 2)}`;
  const sqm = area(model) / 1e6;
  const kg = weightKg(model, current.design.thickness, current.design.density);
  const flange = current.design.flange;

  const setParam = (key: string, v: number) => setDesign((d) => ({ ...d, params: { ...d.params, [key]: v } }));
  const open = (d: Design) => {
    // Library entries saved before flanges existed have no flange width.
    setDesign({ ...d, flange: Number.isFinite(d.flange) ? d.flange : DEFAULT_FLANGE });
    setPreset('iso');
    setFrame((n) => n + 1);
  };
  const pick = (id: string) => open({ ...design, fitting: id, params: defaults(getFitting(id)!) });

  const exportAs = (kind: 'dxf' | 'csv' | 'json') => {
    const d = current.design;
    const file = `siscom-duct-${d.fitting}`;
    if (kind === 'dxf') download(`${file}.dxf`, toDxf(model, d.flange), 'application/dxf');
    if (kind === 'csv') download(`${file}.csv`, toCsv(d, t(`f.${d.fitting}`)), 'text/csv');
    if (kind === 'json') download(`${file}.json`, toJson(d), 'application/json');
  };
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      open(fromJson(await file.text()));
      setNotice('');
    } catch {
      setNotice(t('err.file'));
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const saveLibrary = (next: Saved[]) => {
    setLibrary(next);
    setNotice(store('library', next) ? '' : t('lib.off'));
  };
  const autoName = `${t(`f.${current.design.fitting}`)} ${fitting.params
    .slice(0, 2)
    .map((p) => trim(current.design.params[p.key] / factor, 2))
    .join('×')}`;
  const addToLibrary = () => {
    saveLibrary([{ id: Date.now().toString(36), name: name.trim() || autoName, design: current.design }, ...library]);
    setName('');
  };

  return (
    <>
      <header className="top">
        <div className="brand">
          <img src="./icon.svg" alt="" width="34" height="34" />
          <div>
            <strong>SISCOM Duct</strong>
            <span>{t('tagline')}</span>
          </div>
        </div>
        <div className="prefs">
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label={t('unit')}>
            {Object.keys(UNITS).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>

      <main className="layout" data-tab={tab}>
        <section className="viewer card">
          <div className="viewer-bar">
            <div className="seg">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === preset ? 'on' : ''}
                  onClick={() => {
                    setPreset(p);
                    setFrame((n) => n + 1);
                  }}
                >
                  {t(`view.${p}`)}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" aria-label={t('dims')} checked={showDims} onChange={(e) => setShowDims(e.target.checked)} />
              <span>{t('dims')}</span>
            </label>
          </div>
          <Viewer3D
            model={model}
            flange={flange}
            frameKey={`${current.design.fitting}:${frame}`}
            preset={preset}
            showDims={showDims}
            dimText={dimText}
            failText={t('err.webgl')}
          />
          <p className="hint">{t('hint')}</p>
        </section>

        <nav className="tabs seg">
          {(['params', 'views', 'library'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`${id === tab ? 'on' : ''} tab-${id}`}
              onClick={() => setTab(id)}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
        </nav>

        <section className="panel card">
          {notice && (
            <p className="alert" role="alert">
              {notice}
            </p>
          )}
          {tab === 'library' ? (
            <>
              <div className="save-row">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} aria-label={t('lib.name')} />
                <button type="button" className="primary" onClick={addToLibrary}>
                  {t('lib.save')}
                </button>
              </div>
              {library.length === 0 && <p className="muted">{t('lib.empty')}</p>}
              <ul className="library">
                {library.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="open" onClick={() => open(item.design)}>
                      <strong>{item.name}</strong>
                      <span>{t(`f.${item.design.fitting}`)}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => window.confirm(t('lib.confirm')) && saveLibrary(library.filter((x) => x.id !== item.id))}
                    >
                      {t('lib.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2>{t('fitting')}</h2>
              <FittingPicker value={design.fitting} label={t('fitting')} name={(id) => t(`f.${id}`)} onChange={pick} />

              <div className="row">
                <h2>{t('size')}</h2>
                <button type="button" className="ghost" onClick={() => open(newDesign(design.fitting))}>
                  {t('reset')}
                </button>
              </div>
              {problem && (
                <p className="alert" role="alert">
                  {t(problem)}
                </p>
              )}
              <div className="grid">
                {fitting.params.map((p) => (
                  <Field
                    key={`${design.fitting}.${p.key}`}
                    label={t(p.label ?? `p.${p.key}`)}
                    value={design.params[p.key]}
                    factor={p.kind === 'count' ? 1 : factor}
                    step={p.kind === 'count' ? 1 : STEP[unit]}
                    suffix={p.kind === 'count' ? '' : unit}
                    min={p.min}
                    max={p.max}
                    errText={t('err.number')}
                    onChange={(v) => setParam(p.key, v)}
                  />
                ))}
              </div>

              <h2>{t('material')}</h2>
              <div className="grid">
                <Field
                  label={t('thickness')}
                  value={design.thickness}
                  factor={1}
                  step={0.1}
                  suffix="mm"
                  min={0.01}
                  max={50}
                  errText={t('err.number')}
                  onChange={(v) => setDesign((d) => ({ ...d, thickness: v }))}
                />
                <Field
                  label={t('density')}
                  value={design.density}
                  factor={1}
                  step={10}
                  suffix="kg/m³"
                  min={1}
                  max={30000}
                  errText={t('err.number')}
                  onChange={(v) => setDesign((d) => ({ ...d, density: v }))}
                />
                <Field
                  label={t('flange')}
                  value={design.flange}
                  factor={1}
                  step={5}
                  suffix="mm"
                  min={0}
                  max={200}
                  errText={t('err.number')}
                  onChange={(v) => setDesign((d) => ({ ...d, flange: v }))}
                />
              </div>
              <p className="muted">{t('flange.note')}</p>

              <h2>{t('result')}</h2>
              <dl className="result">
                <div>
                  <dt>{t('area')}</dt>
                  <dd>
                    {sqm.toFixed(3)} <em>m²</em>
                  </dd>
                </div>
                <div>
                  <dt>{t('weight')}</dt>
                  <dd>
                    {kg.toFixed(2)} <em>kg</em>
                  </dd>
                </div>
                {flange > 0 && flangeLength(model) > 0 && (
                  <div className="wide">
                    <dt>{t('flange.length')}</dt>
                    <dd>
                      {(flangeLength(model) / 1e3).toFixed(2)} <em>m</em>
                    </dd>
                  </div>
                )}
              </dl>
              <p className="muted">{t('note')}</p>

              <h2>{t('export')}</h2>
              <div className="exports">
                <button type="button" className="primary" onClick={() => exportAs('dxf')}>
                  {t('ex.dxf')}
                </button>
                <button type="button" onClick={() => exportAs('csv')}>
                  {t('ex.csv')}
                </button>
                <button type="button" onClick={() => exportAs('json')}>
                  {t('ex.json')}
                </button>
                <button type="button" onClick={() => fileInput.current?.click()}>
                  {t('ex.open')}
                </button>
                <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => openFile(e.target.files?.[0])} />
              </div>
            </>
          )}
        </section>

        <section className="views">
          <Views2D model={model} flange={flange} title={(id) => t(`view.${id}`)} dimText={dimText} />
        </section>
      </main>
    </>
  );
}

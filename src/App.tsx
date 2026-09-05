import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { type CodeEditorHandle } from './components/CodeEditor';
import Diagram from './components/Diagram';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ExportModal from './components/ExportModal';
import HelpModal from './components/HelpModal';
import { parseSchema } from './lib/parser';
import { autoLayout, contentBounds, placeNewTables, tableRect } from './lib/geometry';
import { exportPng, exportSvg } from './lib/export';
import { SAMPLES } from './lib/samples';
import type { ConnectorStyle, Point } from './types';

const LS_TEXT = 'qdbd.text';
const LS_POS = 'qdbd.positions';
const LS_OPTS = 'qdbd.opts';

interface Options {
  connector: ConnectorStyle;
  colorful: boolean;
  showLabels: boolean;
  editorWidth: number;
}

const DEFAULT_OPTS: Options = {
  connector: 'orthogonal',
  colorful: true,
  showLabels: false,
  editorWidth: 42,
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [text, setText] = useState<string>(() => localStorage.getItem(LS_TEXT) ?? SAMPLES[0].text);
  const [positions, setPositions] = useState<Record<string, Point>>(() => loadJSON(LS_POS, {}));
  const [opts, setOpts] = useState<Options>(() => loadJSON(LS_OPTS, DEFAULT_OPTS));
  const [selected, setSelected] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);

  const editorRef = useRef<CodeEditorHandle>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseSchema(text), [text]);
  const { tables, relationships, diagnostics, lineKinds, bracketRefs } = parsed;

  /* ---------- visual editing: create / remove connectors ---------- */
  const handleLink = useCallback(
    (fromTable: string, fromCol: string, toTable: string, toCol: string) => {
      if (fromTable === toTable && fromCol === toCol) return;
      setText((prev) => {
        const lines = prev.split('\n');
        const headerIdx = lines.findIndex(
          (l) => l.trim().replace(/\{$/, '').trim().toLowerCase() === fromTable.toLowerCase(),
        );
        if (headerIdx < 0) return prev;
        const indentOf = (i: number) => lines[i].match(/^\s*/)?.[0] ?? '  ';
        let colIdx = -1;
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const t = lines[i].trim();
          if (!t) {
            if (colIdx > headerIdx + 1) break;
            continue;
          }
          if (/^[-=~]{1,}$/.test(t)) continue;
          if (t === '}' || (t.endsWith('{') && i > headerIdx)) break;
          if (t.split(/\s+/)[0] === fromCol) {
            colIdx = i;
            break;
          }
        }

        if (colIdx < 0) {
          // coluna não existe: cria com tipo "int" e a referência
          let insertAt: number;
          if (lines[headerIdx].trim().endsWith('{')) {
            let end = headerIdx + 1;
            while (end < lines.length && lines[end].trim() !== '}') end++;
            if (end >= lines.length) return prev;
            insertAt = end;
          } else {
            insertAt = headerIdx + 2;
            while (insertAt < lines.length && lines[insertAt].trim() !== '') insertAt++;
          }
          lines.splice(insertAt, 0, `${indentOf(insertAt)}${fromCol} int FK >- ${toTable}.${toCol}`);
          return lines.join('\n');
        }

        // coluna existe: apende (ou substitui) a referência no final da linha
        lines[colIdx] =
          lines[colIdx]
            .replace(/\s*(FK\s*)?[<>\-0]+\s*["']?[\w ]+\.["']?[\w$]+["']?/i, ' ')
            .replace(/\s{2,}/g, ' ')
            .trimEnd() +
          ` FK >- ${toTable}.${toCol}`;
        return lines.join('\n');
      });
      flash(`Conexão criada: ${fromTable}.${fromCol} → ${toTable}.${toCol}`);
    },
    [],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const rel = relationships.find((r) => r.id === id);
      if (!rel) return;
      const colKey = `${rel.fromColumn}::${rel.line}`;
      setText((prev) => {
        // relações de [ref: ...]: remove apenas o atributo, mantém a coluna
        if (bracketRefs.has(colKey)) {
          const re =
            /\[(?!\s*\])(?:(?!\]).)*?ref\s*[:=]\s*(?:[<>\-0]+\s*)?(?:"[^"]*"|'[^']*'|[\w ]+)\s*\.\s*(?:"[^"]*"|'[^']*'|[\w$]+)(?:(?!\]).)*?\]/g;
          return prev.replace(re, (m) => {
            const tableM = m.match(/ref\s*[:=]\s*(?:[<>\-0]+\s*)?(?:"([^"]*)"|'([^']*)'|([\w ]+))\s*\.\s*(?:"([^"]*)"|'([^']*)'|([\w$]+))/i);
            if (!tableM) return m;
            const t = (tableM[1] ?? tableM[2] ?? tableM[3] ?? '').trim();
            const c = (tableM[4] ?? tableM[5] ?? tableM[6] ?? '').trim();
            if (
              (t.toLowerCase() === rel.toTable.toLowerCase() && c.toLowerCase() === rel.toColumn.toLowerCase()) ||
              (t.toLowerCase() === rel.fromTable.toLowerCase() && c.toLowerCase() === rel.fromColumn.toLowerCase())
            ) {
              const clean = m
                .slice(1, -1)
                .replace(re, '')
                .replace(/^[,\s]+/, '')
                .replace(/,\s*$/, '')
                .trim();
              return clean ? `[${clean}]` : '';
            }
            return m;
          });
        }
        // relações em linha: remove o símbolo e o alvo (e o FK) da linha da coluna
        const lines = prev.split('\n');
        const headerIdx = lines.findIndex(
          (l) => l.trim().replace(/\{$/, '').trim().toLowerCase() === rel.fromTable.toLowerCase(),
        );
        if (headerIdx < 0) return prev;
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const t = lines[i].trim();
          if (!t) continue;
          if (/^[-=~]{1,}$/.test(t)) continue;
          if (t === '}' || (t.endsWith('{') && i > headerIdx)) break;
          if (t.split(/\s+/)[0] === rel.fromColumn) {
            lines[i] = lines[i]
              .replace(/\s*(FK\s*)?[<>\-0]+\s*["']?[\w ]+\.["']?[\w$]+["']?/i, ' ')
              .replace(/\s{2,}/g, ' ')
              .trimEnd();
            return lines.join('\n');
          }
        }
        return prev;
      });
      flash(`Conexão removida: ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}`);
    },
    [relationships, bracketRefs],
  );

  /* ---------- persistence ---------- */
  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(LS_TEXT, text), 300);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(LS_POS, JSON.stringify(positions)), 300);
    return () => clearTimeout(id);
  }, [positions]);

  useEffect(() => {
    localStorage.setItem(LS_OPTS, JSON.stringify(opts));
  }, [opts]);

  /* ---------- keep user positions, only place new tables ---------- */
  useEffect(() => {
    setPositions((prev) => {
      const missing = tables.some((t) => !prev[t.name]);
      if (!missing) return prev;
      return placeNewTables(tables, prev);
    });
  }, [tables]);

  const movedTables = useMemo(
    () => tables.filter((t) => positions[t.name]).length,
    [tables, positions],
  );

  /* ---------- tables that contain errors ---------- */
  const errorTables = useMemo(() => {
    const set = new Set<string>();
    const starts = tables
      .map((t) => ({ name: t.name, line: t.line }))
      .sort((a, b) => a.line - b.line);
    for (const d of diagnostics) {
      if (d.severity !== 'error') continue;
      let owner: string | null = null;
      for (const s of starts) {
        if (s.line <= d.line) owner = s.name;
        else break;
      }
      if (owner) set.add(owner);
    }
    return set;
  }, [diagnostics, tables]);

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.length - errorCount;
  const columnCount = tables.reduce((acc, t) => acc + t.columns.length, 0);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  /* ---------- actions ---------- */
  const handleMove = useCallback((name: string, p: Point) => {
    setPositions((prev) => ({ ...prev, [name]: p }));
  }, []);

  const handleAutoLayout = () => {
    setPositions((prev) => ({ ...prev, ...autoLayout(tables) }));
    setFitTick((t) => t + 1);
    flash('Layout reorganizado');
  };

  const bounds = () => contentBounds(tables.map((t) => tableRect(t, positions)), 48);

  const handleExportPng = async () => {
    if (!svgRef.current || !tables.length) return;
    await exportPng(svgRef.current, bounds(), 'diagrama.png', 2);
    flash('PNG exportado');
  };

  const handleExportSvg = () => {
    if (!svgRef.current || !tables.length) return;
    exportSvg(svgRef.current, bounds(), 'diagrama.svg');
    flash('SVG exportado');
  };

  /* ---------- resizable split ---------- */
  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setOpts((o) => ({ ...o, editorWidth: Math.min(70, Math.max(22, pct)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const connectorOptions: { id: ConnectorStyle; label: string; icon: string }[] = [
    { id: 'orthogonal', label: 'Ortogonal', icon: '⌐' },
    { id: 'curved', label: 'Curvo', icon: '∿' },
    { id: 'straight', label: 'Reto', icon: '／' },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* ---------------- header ---------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-black text-white shadow-lg shadow-sky-500/20">
            Q
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-tight">QuickDBD Studio</h1>
            <p className="text-[11px] text-slate-500">Diagramas de banco de dados digitando</p>
          </div>
        </div>

        <div className="mx-2 hidden h-6 w-px bg-slate-800 sm:block" />

        <div className="relative">
          <button
            onClick={() => setShowSamples((s) => !s)}
            onBlur={() => setTimeout(() => setShowSamples(false), 150)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Exemplos ▾
          </button>
          {showSamples && (
            <div className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={() => {
                    setText(s.text);
                    setPositions({});
                    setSelected(null);
                    setTimeout(() => setFitTick((t) => t + 1), 60);
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-700"
                >
                  <span className="block text-xs font-medium text-slate-100">{s.name}</span>
                  <span className="block text-[11px] text-slate-400">{s.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => {
            setText('');
            setSelected(null);
          }}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Limpar
        </button>
        <button
          onClick={handleAutoLayout}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          title="Reposiciona todas as tabelas em grade"
        >
          Auto layout
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Sintaxe
          </button>
          <button
            onClick={handleExportSvg}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            SVG
          </button>
          <button
            onClick={handleExportPng}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            PNG
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-sky-400"
          >
            Exportar SQL
          </button>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {/* editor side */}
        <section
          className="flex min-h-0 min-w-0 flex-col border-r border-slate-800"
          style={{ width: `${opts.editorWidth}%` }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Schema
            </span>
            <span className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>{tables.length} tabelas</span>
              <span className="text-slate-700">•</span>
              <span>{columnCount} colunas</span>
              <span className="text-slate-700">•</span>
              <span>{relationships.length} relações</span>
            </span>
          </div>

          <CodeEditor
            ref={editorRef}
            value={text}
            onChange={setText}
            lineKinds={lineKinds}
            diagnostics={diagnostics}
            highlightTable={selected}
          />

          <DiagnosticsPanel
            diagnostics={diagnostics}
            onJump={(line) => editorRef.current?.goToLine(line)}
          />
        </section>

        {/* splitter */}
        <div
          onPointerDown={startSplitDrag}
          className="w-1 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-sky-500"
        />

        {/* diagram side */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Diagrama
            </span>

            <div className="ml-2 flex items-center gap-0.5 rounded-md bg-slate-800 p-0.5">
              {connectorOptions.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setOpts((o) => ({ ...o, connector: c.id }))}
                  title={`Conectores: ${c.label}`}
                  className={`rounded px-2 py-1 text-[11px] transition ${
                    opts.connector === c.id
                      ? 'bg-sky-500 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span className="mr-1 font-mono">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setOpts((o) => ({ ...o, colorful: !o.colorful }))}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                opts.colorful
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
              title="Cor diferente para cada relação"
            >
              🎨 Cores
            </button>
            <button
              onClick={() => setOpts((o) => ({ ...o, showLabels: !o.showLabels }))}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                opts.showLabels
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
              title="Mostrar as colunas ligadas em cada conector"
            >
              🏷️ Rótulos
            </button>

            <details className="group relative">
              <summary className="cursor-pointer list-none rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                Legenda
              </summary>
              <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-800 p-3 text-[11px] shadow-xl">
                <p className="mb-2 font-semibold text-slate-200">Notação pé-de-galinha</p>
                <ul className="space-y-1 text-slate-300">
                  <li>
                    <span className="mr-2 font-mono text-pink-400">||</span> exatamente um
                  </li>
                  <li>
                    <span className="mr-2 font-mono text-pink-400">&lt;</span> muitos
                  </li>
                  <li>
                    <span className="mr-2 font-mono text-pink-400">○</span> zero ou um
                  </li>
                  <li>
                    <span className="mr-2 font-mono text-pink-400">○&lt;</span> zero ou muitos
                  </li>
                </ul>
                <p className="mt-2 text-slate-400">
                  Passe o mouse sobre uma tabela para destacar apenas as conexões dela.
                </p>
              </div>
            </details>

            <span className="ml-auto text-[11px] text-slate-500">
              {selected ? (
                <>
                  Selecionada: <span className="text-sky-400">{selected}</span>
                </>
              ) : (
                'arraste as tabelas • posições salvas'
              )}
            </span>
          </div>

          <Diagram
            tables={tables}
            relationships={relationships}
            positions={positions}
            onMove={handleMove}
            onLink={handleLink}
            onRemove={handleRemove}
            connector={opts.connector}
            colorful={opts.colorful}
            showLabels={opts.showLabels}
            selected={selected}
            onSelect={setSelected}
            errorTables={errorTables}
            fitTick={fitTick}
            svgRef={svgRef}
          />
        </section>
      </div>

      {/* ---------------- status bar ---------------- */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 py-1.5 text-[11px] text-slate-500">
        <span className={errorCount ? 'text-rose-400' : 'text-emerald-400'}>
          {errorCount ? `✖ ${errorCount} erro(s)` : '✔ sem erros'}
        </span>
        <span className={warningCount ? 'text-amber-400' : ''}>⚠ {warningCount} aviso(s)</span>
            <span className="text-slate-700">|</span>
            <span>{movedTables} posições memorizadas</span>
            <span className="ml-auto">
              arraste os ● das colunas para ligar • solte sobre outra linha para removê-la • roda = zoom
            </span>
      </footer>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-xs text-slate-100 shadow-xl">
          {toast}
        </div>
      )}

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        tables={tables}
        relationships={relationships}
      />
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

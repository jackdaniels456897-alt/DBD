import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { type CodeEditorHandle } from './components/CodeEditor';
import Diagram, { type DiagramHandle } from './components/Diagram';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ExportModal from './components/ExportModal';
import HelpModal from './components/HelpModal';
import { parseSchema } from './lib/parser';
import { autoLayout, contentBounds, placeNewTables, tableRect } from './lib/geometry';
import { downloadBlob, exportPng, exportSvg } from './lib/export';
import {
  createVisualConnection,
  createVisualTable,
  removeVisualConnection,
} from './lib/visualRelations';
import { SAMPLES } from './lib/samples';
import type { ConnectorStyle, Point, TableGroup } from './types';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MODIFIER_LABEL = IS_MAC ? '⌘' : 'Ctrl';

const LS_TEXT = 'qdbd.text';
const LS_POS = 'qdbd.positions';
const LS_OPTS = 'qdbd.opts';
const LS_GROUPS = 'qdbd.groups';

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
  const [groups, setGroups] = useState<TableGroup[]>(() => {
    try {
      const raw = localStorage.getItem(LS_GROUPS);
      return raw ? (JSON.parse(raw) as TableGroup[]) : [];
    } catch {
      return [];
    }
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);

  const editorRef = useRef<CodeEditorHandle>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<DiagramHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const namePromptInput = useRef<HTMLInputElement | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showGroupsPanel, setShowGroupsPanel] = useState(false);
  const [groupPrompt, setGroupPrompt] = useState<{ resolve: (name: string | null) => void } | null>(null);
  const [tablePrompt, setTablePrompt] = useState<{
    screen: Point;
    position?: Point;
    value: string;
  } | null>(null);

  const parsed = useMemo(() => parseSchema(text), [text]);
  const { tables, relationships, diagnostics, lineKinds } = parsed;

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /* ---------- edit mode: hold Ctrl (Windows/Linux) or ⌘ (Mac) ---------- */
  useEffect(() => {
    const isModifier = (e: KeyboardEvent) => e.key === 'Control' || e.key === 'Meta';
    const onDown = (e: KeyboardEvent) => { if (isModifier(e)) setEditMode(true); };
    const onUp = (e: KeyboardEvent) => { if (isModifier(e)) setEditMode(false); };
    const onSyncFromEvent = (e: KeyboardEvent) => {
      // Handles cases where the browser stole the initial keydown (e.g. shortcut menu).
      setEditMode(e.ctrlKey || e.metaKey);
    };
    const clear = () => setEditMode(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('keydown', onSyncFromEvent, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('keydown', onSyncFromEvent, true);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, []);

  /* ---------- visual creation of tables ---------- */
  const handleCreateTable = useCallback(
    (name: string, position?: Point) => {
      const result = createVisualTable(text, name);
      if (result.status === 'created') {
        if (position) {
          setPositions((prev) => ({ ...prev, [result.tableName]: position }));
        }
        setText(result.text);
        setSelected(result.tableName);
      }
      flash(result.message);
      return result.status === 'created';
    },
    [text, flash],
  );

  const openTablePrompt = useCallback((screen: Point, position?: Point) => {
    setTablePrompt({ screen, position, value: '' });
  }, []);

  const openHeaderTablePrompt = useCallback(() => {
    const center = diagramRef.current?.getViewportCenter();
    if (center) openTablePrompt(center.screen, center.diagram);
    else openTablePrompt({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, [openTablePrompt]);

  const confirmTablePrompt = useCallback(() => {
    if (!tablePrompt) return;
    const ok = handleCreateTable(tablePrompt.value, tablePrompt.position);
    if (ok) setTablePrompt(null);
    else namePromptInput.current?.focus();
  }, [handleCreateTable, tablePrompt]);

  useEffect(() => {
    if (tablePrompt) namePromptInput.current?.focus();
  }, [tablePrompt]);

  /* ---------- visual editing: create / remove connectors ---------- */
  const handleLink = useCallback(
    (fromTable: string, fromCol: string, toTable: string, toCol: string) => {
      const result = createVisualConnection(
        text,
        { table: fromTable, column: fromCol },
        { table: toTable, column: toCol },
      );
      if (result.text !== text) setText(result.text);
      flash(result.message);
    },
    [text, flash],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const result = removeVisualConnection(text, id);
      if (result.text !== text) setText(result.text);
      flash(result.message);
    },
    [text, flash],
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
    const id = setTimeout(() => localStorage.setItem(LS_GROUPS, JSON.stringify(groups)), 300);
    return () => clearTimeout(id);
  }, [groups]);

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

  const handleExportProject = () => {
    const project = {
      version: 1,
      text,
      positions,
      opts,
      groups,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'quickdbd-projeto.json');
    flash('Projeto exportado (layout mantido!)');
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string);
        if (data && typeof data.text === 'string') {
          setText(data.text);
          if (data.positions && typeof data.positions === 'object') {
            setPositions(data.positions);
          }
          if (Array.isArray(data.groups)) {
            setGroups(data.groups);
          }
          if (data.opts && typeof data.opts === 'object') {
            setOpts((prev) => ({ ...prev, ...data.opts }));
          }
          setSelected(null);
          setSelectedGroup(null);
          setTimeout(() => setFitTick((t) => t + 1), 60);
          flash('Projeto importado (layout restaurado!)');
        } else {
          alert('Formato de projeto inválido.');
        }
      } catch {
        alert('Falha ao ler o arquivo JSON do projeto.');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset
  };

  /* ---------- table groups ---------- */
  const addTableToGroup = useCallback((groupId: string, tableName: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.tableNames.includes(tableName)
          ? { ...g, tableNames: [...g.tableNames, tableName] }
          : g,
      ),
    );
  }, []);

  const removeTableFromGroup = useCallback((groupId: string, tableName: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, tableNames: g.tableNames.filter((n) => n !== tableName) } : g,
      ),
    );
  }, []);

  const createGroup = useCallback((name: string, tableNames: string[] = []) => {
    const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setGroups((prev) => [...prev, { id, name: name || `Grupo ${prev.length + 1}`, tableNames }]);
    return id;
  }, []);

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setSelectedGroup(null);
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  const moveTablesTogether = useCallback(
    (delta: Point) => {
      if (!selectedGroup) return;
      const grp = groups.find((g) => g.id === selectedGroup);
      if (!grp) return;
      setPositions((prev) => {
        const next = { ...prev };
        for (const name of grp.tableNames) {
          if (next[name]) {
            next[name] = { x: next[name].x + delta.x, y: next[name].y + delta.y };
          }
        }
        return next;
      });
    },
    [groups, selectedGroup],
  );

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
                    setGroups([]);
                    setSelected(null);
                    setSelectedGroup(null);
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
            setGroups([]);
            setSelected(null);
            setSelectedGroup(null);
          }}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Limpar
        </button>
        <button
          onClick={openHeaderTablePrompt}
          className="rounded-md border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
          title="Adiciona uma nova tabela ao schema"
        >
          + Nova tabela
        </button>
        <div className="relative">
          <button
            onClick={() => setShowGroupsPanel((s) => !s)}
            onBlur={() => setTimeout(() => setShowGroupsPanel(false), 180)}
            className={`rounded-md border px-3 py-1.5 text-xs transition ${
              groups.length
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="Agrupar tabelas em regiões nomeadas"
          >
            📁 Grupos{groups.length ? ` (${groups.length})` : ''}
          </button>
          {showGroupsPanel && (
            <div
              className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-800 p-2 shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Grupos</span>
                <button
                  onClick={() => setGroupPrompt({ resolve: (name) => name && createGroup(name, selected ? [selected] : []) })}
                  className="text-[11px] font-medium text-amber-300 hover:text-amber-200"
                >
                  + Novo grupo
                </button>
              </div>
              {groups.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-slate-500">Selecione uma tabela e clique em “+ Novo grupo” para começar.</p>
              ) : (
                <ul className="space-y-1">
                  {groups.map((g) => (
                    <li key={g.id} className={`rounded px-2 py-1 ${selectedGroup === g.id ? 'bg-amber-500/20' : 'hover:bg-slate-700/60'}`}>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400"
                          title="Grupo selecionado"
                        />
                        <input
                          value={g.name}
                          onChange={(e) => renameGroup(g.id, e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none focus:text-amber-200"
                          placeholder="Nome do grupo"
                        />
                        <button
                          onClick={() => setSelectedGroup(selectedGroup === g.id ? null : g.id)}
                          className="text-[10px] text-slate-400 hover:text-amber-300"
                          title={selectedGroup === g.id ? 'Deselecionar' : 'Selecionar'}
                        >
                          {selectedGroup === g.id ? '●' : '○'}
                        </button>
                        <button
                          onClick={() => deleteGroup(g.id)}
                          className="text-[10px] text-slate-500 hover:text-rose-400"
                          title="Excluir grupo"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="mt-0.5 pl-5 text-[10px] text-slate-500">
                        {g.tableNames.length} tabela{g.tableNames.length === 1 ? '' : 's'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <button
          onClick={handleAutoLayout}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          title="Reposiciona todas as tabelas em grade"
        >
          Auto layout
        </button>
        <span
          className={`ml-1 hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition sm:inline-flex ${
            editMode
              ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
              : 'border-slate-700 bg-slate-800/60 text-slate-400'
          }`}
          title={`Segure ${MODIFIER_LABEL} para exibir âncoras de conexão e o botão de remover`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${editMode ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.9)]' : 'bg-slate-500'}`} />
          {editMode ? `Modo edição (${MODIFIER_LABEL})` : `Segure ${MODIFIER_LABEL} p/ editar`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportProject}
            accept=".json"
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Importar um arquivo JSON de projeto com todo o layout preservado"
          >
            📂 Importar Projeto
          </button>
          <button
            onClick={handleExportProject}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Salvar o projeto em um arquivo JSON com todo o layout preservado"
          >
            💾 Salvar Projeto
          </button>
          <div className="h-4 w-px bg-slate-800" />
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Sintaxe
          </button>
          <button
            onClick={handleExportSvg}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Exportar diagrama como SVG mantendo o layout atual"
          >
            SVG
          </button>
          <button
            onClick={handleExportPng}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Exportar diagrama como PNG mantendo o layout atual"
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

            {selectedGroup && (
              <span className="ml-2 flex items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
                📁 {groups.find((g) => g.id === selectedGroup)?.name ?? 'Grupo'}
                {selected && groups.find((g) => g.id === selectedGroup)?.tableNames.includes(selected) ? (
                  <button
                    onMouseDown={() => {
                      removeTableFromGroup(selectedGroup, selected);
                      flash(`"${selected}" removida do grupo.`);
                    }}
                    className="ml-1 text-amber-300 hover:text-amber-100"
                    title={`Remover "${selected}" do grupo`}
                  >
                    ✕
                  </button>
                ) : selected ? (
                  <button
                    onMouseDown={() => {
                      addTableToGroup(selectedGroup, selected);
                      flash(`"${selected}" adicionada ao grupo.`);
                    }}
                    className="ml-1 text-amber-300 hover:text-amber-100"
                    title={`Adicionar "${selected}" ao grupo`}
                  >
                    +
                  </button>
                ) : null}
              </span>
            )}
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
            onCreateTableAt={(screen, position) => openTablePrompt(screen, position)}
            connector={opts.connector}
            colorful={opts.colorful}
            showLabels={opts.showLabels}
            editMode={editMode}
            selected={selected}
            onSelect={setSelected}
            errorTables={errorTables}
            fitTick={fitTick}
            svgRef={svgRef}
            diagramRef={diagramRef}
            groups={groups}
            selectedGroup={selectedGroup}
            onSelectGroup={setSelectedGroup}
            onMoveGroup={moveTablesTogether}
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
        {groups.length > 0 && (
          <>
            <span className="text-slate-700">|</span>
            <span className="text-amber-300">📁 {groups.length} grupo{groups.length === 1 ? '' : 's'}</span>
          </>
        )}
        <span className="ml-auto">
          Segure <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">{MODIFIER_LABEL}</kbd> para editar visualmente • duplo-clique cria tabela • Esc cancela
        </span>
      </footer>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-xs text-slate-100 shadow-xl">
          {toast}
        </div>
      )}

      {groupPrompt && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setGroupPrompt(null)}
          />
          <div
            className="fixed left-1/2 top-1/3 z-50 w-64 -translate-x-1/2 rounded-lg border border-amber-500/60 bg-slate-900 p-3 shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const el = e.currentTarget.querySelector('input');
                const name = (el as HTMLInputElement)?.value.trim() ?? '';
                setGroupPrompt(null);
                if (name) {
                  const grp = createGroup(name, selected ? [selected] : []);
                  setSelectedGroup(grp);
                  if (selected) flash(`Grupo "${name}" criado com "${selected}" nele.`);
                  else flash(`Grupo "${name}" criado.`);
                }
              }}
            >
              <label className="mb-1 block text-[11px] font-medium text-amber-300">
                Nome do grupo
              </label>
              <input
                autoFocus
                defaultValue=""
                maxLength={40}
                placeholder="Ex.: Autenticação"
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-500"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                {selected
                  ? `O grupo nascerá com a tabela "${selected}" incluída.`
                  : 'Você poderá adicionar/remover tabelas depois.'}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setGroupPrompt(null)}
                  className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-300"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {tablePrompt && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setTablePrompt(null)}
          />
          <div
            className="fixed z-50 w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-emerald-500/60 bg-slate-900 p-3 shadow-2xl"
            style={{
              left: Math.min(Math.max(tablePrompt.screen.x, 140), window.innerWidth - 140),
              top: Math.min(Math.max(tablePrompt.screen.y, 60), window.innerHeight - 100),
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirmTablePrompt();
              }}
            >
              <label className="mb-1 block text-[11px] font-medium text-emerald-300">
                Nome da nova tabela
              </label>
              <input
                ref={namePromptInput}
                value={tablePrompt.value}
                onChange={(e) =>
                  setTablePrompt((p) => (p ? { ...p, value: e.target.value } : p))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setTablePrompt(null);
                  }
                }}
                placeholder="Ex.: Customers"
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-emerald-500"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                Letras, números e underscore. A tabela nasce com <code className="text-emerald-300">id</code> como PK.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTablePrompt(null)}
                  className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-emerald-400"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </>
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

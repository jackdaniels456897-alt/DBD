import { useMemo, useState } from 'react';
import type { Relationship, Table } from '../types';
import { DIALECT_LABELS, generateMarkdown, generateSQL, type Dialect } from '../lib/sql';
import { downloadText } from '../lib/export';

interface Props {
  open: boolean;
  onClose: () => void;
  tables: Table[];
  relationships: Relationship[];
}

export default function ExportModal({ open, onClose, tables, relationships }: Props) {
  const [tab, setTab] = useState<'sql' | 'markdown'>('sql');
  const [dialect, setDialect] = useState<Dialect>('mysql');
  const [dropIfExists, setDropIfExists] = useState(false);
  const [copied, setCopied] = useState(false);

  const content = useMemo(() => {
    if (!open) return '';
    return tab === 'sql'
      ? generateSQL(tables, relationships, dialect, { dropIfExists })
      : generateMarkdown(tables, relationships);
  }, [open, tab, tables, relationships, dialect, dropIfExists]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    if (tab === 'sql') downloadText(content, `schema-${dialect}.sql`, 'application/sql');
    else downloadText(content, 'schema.md', 'text/markdown');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1">
            {(['sql', 'markdown'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  tab === t ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {t === 'sql' ? 'SQL' : 'Documentação (MD)'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2">
          {tab === 'sql' && (
            <>
              <select
                value={dialect}
                onChange={(e) => setDialect(e.target.value as Dialect)}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
              >
                {(Object.keys(DIALECT_LABELS) as Dialect[]).map((d) => (
                  <option key={d} value={d}>
                    {DIALECT_LABELS[d]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={dropIfExists}
                  onChange={(e) => setDropIfExists(e.target.checked)}
                  className="accent-sky-500"
                />
                DROP TABLE IF EXISTS
              </label>
            </>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={copy}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              {copied ? '✔ Copiado' : 'Copiar'}
            </button>
            <button
              onClick={download}
              className="rounded bg-sky-500 px-3 py-1 text-xs font-medium text-white hover:bg-sky-400"
            >
              Baixar
            </button>
          </div>
        </div>

        <pre className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-300">
          {content}
        </pre>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Diagnostic } from '../types';

interface Props {
  diagnostics: Diagnostic[];
  onJump: (line: number) => void;
}

export default function DiagnosticsPanel({ diagnostics, onJump }: Props) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const list = filter === 'all' ? diagnostics : diagnostics.filter((d) => d.severity === filter);

  return (
    <div className="border-t border-slate-800 bg-slate-900/80">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white"
        >
          <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          Problemas
        </button>

        <button
          onClick={() => setFilter(filter === 'error' ? 'all' : 'error')}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
            errors.length
              ? filter === 'error'
                ? 'bg-rose-500 text-white'
                : 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          ✖ {errors.length} erro{errors.length === 1 ? '' : 's'}
        </button>
        <button
          onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
            warnings.length
              ? filter === 'warning'
                ? 'bg-amber-400 text-slate-900'
                : 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          ⚠ {warnings.length} aviso{warnings.length === 1 ? '' : 's'}
        </button>

        {!diagnostics.length && (
          <span className="ml-auto text-[11px] text-emerald-400">✔ schema sem problemas</span>
        )}
      </div>

      {open && (
        <div className="max-h-44 overflow-y-auto border-t border-slate-800/80">
          {list.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">
              Nenhum problema encontrado. Bom trabalho!
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {list.map((d, i) => (
                <li key={`${d.line}-${i}`}>
                  <button
                    onClick={() => onJump(d.line)}
                    className="group flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-800/70"
                  >
                    <span
                      className={`mt-[2px] shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        d.severity === 'error'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-amber-400/20 text-amber-300'
                      }`}
                    >
                      {d.severity === 'error' ? 'ERRO' : 'AVISO'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-slate-200">{d.message}</span>
                      {d.hint && (
                        <span className="mt-0.5 block text-[11px] text-slate-500">💡 {d.hint}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-500 group-hover:text-sky-400">
                      L{d.line}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

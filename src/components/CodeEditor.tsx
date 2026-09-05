import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Diagnostic, LineKind } from '../types';

export interface CodeEditorHandle {
  goToLine: (line: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  lineKinds: LineKind[];
  diagnostics: Diagnostic[];
  highlightTable?: string | null;
}

const LINE_H = 22;
const PAD_Y = 10;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KEYWORD_RE =
  /^(pk|fk|unique|uq|increment|autoincrement|auto_increment|identity|null|nullable|index|idx|not|default|ref|note)$/i;
const SYMBOL_RE = /^(?:[<>]?0?-0?[<>]?|<>|>|<)$/;

function span(cls: string, text: string) {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function highlightColumn(raw: string): string {
  const indentMatch = raw.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const rest = raw.slice(indent.length);
  if (!rest) return escapeHtml(raw);

  let html = escapeHtml(indent);
  const tokenRe = /(\s+)|(\[|\]|,)|("[^"]*"|'[^']*')|([^\s[\],]+)/g;
  let m: RegExpExecArray | null;
  let isFirst = true;
  let inBracket = false;

  while ((m = tokenRe.exec(rest))) {
    const [, ws, punct, quoted, word] = m;
    if (ws) {
      html += escapeHtml(ws);
      continue;
    }
    if (punct) {
      if (punct === '[') inBracket = true;
      if (punct === ']') inBracket = false;
      html += span('text-slate-500', punct);
      continue;
    }
    if (quoted) {
      html += span('text-amber-300', quoted);
      continue;
    }
    if (word) {
      if (isFirst && !inBracket) {
        html += span('text-sky-200 font-semibold', word);
        isFirst = false;
        continue;
      }
      if (SYMBOL_RE.test(word)) {
        html += span('text-pink-400 font-bold', word);
        continue;
      }
      if (/^[\w$]+\.[\w$]+$/.test(word)) {
        html += span('text-violet-300 underline decoration-dotted', word);
        continue;
      }
      const bare = word.replace(/[:=].*$/, '');
      if (KEYWORD_RE.test(bare)) {
        const isKey = /^(pk|fk)$/i.test(bare);
        html += span(isKey ? 'text-amber-400 font-bold' : 'text-emerald-400', word);
        continue;
      }
      html += span('text-teal-300', word);
    }
  }
  return html;
}

function highlightLine(raw: string, kind: LineKind): string {
  if (!raw) return '&nbsp;';
  switch (kind) {
    case 'comment':
      return span('text-slate-500 italic', raw);
    case 'header':
      return raw.replace(/^(\s*)(.*)$/, (_full, ind: string, body: string) => {
        const brace = body.endsWith('{');
        const name = brace ? body.slice(0, -1).trimEnd() : body;
        return (
          escapeHtml(ind) +
          span('text-blue-300 font-bold', name) +
          (brace ? ' ' + span('text-slate-500', '{') : '')
        );
      });
    case 'separator':
      return span('text-slate-600', raw);
    case 'brace':
      return span('text-slate-500', raw);
    case 'unknown':
      return span('text-rose-300', raw);
    case 'column':
      return highlightColumn(raw);
    default:
      return escapeHtml(raw) || '&nbsp;';
  }
}

const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, lineKinds, diagnostics, highlightTable },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [cursorLine, setCursorLine] = useState(1);

  const lines = useMemo(() => value.split('\n'), [value]);

  const byLine = useMemo(() => {
    const map = new Map<number, Diagnostic[]>();
    for (const d of diagnostics) {
      const arr = map.get(d.line) ?? [];
      arr.push(d);
      map.set(d.line, arr);
    }
    return map;
  }, [diagnostics]);

  const tableLine = useMemo(() => {
    if (!highlightTable) return -1;
    const idx = lines.findIndex((l) => {
      const t = l.trim().replace(/\{$/, '').trim();
      return t.toLowerCase() === highlightTable.toLowerCase();
    });
    return idx + 1;
  }, [highlightTable, lines]);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }, []);

  const updateCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const upTo = ta.value.slice(0, ta.selectionStart);
    setCursorLine(upTo.split('\n').length);
  }, []);

  useImperativeHandle(ref, () => ({
    goToLine(line: number) {
      const ta = textareaRef.current;
      if (!ta) return;
      const all = ta.value.split('\n');
      const idx = Math.min(Math.max(line - 1, 0), all.length - 1);
      const start = all.slice(0, idx).reduce((acc, l) => acc + l.length + 1, 0);
      const end = start + all[idx].length;
      ta.focus();
      ta.setSelectionRange(start, end);
      const target = Math.max(0, (idx - 4) * LINE_H);
      ta.scrollTop = target;
      syncScroll();
      setCursorLine(idx + 1);
    },
  }));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-950 font-mono text-[13px] leading-[22px]">
      {/* gutter */}
      <div
        ref={gutterRef}
        className="w-[58px] shrink-0 overflow-hidden border-r border-slate-800 bg-slate-900/70 text-right select-none"
        style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
      >
        {lines.map((_, i) => {
          const ln = i + 1;
          const diags = byLine.get(ln);
          const hasError = diags?.some((d) => d.severity === 'error');
          const hasWarning = !hasError && diags?.length;
          return (
            <div
              key={ln}
              title={diags?.map((d) => `${d.severity === 'error' ? '✖' : '⚠'} ${d.message}`).join('\n')}
              className={`flex items-center justify-end gap-1 pr-2 ${
                hasError
                  ? 'bg-rose-500/15 text-rose-300'
                  : hasWarning
                    ? 'bg-amber-500/10 text-amber-300'
                    : ln === cursorLine
                      ? 'text-slate-300'
                      : 'text-slate-600'
              }`}
              style={{ height: LINE_H }}
            >
              {hasError ? <span className="text-[10px]">✖</span> : null}
              {hasWarning ? <span className="text-[10px]">⚠</span> : null}
              <span>{ln}</span>
            </div>
          );
        })}
      </div>

      {/* code area */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={overlayRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden text-slate-200"
        >
          <div
            className="w-max min-w-full whitespace-pre px-3"
            style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
          >
          {lines.map((line, i) => {
            const ln = i + 1;
            const diags = byLine.get(ln);
            const hasError = diags?.some((d) => d.severity === 'error');
            const hasWarning = !hasError && !!diags?.length;
            return (
              <div
                key={ln}
                style={{ height: LINE_H }}
                className={
                  hasError
                    ? 'rounded-sm bg-rose-500/10 shadow-[inset_2px_0_0_0_rgb(244,63,94)]'
                    : hasWarning
                      ? 'rounded-sm bg-amber-400/10 shadow-[inset_2px_0_0_0_rgb(251,191,36)]'
                      : ln === tableLine
                        ? 'rounded-sm bg-sky-500/15'
                        : ln === cursorLine
                          ? 'rounded-sm bg-white/[0.04]'
                          : undefined
                }
                dangerouslySetInnerHTML={{
                  __html: highlightLine(line, lineKinds[i] ?? 'blank'),
                }}
              />
            );
          })}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyUp={updateCursor}
          onClick={updateCursor}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent px-3 font-mono text-[13px] leading-[22px] text-transparent caret-sky-400 outline-none selection:bg-sky-500/30 placeholder:text-slate-600"
          style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
          placeholder="Users&#10;-&#10;id int PK&#10;email varchar UNIQUE"
        />
      </div>
    </div>
  );
});

export default CodeEditor;

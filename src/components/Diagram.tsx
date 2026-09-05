import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  Cardinality,
  ConnectorStyle,
  Point,
  Relationship,
  Table,
} from '../types';
import {
  buildConnector,
  computeAnchors,
  contentBounds,
  HEADER_H,
  ROW_H,
  rowCenterY,
  tableRect,
  type ConnectorPath,
  type Rect,
} from '../lib/geometry';

const PALETTE = [
  '#38bdf8', '#f472b6', '#facc15', '#4ade80',
  '#a78bfa', '#fb923c', '#22d3ee', '#f87171',
];

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

interface Props {
  tables: Table[];
  relationships: Relationship[];
  positions: Record<string, Point>;
  onMove: (name: string, p: Point) => void;
  onLink: (from: string, fromCol: string, to: string, toCol: string) => void;
  onRemove: (id: string) => void;
  connector: ConnectorStyle;
  colorful: boolean;
  showLabels: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  errorTables: Set<string>;
  fitTick: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

type LinkDrag = {
  srcTable: string;
  srcCol: string;
  srcIndex: number;
  srcSide: 'out' | 'in';
  cursor: Point;
};

type DragState =
  | { mode: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { mode: 'table'; name: string; dx: number; dy: number }
  | { mode: 'link'; drag: LinkDrag };

/** distance from point P to segment AB */
function segDist(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function pathDist(p: Point, d: string): number {
  const cmds = d.slice(1).match(/[MLQ][-+0-9.]+(?:\s[-+0-9.]+)+/g);
  if (!cmds) return Infinity;
  let min = Infinity;
  let cur: Point | null = null;
  for (const c of cmds) {
    const n2 = c.match(/[-+0-9.]+/g)?.map(Number) ?? [];
    const kind = c[0];
    if (kind === 'M') cur = { x: n2[0], y: n2[1] };
    else if (kind === 'L' && cur) {
      const next = { x: n2[0], y: n2[1] };
      min = Math.min(min, segDist(p, cur, next));
      cur = next;
    } else if (kind === 'Q' && cur && n2.length >= 4) {
      const cp = { x: n2[0], y: n2[1] };
      const next = { x: n2[2], y: n2[3] };
      let last = cur;
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        const mt = 1 - t;
        const pt = {
          x: mt * mt * last.x + 2 * mt * t * cp.x + t * t * next.x,
          y: mt * mt * last.y + 2 * mt * t * cp.y + t * t * next.y,
        };
        min = Math.min(min, segDist(p, last, pt));
        last = pt;
      }
      cur = next;
    }
  }
  return min;
}

function CrowFoot({
  x,
  y,
  dir,
  card,
  color,
  active,
}: {
  x: number;
  y: number;
  dir: 1 | -1;
  card: Cardinality;
  color: string;
  active: boolean;
}) {
  const w = active ? 2.4 : 1.8;
  const props = { stroke: color, strokeWidth: w, strokeLinecap: 'round' as const, fill: 'none' };
  const many = card === 'many' || card === 'zero-or-many';
  const zero = card === 'zero-or-one' || card === 'zero-or-many';
  const items = [];

  if (many) {
    const base = x + dir * 15;
    items.push(<path key="f1" d={`M ${base} ${y} L ${x} ${y - 8}`} {...props} />);
    items.push(<path key="f2" d={`M ${base} ${y} L ${x} ${y + 8}`} {...props} />);
    items.push(<path key="f3" d={`M ${base} ${y} L ${x} ${y}`} {...props} />);
  } else {
    const tx = x + dir * 13;
    items.push(<path key="t" d={`M ${tx} ${y - 7} L ${tx} ${y + 7}`} {...props} />);
  }
  if (zero) {
    const cx = x + dir * 23;
    items.push(<circle key="c" cx={cx} cy={y} r={4.5} fill="#0b1220" stroke={color} strokeWidth={w} />);
  }
  return <g>{items}</g>;
}

export default function Diagram({
  tables,
  relationships,
  positions,
  onMove,
  onLink,
  onRemove,
  connector,
  colorful,
  showLabels,
  selected,
  onSelect,
  errorTables,
  fitTick,
  svgRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hoverTable, setHoverTable] = useState<string | null>(null);
  const [hoverRel, setHoverRel] = useState<string | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [linkHit, setLinkHit] = useState<string | null>(null);
  const [draggingTable, setDraggingTable] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const t of tables) map.set(t.name, tableRect(t, positions));
    return map;
  }, [tables, positions]);

  const toDiagram = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const r = svg.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    },
    [svgRef],
  );

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !tables.length) return;
    const b = contentBounds([...rects.values()], 60);
    const k = Math.min(1.2, Math.min(wrap.clientWidth / b.w, wrap.clientHeight / b.h));
    setView({
      k,
      x: (wrap.clientWidth - b.w * k) / 2 - b.x * k,
      y: (wrap.clientHeight - b.h * k) / 2 - b.y * k,
    });
  }, [rects, tables.length]);

  useEffect(() => {
    if (fitTick > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  const didInitialFit = useRef(false);
  useLayoutEffect(() => {
    if (!didInitialFit.current && tables.length) {
      didInitialFit.current = true;
      fit();
    }
  }, [tables.length, fit]);

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      setView((v) => ({ ...v, x: drag.ox + (e.clientX - drag.startX), y: drag.oy + (e.clientY - drag.startY) }));
      return;
    }
    const p = toDiagram(e.clientX, e.clientY);
    if (drag.mode === 'table') {
      const snap = e.altKey ? 1 : 5;
      onMove(drag.name, {
        x: Math.round((p.x - drag.dx) / snap) * snap,
        y: Math.round((p.y - drag.dy) / snap) * snap,
      });
      return;
    }
    setLinkDrag((d) => (d ? { ...d, cursor: p } : d));
    setLinkHit(hitTest(p.x, p.y)?.id ?? null);
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingTable(false);
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (drag?.mode === 'link') {
      const p = toDiagram(e.clientX, e.clientY);
      const { drag: d } = drag;
      const hit = hitTest(p.x, p.y);
      // soltar sobre outra conexão: a conexão alvo é removida
      if (hit) {
        const isOwn =
          (hit.fromTable === d.srcTable && hit.fromColumn === d.srcCol) ||
          (hit.toTable === d.srcTable && hit.toColumn === d.srcCol);
        if (isOwn) {
          setLinkDrag(null);
          setLinkHit(null);
          return;
        }
        // arrastou a alça de uma coluna: se não foi um clique simples, o alvo é removido
        const moved = Math.hypot(p.x - d.cursor.x, p.y - d.cursor.y);
        if (moved > 10) onRemove(hit.id);
        else onLink(d.srcTable, d.srcCol, hit.toTable, hit.toColumn);
        setLinkDrag(null);
        setLinkHit(null);
      }
      setLinkDrag(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      const ratio = k / v.k;
      return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio };
    });
  };

  const zoomBy = (factor: number) => {
    const wrap = wrapRef.current;
    const cx = (wrap?.clientWidth ?? 600) / 2;
    const cy = (wrap?.clientHeight ?? 400) / 2;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.25, v.k * factor));
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  };

  const activeTable = hoverTable ?? selected;

  const connectors = useMemo(() => {
    return relationships
      .map((rel, index) => {
        const fromTable = tables.find((t) => t.name === rel.fromTable);
        const toTable = tables.find((t) => t.name === rel.toTable);
        const fromRect = rects.get(rel.fromTable);
        const toRect = rects.get(rel.toTable);
        if (!fromTable || !toTable || !fromRect || !toRect) return null;
        const fi = fromTable.columns.findIndex((c) => c.name === rel.fromColumn);
        const ti = toTable.columns.findIndex((c) => c.name === rel.toColumn);
        if (fi < 0 || ti < 0) return null;
        const fromY = fromRect.y + rowCenterY(fi);
        const toY = toRect.y + rowCenterY(ti);
        const [a, b] = computeAnchors(fromRect, fromY, toRect, toY);
        const selfLoop = rel.fromTable === rel.toTable;
        const path = buildConnector(connector, a, b, fromRect, toRect, selfLoop);
        return { rel, a, b, path, color: colorful ? PALETTE[index % PALETTE.length] : '#94a3b8' };
      })
      .filter(Boolean) as {
      rel: Relationship;
      a: { x: number; y: number; dir: 1 | -1 };
      b: { x: number; y: number; dir: 1 | -1 };
      path: ConnectorPath;
      color: string;
    }[];
  }, [relationships, tables, rects, connector, colorful]);

  const hitTest = useCallback(
    (x: number, y: number): Relationship | null => {
      const p = { x, y };
      let best: Relationship | null = null;
      let bestDist = 8;
      for (const c of connectors) {
        const d = Math.min(pathDist(p, c.path.d), Math.hypot(p.x - c.path.label.x, p.y - c.path.label.y) - 12);
        if (d < bestDist) {
          bestDist = d;
          best = c.rel;
        }
      }
      return best;
    },
    [connectors],
  );

  const cursor = linkDrag
    ? linkHit &&
        !(
          (linkHit.startsWith(`${linkDrag.srcTable}.`) &&
            linkHit.includes(`.${linkDrag.srcCol}->`)) ||
          linkHit.endsWith(`.${linkDrag.srcTable}.${linkDrag.srcCol}`)
        )
      ? 'not-allowed'
      : 'crosshair'
    : hoverRel
      ? 'pointer'
      : draggingTable
        ? 'grabbing'
        : 'default';

  const highlightedRows = useMemo(() => {
    const set = new Set<string>();
    for (const c of connectors) {
      const isActive =
        hoverRel === c.rel.id ||
        (activeTable && (c.rel.fromTable === activeTable || c.rel.toTable === activeTable));
      if (isActive) {
        set.add(`${c.rel.fromTable}.${c.rel.fromColumn}`);
        set.add(`${c.rel.toTable}.${c.rel.toColumn}`);
      }
    }
    return set;
  }, [connectors, hoverRel, activeTable]);

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#0b1220]">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        style={{ cursor }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="dbd-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#1e293b" />
          </pattern>
          <filter id="dbd-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        <rect
          id="dbd-bg"
          width="100%"
          height="100%"
          fill="#0b1220"
          onPointerDown={(e) => {
            if (linkDrag) return; // conector sendo arrastado — não inicia pan
            onSelect(null);
            dragRef.current = {
              mode: 'pan',
              startX: e.clientX,
              startY: e.clientY,
              ox: view.x,
              oy: view.y,
            };
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
        />
        <rect width="100%" height="100%" fill="url(#dbd-grid)" pointerEvents="none" />

        <g id="dbd-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* ---------- connectors ---------- */}
          {connectors.map(({ rel, a, b, path, color }) => {
            const isActive =
              hoverRel === rel.id ||
              linkHit === rel.id ||
              (!!activeTable && (rel.fromTable === activeTable || rel.toTable === activeTable));
            const dimmed =
              (!!activeTable || !!hoverRel || !!linkDrag) &&
              !isActive &&
              !(linkHit === rel.id);
            return (
              <g
                key={rel.id}
                opacity={dimmed ? 0.16 : 1}
                onPointerEnter={() => setHoverRel(rel.id)}
                onPointerLeave={() => setHoverRel(null)}
              >
                {/* alvo invisível para concluir um arrasto por cima da linha */}
                {/* área invisível de drop durante o arrasto; o ponteiro segue até o svg para concluir */}
              {linkDrag && <path d={path.d} fill="none" stroke="transparent" strokeWidth={22} pointerEvents="none" />}
                {isActive && (
                  <g>
                    <rect
                      x={path.label.x - (rel.fromColumn.length + rel.toColumn.length + 3) * 3.3 - 9}
                      y={path.label.y - 12}
                      width={(rel.fromColumn.length + rel.toColumn.length + 3) * 6.6 + 18}
                      height={24}
                      fill="transparent"
                      style={{ pointerEvents: 'none' }}
                    />
                    <circle
                      cx={path.label.x}
                      cy={path.label.y}
                      r={9}
                      fill="#0f172a"
                      stroke="#f43f5e"
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M ${path.label.x - 3} ${path.label.y - 3} L ${path.label.x + 3} ${
                        path.label.y + 3
                      } M ${path.label.x + 3} ${path.label.y - 3} L ${path.label.x - 3} ${path.label.y + 3}`}
                      stroke="#f43f5e"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                    <text
                      x={path.label.x}
                      y={path.label.y - 14}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily={MONO}
                      fill="#fda4af"
                    >
                      {linkHit === rel.id ? 'solte p/ remover' : 'remover'}
                    </text>
                  </g>
                )}
                {/* halo makes crossings readable */}
                <path d={path.d} fill="none" stroke="#0b1220" strokeWidth={isActive ? 9 : 7} strokeLinecap="round" />
                {linkHit === rel.id && (
                  <path
                    d={path.d}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth={5}
                    strokeLinecap="round"
                    opacity={0.5}
                  />
                )}
                <path
                  d={path.d}
                  fill="none"
                  stroke={linkHit === rel.id ? '#f43f5e' : color}
                  strokeWidth={isActive ? 2.8 : 1.8}
                  strokeLinecap="round"
                />
                <path d={path.d} fill="none" stroke="transparent" strokeWidth={16} />
                {isActive && (
                  <circle
                    cx={path.label.x}
                    cy={path.label.y}
                    r={14}
                    fill="transparent"
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      onRemove(rel.id);
                    }}
                  />
                )}
                <CrowFoot x={a.x} y={a.y} dir={a.dir} card={rel.fromCard} color={color} active={isActive} />
                <CrowFoot x={b.x} y={b.y} dir={b.dir} card={rel.toCard} color={color} active={isActive} />
                {(showLabels || isActive) && (
                  <g pointerEvents="none">
                    <rect
                      x={path.label.x - ((rel.fromColumn.length + rel.toColumn.length + 3) * 6.6 + 18) / 2}
                      y={path.label.y - 10}
                      width={(rel.fromColumn.length + rel.toColumn.length + 3) * 6.6 + 18}
                      height={20}
                      rx={10}
                      fill="#0f172a"
                      stroke={color}
                      strokeOpacity={0.6}
                    />
                    <text
                      x={path.label.x}
                      y={path.label.y + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontFamily={MONO}
                      fill={color}
                    >
                      {rel.fromColumn} → {rel.toColumn}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ---------- preview of the connector being dragged ---------- */}
          {linkDrag && (
            <g pointerEvents="none">
              {(() => {
                const from = tables.find((t) => t.name === linkDrag.srcTable);
                const fr = rects.get(linkDrag.srcTable);
                if (!from || !fr) return null;
                const srcY = fr.y + rowCenterY(linkDrag.srcIndex);
                const dir = linkDrag.srcSide === 'out' ? 1 : -1;
                const a = { x: fr.x + (dir === 1 ? fr.w : 0), y: srcY, dir: dir as 1 | -1 };
                const b = { x: linkDrag.cursor.x, y: linkDrag.cursor.y, dir: 1 as const };
                const preview = buildConnector(connector, a, b, fr, fr, false);
                return (
                  <>
                    <path
                      d={preview.d}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      strokeDasharray="7 5"
                      strokeLinecap="round"
                    />
                    <circle cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={5} fill="none" stroke="#38bdf8" strokeWidth={1.6} />
                    <circle cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={2} fill="#38bdf8" />
                  </>
                );
              })()}
            </g>
          )}

          {/* ---------- tables ---------- */}
          {tables.map((table) => {
            const r = rects.get(table.name);
            if (!r) return null;
            const isSelected = selected === table.name;
            const isActive = activeTable === table.name;
            const related =
              !!activeTable &&
              relationships.some(
                (rel) =>
                  (rel.fromTable === activeTable && rel.toTable === table.name) ||
                  (rel.toTable === activeTable && rel.fromTable === table.name),
              );
            const dimmed = !!activeTable && !isActive && !related;
            const hasError = errorTables.has(table.name);
            const radius = 10;
            const headerPath = `M ${r.x} ${r.y + radius} Q ${r.x} ${r.y} ${r.x + radius} ${r.y} L ${
              r.x + r.w - radius
            } ${r.y} Q ${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + radius} L ${r.x + r.w} ${
              r.y + HEADER_H
            } L ${r.x} ${r.y + HEADER_H} Z`;

            return (
              <g
                key={table.name}
                opacity={dimmed ? 0.35 : 1}
                filter="url(#dbd-shadow)"
                onPointerEnter={() => setHoverTable(table.name)}
                onPointerLeave={() => setHoverTable(null)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(table.name);
                  const p = toDiagram(e.clientX, e.clientY);
                  dragRef.current = { mode: 'table', name: table.name, dx: p.x - r.x, dy: p.y - r.y };
                  setDraggingTable(true);
                  (e.target as Element).setPointerCapture(e.pointerId);
                }}
              >
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={radius}
                  fill="#0f172a"
                  stroke={hasError ? '#f43f5e' : isSelected ? '#38bdf8' : isActive ? '#64748b' : '#1e293b'}
                  strokeWidth={isSelected || hasError ? 2 : 1.2}
                />
                <path d={headerPath} fill={hasError ? '#4c1d24' : '#1e293b'} />
                <text
                  x={r.x + 12}
                  y={r.y + 22}
                  fontSize={13}
                  fontWeight={700}
                  fontFamily={MONO}
                  fill={hasError ? '#fda4af' : '#e2e8f0'}
                >
                  {table.name}
                </text>
                <text
                  x={r.x + r.w - 10}
                  y={r.y + 22}
                  textAnchor="end"
                  fontSize={10}
                  fontFamily={MONO}
                  fill="#64748b"
                >
                  {table.columns.length}
                </text>

                {table.columns.map((col, i) => {
                  const y = r.y + HEADER_H + i * ROW_H;
                  const cy = y + ROW_H / 2 + 4;
                  const rowKey = `${table.name}.${col.name}`;
                  const rowActive = highlightedRows.has(rowKey);
                  return (
                    <g key={col.name}>
                      {(i % 2 === 1 || rowActive) && (
                        <rect
                          x={r.x + 1}
                          y={y}
                          width={r.w - 2}
                          height={ROW_H}
                          fill={rowActive ? '#1d4ed8' : '#0b1220'}
                          opacity={rowActive ? 0.35 : 0.45}
                        />
                      )}
                      <text x={r.x + 12} y={cy} fontSize={11.5} fontFamily={MONO} fill="#cbd5e1">
                        {col.pk && (
                          <tspan fill="#fbbf24" fontWeight={700}>
                            PK{' '}
                          </tspan>
                        )}
                        {col.fk && (
                          <tspan fill="#38bdf8" fontWeight={700}>
                            FK{' '}
                          </tspan>
                        )}
                        <tspan fill={col.pk ? '#f8fafc' : '#cbd5e1'}>{col.name}</tspan>
                        {col.unique && !col.pk && (
                          <tspan fill="#4ade80" fontSize={9}>
                            {' '}
                            ●
                          </tspan>
                        )}
                      </text>
                      <text
                        x={r.x + r.w - 10}
                        y={cy}
                        textAnchor="end"
                        fontSize={10.5}
                        fontFamily={MONO}
                        fill="#64748b"
                      >
                        {col.type}
                      </text>

                      {/* alças de conexão: arraste para ligar a outra tabela */}
                      {(!hoverTable || hoverTable === table.name) && (
                        <g
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelect(table.name);
                            const p = toDiagram(e.clientX, e.clientY);
                            dragRef.current = {
                              mode: 'link',
                              drag: {
                                srcTable: table.name,
                                srcCol: col.name,
                                srcIndex: i,
                                srcSide: 'out',
                                cursor: p,
                              },
                            };
                            setLinkDrag(dragRef.current.mode === 'link' ? dragRef.current.drag : null);
                            (e.target as Element).setPointerCapture(e.pointerId);
                          }}
                        >
                          <rect
                            x={r.x + r.w - 8}
                            y={y}
                            width={14}
                            height={ROW_H}
                            fill="transparent"
                            style={{ cursor: 'crosshair' }}
                          />
                          <circle
                            cx={r.x + r.w}
                            cy={y + ROW_H / 2}
                            r={3.4}
                            fill="#0b1220"
                            stroke={col.pk || col.unique ? '#4ade80' : '#38bdf8'}
                            strokeWidth={1.4}
                          />
                          <rect
                            x={r.x - 6}
                            y={y}
                            width={14}
                            height={ROW_H}
                            fill="transparent"
                            style={{ cursor: 'crosshair' }}
                          />
                          <circle
                            cx={r.x}
                            cy={y + ROW_H / 2}
                            r={3.4}
                            fill="#0b1220"
                            stroke={col.pk || col.unique ? '#4ade80' : '#38bdf8'}
                            strokeWidth={1.4}
                          />
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* zoom controls */}
      <div className="pointer-events-auto absolute bottom-4 left-4 flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-900/90 p-1 shadow-lg backdrop-blur">
        <button
          onClick={() => zoomBy(0.85)}
          className="h-7 w-7 rounded text-slate-300 hover:bg-slate-700"
          title="Diminuir zoom"
        >
          −
        </button>
        <span className="w-12 text-center text-xs text-slate-400">{Math.round(view.k * 100)}%</span>
        <button
          onClick={() => zoomBy(1.18)}
          className="h-7 w-7 rounded text-slate-300 hover:bg-slate-700"
          title="Aumentar zoom"
        >
          +
        </button>
        <div className="mx-1 h-5 w-px bg-slate-700" />
        <button
          onClick={fit}
          className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          title="Ajustar à tela"
        >
          Ajustar
        </button>
      </div>

      {!tables.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-slate-600">
            <div className="mb-3 text-5xl">🗂️</div>
            <p className="text-sm">Comece a escrever o schema à esquerda</p>
            <p className="mt-1 text-xs text-slate-700">o diagrama aparece enquanto você digita</p>
          </div>
        </div>
      )}
    </div>
  );
}

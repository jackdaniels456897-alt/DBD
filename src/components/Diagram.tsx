import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Cardinality,
  ConnectorStyle,
  Point,
  Relationship,
  Table,
  TableGroup,
} from '../types';
import {
  buildConnector,
  computeAnchors,
  contentBounds,
  hitColumn,
  HEADER_H,
  ROW_H,
  rowCenterY,
  tableRect,
  type ConnectorPath,
  type ColumnHit,
  type Rect,
} from '../lib/geometry';
import { resolveVisualConnection } from '../lib/visualRelations';
import {
  groupBox,
  groupColor,
  GROUP_HEADER_H,
  rectFromDrag,
  sortedForPaint,
} from '../lib/groups';

const PALETTE = [
  '#38bdf8', '#f472b6', '#facc15', '#4ade80',
  '#a78bfa', '#fb923c', '#22d3ee', '#f87171',
];

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface DiagramHandle {
  /** Returns the diagram-space and screen-space center of the visible canvas. */
  getViewportCenter(): { diagram: Point; screen: Point } | null;
}

interface Props {
  tables: Table[];
  relationships: Relationship[];
  positions: Record<string, Point>;
  onMove: (name: string, p: Point) => void;
  onLink: (from: string, fromCol: string, to: string, toCol: string) => void;
  onRemove: (id: string) => void;
  onCreateTableAt?: (screen: Point, diagram: Point) => void;
  connector: ConnectorStyle;
  colorful: boolean;
  showLabels: boolean;
  editMode: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  errorTables: Set<string>;
  fitTick: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  diagramRef?: React.Ref<DiagramHandle>;
  groups?: TableGroup[];
  groupAnchors?: Record<string, Point>;
  selectedGroup?: string | null;
  onSelectGroup?: (id: string | null) => void;
  /** Move todos os membros do grupo por um delta absoluto (start + delta). */
  onGroupMoveStart?: (id: string) => void;
  onGroupMove?: (id: string, delta: Point) => void;
  onGroupMoveEnd?: () => void;
  /** Cria grupo a partir de um retângulo; captura tabelas cujo centro caiu dentro. */
  onCreateGroup?: (rect: Rect) => void;
  onRenameGroup?: (id: string, name: string) => void;
  onDeleteGroup?: (id: string) => void;
  /** Chamado ao soltar uma tabela: reavalia em qual grupo ela deve ficar. */
  onTableDropped?: (name: string) => void;
}

type LinkDrag = {
  srcTable: string;
  srcCol: string;
  srcIndex: number;
  side: 1 | -1;
  start: Point;
  cursor: Point;
};

type DragState = { pointerId: number } & (
  | { mode: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { mode: 'table'; name: string; dx: number; dy: number; moved: boolean }
  | { mode: 'link'; drag: LinkDrag }
  | { mode: 'groupMove'; id: string; start: Point }
  | { mode: 'groupDraw'; start: Point }
);

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
  onCreateTableAt,
  connector,
  colorful,
  showLabels,
  editMode,
  selected,
  onSelect,
  errorTables,
  fitTick,
  svgRef,
  diagramRef,
  groups = [],
  groupAnchors = {},
  selectedGroup = null,
  onSelectGroup,
  onGroupMoveStart,
  onGroupMove,
  onGroupMoveEnd,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onTableDropped,
}: Props) {
  useImperativeHandle(
    diagramRef,
    () => ({
      getViewportCenter() {
        const wrap = wrapRef.current;
        const svg = svgRef.current;
        if (!wrap || !svg) return null;
        const rect = svg.getBoundingClientRect();
        const screen = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const v = viewRef.current;
        return {
          screen,
          diagram: {
            x: (rect.width / 2 - v.x) / v.k,
            y: (rect.height / 2 - v.y) / v.k,
          },
        };
      },
    }),
    // svgRef is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagramRef],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hoverTable, setHoverTable] = useState<string | null>(null);
  const [hoverRel, setHoverRel] = useState<string | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [linkTarget, setLinkTarget] = useState<ColumnHit | null>(null);
  const [draggingTable, setDraggingTable] = useState(false);
  const [drawRect, setDrawRect] = useState<Rect | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const t of tables) map.set(t.name, tableRect(t, positions));
    return map;
  }, [tables, positions]);

  /** Frames derivados dos membros (auto-envolvem as tabelas). */
  const groupBoxes = useMemo(
    () => groups.map((g) => groupBox(g, tables, positions, groupAnchors)),
    [groups, tables, positions, groupAnchors],
  );

  /** Grupo (menor) ao qual cada tabela pertence, para pintar o pontinho. */
  const tableGroupOf = useMemo(() => {
    const map = new Map<string, TableGroup>();
    for (const g of groups) for (const n of g.members) if (!map.has(n)) map.set(n, g);
    return map;
  }, [groups]);

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

  const hitTarget = useCallback(
    (x: number, y: number) => hitColumn(tables, positions, { x, y }, 10 / viewRef.current.k),
    [tables, positions],
  );

  const cancelDrag = useCallback(() => {
    const pointerId = dragRef.current?.pointerId;
    dragRef.current = null;
    setLinkDrag(null);
    setLinkTarget(null);
    setDraggingTable(false);
    setDrawRect(null);
    const svg = svgRef.current;
    if (pointerId !== undefined && svg?.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
  }, [svgRef]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        cancelDrag();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [cancelDrag]);

  const beginLink = (e: React.PointerEvent, table: Table, index: number, side: 1 | -1) => {
    if (e.button !== 0 || dragRef.current || !editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const point = toDiagram(e.clientX, e.clientY);
    const link: LinkDrag = {
      srcTable: table.name,
      srcCol: table.columns[index].name,
      srcIndex: index,
      side,
      start: point,
      cursor: point,
    };
    dragRef.current = { mode: 'link', drag: link, pointerId: e.pointerId };
    setLinkDrag(link);
    setLinkTarget(null);
    setHoverRel(null);
    onSelect(table.name);
    // The SVG stays mounted when hover changes; a column handle might not.
    svgRef.current?.setPointerCapture(e.pointerId);
    svgRef.current?.focus({ preventScroll: true });
  };

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
    if (!didInitialFit.current && tables.length && tables.every((t) => positions[t.name])) {
      didInitialFit.current = true;
      fit();
    }
  }, [tables, positions, fit]);

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.mode === 'pan') {
      setView((v) => ({ ...v, x: drag.ox + (e.clientX - drag.startX), y: drag.oy + (e.clientY - drag.startY) }));
      return;
    }
    const p = toDiagram(e.clientX, e.clientY);
    if (drag.mode === 'groupDraw') {
      setDrawRect(rectFromDrag(drag.start, p));
      return;
    }
    if (drag.mode === 'groupMove') {
      const snap = e.altKey ? 1 : 5;
      onGroupMove?.(drag.id, {
        x: Math.round((p.x - drag.start.x) / snap) * snap,
        y: Math.round((p.y - drag.start.y) / snap) * snap,
      });
      return;
    }
    if (drag.mode === 'table') {
      const snap = e.altKey ? 1 : 5;
      drag.moved = true;
      onMove(drag.name, {
        x: Math.round((p.x - drag.dx) / snap) * snap,
        y: Math.round((p.y - drag.dy) / snap) * snap,
      });
      return;
    }
    setLinkDrag((d) => (d ? { ...d, cursor: p } : d));
    setLinkTarget(hitTarget(p.x, p.y));
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.mode === 'groupDraw') {
      const rect = drawRect;
      cancelDrag();
      if (rect && rect.w >= 30 && rect.h >= 30) onCreateGroup?.(rect);
      return;
    }
    if (drag.mode === 'groupMove') {
      cancelDrag();
      onGroupMoveEnd?.();
      return;
    }
    if (drag.mode === 'table') {
      const wasMoved = drag.moved;
      const name = drag.name;
      cancelDrag();
      if (wasMoved) onTableDropped?.(name); // reavalia participação em grupos
      return;
    }

    const point = toDiagram(e.clientX, e.clientY);
    const target = hitTarget(point.x, point.y);
    const bounds = svgRef.current?.getBoundingClientRect();
    const inside = bounds && e.clientX >= bounds.left && e.clientX <= bounds.right &&
      e.clientY >= bounds.top && e.clientY <= bounds.bottom;
    cancelDrag();
    if (drag.mode !== 'link' || !target || !inside) return;
    const source = drag.drag;
    const moved = Math.hypot(point.x - source.start.x, point.y - source.start.y) * viewRef.current.k;
    if (moved < 4 || (target.table === source.srcTable && target.col === source.srcCol)) return;
    onLink(source.srcTable, source.srcCol, target.table, target.col);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (dragRef.current) return;
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
        const ratio = k / v.k;
        return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [svgRef]);

  const zoomBy = (factor: number) => {
    if (dragRef.current) return;
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

  const previewConnection = linkDrag && linkTarget ? resolveVisualConnection(
    tables,
    relationships,
    { table: linkDrag.srcTable, column: linkDrag.srcCol },
    { table: linkTarget.table, column: linkTarget.col },
  ) : null;
  const linkTargetValid = !!previewConnection;

  const cursor = linkDrag
    ? linkTargetValid
      ? 'crosshair'
      : 'not-allowed'
    : hoverRel && editMode
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
        className="h-full w-full touch-none select-none outline-none"
        tabIndex={0}
        aria-label="Diagrama de banco de dados. Arraste entre colunas pelos dois lados das tabelas."
        style={{ cursor }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) cancelDrag();
        }}
        onLostPointerCapture={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) cancelDrag();
        }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHoverTable(null);
            setHoverRel(null);
          }
        }}
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
            if (e.button !== 0 || dragRef.current) return;
            e.preventDefault();
            onSelect(null);
            onSelectGroup?.(null);
            setRenamingGroup(null);
            // Em modo edição, arrastar o fundo desenha um novo grupo.
            if (editMode && onCreateGroup) {
              const p = toDiagram(e.clientX, e.clientY);
              dragRef.current = { mode: 'groupDraw', start: p, pointerId: e.pointerId };
              setDrawRect({ x: p.x, y: p.y, w: 0, h: 0 });
              svgRef.current?.setPointerCapture(e.pointerId);
              return;
            }
            dragRef.current = {
              mode: 'pan',
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              ox: view.x,
              oy: view.y,
            };
            svgRef.current?.setPointerCapture(e.pointerId);
          }}
          onDoubleClick={(e) => {
            if (!editMode || !onCreateTableAt) return;
            e.preventDefault();
            e.stopPropagation();
            const point = toDiagram(e.clientX, e.clientY);
            onCreateTableAt({ x: e.clientX, y: e.clientY }, point);
          }}
        />
        <rect width="100%" height="100%" fill="url(#dbd-grid)" pointerEvents="none" />

        <g id="dbd-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* ---------- table groups: frames derived from their members ---------- */}
          {sortedForPaint(groupBoxes).map((box) => {
            const group = box.group;
            const c = groupColor(group.color);
            const isSel = selectedGroup === group.id;
            const isRenaming = renamingGroup === group.id;
            const holdsDragged = !!linkDrag && group.members.includes(linkDrag.srcTable);
            const empty = box.memberNames.length === 0;
            const nameW = Math.max(group.name.length * 6.6 + 52, 108);
            const midY = group.members.length ? box.y - GROUP_HEADER_H / 2 : box.y + GROUP_HEADER_H / 2;
            const chipY = group.members.length ? box.y - GROUP_HEADER_H : box.y;

            const startMove = (e: React.PointerEvent) => {
              if (e.button !== 0 || dragRef.current || linkDrag) return;
              e.stopPropagation();
              onSelectGroup?.(group.id);
              onSelect(null);
              if (!editMode) return; // fora do modo edição, só seleciona
              e.preventDefault();
              const pt = toDiagram(e.clientX, e.clientY);
              dragRef.current = { mode: 'groupMove', id: group.id, start: pt, pointerId: e.pointerId };
              onGroupMoveStart?.(group.id);
              svgRef.current?.setPointerCapture(e.pointerId);
            };

            return (
              <g key={group.id} pointerEvents={linkDrag ? 'none' : undefined}>
                {/* body */}
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={16}
                  fill={c.fill}
                  fillOpacity={holdsDragged ? 0.14 : isSel ? 0.1 : 0.05}
                  stroke={c.stroke}
                  strokeOpacity={isSel ? 0.95 : 0.4}
                  strokeWidth={isSel ? 2 : 1.4}
                  strokeDasharray={empty ? '4 5' : isSel ? undefined : '9 7'}
                  style={{ cursor: editMode ? 'move' : 'pointer' }}
                  onPointerDown={startMove}
                />
                {empty && (
                  <text
                    x={box.x + box.w / 2}
                    y={box.y + box.h / 2 + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontFamily={MONO}
                    fill={c.stroke}
                    fillOpacity={0.6}
                    pointerEvents="none"
                  >
                    arraste tabelas para cá
                  </text>
                )}

                {/* title chip */}
                <g
                  style={{ cursor: editMode ? 'move' : 'pointer' }}
                  onPointerDown={startMove}
                  onDoubleClick={(e) => {
                    if (!editMode) return;
                    e.stopPropagation();
                    setRenamingGroup(group.id);
                  }}
                >
                  <rect
                    x={box.x}
                    y={chipY}
                    width={nameW}
                    height={GROUP_HEADER_H}
                    rx={9}
                    fill={c.chip}
                    fillOpacity={isSel ? 1 : 0.92}
                    stroke={c.stroke}
                    strokeOpacity={isSel ? 0.9 : 0.4}
                    strokeWidth={1.2}
                  />
                  <circle cx={box.x + 14} cy={midY} r={4} fill={c.stroke} />
                  <text
                    x={box.x + 25}
                    y={midY + 4}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily={MONO}
                    fill={c.text}
                    pointerEvents="none"
                  >
                    {group.name}
                  </text>
                  <text
                    x={box.x + nameW - 28}
                    y={midY + 4}
                    textAnchor="end"
                    fontSize={10}
                    fontFamily={MONO}
                    fill={c.text}
                    fillOpacity={0.6}
                    pointerEvents="none"
                  >
                    {box.memberNames.length}
                  </text>

                  {/* delete button lives on the chip, edit mode only */}
                  {editMode && !linkDrag && (
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`Excluir grupo ${group.name}`}
                      style={{ cursor: 'pointer' }}
                      data-interactive="true"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteGroup?.(group.id);
                      }}
                    >
                      <title>Excluir grupo (as tabelas permanecem)</title>
                      <circle cx={box.x + nameW - 14} cy={midY} r={8} fill="#351821" stroke="#f43f5e" strokeWidth={1.2} />
                      <path
                        d={`M ${box.x + nameW - 17} ${midY - 3} l 6 6 M ${box.x + nameW - 11} ${midY - 3} l -6 6`}
                        stroke="#fda4af"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    </g>
                  )}
                </g>

                {/* inline rename */}
                {isRenaming && (
                  <foreignObject x={box.x} y={chipY} width={Math.max(nameW, 180)} height={GROUP_HEADER_H} data-interactive="true">
                    <input
                      autoFocus
                      defaultValue={group.name}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v) onRenameGroup?.(group.id, v);
                        setRenamingGroup(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = e.currentTarget.value.trim();
                          if (v) onRenameGroup?.(group.id, v);
                          setRenamingGroup(null);
                        }
                        if (e.key === 'Escape') setRenamingGroup(null);
                        e.stopPropagation();
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        boxSizing: 'border-box',
                        background: c.chip,
                        color: c.text,
                        border: `1.5px solid ${c.stroke}`,
                        borderRadius: 9,
                        padding: '0 10px',
                        font: `700 11px ${MONO}`,
                        outline: 'none',
                      }}
                    />
                  </foreignObject>
                )}
              </g>
            );
          })}

          {/* preview while drawing a new group */}
          {drawRect && (
            <g pointerEvents="none" data-interactive="true">
              <rect
                x={drawRect.x}
                y={drawRect.y}
                width={drawRect.w}
                height={drawRect.h}
                rx={16}
                fill="#38bdf8"
                fillOpacity={0.08}
                stroke="#38bdf8"
                strokeWidth={1.8}
                strokeDasharray="8 6"
              />
              <text x={drawRect.x + 10} y={drawRect.y + 20} fontSize={11} fontFamily={MONO} fill="#7dd3fc">
                {drawRect.w >= 30 && drawRect.h >= 30 ? 'Solte para criar o grupo' : 'Arraste para criar'}
              </text>
            </g>
          )}

          {/* ---------- connectors ---------- */}
          {connectors.map(({ rel, a, b, path, color }) => {
            const isActive =
              hoverRel === rel.id ||
              (!!activeTable && (rel.fromTable === activeTable || rel.toTable === activeTable));
            const dimmed = !!linkDrag || ((!!activeTable || !!hoverRel) && !isActive);
            const labelWidth = (rel.fromColumn.length + rel.toColumn.length + 4) * 6.6 + 18;
            const deleteX = path.label.x;
            const deleteY = path.label.y - 26;
            return (
              <g
                key={rel.id}
                opacity={dimmed ? 0.16 : 1}
                pointerEvents={linkDrag ? 'none' : undefined}
                onPointerEnter={() => { if (!dragRef.current) setHoverRel(rel.id); }}
                onPointerLeave={() => { if (!dragRef.current) setHoverRel(null); }}
              >
                {/* halo makes crossings readable */}
                <path d={path.d} fill="none" stroke="#0b1220" strokeWidth={isActive ? 9 : 7} strokeLinecap="round" />
                <path
                  d={path.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 2.8 : 1.8}
                  strokeLinecap="round"
                />
                <path d={path.d} fill="none" stroke="transparent" strokeWidth={16} />
                <CrowFoot x={a.x} y={a.y} dir={a.dir} card={rel.fromCard} color={color} active={isActive} />
                <CrowFoot x={b.x} y={b.y} dir={b.dir} card={rel.toCard} color={color} active={isActive} />
                {(showLabels || (editMode && isActive && !linkDrag)) && (
                  <g>
                    <rect
                      x={path.label.x - labelWidth / 2}
                      y={path.label.y - 10}
                      width={labelWidth}
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
                      pointerEvents="none"
                    >
                      {rel.fromColumn} {'->'} {rel.toColumn}
                    </text>
                  </g>
                )}
                {editMode && isActive && !linkDrag && (
                  <g data-interactive="true">
                    <rect x={deleteX - 14} y={deleteY - 14} width={28} height={40} fill="transparent" />
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`Remover conexão ${rel.fromTable}.${rel.fromColumn} para ${rel.toTable}.${rel.toColumn}`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!dragRef.current) onRemove(rel.id);
                      }}
                      onFocus={() => setHoverRel(rel.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete') {
                          e.preventDefault();
                          e.stopPropagation();
                          onRemove(rel.id);
                          svgRef.current?.focus({ preventScroll: true });
                        }
                      }}
                    >
                      <title>Remover conexão</title>
                      <circle cx={deleteX} cy={deleteY} r={11} fill="#351821" stroke="#f43f5e" strokeWidth={1.4} />
                      <path
                        d={`M ${deleteX - 3} ${deleteY - 3} l 6 6 M ${deleteX + 3} ${deleteY - 3} l -6 6`}
                        stroke="#fda4af"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* ---------- preview of the connector being dragged ---------- */}
          {linkDrag && (
            <g pointerEvents="none" data-interactive="true">
              {(() => {
                const fr = rects.get(linkDrag.srcTable);
                if (!fr) return null;
                const srcY = fr.y + rowCenterY(linkDrag.srcIndex);
                const dir = linkDrag.side;
                const a = { x: fr.x + (dir === 1 ? fr.w : 0), y: srcY, dir };
                const targetRect = linkTarget ? rects.get(linkTarget.table) : undefined;
                const selfLoop = !!linkTarget && linkTarget.table === linkDrag.srcTable;
                const targetSide = selfLoop ? dir : linkTarget?.side;
                const b = targetRect && linkTarget && targetSide ? {
                  x: targetRect.x + (targetSide === 1 ? targetRect.w : 0),
                  y: targetRect.y + rowCenterY(linkTarget.index),
                  dir: targetSide,
                } : {
                  x: linkDrag.cursor.x,
                  y: linkDrag.cursor.y,
                  dir: (linkDrag.cursor.x >= a.x ? -1 : 1) as 1 | -1,
                };
                const preview = buildConnector(connector, a, b, fr,
                  targetRect ?? { x: b.x, y: b.y, w: 0, h: 0 }, selfLoop);
                const ok = linkTargetValid;
                const color = ok ? '#38bdf8' : '#64748b';
                return (
                  <>
                    <path
                      d={preview.d}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray="7 5"
                      strokeLinecap="round"
                    />
                    <circle cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={5} fill="none" stroke={color} strokeWidth={1.6} />
                    <circle cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={2} fill={color} />
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
            const isLinkTarget = linkTargetValid && linkTarget?.table === table.name;
            const related =
              !!activeTable &&
              relationships.some(
                (rel) =>
                  (rel.fromTable === activeTable && rel.toTable === table.name) ||
                  (rel.toTable === activeTable && rel.fromTable === table.name),
              );
            const dimmed = !linkDrag && !!activeTable && !isActive && !related;
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
                onPointerEnter={() => { if (!dragRef.current) setHoverTable(table.name); }}
                onPointerLeave={() => { if (!dragRef.current) setHoverTable(null); }}
                style={{ cursor: linkDrag ? cursor : draggingTable ? 'grabbing' : 'grab' }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || dragRef.current) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(table.name);
                  onSelectGroup?.(null);
                  const p = toDiagram(e.clientX, e.clientY);
                  dragRef.current = { mode: 'table', name: table.name, dx: p.x - r.x, dy: p.y - r.y, moved: false, pointerId: e.pointerId };
                  setDraggingTable(true);
                  svgRef.current?.setPointerCapture(e.pointerId);
                }}
              >
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={radius}
                  fill="#0f172a"
                  stroke={isLinkTarget ? '#38bdf8' : hasError ? '#f43f5e' : isSelected ? '#38bdf8' : isActive ? '#64748b' : '#1e293b'}
                  strokeWidth={isLinkTarget || isSelected || hasError ? 2 : 1.2}
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
                {(() => {
                  const g = tableGroupOf.get(table.name);
                  if (!g) return null;
                  const c = groupColor(g.color);
                  return (
                    <circle
                      cx={r.x + 6}
                      cy={r.y + 6}
                      r={3.5}
                      fill={c.stroke}
                      stroke="#0b1220"
                      strokeWidth={1}
                      pointerEvents="none"
                    >
                      <title>{`Grupo: ${g.name}`}</title>
                    </circle>
                  );
                })()}

                {table.columns.map((col, i) => {
                  const y = r.y + HEADER_H + i * ROW_H;
                  const cy = y + ROW_H / 2 + 4;
                  const rowKey = `${table.name}.${col.name}`;
                  const dropTarget = isLinkTarget && linkTarget?.col === col.name;
                  const rowActive = dropTarget || (!linkDrag && highlightedRows.has(rowKey));
                  return (
                    <g key={col.name}>
                      {(i % 2 === 1 || rowActive) && (
                        <rect
                          x={r.x + 1}
                          y={y}
                          width={r.w - 2}
                          height={ROW_H}
                          fill={dropTarget ? '#036a83' : rowActive ? '#1d4ed8' : '#0b1220'}
                          opacity={dropTarget ? 0.65 : rowActive ? 0.35 : 0.45}
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

                      {editMode && ([-1, 1] as const).map((side) => (
                        <g
                          key={side}
                          data-interactive="true"
                          data-port={`${table.name}.${col.name}`}
                          data-side={side === -1 ? 'left' : 'right'}
                          opacity={isActive || linkDrag ? 1 : 0.65}
                          style={{ cursor: 'crosshair', transition: 'opacity 150ms ease' }}
                          onPointerDown={(e) => beginLink(e, table, i, side)}
                        >
                          <title>{`Arraste ${table.name}.${col.name} para outra coluna. PK e FK funcionam nos dois sentidos.`}</title>
                          <rect
                            x={r.x + (side === 1 ? r.w : 0) - 10}
                            y={y}
                            width={20}
                            height={ROW_H}
                            fill="transparent"
                          />
                          <circle
                            cx={r.x + (side === 1 ? r.w : 0)}
                            cy={y + ROW_H / 2}
                            r={dropTarget ? 5 : 4}
                            fill={dropTarget ? '#38bdf8' : '#0b1220'}
                            stroke={dropTarget ? '#a5f3fc' : col.pk || col.unique ? '#4ade80' : '#38bdf8'}
                            strokeWidth={1.5}
                            pointerEvents="none"
                          />
                        </g>
                      ))}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {linkDrag && (
        <div role="status" className="pointer-events-none absolute bottom-5 right-4 max-w-[65%] text-right text-xs text-sky-300">
          {previewConnection
            ? `FK ${previewConnection.foreign.table.name}.${previewConnection.foreign.column.name} -> ${previewConnection.primary.table.name}.${previewConnection.primary.column.name}`
            : 'Solte sobre a coluna de destino. Esc cancela.'}
        </div>
      )}

      {editMode && !linkDrag && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-500/60 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-200 shadow-lg backdrop-blur"
          role="status"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
          Modo edição — âncoras conectam • arraste o fundo desenha grupo • 2× clique cria tabela
        </div>
      )}

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
            <svg aria-hidden="true" className="mx-auto mb-3 h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18M9 9v11M3 14h18" />
            </svg>
            <p className="text-sm">Comece a escrever o schema à esquerda</p>
            <p className="mt-1 text-xs text-slate-700">o diagrama aparece enquanto você digita</p>
          </div>
        </div>
      )}
    </div>
  );
}

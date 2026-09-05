import type { ConnectorStyle, Point, Table } from '../types';

export const HEADER_H = 34;
export const ROW_H = 24;
export const BODY_PAD = 8;
export const MIN_W = 200;
export const MAX_W = 340;
const CHAR_W = 6.9;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tableWidth(table: Table): number {
  let max = table.name.length * 7.8 + 48;
  for (const c of table.columns) {
    const badge = (c.pk ? 3 : 0) + (c.fk ? 3 : 0);
    const w = (c.name.length + badge) * CHAR_W + c.type.length * CHAR_W + 54;
    if (w > max) max = w;
  }
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(max)));
}

export function tableHeight(table: Table): number {
  return HEADER_H + Math.max(1, table.columns.length) * ROW_H + BODY_PAD;
}

export function rowCenterY(index: number): number {
  return HEADER_H + index * ROW_H + ROW_H / 2;
}

export function tableRect(table: Table, positions: Record<string, Point>): Rect {
  const p = positions[table.name] ?? { x: 0, y: 0 };
  return { x: p.x, y: p.y, w: tableWidth(table), h: tableHeight(table) };
}

export interface ColumnHit {
  table: string;
  col: string;
  index: number;
  side: 1 | -1;
}

export function hitColumn(
  tables: Table[],
  positions: Record<string, Point>,
  point: Point,
  margin = 10,
): ColumnHit | null {
  // Reverse paint order gives overlapping tables the same priority as the SVG.
  for (let n = tables.length - 1; n >= 0; n--) {
    const table = tables[n];
    const rect = tableRect(table, positions);
    if (point.x < rect.x - margin || point.x > rect.x + rect.w + margin) continue;
    const index = Math.floor((point.y - rect.y - HEADER_H) / ROW_H);
    if (index < 0 || index >= table.columns.length) continue;
    return {
      table: table.name,
      col: table.columns[index].name,
      index,
      side: point.x < rect.x + rect.w / 2 ? -1 : 1,
    };
  }
  return null;
}

function overlaps(a: Rect, b: Rect, gap: number) {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

/**
 * Keeps every position the user already chose and only finds a free slot for
 * tables that are new to the diagram.
 */
export function placeNewTables(
  tables: Table[],
  positions: Record<string, Point>,
): Record<string, Point> {
  const next = { ...positions };
  const placed: Rect[] = [];

  for (const t of tables) {
    if (next[t.name]) {
      placed.push({ ...next[t.name], w: tableWidth(t), h: tableHeight(t) });
    }
  }

  const gapY = 50;
  const startX = 40;
  const startY = 40;
  const stepX = 280;
  const stepY = 60;

  for (const t of tables) {
    if (next[t.name]) continue;
    const w = tableWidth(t);
    const h = tableHeight(t);
    let found: Point | null = null;
    for (let row = 0; row < 60 && !found; row++) {
      for (let col = 0; col < 6 && !found; col++) {
        const candidate: Rect = {
          x: startX + col * stepX,
          y: startY + row * stepY,
          w,
          h,
        };
        if (!placed.some((r) => overlaps(candidate, r, 24))) {
          found = { x: candidate.x, y: candidate.y };
        }
      }
    }
    const pos = found ?? { x: startX, y: startY + placed.length * (h + gapY) };
    next[t.name] = pos;
    placed.push({ ...pos, w, h });
  }

  return next;
}

/** Grid layout used by the "Auto layout" button. */
export function autoLayout(tables: Table[]): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const gap = 80;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  let y = 40;
  for (let i = 0; i < tables.length; i += perRow) {
    const row = tables.slice(i, i + perRow);
    let x = 40;
    let rowH = 0;
    for (const t of row) {
      positions[t.name] = { x, y };
      x += tableWidth(t) + gap;
      rowH = Math.max(rowH, tableHeight(t));
    }
    y += rowH + gap;
  }
  return positions;
}

export function contentBounds(rects: Rect[], pad = 48): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 800, h: 600 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export interface Anchor {
  x: number;
  y: number;
  dir: 1 | -1;
}

export function computeAnchors(
  from: Rect,
  fromY: number,
  to: Rect,
  toY: number,
): [Anchor, Anchor] {
  if (from === to) {
    return [
      { x: from.x + from.w, y: fromY, dir: 1 },
      { x: to.x + to.w, y: toY, dir: 1 },
    ];
  }
  const fromCenter = from.x + from.w / 2;
  const toCenter = to.x + to.w / 2;
  if (fromCenter <= toCenter) {
    return [
      { x: from.x + from.w, y: fromY, dir: 1 },
      { x: to.x, y: toY, dir: -1 },
    ];
  }
  return [
    { x: from.x, y: fromY, dir: -1 },
    { x: to.x + to.w, y: toY, dir: 1 },
  ];
}

function roundedPath(points: Point[], radius = 10): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const p1 = {
      x: cur.x + ((prev.x - cur.x) / (d1 || 1)) * r,
      y: cur.y + ((prev.y - cur.y) / (d1 || 1)) * r,
    };
    const p2 = {
      x: cur.x + ((next.x - cur.x) / (d2 || 1)) * r,
      y: cur.y + ((next.y - cur.y) / (d2 || 1)) * r,
    };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export interface ConnectorPath {
  d: string;
  label: Point;
}

export function buildConnector(
  style: ConnectorStyle,
  a: Anchor,
  b: Anchor,
  fromRect: Rect,
  toRect: Rect,
  selfLoop: boolean,
): ConnectorPath {
  const stub = 26;

  if (selfLoop) {
    const x = a.dir === -1 ? Math.min(a.x, b.x) - 44 : Math.max(a.x, b.x) + 44;
    const pts = [
      { x: a.x, y: a.y },
      { x, y: a.y },
      { x, y: b.y },
      { x: b.x, y: b.y },
    ];
    return { d: roundedPath(pts), label: { x, y: (a.y + b.y) / 2 } };
  }

  if (style === 'straight') {
    return {
      d: `M ${a.x} ${a.y} L ${a.x + a.dir * 12} ${a.y} L ${b.x + b.dir * 12} ${b.y} L ${b.x} ${b.y}`,
      label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  if (style === 'curved') {
    const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
    const c1 = { x: a.x + a.dir * dx, y: a.y };
    const c2 = { x: b.x + b.dir * dx, y: b.y };
    return {
      d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
      label: {
        x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
        y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
      },
    };
  }

  // orthogonal
  let pts: Point[];
  if (a.dir === b.dir) {
    const x = a.dir === 1 ? Math.max(a.x, b.x) + stub + 14 : Math.min(a.x, b.x) - stub - 14;
    pts = [
      { x: a.x, y: a.y },
      { x, y: a.y },
      { x, y: b.y },
      { x: b.x, y: b.y },
    ];
    return { d: roundedPath(pts), label: { x, y: (a.y + b.y) / 2 } };
  }

  const facing = (a.dir === 1 && b.x - a.x >= 2 * stub) || (a.dir === -1 && a.x - b.x >= 2 * stub);
  if (facing) {
    const mid = (a.x + b.x) / 2;
    pts = [
      { x: a.x, y: a.y },
      { x: mid, y: a.y },
      { x: mid, y: b.y },
      { x: b.x, y: b.y },
    ];
    return { d: roundedPath(pts), label: { x: mid, y: (a.y + b.y) / 2 } };
  }

  const x1 = a.x + a.dir * stub;
  const x2 = b.x + b.dir * stub;
  let midY: number;
  if (fromRect.y + fromRect.h < toRect.y) midY = (fromRect.y + fromRect.h + toRect.y) / 2;
  else if (toRect.y + toRect.h < fromRect.y) midY = (toRect.y + toRect.h + fromRect.y) / 2;
  else midY = Math.min(fromRect.y, toRect.y) - 34;

  pts = [
    { x: a.x, y: a.y },
    { x: x1, y: a.y },
    { x: x1, y: midY },
    { x: x2, y: midY },
    { x: x2, y: b.y },
    { x: b.x, y: b.y },
  ];
  return { d: roundedPath(pts), label: { x: (x1 + x2) / 2, y: midY } };
}

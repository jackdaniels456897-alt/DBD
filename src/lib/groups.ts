import type { Point, Table, TableGroup } from '../types';
import { tableRect, type Rect } from './geometry';

export const GROUP_COLORS = [
  { stroke: '#f59e0b', fill: '#f59e0b', chip: '#78350f', text: '#fde68a' }, // amber
  { stroke: '#38bdf8', fill: '#38bdf8', chip: '#0c4a6e', text: '#bae6fd' }, // sky
  { stroke: '#a78bfa', fill: '#a78bfa', chip: '#4c1d95', text: '#ddd6fe' }, // violet
  { stroke: '#4ade80', fill: '#4ade80', chip: '#14532d', text: '#bbf7d0' }, // green
  { stroke: '#f472b6', fill: '#f472b6', chip: '#831843', text: '#fbcfe8' }, // pink
  { stroke: '#fb923c', fill: '#fb923c', chip: '#7c2d12', text: '#fed7aa' }, // orange
];

export const groupColor = (index: number) => GROUP_COLORS[index % GROUP_COLORS.length];

export const GROUP_HEADER_H = 30;
export const MIN_GROUP_W = 120;
export const MIN_GROUP_H = 90;
export const HANDLE_SIZE = 9;

export type ResizeEdge = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Builds a normalized rect from two arbitrary drag corners. */
export function rectFromDrag(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function groupRect(g: TableGroup): Rect {
  return { x: g.x, y: g.y, w: g.w, h: g.h };
}

/** A table belongs to a group when its center lies inside the frame. */
export function tablesInGroup(
  group: TableGroup,
  tables: Table[],
  positions: Record<string, Point>,
): string[] {
  const out: string[] = [];
  for (const t of tables) {
    const r = tableRect(t, positions);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h) {
      out.push(t.name);
    }
  }
  return out;
}

/** Which group (topmost = smallest area) currently contains a table. */
export function groupOfTable(
  tableName: string,
  groups: TableGroup[],
  tables: Table[],
  positions: Record<string, Point>,
): TableGroup | null {
  const table = tables.find((t) => t.name === tableName);
  if (!table) return null;
  const r = tableRect(table, positions);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const hits = groups.filter(
    (g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h,
  );
  if (!hits.length) return null;
  return hits.reduce((best, g) => (g.w * g.h < best.w * best.h ? g : best));
}

export function applyResize(
  original: Rect,
  edge: ResizeEdge,
  delta: Point,
): Rect {
  let { x, y, w, h } = original;
  if (edge.includes('w')) {
    x = original.x + delta.x;
    w = original.w - delta.x;
  }
  if (edge.includes('e')) w = original.w + delta.x;
  if (edge.includes('n')) {
    y = original.y + delta.y;
    h = original.h - delta.y;
  }
  if (edge.includes('s')) h = original.h + delta.y;

  if (w < MIN_GROUP_W) {
    if (edge.includes('w')) x = original.x + original.w - MIN_GROUP_W;
    w = MIN_GROUP_W;
  }
  if (h < MIN_GROUP_H) {
    if (edge.includes('n')) y = original.y + original.h - MIN_GROUP_H;
    h = MIN_GROUP_H;
  }
  return { x, y, w, h };
}

export const RESIZE_CURSOR: Record<ResizeEdge, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Handle anchor points, in diagram space. */
export function handlePoints(g: TableGroup): { edge: ResizeEdge; x: number; y: number }[] {
  const { x, y, w, h } = g;
  return [
    { edge: 'nw', x, y },
    { edge: 'n', x: x + w / 2, y },
    { edge: 'ne', x: x + w, y },
    { edge: 'e', x: x + w, y: y + h / 2 },
    { edge: 'se', x: x + w, y: y + h },
    { edge: 's', x: x + w / 2, y: y + h },
    { edge: 'sw', x, y: y + h },
    { edge: 'w', x, y: y + h / 2 },
  ];
}

/** Frames sorted so larger ones paint first (smaller stay clickable on top). */
export function sortedForPaint(groups: TableGroup[]): TableGroup[] {
  return [...groups].sort((a, b) => b.w * b.h - a.w * a.h);
}

export function makeGroup(rect: Rect, index: number): TableGroup {
  return {
    id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `Grupo ${index + 1}`,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(Math.max(rect.w, MIN_GROUP_W)),
    h: Math.round(Math.max(rect.h, MIN_GROUP_H)),
    color: index % GROUP_COLORS.length,
  };
}

/** Expands a frame so it visually wraps the given tables. */
export function fitGroupToTables(
  group: TableGroup,
  tableNames: string[],
  tables: Table[],
  positions: Record<string, Point>,
): TableGroup {
  const rects = tableNames
    .map((n) => tables.find((t) => t.name === n))
    .filter(Boolean)
    .map((t) => tableRect(t as Table, positions));
  if (!rects.length) return group;
  const pad = 22;
  const minX = Math.min(...rects.map((r) => r.x)) - pad;
  const minY = Math.min(...rects.map((r) => r.y)) - pad - GROUP_HEADER_H;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return {
    ...group,
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(Math.max(maxX - minX, MIN_GROUP_W)),
    h: Math.round(Math.max(maxY - minY, MIN_GROUP_H)),
  };
}

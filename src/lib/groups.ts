import type { Point, Table, TableGroup } from '../types';
import { tableHeight, tableRect, tableWidth, type Rect } from './geometry';

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
export const GROUP_PAD = 22;
/** Tamanho mínimo do frame quando o grupo está vazio. */
export const EMPTY_W = 220;
export const EMPTY_H = 150;

export interface GroupBox extends Rect {
  group: TableGroup;
  memberNames: string[];
}

/**
 * O retângulo do grupo é DERIVADO das tabelas membros (auto-envolve). Grupos
 * vazios recebem uma âncora persistida em anchors[id] para não sumirem.
 */
export function groupBox(
  group: TableGroup,
  tables: Table[],
  positions: Record<string, Point>,
  anchors: Record<string, Point>,
): GroupBox {
  const memberNames = group.members.filter((n) => tables.some((t) => t.name === n));
  const rects = memberNames.map((n) => tableRect(tables.find((t) => t.name === n)!, positions));

  if (!rects.length) {
    const a = anchors[group.id] ?? { x: 60, y: 60 };
    return { x: a.x, y: a.y, w: EMPTY_W, h: EMPTY_H, group, memberNames };
  }

  const minX = Math.min(...rects.map((r) => r.x)) - GROUP_PAD;
  const minY = Math.min(...rects.map((r) => r.y)) - GROUP_PAD - GROUP_HEADER_H;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + GROUP_PAD;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + GROUP_PAD;
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
    group,
    memberNames,
  };
}

/** Retângulo normalizado a partir de dois cantos arbitrários de arrasto. */
export function rectFromDrag(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** True quando o centro da tabela cai dentro do box (usado para drop). */
export function tableCenterInBox(rect: Rect, box: Rect): boolean {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

export function makeGroup(index: number, members: string[] = []): TableGroup {
  return {
    id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `Grupo ${index + 1}`,
    members,
    color: index % GROUP_COLORS.length,
  };
}

/** Frames pintados dos maiores para os menores (menores clicáveis por cima). */
export function sortedForPaint(boxes: GroupBox[]): GroupBox[] {
  return [...boxes].sort((a, b) => b.w * b.h - a.w * a.h);
}

const CLUSTER_GAP = 90;
const TABLE_GAP = 40;

/**
 * Auto layout que respeita grupos: cada grupo vira um cluster com suas tabelas
 * lado a lado; tabelas sem grupo formam clusters individuais. Clusters são
 * empacotados em linhas. Retorna posições novas para TODAS as tabelas.
 */
export function autoLayoutWithGroups(
  tables: Table[],
  groups: TableGroup[],
): Record<string, Point> {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const used = new Set<string>();

  interface Cluster { names: string[]; isGroup: boolean }
  const clusters: Cluster[] = [];

  for (const g of groups) {
    const names = g.members.filter((n) => byName.has(n) && !used.has(n));
    if (!names.length) continue;
    names.forEach((n) => used.add(n));
    clusters.push({ names, isGroup: true });
  }
  for (const t of tables) {
    if (!used.has(t.name)) clusters.push({ names: [t.name], isGroup: false });
  }

  // dimensões internas de cada cluster (grid quadrado das tabelas)
  const measured = clusters.map((cl) => {
    const per = Math.max(1, Math.ceil(Math.sqrt(cl.names.length)));
    let colW = 0;
    let rowsH: number[] = [];
    const cellW: number[] = [];
    const cellH: number[] = [];
    for (const n of cl.names) {
      const t = byName.get(n)!;
      cellW.push(tableWidth(t));
      cellH.push(tableHeight(t));
    }
    const cols = Math.min(per, cl.names.length);
    // largura = soma das larguras máximas por coluna
    const colWidths: number[] = new Array(cols).fill(0);
    const rowCount = Math.ceil(cl.names.length / cols);
    const rowHeights: number[] = new Array(rowCount).fill(0);
    cl.names.forEach((_, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      colWidths[c] = Math.max(colWidths[c], cellW[i]);
      rowHeights[r] = Math.max(rowHeights[r], cellH[i]);
    });
    colW = colWidths.reduce((a, b) => a + b, 0) + TABLE_GAP * (cols - 1);
    rowsH = rowHeights;
    const innerH = rowsH.reduce((a, b) => a + b, 0) + TABLE_GAP * (rowCount - 1);
    const pad = cl.isGroup && cl.names.length ? GROUP_PAD : 0;
    const headPad = cl.isGroup && cl.names.length ? GROUP_HEADER_H : 0;
    return {
      cluster: cl,
      cols,
      colWidths,
      rowHeights,
      w: colW + pad * 2,
      h: innerH + pad * 2 + headPad,
      pad,
      headPad,
    };
  });

  // empacota clusters em linhas com largura-alvo
  const target = Math.max(
    900,
    Math.sqrt(measured.reduce((a, m) => a + m.w * m.h, 0)) * 1.4,
  );
  const positions: Record<string, Point> = {};
  let x = CLUSTER_GAP;
  let y = CLUSTER_GAP;
  let rowH = 0;

  for (const m of measured) {
    if (x > CLUSTER_GAP && x + m.w > target) {
      x = CLUSTER_GAP;
      y += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    // origem interna das tabelas do cluster
    const ox = x + m.pad;
    const oy = y + m.pad + m.headPad;
    let iy = oy;
    m.cluster.names.forEach((n, i) => {
      const c = i % m.cols;
      const r = Math.floor(i / m.cols);
      let ix = ox;
      for (let cc = 0; cc < c; cc++) ix += m.colWidths[cc] + TABLE_GAP;
      if (c === 0 && r > 0) iy += m.rowHeights[r - 1] + TABLE_GAP;
      positions[n] = { x: Math.round(ix), y: Math.round(iy) };
    });
    x += m.w + CLUSTER_GAP;
    rowH = Math.max(rowH, m.h);
  }

  return positions;
}

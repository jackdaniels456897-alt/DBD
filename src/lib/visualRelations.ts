import type { Column, Relationship, Table } from '../types';
import { parseSchema, splitAttributes, splitSchemaComment } from './parser.ts';

export interface ColumnEndpoint {
  table: string;
  column: string;
}

interface ResolvedEndpoint {
  table: Table;
  column: Column;
}

export interface VisualConnection {
  foreign: ResolvedEndpoint;
  primary: ResolvedEndpoint;
  existing?: Relationship;
}

export interface ConnectionEdit {
  text: string;
  status: 'created' | 'updated' | 'removed' | 'unchanged' | 'error';
  message: string;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function findEndpoint(tables: Table[], endpoint: ColumnEndpoint): ResolvedEndpoint | null {
  const table = tables.find((t) => sameName(t.name, endpoint.table));
  const column = table?.columns.find((c) => sameName(c.name, endpoint.column));
  return table && column ? { table, column } : null;
}

function matches(endpoint: ResolvedEndpoint, table: string, column: string) {
  return sameName(endpoint.table.name, table) && sameName(endpoint.column.name, column);
}

function isKey(endpoint: ResolvedEndpoint) {
  // An individual column in a composite PK is not necessarily unique.
  return endpoint.column.unique ||
    (endpoint.column.pk && endpoint.table.columns.filter((c) => c.pk).length === 1);
}

export function resolveVisualConnection(
  tables: Table[],
  relationships: Relationship[],
  start: ColumnEndpoint,
  end: ColumnEndpoint,
): VisualConnection | null {
  const a = findEndpoint(tables, start);
  const b = findEndpoint(tables, end);
  if (!a || !b || matches(a, b.table.name, b.column.name)) return null;

  const existing = relationships.find((rel) =>
    (matches(a, rel.fromTable, rel.fromColumn) && matches(b, rel.toTable, rel.toColumn)) ||
    (matches(b, rel.fromTable, rel.fromColumn) && matches(a, rel.toTable, rel.toColumn)),
  );
  if (existing) {
    return matches(a, existing.fromTable, existing.fromColumn)
      ? { foreign: a, primary: b, existing }
      : { foreign: b, primary: a, existing };
  }

  // The gesture direction does not determine which column owns the foreign key.
  let reverse = false;
  if (isKey(a) !== isKey(b)) reverse = isKey(a);
  else if (a.column.fk !== b.column.fk) reverse = b.column.fk;
  else if (a.column.pk !== b.column.pk) reverse = a.column.pk;
  else {
    const aIsId = /^(id|uuid)$/i.test(a.column.name);
    const bIsId = /^(id|uuid)$/i.test(b.column.name);
    if (aIsId !== bIsId) reverse = aIsId;
  }
  return reverse ? { foreign: b, primary: a } : { foreign: a, primary: b };
}

const REL_SYMBOL = /^(?:[<>]?0?-0?[<>]?|<>|>|<)$/;
const REFERENCE = /^(?:[\w$]+|"[^"]+"|'[^']+'|`[^`]+`)\.(?:[\w$]+|"[^"]+"|'[^']+'|`[^`]+`)$/;

function removeInlineReference(body: string): string {
  const tokens = [...body.matchAll(/(?:[^\s"'`]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)+/g)];
  const remove = new Set<number>();
  const hasFk = tokens.some((token, i) => i > 0 && /^fk$/i.test(token[0]));
  for (let i = 1; i < tokens.length; i++) {
    const value = tokens[i][0];
    if (/^fk$/i.test(value)) remove.add(i);
    if (REL_SYMBOL.test(value) && tokens[i + 1] && REFERENCE.test(tokens[i + 1][0])) {
      remove.add(i);
      remove.add(i + 1);
    } else if (hasFk && REFERENCE.test(value)) remove.add(i);
  }

  // Delete token spans, not a global regex over the schema or quoted notes.
  let result = body;
  for (let i = tokens.length - 1; i > 0; i--) {
    if (!remove.has(i)) continue;
    let start = tokens[i].index!;
    const end = start + tokens[i][0].length;
    while (start > 0 && /[ \t]/.test(body[start - 1])) start--;
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trimEnd();
}

function identifier(name: string) {
  return /^[\w$]+$/.test(name) ? name : `"${name}"`;
}

function rewriteReferenceLine(
  raw: string,
  connection: VisualConnection | null,
  preferBrackets: boolean,
): string {
  const ending = raw.endsWith('\r') ? '\r' : '';
  const { code, comment } = splitSchemaComment(ending ? raw.slice(0, -1) : raw);
  const bracket = code.match(/^(.*?)\s*\[(.*)\](.*)$/);
  const attributes = bracket ? splitAttributes(bracket[2]) : [];
  const kept = attributes.map((attr) => attr.trim()).filter((attr) =>
    attr && !/^ref\s*[:=]/i.test(attr) && !/^fk$/i.test(attr),
  );
  let body = bracket ? bracket[1].trimEnd() : code;
  if (bracket?.[3].trim()) body += ` ${bracket[3].trim()}`;
  body = removeInlineReference(body);

  const useBrackets = !!bracket || preferBrackets ||
    !!(connection && /\s/.test(connection.primary.table.name));
  if (connection) {
    const target = `${identifier(connection.primary.table.name)}.${identifier(connection.primary.column.name)}`;
    const symbol = isKey(connection.foreign) ? '-' : '>-';
    if (useBrackets) kept.push(`ref: ${symbol} ${target}`);
    else body += ` FK ${symbol} ${target}`;
  }
  return `${body}${kept.length ? ` [${kept.join(', ')}]` : ''}${comment}${ending}`;
}

export function createVisualConnection(
  text: string,
  start: ColumnEndpoint,
  end: ColumnEndpoint,
): ConnectionEdit {
  const schema = parseSchema(text);
  const connection = resolveVisualConnection(schema.tables, schema.relationships, start, end);
  if (!connection) {
    return { text, status: 'error', message: 'Selecione duas colunas diferentes para conectar.' };
  }
  if (connection.existing) {
    return { text, status: 'unchanged', message: 'Esta conex\u00e3o j\u00e1 existe, independentemente do sentido do arrasto.' };
  }

  const { foreign, primary } = connection;
  const lines = text.split('\n');
  const line = foreign.column.line - 1;
  const braceStyle = splitSchemaComment(lines[foreign.table.line - 1]).code.trimEnd().endsWith('{');
  lines[line] = rewriteReferenceLine(lines[line], connection, braceStyle);
  const next = lines.join('\n');
  const expected = `${foreign.table.name}.${foreign.column.name}->${primary.table.name}.${primary.column.name}`;
  if (!parseSchema(next).relationships.some((rel) => rel.id === expected)) {
    return { text, status: 'error', message: 'N\u00e3o foi poss\u00edvel criar a conex\u00e3o. Corrija a sintaxe das colunas selecionadas.' };
  }
  return {
    text: next,
    status: foreign.column.ref ? 'updated' : 'created',
    message: `FK ${foreign.table.name}.${foreign.column.name} -> ${primary.table.name}.${primary.column.name}`,
  };
}

export function removeVisualConnection(text: string, id: string): ConnectionEdit {
  const schema = parseSchema(text);
  const relation = schema.relationships.find((rel) => rel.id === id);
  if (!relation) return { text, status: 'unchanged', message: 'A conex\u00e3o j\u00e1 foi removida.' };
  const lines = text.split('\n');
  lines[relation.line - 1] = rewriteReferenceLine(lines[relation.line - 1], null, false);
  const next = lines.join('\n');
  if (parseSchema(next).relationships.some((rel) => rel.id === id)) {
    return { text, status: 'error', message: 'N\u00e3o foi poss\u00edvel remover a refer\u00eancia desta coluna.' };
  }
  return { text: next, status: 'removed', message: 'Conex\u00e3o removida. As colunas foram preservadas.' };
}
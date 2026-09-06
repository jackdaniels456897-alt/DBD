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

export interface TableCreation {
  text: string;
  status: 'created' | 'error';
  message: string;
  tableName: string;
}

/** Detects the syntax the user prefers, so new tables match the existing style. */
function detectStyle(text: string): 'brace' | 'dash' {
  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[A-Za-z_][\w$ ]*\{$/.test(line)) return 'brace';
    if (/^[A-Za-z_][\w$ ]*$/.test(line)) {
      const idx = lines.indexOf(raw);
      const next = lines[idx + 1]?.trim() ?? '';
      if (/^[-=~]{1,}$/.test(next)) return 'dash';
    }
  }
  return 'dash';
}

/** Guarantees a unique table name by appending _2, _3, ... if needed. */
function uniqueName(name: string, existing: Table[]): string {
  const taken = new Set(existing.map((t) => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name}_${n}`.toLowerCase())) n++;
  return `${name}_${n}`;
}

export function createVisualTable(text: string, rawName: string): TableCreation {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { text, status: 'error', message: 'Informe um nome para a nova tabela.', tableName: '' };
  }
  const quoted = /\s/.test(trimmed);
  const identifier = trimmed.replace(/["'`]/g, '');
  if (!/^[A-Za-z_][\w$ ]*$/.test(identifier)) {
    return {
      text,
      status: 'error',
      message: 'Use apenas letras, números, underscore e espaços. Comece por letra.',
      tableName: '',
    };
  }
  const schema = parseSchema(text);
  const name = uniqueName(identifier, schema.tables);
  const style = detectStyle(text);
  const header = quoted ? `"${name}"` : name;
  const block =
    style === 'brace'
      ? `${header} {\n  id int [pk, increment]\n}`
      : `${header}\n-\nid int PK`;
  const separator = text.length && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : '';
  const next = `${text}${separator}${block}\n`;
  if (!parseSchema(next).tables.some((t) => sameName(t.name, name))) {
    return { text, status: 'error', message: 'Não foi possível criar a tabela.', tableName: '' };
  }
  return {
    text: next,
    status: 'created',
    message: `Tabela "${name}" criada.`,
    tableName: name,
  };
}

export interface TableRename {
  text: string;
  status: 'renamed' | 'unchanged' | 'error';
  message: string;
  tableName: string;
}

function quoteIdentifier(name: string) {
  return identifier(name);
}

/** Extrai símbolo e coluna da referência atual que aponta para oldTable. */
function extractRefTarget(
  body: string,
  bracketAttrs: string[],
  oldTable: string,
): { symbol: string; column: string } | null {
  for (const attr of bracketAttrs) {
    const rm = attr.trim().match(/^ref\s*[:=]\s*(.+)$/i);
    if (!rm) continue;
    const m = rm[1].trim().match(/^([<>0-]{1,3})?\s*(.+)$/);
    if (!m) continue;
    const dot = m[2].lastIndexOf('.');
    if (dot < 0) continue;
    const tablePart = m[2].slice(0, dot).trim().replace(/^["'`]|["'`]$/g, '');
    if (tablePart.toLowerCase() !== oldTable.toLowerCase()) continue;
    return { symbol: (m[1] ?? '').trim(), column: m[2].slice(dot + 1).trim() };
  }
  const tokens = [...body.matchAll(/(?:[^\s"'`]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)+/g)].map(
    (t) => t[0],
  );
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    const cur = tokens[i];
    if (!REL_SYMBOL.test(prev) && !/^fk$/i.test(prev)) continue;
    const dot = cur.lastIndexOf('.');
    if (dot <= 0 || dot === cur.length - 1) continue;
    if (/[:=]/.test(cur.slice(0, dot))) continue;
    const tablePart = cur.slice(0, dot).replace(/^["'`]|["'`]$/g, '');
    if (tablePart.toLowerCase() !== oldTable.toLowerCase()) continue;
    return { symbol: REL_SYMBOL.test(prev) ? prev : '', column: cur.slice(dot + 1) };
  }
  return null;
}

/** Substitui a tabela-alvo de uma referência, preservando símbolo e coluna. */
function replaceRefTarget(line: string, oldTable: string, newTable: string): string {
  const ending = line.endsWith('\r') ? '\r' : '';
  const src = ending ? line.slice(0, -1) : line;
  const { code, comment } = splitSchemaComment(src);
  const bracket = code.match(/^(.*?)\s*\[(.*)\](.*)$/);
  const attrs = bracket ? splitAttributes(bracket[2]) : [];

  let body = bracket ? bracket[1].trimEnd() : code;
  const trailing = bracket?.[3] ?? '';
  if (trailing.trim()) body += ` ${trailing.trim()}`;

  const current = extractRefTarget(body, attrs, oldTable);
  if (!current) return line;
  const target = `${quoteIdentifier(newTable)}.${current.column}`;
  // Nomes com espaço não funcionam inline (o parser quebra por whitespace):
  // usa sempre a forma [ref: ...], igual ao createVisualConnection.
  const useBrackets = !!bracket || /\s/.test(newTable);

  const kept = attrs
    .map((attr) => attr.trim())
    .filter((attr) => attr && !/^ref\s*[:=]/i.test(attr) && !/^fk$/i.test(attr));

  let newBody = removeInlineReference(body);
  if (useBrackets) {
    kept.push(`ref: ${current.symbol ? current.symbol + ' ' : ''}${target}`);
    return `${newBody}${kept.length ? ` [${kept.join(', ')}]` : ''}${comment}${ending}`;
  }
  newBody += ` FK${current.symbol ? ` ${current.symbol}` : ''} ${target}`;
  return `${newBody}${kept.length ? ` [${kept.join(', ')}]` : ''}${comment}${ending}`;
}

export function renameVisualTable(text: string, oldName: string, rawNew: string): TableRename {
  const trimmed = rawNew.trim().replace(/^["'`]|["'`]$/g, '');
  if (!trimmed) {
    return { text, status: 'error', message: 'O nome não pode ficar vazio.', tableName: oldName };
  }
  if (!/^[A-Za-z_][\w$ ]*$/.test(trimmed)) {
    return {
      text,
      status: 'error',
      message: 'Use apenas letras, números, underscore e espaços. Comece por letra.',
      tableName: oldName,
    };
  }
  const schema = parseSchema(text);
  const target = schema.tables.find((t) => t.name.toLowerCase() === oldName.toLowerCase());
  if (!target) {
    return { text, status: 'error', message: 'Tabela original não encontrada.', tableName: oldName };
  }
  if (trimmed.toLowerCase() !== target.name.toLowerCase()) {
    const clash = schema.tables.some(
      (t) => t !== target && t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (clash) {
      return { text, status: 'error', message: `Já existe uma tabela chamada "${trimmed}".`, tableName: oldName };
    }
  } else if (trimmed === target.name) {
    return { text, status: 'unchanged', message: 'Nome mantido.', tableName: target.name };
  }

  const newName = trimmed;
  const lines = text.split('\n');

  // 1) cabeçalho
  const headerIdx = target.line - 1;
  const headerRaw = lines[headerIdx] ?? '';
  const { code: headerCode, comment: headerComment } = splitSchemaComment(
    headerRaw.endsWith('\r') ? headerRaw.slice(0, -1) : headerRaw,
  );
  const headerEnding = headerRaw.endsWith('\r') ? '\r' : '';
  const brace = headerCode.match(/^(\s*)(["'`]?)(.*?)\2\s*\{\s*$/);
  if (brace) {
    const q = /\s/.test(newName) ? '"' : brace[2];
    lines[headerIdx] = `${brace[1]}${q}${newName}${q} {${headerComment}${headerEnding}`;
  } else {
    const dash = headerCode.match(/^(\s*)(["'`]?)(.*?)\2\s*$/);
    if (!dash) {
      return { text, status: 'error', message: 'Não foi possível localizar o cabeçalho da tabela.', tableName: oldName };
    }
    const q = /\s/.test(newName) ? '"' : dash[2];
    lines[headerIdx] = `${dash[1]}${q}${newName}${q}${headerComment}${headerEnding}`;
  }

  // 2) referências (qualquer coluna cujo ref aponte para a tabela antiga)
  for (const table of schema.tables) {
    for (const col of table.columns) {
      if (col.ref && col.ref.table.toLowerCase() === target.name.toLowerCase()) {
        lines[col.line - 1] = replaceRefTarget(lines[col.line - 1], target.name, newName);
      }
    }
  }

  const next = lines.join('\n');
  const check = parseSchema(next);
  if (!check.tables.some((t) => t.name === newName)) {
    return { text, status: 'error', message: 'Não foi possível renomear. Verifique a sintaxe.', tableName: oldName };
  }
  return { text: next, status: 'renamed', message: `Tabela renomeada para "${newName}".`, tableName: newName };
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
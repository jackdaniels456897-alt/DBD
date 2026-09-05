import type {
  Cardinality,
  Column,
  Diagnostic,
  LineKind,
  ParsedSchema,
  Relationship,
  Table,
} from '../types';

const KNOWN_TYPES = [
  'int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial', 'bigserial',
  'varchar', 'nvarchar', 'char', 'nchar', 'text', 'longtext', 'string', 'clob',
  'boolean', 'bool', 'bit', 'date', 'datetime', 'datetime2', 'timestamp', 'time', 'year',
  'decimal', 'numeric', 'money', 'float', 'double', 'real', 'json', 'jsonb', 'xml',
  'uuid', 'guid', 'blob', 'binary', 'varbinary', 'enum', 'array', 'inet', 'interval',
];

const KEYWORDS: Record<string, keyof Column | 'notnull'> = {
  pk: 'pk',
  'primarykey': 'pk',
  fk: 'fk',
  unique: 'unique',
  uq: 'unique',
  increment: 'increment',
  autoincrement: 'increment',
  auto_increment: 'increment',
  identity: 'increment',
  serial: 'increment',
  null: 'nullable',
  nullable: 'nullable',
  notnull: 'notnull',
  index: 'index',
  idx: 'index',
};

const REL_SYMBOL = /^(?:[<>]?0?-0?[<>]?|<>|>|<)$/;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = levenshtein(word, c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(word.length / 2));
  return bestScore <= limit ? best : undefined;
}

/** Converts a QuickDBD relationship symbol into the cardinality of both ends. */
export function parseRelSymbol(symbol: string): { from: Cardinality; to: Cardinality } {
  const s = symbol.trim();
  if (s === '>') return { from: 'many', to: 'one' };
  if (s === '<') return { from: 'one', to: 'many' };
  if (s === '<>' ) return { from: 'many', to: 'many' };
  if (!s.includes('-')) return { from: 'many', to: 'one' };
  const dash = s.indexOf('-');
  const left = s.slice(0, dash);
  const right = s.slice(dash + 1);
  const card = (part: string, manyChar: string): Cardinality => {
    const many = part.includes(manyChar);
    const zero = part.includes('0');
    if (many && zero) return 'zero-or-many';
    if (many) return 'many';
    if (zero) return 'zero-or-one';
    return 'one';
  };
  return { from: card(left, '>'), to: card(right, '<') };
}

function emptyColumn(name: string, line: number): Column {
  return {
    name,
    type: '',
    pk: false,
    fk: false,
    unique: false,
    increment: false,
    nullable: false,
    index: false,
    line,
  };
}

function applyKeyword(col: Column, raw: string): boolean {
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  const mapped = KEYWORDS[key] ?? KEYWORDS[raw.toLowerCase()];
  if (!mapped) return false;
  if (mapped === 'notnull') {
    col.nullable = false;
    return true;
  }
  if (mapped === 'pk') col.pk = true;
  else if (mapped === 'fk') col.fk = true;
  else if (mapped === 'unique') col.unique = true;
  else if (mapped === 'increment') col.increment = true;
  else if (mapped === 'nullable') col.nullable = true;
  else if (mapped === 'index') col.index = true;
  return true;
}

function stripQuotes(value: string) {
  return value.replace(/^["'`]|["'`]$/g, '');
}

/** Parses a single column line. Returns null when the line makes no sense at all. */
function parseColumnLine(raw: string, line: number, diags: Diagnostic[]): Column | null {
  const trimmed = splitSchemaComment(raw).code.trim().replace(/,+$/, '');
  if (!trimmed) return null;

  let body = trimmed;
  let bracket = '';
  const bracketMatch = trimmed.match(/^(.*?)\s*\[(.*)\](.*)$/);
  if (bracketMatch) {
    // Accept legacy visual edits that placed an inline FK after the attributes.
    body = `${bracketMatch[1]} ${bracketMatch[3]}`.trim();
    bracket = bracketMatch[2];
  } else if (trimmed.includes('[') && !trimmed.includes(']')) {
    diags.push({
      line,
      severity: 'error',
      message: 'Colchete "[" sem fechamento "]".',
      hint: 'Feche a lista de atributos, ex.: id int [pk, increment]',
    });
  }

  const tokens = body.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const rawName = tokens.shift() as string;
  const name = stripQuotes(rawName);
  if (!/^[A-Za-z_][\w$]*$/.test(name)) {
    diags.push({
      line,
      severity: 'error',
      message: `Nome de coluna inválido: "${rawName}".`,
      hint: 'Use letras, números e underscore, começando por letra. Ex.: user_id',
      token: rawName,
    });
    return null;
  }

  const col = emptyColumn(name, line);
  const typeParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (applyKeyword(col, token)) continue;

    if (REL_SYMBOL.test(token)) {
      const target = tokens[i + 1];
      if (!target) {
        diags.push({
          line,
          severity: 'error',
          message: `Relacionamento "${token}" sem destino.`,
          hint: 'Informe o alvo depois do símbolo. Ex.: user_id int FK >- users.id',
          token,
        });
        continue;
      }
      const m = target.match(/^["'`]?([\w ]+)["'`]?\.["'`]?([\w$]+)["'`]?$/);
      if (!m) {
        diags.push({
          line,
          severity: 'error',
          message: `Destino de relacionamento inválido: "${target}".`,
          hint: 'Use o formato Tabela.coluna, ex.: users.id',
          token: target,
        });
        i++;
        continue;
      }
      const cards = parseRelSymbol(token);
      col.ref = { table: m[1].trim(), column: m[2], from: cards.from, to: cards.to };
      col.fk = true;
      i++;
      continue;
    }

    const dotted = token.match(/^["'`]?([\w ]+)["'`]?\.["'`]?([\w$]+)["'`]?$/);
    if (dotted && (col.fk || col.ref)) {
      if (!col.ref) {
        col.ref = { table: dotted[1].trim(), column: dotted[2], from: 'many', to: 'one' };
      }
      continue;
    }

    const def = token.match(/^default[=:](.+)$/i);
    if (def) {
      col.defaultValue = stripQuotes(def[1]);
      continue;
    }

    typeParts.push(token);
  }

  col.type = typeParts.join(' ');

  // ---- bracket attributes (dbdiagram-like) ----
  if (bracket) {
    for (const rawAttr of splitAttributes(bracket)) {
      const attr = rawAttr.trim();
      if (!attr) continue;
      const lower = attr.toLowerCase();

      if (applyKeyword(col, attr)) continue;
      if (lower === 'primary key' || lower === 'primary_key') {
        col.pk = true;
        continue;
      }
      if (lower === 'not null') {
        col.nullable = false;
        continue;
      }
      const defAttr = attr.match(/^default\s*[:=]\s*(.+)$/i);
      if (defAttr) {
        col.defaultValue = stripQuotes(defAttr[1].trim());
        continue;
      }
      const noteAttr = attr.match(/^note\s*[:=]\s*(.+)$/i);
      if (noteAttr) {
        col.note = stripQuotes(noteAttr[1].trim());
        continue;
      }
      const refAttr = attr.match(/^ref\s*[:=]\s*(.+)$/i);
      if (refAttr) {
        const value = refAttr[1].trim();
        const withSymbol = value.match(/^([<>0-]{1,3})\s*["'`]?([\w ]+)["'`]?\.["'`]?([\w$]+)["'`]?$/);
        const plain = value.match(/^["'`]?([\w ]+)["'`]?\.["'`]?([\w$]+)["'`]?$/);
        if (withSymbol) {
          const cards = parseRelSymbol(withSymbol[1]);
          col.ref = {
            table: withSymbol[2].trim(),
            column: withSymbol[3],
            from: cards.from,
            to: cards.to,
          };
          col.fk = true;
        } else if (plain) {
          col.ref = { table: plain[1].trim(), column: plain[2], from: 'many', to: 'one' };
          col.fk = true;
        } else {
          diags.push({
            line,
            severity: 'error',
            message: `Referência inválida: "${value}".`,
            hint: 'Use [ref: > Tabela.coluna] com um dos símbolos -, -<, >-, >-<, -0, 0-, -0<, >0-',
            token: value,
          });
        }
        continue;
      }
      diags.push({
        line,
        severity: 'warning',
        message: `Atributo desconhecido: "${attr}".`,
        hint: 'Atributos válidos: pk, fk, unique, increment, null, index, default:valor, ref: > Tabela.coluna, note:"texto"',
        token: attr,
      });
    }
  }

  const opens = (trimmed.match(/\(/g) ?? []).length;
  const closes = (trimmed.match(/\)/g) ?? []).length;
  if (opens !== closes) {
    diags.push({
      line,
      severity: 'error',
      message:
        opens > closes
          ? `Parêntese "(" não fechado em "${col.name}".`
          : `Parêntese ")" sobrando em "${col.name}".`,
      hint: 'Ex.: preco decimal(10,2)',
      token: col.name,
    });
  }

  if (!col.type) {
    diags.push({
      line,
      severity: 'warning',
      message: `A coluna "${col.name}" não tem tipo de dado.`,
      hint: 'Ex.: ' + col.name + ' varchar',
      token: col.name,
    });
  } else {
    const base = col.type.split(/[( ]/)[0].toLowerCase();
    if (!KNOWN_TYPES.includes(base)) {
      const suggestion = closest(base, KNOWN_TYPES);
      diags.push({
        line,
        severity: 'warning',
        message: `Tipo de dado desconhecido: "${col.type}".`,
        hint: suggestion ? `Você quis dizer "${suggestion}"?` : 'Tipos comuns: int, varchar, text, boolean, datetime, decimal',
        token: col.type,
      });
    }
  }

  if (col.fk && !col.ref) {
    diags.push({
      line,
      severity: 'warning',
      message: `A coluna "${col.name}" está marcada como FK mas não aponta para nenhuma tabela.`,
      hint: `Ex.: ${col.name} int FK >- OutraTabela.id`,
      token: col.name,
    });
  }

  return col;
}

export function splitSchemaComment(raw: string): { code: string; comment: string } {
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\' || (ch === quote && raw[i + 1] === quote)) i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if ((i === 0 || /\s/.test(raw[i - 1])) &&
      (ch === '#' || raw.slice(i, i + 2) === '//')) {
      const code = raw.slice(0, i).trimEnd();
      return { code, comment: raw.slice(code.length) };
    }
  }
  return { code: raw, comment: '' };
}

export function splitAttributes(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      cur += ch;
      if ((ch === '\\' || (ch === quote && value[i + 1] === quote)) && i + 1 < value.length) {
        cur += value[++i];
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseSchema(text: string): ParsedSchema {
  const lines = text.split('\n');
  const lineKinds: LineKind[] = lines.map(() => 'blank');
  const diagnostics: Diagnostic[] = [];
  const tables: Table[] = [];

  let current: Table | null = null;
  let mode: 'brace' | 'dash' | null = null;

  const closeTable = () => {
    if (current) tables.push(current);
    current = null;
    mode = null;
  };

  const isDashLine = (value: string) => /^[-=~]{1,}$/.test(value.trim());
  const isHeaderName = (value: string) => /^["'`]?[A-Za-z_][\w $]*["'`]?\s*$/.test(value.trim());

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const ln = i + 1;

    if (!line) {
      lineKinds[i] = 'blank';
      if (mode === 'dash') closeTable();
      continue;
    }

    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('--')) {
      lineKinds[i] = 'comment';
      continue;
    }

    // ---- closing brace ----
    if (line === '}') {
      lineKinds[i] = 'brace';
      if (mode === 'brace') {
        closeTable();
      } else {
        diagnostics.push({
          line: ln,
          severity: 'error',
          message: 'Chave de fechamento "}" sem tabela aberta.',
          hint: 'Remova esta linha ou abra a tabela com  NomeDaTabela {',
        });
      }
      continue;
    }

    // ---- brace style header:  Users { ----
    const braceOpen = line.match(/^["'`]?([A-Za-z_][\w $]*?)["'`]?\s*\{$/);
    if (braceOpen) {
      if (current && mode === 'brace') {
        diagnostics.push({
          line: current.line,
          severity: 'error',
          message: `A tabela "${current.name}" não foi fechada com "}".`,
          hint: 'Adicione uma linha com } antes de iniciar outra tabela.',
        });
        closeTable();
      } else if (current) {
        closeTable();
      }
      lineKinds[i] = 'header';
      current = { name: braceOpen[1].trim(), columns: [], line: ln };
      mode = 'brace';
      continue;
    }

    // ---- dash style header:  Users \n ----- ----
    const next = lines[i + 1];
    if (mode !== 'brace' && isHeaderName(line) && next !== undefined && isDashLine(next)) {
      closeTable();
      lineKinds[i] = 'header';
      lineKinds[i + 1] = 'separator';
      current = { name: stripQuotes(line).trim(), columns: [], line: ln };
      mode = 'dash';
      i++;
      continue;
    }

    if (isDashLine(line) && mode === 'dash') {
      lineKinds[i] = 'separator';
      continue;
    }

    if (!current) {
      lineKinds[i] = 'unknown';
      const looksLikeColumn = /^[A-Za-z_][\w$]*\s+\S+/.test(line);
      diagnostics.push({
        line: ln,
        severity: 'error',
        message: looksLikeColumn
          ? 'Coluna definida fora de uma tabela.'
          : `Não foi possível entender "${line}".`,
        hint: 'Comece uma tabela com  NomeDaTabela {  ou com o nome seguido de uma linha de traços (-----).',
      });
      continue;
    }

    // ---- column ----
    lineKinds[i] = 'column';
    const col = parseColumnLine(raw, ln, diagnostics);
    if (col) {
      if (current.columns.some((c) => c.name.toLowerCase() === col.name.toLowerCase())) {
        diagnostics.push({
          line: ln,
          severity: 'error',
          message: `Coluna duplicada "${col.name}" na tabela "${current.name}".`,
          hint: 'Renomeie ou remova uma das colunas.',
          token: col.name,
        });
      } else {
        current.columns.push(col);
      }
    } else {
      lineKinds[i] = 'unknown';
    }
  }

  if (current) {
    if (mode === 'brace') {
      diagnostics.push({
        line: (current as Table).line,
        severity: 'error',
        message: `A tabela "${(current as Table).name}" não foi fechada com "}".`,
        hint: 'Adicione uma linha com } no final da definição da tabela.',
      });
    }
    closeTable();
  }

  // ---- cross validation ----
  const byName = new Map<string, Table>();
  const uniqueTables: Table[] = [];
  for (const table of tables) {
    const key = table.name.toLowerCase();
    if (byName.has(key)) {
      diagnostics.push({
        line: table.line,
        severity: 'error',
        message: `Tabela duplicada: "${table.name}".`,
        hint: 'Cada tabela precisa de um nome único.',
        token: table.name,
      });
      continue;
    }
    byName.set(key, table);
    uniqueTables.push(table);
  }

  const tableNames = uniqueTables.map((t) => t.name);
  const relationships: Relationship[] = [];

  for (const table of uniqueTables) {
    if (!table.columns.length) {
      diagnostics.push({
        line: table.line,
        severity: 'warning',
        message: `A tabela "${table.name}" está vazia.`,
        hint: 'Adicione pelo menos uma coluna, ex.: id int PK',
        token: table.name,
      });
    } else if (!table.columns.some((c) => c.pk)) {
      diagnostics.push({
        line: table.line,
        severity: 'warning',
        message: `A tabela "${table.name}" não tem chave primária.`,
        hint: 'Marque uma coluna com PK, ex.: id int PK',
        token: table.name,
      });
    }

    for (const col of table.columns) {
      if (!col.ref) continue;
      const target = byName.get(col.ref.table.toLowerCase());
      if (!target) {
        const suggestion = closest(col.ref.table, tableNames);
        diagnostics.push({
          line: col.line,
          severity: 'error',
          message: `A tabela "${col.ref.table}" referenciada por ${table.name}.${col.name} não existe.`,
          hint: suggestion
            ? `Você quis dizer "${suggestion}"?`
            : 'Crie a tabela ou corrija o nome da referência.',
          token: col.ref.table,
        });
        continue;
      }
      const targetCol = target.columns.find(
        (c) => c.name.toLowerCase() === col.ref!.column.toLowerCase(),
      );
      if (!targetCol) {
        const suggestion = closest(col.ref.column, target.columns.map((c) => c.name));
        diagnostics.push({
          line: col.line,
          severity: 'error',
          message: `A coluna "${col.ref.column}" não existe em "${target.name}".`,
          hint: suggestion
            ? `Você quis dizer "${target.name}.${suggestion}"?`
            : `Colunas disponíveis: ${target.columns.map((c) => c.name).slice(0, 6).join(', ') || 'nenhuma'}`,
          token: col.ref.column,
        });
        continue;
      }
      if (!targetCol.pk && !targetCol.unique) {
        diagnostics.push({
          line: col.line,
          severity: 'warning',
          message: `${target.name}.${targetCol.name} não é PK nem UNIQUE — normalmente uma FK aponta para uma chave.`,
          hint: `Marque ${target.name}.${targetCol.name} como PK ou unique.`,
          token: col.ref.column,
        });
      }
      relationships.push({
        id: `${table.name}.${col.name}->${target.name}.${targetCol.name}`,
        fromTable: table.name,
        fromColumn: col.name,
        toTable: target.name,
        toColumn: targetCol.name,
        fromCard: col.ref.from,
        toCard: col.ref.to,
        line: col.line,
      });
    }
  }

  diagnostics.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

  return { tables: uniqueTables, relationships, diagnostics, lineKinds };
}

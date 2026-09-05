export type Cardinality = 'one' | 'many' | 'zero-or-one' | 'zero-or-many';

export interface ColumnRef {
  table: string;
  column: string;
  from: Cardinality;
  to: Cardinality;
}

export interface Column {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  unique: boolean;
  increment: boolean;
  nullable: boolean;
  index: boolean;
  defaultValue?: string;
  note?: string;
  ref?: ColumnRef;
  line: number;
}

export interface Table {
  name: string;
  columns: Column[];
  line: number;
}

export interface Relationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCard: Cardinality;
  toCard: Cardinality;
  line: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  line: number;
  message: string;
  severity: Severity;
  hint?: string;
  /** name of the token that caused the problem, used for inline highlight */
  token?: string;
}

export type LineKind =
  | 'blank'
  | 'comment'
  | 'header'
  | 'separator'
  | 'brace'
  | 'column'
  | 'unknown';

export interface ParsedSchema {
  tables: Table[];
  relationships: Relationship[];
  diagnostics: Diagnostic[];
  lineKinds: LineKind[];
}

export interface Point {
  x: number;
  y: number;
}

export type ConnectorStyle = 'orthogonal' | 'curved' | 'straight';

/** Área agrupada que envolve tabelas visualmente relacionadas. */
export interface TableGroup {
  id: string;
  name: string;
  tableNames: string[];
}

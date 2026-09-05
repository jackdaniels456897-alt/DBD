import { useState, useEffect, useCallback, useRef } from 'react';

// Types
interface Column {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  isIncrement: boolean;
  isNullable: boolean;
  defaultValue?: string;
  refTable?: string;
  refColumn?: string;
  relationshipType?: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
}

interface Table {
  name: string;
  columns: Column[];
  position: { x: number; y: number };
}

interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
}

interface ParsedSchema {
  tables: Table[];
  relationships: Relationship[];
  errors: string[];
}

// Parser functions
function parseSchema(text: string): ParsedSchema {
  const tables: Table[] = [];
  const relationships: Relationship[] = [];
  const errors: string[] = [];

  const lines = text.split('\n');
  let currentTable: Table | null = null;
  let inTable = false;
  let braceCount = 0;

  // First pass: parse tables
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines and comments
    if (!line || line.startsWith('//') || line.startsWith('#')) {
      continue;
    }

    // Table definition start
    const tableMatch = line.match(/^(\w+)\s*\{/);
    if (tableMatch) {
      if (currentTable) {
        errors.push(`Line ${lineNumber}: Unclosed table ${currentTable.name}`);
      }
      currentTable = {
        name: tableMatch[1],
        columns: [],
        position: { x: 0, y: 0 },
      };
      inTable = true;
      braceCount = 1;
      continue;
    }

    // Table definition end
    if (line === '}') {
      braceCount--;
      if (braceCount === 0 && currentTable) {
        tables.push(currentTable);
        currentTable = null;
        inTable = false;
      }
      continue;
    }

    // Count braces
    if (inTable) {
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;
    }

    // Column definition
    if (inTable && currentTable) {
      const columnMatch = line.match(/^(\w+)\s+(\w+)(?:\s*\[(.*?)\])?$/);
      if (columnMatch) {
        const [, name, type, attributesStr] = columnMatch;
        const attributes = attributesStr ? attributesStr.split(',').map(a => a.trim()) : [];

        const column: Column = {
          name,
          type,
          isPrimaryKey: attributes.some(a => a === 'pk' || a === 'PK'),
          isForeignKey: attributes.some(a => a.startsWith('ref:') || a.startsWith('FK') || a === 'fk'),
          isUnique: attributes.some(a => a === 'unique' || a === 'UNIQUE'),
          isIncrement: attributes.some(a => a === 'increment' || a === 'IDENTITY' || a === 'AUTOINCREMENT'),
          isNullable: attributes.some(a => a === 'null' || a === 'NULL' || a === 'nullable'),
          defaultValue: undefined,
        };

        // Parse default value
        const defaultAttr = attributes.find(a => a.startsWith('default:'));
        if (defaultAttr) {
          column.defaultValue = defaultAttr.split(':')[1];
        }

        // Parse reference
        const refAttr = attributes.find(a => a.startsWith('ref:'));
        if (refAttr) {
          const refParts = refAttr.split(':')[1].trim();
          const relMatch = refParts.match(/^([<>\-0]+)\s*(\w+)\.(\w+)$/);
          if (relMatch) {
            const [, relType, refTable, refColumn] = relMatch;
            column.refTable = refTable;
            column.refColumn = refColumn;
            column.relationshipType = parseRelationshipType(relType);
          } else {
            const simpleRef = refParts.match(/^(\w+)\.(\w+)$/);
            if (simpleRef) {
              column.refTable = simpleRef[1];
              column.refColumn = simpleRef[2];
              column.relationshipType = 'one-to-many';
            }
          }
        }

        currentTable.columns.push(column);
      }
    }
  }

  // Second pass: build relationships
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.isForeignKey && column.refTable && column.refColumn) {
        relationships.push({
          fromTable: table.name,
          fromColumn: column.name,
          toTable: column.refTable,
          toColumn: column.refColumn,
          type: column.relationshipType || 'one-to-many',
        });
      }
    }
  }

  // Auto-position tables
  const tablesPerRow = 3;
  const tableWidth = 200;
  const tableHeight = 100;
  const padding = 50;

  tables.forEach((table, index) => {
    const row = Math.floor(index / tablesPerRow);
    const col = index % tablesPerRow;
    table.position = {
      x: padding + col * (tableWidth + padding),
      y: padding + row * (tableHeight + padding + 50),
    };
  });

  return { tables, relationships, errors };
}

function parseRelationshipType(symbol: string): Column['relationshipType'] {
  if (symbol.includes('-0') && symbol.includes('0-')) return 'one-to-one';
  if (symbol.includes('-0<') || symbol.includes('>0-')) return 'one-to-many';
  if (symbol.includes('>-<') || symbol.includes('<-<')) return 'many-to-many';
  if (symbol.includes('>-') || symbol.includes('-<')) return 'one-to-many';
  if (symbol.includes('<-') || symbol.includes('->')) return 'many-to-one';
  return 'one-to-many';
}

// SQL Generator
function generateSQL(tables: Table[], _relationships: Relationship[], dialect: 'mysql' | 'postgresql' | 'sqlserver'): string {
  const typeMap: Record<string, Record<string, string>> = {
    mysql: {
      int: 'INT',
      varchar: 'VARCHAR(255)',
      text: 'TEXT',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'DATETIME',
      timestamp: 'TIMESTAMP',
      decimal: 'DECIMAL(10,2)',
      float: 'FLOAT',
    },
    postgresql: {
      int: 'INTEGER',
      varchar: 'VARCHAR(255)',
      text: 'TEXT',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'TIMESTAMP',
      timestamp: 'TIMESTAMP',
      decimal: 'DECIMAL(10,2)',
      float: 'REAL',
    },
    sqlserver: {
      int: 'INT',
      varchar: 'VARCHAR(255)',
      text: 'TEXT',
      boolean: 'BIT',
      date: 'DATE',
      datetime: 'DATETIME',
      timestamp: 'DATETIME',
      decimal: 'DECIMAL(10,2)',
      float: 'FLOAT',
    },
  };

  let sql = `-- ${dialect.toUpperCase()} Schema\n-- Generated by QuickDBD Clone\n\n`;

  // Create tables
  for (const table of tables) {
    sql += `CREATE TABLE ${table.name} (\n`;
    
    const columnDefs: string[] = [];
    for (const column of table.columns) {
      let def = `  ${column.name} ${typeMap[dialect][column.type.toLowerCase()] || column.type.toUpperCase()}`;
      
      if (column.isPrimaryKey) {
        if (dialect === 'mysql' || dialect === 'sqlserver') {
          if (column.isIncrement) {
            def += ' AUTO_INCREMENT';
          }
        } else if (dialect === 'postgresql') {
          if (column.isIncrement) {
            def = `  ${column.name} SERIAL`;
          }
        }
      }
      
      if (column.isPrimaryKey) {
        def += ' PRIMARY KEY';
      }
      
      if (column.isUnique && !column.isPrimaryKey) {
        def += ' UNIQUE';
      }
      
      if (!column.isNullable && !column.isPrimaryKey) {
        def += ' NOT NULL';
      }
      
      if (column.defaultValue) {
        def += ` DEFAULT ${column.defaultValue}`;
      }
      
      columnDefs.push(def);
    }

    // Add foreign key constraints
    for (const column of table.columns) {
      if (column.isForeignKey && column.refTable && column.refColumn) {
        columnDefs.push(`  CONSTRAINT fk_${table.name}_${column.name} FOREIGN KEY (${column.name}) REFERENCES ${column.refTable}(${column.refColumn})`);
      }
    }

    sql += columnDefs.join(',\n');
    sql += '\n);\n\n';
  }

  return sql;
}

// Sample schema
const sampleSchema = `users {
  id int [pk, increment]
  username varchar [unique]
  email varchar [unique]
  password varchar
  created_at timestamp
}

posts {
  id int [pk, increment]
  user_id int [ref: > users.id]
  title varchar
  content text
  published boolean
  created_at timestamp
}

comments {
  id int [pk, increment]
  post_id int [ref: > posts.id]
  user_id int [ref: > users.id]
  content text
  created_at timestamp
}

tags {
  id int [pk, increment]
  name varchar [unique]
}

post_tags {
  id int [pk, increment]
  post_id int [ref: > posts.id]
  tag_id int [ref: > tags.id]
}`;

// Main App Component
export default function App() {
  const [schemaText, setSchemaText] = useState(sampleSchema);
  const [parsed, setParsed] = useState<ParsedSchema>({ tables: [], relationships: [], errors: [] });
  const [sqlDialect, setSqlDialect] = useState<'mysql' | 'postgresql' | 'sqlserver'>('mysql');
  const [showSQL, setShowSQL] = useState(false);
  const [draggedTable, setDraggedTable] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const diagramRef = useRef<HTMLDivElement>(null);

  // Parse schema on text change
  useEffect(() => {
    const result = parseSchema(schemaText);
    setParsed(result);
  }, [schemaText]);

  // Handle table drag
  const handleTableMouseDown = (tableName: string, e: React.MouseEvent) => {
    const table = parsed.tables.find(t => t.name === tableName);
    if (table && diagramRef.current) {
      const rect = diagramRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - table.position.x,
        y: e.clientY - rect.top - table.position.y,
      });
      setDraggedTable(tableName);
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggedTable && diagramRef.current) {
      const rect = diagramRef.current.getBoundingClientRect();
      const newX = e.clientX - rect.left - dragOffset.x;
      const newY = e.clientY - rect.top - dragOffset.y;

      setParsed(prev => ({
        ...prev,
        tables: prev.tables.map(t =>
          t.name === draggedTable ? { ...t, position: { x: newX, y: newY } } : t
        ),
      }));
    }
  }, [draggedTable, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setDraggedTable(null);
  }, []);

  useEffect(() => {
    if (draggedTable) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggedTable, handleMouseMove, handleMouseUp]);

  // Generate SQL
  const generatedSQL = generateSQL(parsed.tables, parsed.relationships, sqlDialect);

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    } catch {
      alert('Failed to copy');
    }
  };

  // Download SQL file
  const downloadSQL = () => {
    const blob = new Blob([generatedSQL], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schema.${sqlDialect === 'postgresql' ? 'pgsql' : 'sql'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download PNG (simplified)
  const downloadPNG = () => {
    alert('PNG export would require canvas/SVG conversion. For now, use screenshot!');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
            <h1 className="text-xl font-bold">QuickDBD Clone</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSchemaText(sampleSchema)}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Load Sample
            </button>
            <button
              onClick={() => setSchemaText('')}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Clear
            </button>
            <button
              onClick={() => setShowSQL(!showSQL)}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Export SQL
            </button>
            <button
              onClick={downloadPNG}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Export PNG
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-60px)]">
        {/* Editor Panel */}
        <div className="w-1/2 border-r border-gray-700 flex flex-col">
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">Schema Editor</span>
            <span className="text-xs text-gray-500">
              {parsed.tables.length} tables • {parsed.relationships.length} relationships
            </span>
          </div>
          <textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="flex-1 bg-gray-900 text-gray-100 p-4 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your schema here..."
            spellCheck={false}
          />
          {parsed.errors.length > 0 && (
            <div className="bg-red-900/50 border-t border-red-800 px-4 py-2">
              {parsed.errors.map((error, i) => (
                <div key={i} className="text-red-400 text-sm">{error}</div>
              ))}
            </div>
          )}
        </div>

        {/* Diagram Panel */}
        <div className="w-1/2 flex flex-col">
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">ER Diagram</span>
            <span className="text-xs text-gray-500">Drag tables to reposition</span>
          </div>
          <div
            ref={diagramRef}
            className="flex-1 bg-gray-950 overflow-auto relative"
            style={{
              backgroundImage: 'radial-gradient(circle, #374151 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          >
            {parsed.tables.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  <p>Start typing your schema to see the diagram</p>
                </div>
              </div>
            ) : (
              <svg className="w-full h-full min-w-[800px] min-h-[600px]">
                {/* Draw relationships */}
                {parsed.relationships.map((rel, idx) => {
                  const fromTable = parsed.tables.find(t => t.name === rel.fromTable);
                  const toTable = parsed.tables.find(t => t.name === rel.toTable);
                  if (!fromTable || !toTable) return null;

                  const fromCol = fromTable.columns.find(c => c.name === rel.fromColumn);
                  const toCol = toTable.columns.find(c => c.name === rel.toColumn);

                  const fromX = fromTable.position.x + 200;
                  const fromY = fromTable.position.y + 40 + (fromCol ? fromTable.columns.indexOf(fromCol) * 24 : 0);
                  const toX = toTable.position.x;
                  const toY = toTable.position.y + 40 + (toCol ? toTable.columns.indexOf(toCol) * 24 : 0);

                  return (
                    <g key={idx}>
                      <line
                        x1={fromX}
                        y1={fromY}
                        x2={toX}
                        y2={toY}
                        stroke="#6B7280"
                        strokeWidth={2}
                      />
                      {/* Relationship markers */}
                      {rel.type === 'one-to-many' && (
                        <>
                          <line x1={toX - 15} y1={toY - 8} x2={toX - 15} y2={toY + 8} stroke="#6B7280" strokeWidth={2} />
                          <line x1={toX - 15} y1={toY - 8} x2={toX - 5} y2={toY} stroke="#6B7280" strokeWidth={2} />
                          <line x1={toX - 15} y1={toY + 8} x2={toX - 5} y2={toY} stroke="#6B7280" strokeWidth={2} />
                        </>
                      )}
                      {rel.type === 'one-to-one' && (
                        <>
                          <line x1={toX - 10} y1={toY - 8} x2={toX - 10} y2={toY + 8} stroke="#6B7280" strokeWidth={2} />
                          <line x1={fromX + 10} y1={fromY - 8} x2={fromX + 10} y2={fromY + 8} stroke="#6B7280" strokeWidth={2} />
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Draw tables */}
                {parsed.tables.map((table) => (
                  <g
                    key={table.name}
                    style={{ cursor: draggedTable === table.name ? 'grabbing' : 'grab' }}
                    onMouseDown={(e) => handleTableMouseDown(table.name, e)}
                  >
                    {/* Table box */}
                    <rect
                      x={table.position.x}
                      y={table.position.y}
                      width={200}
                      height={40 + table.columns.length * 24}
                      rx={8}
                      fill="#1F2937"
                      stroke={draggedTable === table.name ? '#3B82F6' : '#4B5563'}
                      strokeWidth={draggedTable === table.name ? 2 : 1}
                    />

                    {/* Table name */}
                    <rect
                      x={table.position.x}
                      y={table.position.y}
                      width={200}
                      height={32}
                      rx={8}
                      fill="#374151"
                      className="cursor-grab"
                    />
                    <rect
                      x={table.position.x}
                      y={table.position.y + 8}
                      width={200}
                      height={1}
                      fill="#4B5563"
                    />
                    <text
                      x={table.position.x + 100}
                      y={table.position.y + 22}
                      textAnchor="middle"
                      className="fill-white font-semibold text-sm"
                    >
                      {table.name}
                    </text>

                    {/* Columns */}
                    {table.columns.map((column, idx) => (
                      <g key={column.name}>
                        <text
                          x={table.position.x + 10}
                          y={table.position.y + 50 + idx * 24}
                          className="fill-gray-300 text-xs font-mono"
                        >
                          {column.isPrimaryKey && (
                            <tspan className="fill-yellow-500 font-bold">PK </tspan>
                          )}
                          {column.isForeignKey && (
                            <tspan className="fill-blue-400 font-bold">FK </tspan>
                          )}
                          {column.name}
                        </text>
                        <text
                          x={table.position.x + 190}
                          y={table.position.y + 50 + idx * 24}
                          textAnchor="end"
                          className="fill-gray-500 text-xs font-mono"
                        >
                          {column.type}
                        </text>
                        {column.isUnique && (
                          <text
                            x={table.position.x + 190}
                            y={table.position.y + 38 + idx * 24}
                            textAnchor="end"
                            className="fill-green-500 text-xs"
                          >
                            unique
                          </text>
                        )}
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* SQL Export Modal */}
      {showSQL && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg w-[800px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Export SQL</h2>
              <button
                onClick={() => setShowSQL(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-4">
              <label className="text-sm text-gray-400">Dialect:</label>
              <select
                value={sqlDialect}
                onChange={(e) => setSqlDialect(e.target.value as typeof sqlDialect)}
                className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="mysql">MySQL</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="sqlserver">SQL Server</option>
              </select>
              <div className="flex-1" />
              <button
                onClick={() => copyToClipboard(generatedSQL)}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </button>
              <button
                onClick={downloadSQL}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>
            </div>
            <pre className="flex-1 p-4 overflow-auto bg-gray-900 font-mono text-sm text-green-400">
              {generatedSQL}
            </pre>
          </div>
        </div>
      )}

      {/* Help Panel */}
      <div className="fixed bottom-4 right-4">
        <details className="bg-gray-800 rounded-lg shadow-lg">
          <summary className="px-4 py-2 cursor-pointer text-sm font-medium hover:bg-gray-700 rounded-lg">
            Syntax Help
          </summary>
          <div className="p-4 text-xs text-gray-300 bg-gray-800 rounded-lg mt-1 w-72">
            <h3 className="font-semibold text-white mb-2">Table Definition</h3>
            <pre className="bg-gray-900 p-2 rounded mb-2">{'tablename {\n  column type [attributes]\n}'}</pre>
            
            <h3 className="font-semibold text-white mb-2 mt-3">Attributes</h3>
            <ul className="space-y-1">
              <li><code className="text-yellow-400">pk</code> - Primary Key</li>
              <li><code className="text-yellow-400">increment</code> - Auto Increment</li>
              <li><code className="text-blue-400">ref: &gt; table.col</code> - Foreign Key (one-to-many)</li>
              <li><code className="text-blue-400">ref: table.col</code> - Foreign Key</li>
              <li><code className="text-green-400">unique</code> - Unique Constraint</li>
              <li><code className="text-gray-400">null</code> - Nullable</li>
              <li><code className="text-purple-400">default:value</code> - Default Value</li>
            </ul>

            <h3 className="font-semibold text-white mb-2 mt-3">Relationships</h3>
            <ul className="space-y-1">
              <li><code className="text-blue-400">ref: &gt; table.col</code> - One to Many</li>
              <li><code className="text-blue-400">ref: &lt; table.col</code> - Many to One</li>
              <li><code className="text-blue-400">ref: &gt;-&lt; table.col</code> - Many to Many</li>
              <li><code className="text-blue-400">ref: -0 table.col</code> - One to Zero/One</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}

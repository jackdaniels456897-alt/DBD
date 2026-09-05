interface Props {
  open: boolean;
  onClose: () => void;
}

const REL_ROWS: [string, string][] = [
  ['-', 'um para um'],
  ['-<', 'um para muitos'],
  ['>-', 'muitos para um'],
  ['>-<', 'muitos para muitos'],
  ['-0', 'um para zero ou um'],
  ['0-', 'zero ou um para um'],
  ['0-0', 'zero ou um para zero ou um'],
  ['-0<', 'um para zero ou muitos'],
  ['>0-', 'zero ou muitos para um'],
];

export default function HelpModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Guia de sintaxe</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">1. Definindo tabelas</h3>
            <pre className="rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">{`Users
-
id int PK
email varchar UNIQUE
created_at datetime`}</pre>
            <p className="mt-2 text-xs text-slate-400">
              Nome da tabela, uma linha de traços e as colunas. Uma linha em branco encerra a
              tabela.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">2. Estilo com chaves</h3>
            <pre className="rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">{`posts {
  id int [pk, increment]
  user_id int [ref: > users.id]
  title varchar [unique]
}`}</pre>
            <p className="mt-2 text-xs text-slate-400">
              Atributos entre colchetes: <code>pk</code>, <code>fk</code>, <code>unique</code>,{' '}
              <code>increment</code>, <code>null</code>, <code>index</code>,{' '}
              <code>default:valor</code>, <code>ref: &gt; Tabela.coluna</code>.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">3. Relacionamentos</h3>
            <table className="w-full text-xs">
              <tbody>
                {REL_ROWS.map(([sym, label]) => (
                  <tr key={sym} className="border-b border-slate-800/70">
                    <td className="py-1 pr-3 font-mono text-pink-400">{sym}</td>
                    <td className="py-1 text-slate-300">{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre className="mt-2 rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-300">{`user_id int FK >- Users.id`}</pre>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">4. Dicas do diagrama</h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>• Arraste as tabelas — a posição é salva automaticamente.</li>
              <li>• Segure Alt ao arrastar para desligar o encaixe na grade.</li>
              <li>• Roda do mouse: zoom. Arrastar o fundo: mover o canvas.</li>
              <li>• Passe o mouse sobre uma tabela para isolar suas conexões.</li>
              <li>• Clique em um problema na lista para pular direto à linha.</li>
              <li>• Exporte em SQL (5 bancos), PNG, SVG ou Markdown.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

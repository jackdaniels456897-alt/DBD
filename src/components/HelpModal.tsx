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
            <h3 className="mb-2 text-sm font-semibold text-sky-400">4. Modo edição visual</h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>
                Segure <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">Ctrl</kbd> (
                Windows/Linux) ou <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">⌘</kbd>{' '}
                (Mac) para ativar. As âncoras e o botão de remover aparecem só nesse modo.
              </li>
              <li>Arraste uma âncora até uma coluna de outra tabela para criar a conexão.</li>
              <li>Comece pela PK/UNIQUE ou pela FK: o editor identifica qual coluna recebe a referência.</li>
              <li>Clique no X vermelho perto do meio da linha para remover a conexão.</li>
              <li>Duplo-clique no fundo cria a tabela direto na posição, já com o nome em edição.</li>
              <li>Clique no título da tabela (em modo edição) para renomear, igual aos grupos.</li>
              <li>Solte a tecla para voltar ao modo normal (arrastar/reposicionar).</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">5. Grupos (áreas)</h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>
                <strong className="text-slate-100">Criar:</strong> segure{' '}
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">Ctrl</kbd>/
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">⌘</kbd> e arraste sobre as
                tabelas que quer agrupar.
              </li>
              <li>
                <strong className="text-slate-100">Entrar/sair (só em modo edição):</strong> com o Ctrl/⌘ pressionado,
                arraste a tabela para dentro/fora da área; ou clique com o botão direito na tabela.
                (Sem Ctrl/⌘ a tabela apenas se move visualmente, mas não sai do grupo).
              </li>
              <li>
                Com um grupo e uma tabela selecionados, a tecla{' '}
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1 text-[10px]">G</kbd> alterna a tabela
                no grupo.
              </li>
              <li>A faixa colorida no canto do cabeçalho da tabela indica o grupo dela.</li>
              <li>Arraste o título ou o interior da área (mesmo sem Ctrl/⌘) para mover o grupo inteiro com as tabelas.</li>
              <li>Duplo-clique no título renomeia a qualquer momento. O ✕ (no modo edição) apaga só a área.</li>
              <li><strong className="text-slate-100">Auto layout</strong> reorganiza mantendo cada grupo agrupado.</li>
              <li>Exportações SQL e Markdown vêm organizadas por grupo (com cabeçalhos).</li>
              <li>Grupos entram no “Salvar Projeto” e são restaurados ao importar.</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-sky-400">6. Dicas gerais</h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>Botão “+ Nova tabela” cria direto no centro do canvas, já com o nome em edição — sem janela.</li>
              <li>Arraste as tabelas para reposicioná-las. Alt desativa o encaixe na grade.</li>
              <li>Roda do mouse: zoom. Arrastar o fundo: mover o canvas.</li>
              <li>Clique em um problema para selecionar a linha correspondente no editor.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

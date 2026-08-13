import { TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Página pública.
 *
 * A tese do produto é uma frase e ela abre a página: você já sabe o que gastou,
 * o que falta saber é o que vai sobrar. Todo o resto da página existe para
 * sustentar essa afirmação — por isso o primeiro bloco depois do título não é
 * uma lista de recursos, e sim as três coisas que a planilha não faz.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-[1120px] items-center gap-8 px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-teal-bright)]">
              <TrendingUp className="size-4 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Cardinal</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {['Produto', 'Projecao', 'Seguranca', 'Planos'].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              >
                {item}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Link
              to="/entrar"
              className="text-[13px] font-medium text-[var(--color-text)] hover:text-[var(--color-teal)]"
            >
              Entrar
            </Link>
            <Link
              to="/criar-conta"
              className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2a2a30]"
            >
              Criar workspace
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1120px] px-6">
        {/* --- Hero -------------------------------------------------------- */}
        <section className="grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="num inline-flex items-center gap-2 rounded-full bg-[var(--color-teal-soft)] px-3 py-1 text-[10px] tracking-[0.12em] text-[var(--color-teal)] uppercase">
              <span className="size-1.5 rounded-full bg-[var(--color-teal)]" />
              Open finance · pt-br
            </span>

            <h1 className="mt-5 text-[clamp(2rem,5vw,3.1rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
              O saldo que voce vai ter, nao o que ja gastou.
            </h1>

            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
              O Cardinal junta cartao de credito, conta corrente, parcelas em curso e planos de
              gasto em uma projecao unica de doze meses. Para familias e pequenos negocios que
              precisam decidir hoje com o mes fechado.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/criar-conta"
                className="rounded-full bg-[var(--color-ink)] px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2a30]"
              >
                Comecar gratis
              </Link>
              <Link
                to="/entrar"
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-3 text-[14px] font-medium transition-colors hover:border-[var(--color-line-strong)]"
              >
                Entrar na minha conta
              </Link>
              <span className="text-[12px] text-[var(--color-muted)]">30 dias sem cartao</span>
            </div>
          </div>

          <HeroCard />
        </section>

        {/* --- Diferenciais ------------------------------------------------ */}
        <section id="produto" className="py-10">
          <h2 className="text-[26px] font-semibold tracking-tight">
            Tres coisas que a planilha nao faz
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
            O modelo entende credito, recorrencia e compromisso futuro.
          </p>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              {
                title: 'Credito no dia certo',
                body: 'A compra parcelada nao sai do caixa na data da compra: entra na fatura e debita no vencimento. A projecao segue essa regra.',
              },
              {
                title: 'Recorrencias reconhecidas',
                body: 'Salario, aluguel, escola e debitos automaticos sao identificados nas contas conectadas e viram base dos proximos meses.',
              },
              {
                title: 'Planos antes de gastar',
                body: 'Monte um plano de gasto, veja quanto cai na fatura e quanto sai da conta, e decida com a sobra do mes na frente.',
              },
            ].map((item, index) => (
              <article key={item.title} className="card p-5">
                {/* A numeração é real: as três descrevem a ordem em que o
                    dinheiro se move — gasto, recorrência, compromisso. */}
                <span className="num text-[11px] text-[var(--color-teal)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-2.5 text-[15px] font-semibold">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* --- Projeção ---------------------------------------------------- */}
        <section id="projecao" className="py-10">
          <div className="card p-6">
            <h2 className="text-[19px] font-semibold tracking-tight">Projecao de 6 meses</h2>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">
              Base: recorrencias ativas e parcelas ja lancadas.
            </p>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {['Mes', 'Entradas', 'Saidas', 'Saldo final'].map((head, index) => (
                      <th
                        key={head}
                        className={`th border-b border-[var(--color-line)] px-3 py-2.5 ${index === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Ago 26', '14.800', '12.356', '36.814'],
                    ['Set 26', '14.800', '9.460', '42.154'],
                    ['Out 26', '14.800', '10.254', '46.700'],
                  ].map(([month, income, expense, balance]) => (
                    <tr key={month}>
                      <td className="border-b border-[var(--color-line)] px-3 py-3 font-medium">
                        {month}
                      </td>
                      <td className="num border-b border-[var(--color-line)] px-3 py-3 text-right text-[var(--color-teal)]">
                        R$ {income}
                      </td>
                      <td className="num border-b border-[var(--color-line)] px-3 py-3 text-right text-[var(--color-text-secondary)]">
                        R$ {expense}
                      </td>
                      <td className="num border-b border-[var(--color-line)] px-3 py-3 text-right font-semibold">
                        R$ {balance}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[var(--color-surface-sunken)]">
                    <td className="th px-3 py-2.5" colSpan={3}>
                      Menor saldo
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold">R$ 36.814</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* --- Segurança --------------------------------------------------- */}
        <section id="seguranca" className="py-10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: 'Somente leitura',
                body: 'A conexao le extratos e faturas. O Cardinal nunca movimenta dinheiro.',
              },
              {
                title: 'Consentimento revogavel',
                body: 'Voce encerra o acesso a qualquer banco a qualquer momento, direto em Contas.',
              },
              {
                title: 'Acesso por papel',
                body: 'Administrador, editor e somente leitura para cada pessoa do workspace.',
              },
              {
                title: 'Sessao com rotacao',
                body: 'Token de acesso curto e renovacao rotativa: token copiado derruba a sessao.',
              },
            ].map((item) => (
              <article key={item.title} className="card p-5">
                <h3 className="text-[14px] font-semibold">{item.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* --- CTA --------------------------------------------------------- */}
        <section id="planos" className="py-10 pb-16">
          <div className="rounded-[var(--radius-card)] bg-[var(--color-ink)] p-8 sm:p-10">
            <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
              <div className="max-w-[30ch]">
                <h2 className="text-[24px] leading-tight font-semibold tracking-tight text-white text-balance">
                  Conecte as contas e veja o mes fechado em cinco minutos.
                </h2>
                <p className="mt-3 text-[13px] leading-relaxed text-white/55">
                  R$ 29 por mes por workspace, com pessoas ilimitadas. Trinta dias gratis, sem
                  cartao.
                </p>
              </div>
              <div className="flex shrink-0 gap-3">
                <Link
                  to="/criar-conta"
                  className="rounded-full bg-[var(--color-teal-bright)] px-6 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  Criar workspace
                </Link>
                <Link
                  to="/entrar"
                  className="rounded-full border border-white/25 px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-white/10"
                >
                  Entrar
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-line)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-7">
          <span className="num text-[10px] tracking-[0.12em] text-[var(--color-faint)] uppercase">
            Cardinal · dados via open finance
          </span>
          <div className="flex gap-5 text-[12px] text-[var(--color-muted)]">
            <a href="#produto" className="hover:text-[var(--color-text)]">
              Produto
            </a>
            <a href="#seguranca" className="hover:text-[var(--color-text)]">
              Seguranca
            </a>
            <Link to="/entrar" className="hover:text-[var(--color-text)]">
              Entrar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Cartão do herói: a promessa do produto em números, não em adjetivos. */
function HeroCard() {
  const bars = [42, 51, 58, 66, 71, 78, 88, 100];
  const realizedUntil = 3;

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-ink)] p-6">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-white/55">Saldo consolidado e projecao</span>
        <span className="num text-[10px] tracking-wider text-white/40 uppercase">ago 2026</span>
      </div>

      <p className="num mt-2.5 text-[34px] leading-none font-semibold text-white">R$ 34.370</p>

      <div className="mt-6 flex h-24 items-end gap-2">
        {bars.map((height, index) => (
          <div
            key={index}
            className="flex-1 rounded-t-[3px]"
            style={{
              height: `${height}%`,
              // Barra cheia é o que aconteceu; contornada é projeção. Mesma
              // cor, porque é a mesma grandeza em dois estados.
              background:
                index <= realizedUntil ? 'var(--color-teal-bright)' : 'rgba(18,160,133,0.18)',
              border:
                index <= realizedUntil ? 'none' : '1px dashed rgba(18,160,133,0.55)',
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between text-[10px]">
        <span className="num text-white/45">realizado</span>
        <span className="num text-[var(--color-teal-bright)]">projetado R$ 61.061</span>
      </div>
    </div>
  );
}

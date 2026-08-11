# Cardinal

Gestão financeira que responde **quanto vai sobrar**, não **quanto já gastei**.

Monorepo com API e front separados. O que sustenta o produto é o motor de projeção:
dado o que já foi lançado, as contas que se repetem e as parcelas em curso, ele
diz quanto haverá em caixa nos próximos meses — respeitando o fato de que uma
compra no cartão só vira saída de dinheiro no vencimento da fatura.

---

## Subir o projeto

```bash
npm run setup     # instala, compila o pacote compartilhado, cria e semeia o banco
npm run dev       # sobe API (:3333) e front (:5173) juntos
```

| Endereço | O que é |
| --- | --- |
| http://localhost:5173 | Aplicação |
| http://localhost:3333/api | API |
| http://localhost:3333/docs | Swagger |

Login de demonstração: `marina@familia.com` / `finflow123`.

> No protótipo, `DEV_AUTO_LOGIN=true` no `apps/api/.env` faz qualquer requisição
> sem token resolver para o usuário semeado — é o que permite abrir o app sem
> tela de entrada. **Desligue antes de qualquer ambiente compartilhado.**

## Estrutura

```
packages/shared/     Motor de domínio. Sem Nest, sem Prisma, sem I/O.
  src/domain/        Ciclo de fatura, parcelamento, recorrência, projeção, métricas,
                     planos de gasto e decisão de notificação
  src/money.ts       Dinheiro em centavos inteiros
  src/date.ts        Datas de negócio como YYYY-MM-DD, livres de fuso

apps/api/            NestJS + Prisma
  src/modules/       Contas, cartões, transações, orçamentos, projeções, cenários…
  src/integrations/  Porta de agregador, adaptador Pluggy, sandbox, parser OFX/CSV
  src/notifications/ Portas de push e e-mail, adaptador Firebase, dispatcher
  prisma/seed.ts     Base de demonstração ancorada no mês corrente

apps/web/            React + Vite + Tailwind
  src/pages/         As 11 telas
  src/components/    Design system e gráficos
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API e front em modo desenvolvimento |
| `npm test` | Os 80 testes do motor de domínio |
| `npm run build` | Build de produção dos três pacotes |
| `npm run db:reset` | Recria e re-semeia o banco |
| `npm run typecheck` | Typecheck de todos os pacotes |

## Decisões que valem conhecer antes de mexer

**Dinheiro é inteiro em centavos, do banco ao componente React.** `0.1 + 0.2`
não é `0.3` em ponto flutuante, e um app financeiro que erra centavo perde a
confiança na primeira conciliação. A conversão para decimal só acontece na
formatação.

**Datas de negócio são strings `YYYY-MM-DD`, não `Date`.** `Date` carrega
horário e fuso, e produz o clássico "a compra do dia 01 virou dia 31 do mês
anterior" quando o servidor roda em UTC e o usuário em São Paulo. Toda a
matemática de ciclo depende do dia civil.

**Compra no crédito não sai do caixa na data da compra.** Ela entra na fatura, e
a fatura debita no vencimento. Sem essa separação todo gasto no cartão é contado
duas vezes. Há teste dedicado; na tela de Projeções a coluna *Fatura cartão* é um
recorte de *Saídas*, nunca um valor somado por cima.

**A fatura é identificada pelo mês do vencimento.** Um cartão que fecha 28/07 e
vence 05/08 gera a "fatura de agosto". É o mês em que o dinheiro sai da conta, e
é como as pessoas falam.

**O motor não conhece banco.** `packages/shared` recebe objetos simples e roda
em Node e no navegador. `SnapshotService`, na API, é o único lugar que traduz
linha de Prisma para tipo de domínio.

**Alertas nunca são persistidos.** São derivados do estado a cada leitura, então
somem no instante em que a causa some. O que fica gravado é a **entrega** —
indexada pela chave determinística do alerta, é ela que responde "já avisei esta
pessoa disto?" sem transformar alerta em linha que envelhece.

**Plano de gasto não é cenário nem lançamento agendado.** São três graus de
certeza: o agendado é fato, o plano é intenção (conta no baseline, marcado), o
cenário é hipótese (só conta se você ligar). Um item de plano com data vencida
para de contar — a transação real assumiu o lugar dele.

## Trocar SQLite por Postgres

1. `apps/api/prisma/schema.prisma`: trocar `provider = "sqlite"` por `"postgresql"`.
2. Atualizar `DATABASE_URL` no `.env`.
3. Opcional: promover os campos `String` marcados com `// enum:` a enums nativos.
4. `npx prisma migrate dev`.

Nenhuma regra de negócio depende do banco.

## Integrações

O adaptador Pluggy está escrito mas nunca rodou contra a API real — sem
`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`, a aplicação sobe com o provedor de
sandbox em vez de falhar. Importação de OFX e CSV funciona sem nenhuma
credencial.

Trocar de agregador significa escrever um adaptador de `AggregatorPort`; nada
fora de `src/integrations/providers/` precisa mudar.

## Estado

Pronto: motor de domínio (80 testes), API (15 módulos), 11 telas, OFX/CSV,
planos de gasto, motor de notificação com push e e-mail.

Falta: desligar o auto-login e pôr tela de entrada; *guard* de papel nas rotas de
escrita (hoje um perfil somente-leitura consegue gravar); validar os adaptadores
Pluggy e Firebase contra as APIs reais; agendador chamando a varredura de
notificação; conciliação entre lançamento digitado e importado; integrar cobrança.

## Notificações

Alertas viram push (Firebase Cloud Messaging) e e-mail. A decisão de *quando*
notificar é lógica pura e testada — `packages/shared/src/domain/notifications.ts`
responde quatro perguntas:

| Situação | Comportamento |
| --- | --- |
| Primeira vez | envia |
| Piorou desde o último aviso | envia de novo |
| Sumiu e voltou | envia de novo |
| Continua igual | relembra no máximo a cada N horas |

Errar qualquer uma produz spam, e spam faz a pessoa desligar o canal — o que
destrói o valor de todos os alertas, inclusive os que importam.

Silêncio noturno **adia**, não descarta: como nada é registrado como entregue, a
varredura seguinte envia normalmente. Não precisa de fila para isso funcionar.

```bash
# calcula as decisões sem enviar nada
curl -X POST "localhost:3333/api/notifications/dispatch?dryRun=true"
```

Sem `FIREBASE_*` e `RESEND_API_KEY`, os dois canais apenas registram em log —
notificação é a funcionalidade em que um engano chega no celular de gente real,
então o padrão seguro é não enviar.

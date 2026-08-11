/**
 * Seed do FinFlow — a familia Ribeiro dos prototipos.
 *
 * ANCORAGEM NO TEMPO: os dados sao gerados a partir do MES CORRENTE, nao de uma
 * data fixa. Um seed cravado em julho/2026 envelhece — em tres meses o app abre
 * mostrando "nenhum lancamento neste mes" e parece quebrado. Aqui o mes corrente
 * sempre tem movimento, o historico tem 13 meses para tras e as parcelas
 * atravessam o presente.
 *
 * REPRODUTIBILIDADE: o ruido dos gastos variaveis usa um PRNG semeado. Rodar o
 * seed duas vezes no mesmo mes produz exatamente a mesma base.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  addDays as addDaysISO,
  addMonthsToYearMonth,
  buildInstallmentPlan,
  clampDayToMonth,
  parseYearMonth,
  resolveCycleForPurchase,
  today as todayIn,
  toYearMonth,
  type ISODate,
  type YearMonth,
} from '@finflow/shared';

const prisma = new PrismaClient();

const TIMEZONE = 'America/Sao_Paulo';
const TODAY = todayIn(TIMEZONE);
const CURRENT_MONTH = toYearMonth(TODAY) as YearMonth;
/** Quantos meses de historico gerar antes do mes corrente. */
const HISTORY_MONTHS = 13;

/** PRNG semeado (mulberry32): mesmo seed, mesma base. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(20260809);

/** Varia um valor base em +/- `spread` (0-1), devolvendo centavos redondos. */
function jitter(baseCents: number, spread = 0.18): number {
  const factor = 1 + (random() * 2 - 1) * spread;
  return Math.round((baseCents * factor) / 100) * 100;
}

function dateIn(month: YearMonth, day: number): ISODate {
  const { year, month: m } = parseYearMonth(month);
  return clampDayToMonth(year, m, day);
}

const reais = (value: number): number => Math.round(value * 100);

async function main(): Promise<void> {
  console.log(`Semeando FinFlow — mes corrente ${CURRENT_MONTH}, hoje ${TODAY}`);

  /* ------------------------------------------------------------------ */
  /*  Organizacao e pessoas                                             */
  /* ------------------------------------------------------------------ */

  await prisma.organization.deleteMany({});
  await prisma.user.deleteMany({});

  const organization = await prisma.organization.create({
    data: {
      name: 'Familia Ribeiro',
      badge: 'FAMILIA',
      currency: 'BRL',
      locale: 'pt-BR',
      timezone: TIMEZONE,
      fiscalMonthStartDay: 1,
      projectionHorizon: 6,
      autoSyncPerDay: 4,
      exportPreference: 'CSV mensal',
      commitmentTarget: 75,
    },
  });
  const organizationId = organization.id;

  const passwordHash = await bcrypt.hash('finflow123', 10);
  const people = [
    { name: 'Marina Ribeiro', email: 'marina@familia.com', initials: 'MR', role: 'OWNER' },
    { name: 'Rafael Ribeiro', email: 'rafael@familia.com', initials: 'RF', role: 'EDITOR' },
    { name: 'Bruno Ribeiro', email: 'bruno@familia.com', initials: 'BR', role: 'VIEWER' },
  ];

  for (const person of people) {
    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        initials: person.initials,
        passwordHash,
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId, role: person.role },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Contas                                                            */
  /* ------------------------------------------------------------------ */

  const itau = await prisma.account.create({
    data: {
      organizationId,
      name: 'Itau · Conta corrente',
      type: 'CHECKING',
      institution: 'Itau',
      accountNumber: '0192',
      currentBalance: reais(18_420),
      openingBalance: reais(18_420),
      color: '#EC7000',
    },
  });

  const nubank = await prisma.account.create({
    data: {
      organizationId,
      name: 'Nubank · Conta',
      type: 'CHECKING',
      institution: 'Nubank',
      accountNumber: '7731',
      currentBalance: reais(6_950),
      openingBalance: reais(6_950),
      color: '#820AD1',
    },
  });

  await prisma.account.create({
    data: {
      organizationId,
      name: 'Inter · Reserva',
      type: 'SAVINGS',
      institution: 'Banco Inter',
      accountNumber: '4408',
      currentBalance: reais(9_000),
      openingBalance: reais(9_000),
      color: '#FF7A00',
    },
  });

  // Investimento fica FORA do saldo consolidado: misturar reserva de longo prazo
  // com caixa do mes inflaria o "saldo atual" e mascararia um aperto real.
  await prisma.account.create({
    data: {
      organizationId,
      name: 'XP · Investimentos',
      type: 'INVESTMENT',
      institution: 'XP',
      accountNumber: '5510',
      currentBalance: reais(62_400),
      openingBalance: reais(58_000),
      color: '#0F8A72',
      includeInTotals: false,
    },
  });

  /* ------------------------------------------------------------------ */
  /*  Cartoes                                                           */
  /* ------------------------------------------------------------------ */

  const visa = await prisma.creditCard.create({
    data: {
      organizationId,
      name: 'Visa Infinite',
      brand: 'VISA',
      lastFour: '4417',
      institution: 'Itau',
      limitAmount: reais(22_000),
      closingDay: 28,
      dueDay: 5, // dueDay < closingDay: vence no mes seguinte ao fechamento.
      paymentAccountId: itau.id,
      color: '#16161A',
    },
  });

  const master = await prisma.creditCard.create({
    data: {
      organizationId,
      name: 'Mastercard Black',
      brand: 'MASTERCARD',
      lastFour: '8802',
      institution: 'Nubank',
      limitAmount: reais(12_000),
      closingDay: 3,
      dueDay: 10, // dueDay > closingDay: vence no MESMO mes. Exercita o outro ramo.
      paymentAccountId: nubank.id,
      color: '#820AD1',
    },
  });

  /* ------------------------------------------------------------------ */
  /*  Categorias                                                        */
  /* ------------------------------------------------------------------ */

  const categorySpec = [
    { key: 'moradia', name: 'Moradia', color: '#0F8A72', icon: 'House', budget: 4_000, base: 3_850 },
    { key: 'mercado', name: 'Mercado', color: '#C0453B', icon: 'ShoppingCart', budget: 1_900, base: 2_140 },
    { key: 'educacao', name: 'Educacao', color: '#3B6FE0', icon: 'GraduationCap', budget: 1_200, base: 1_180 },
    { key: 'transporte', name: 'Transporte', color: '#B8863A', icon: 'Car', budget: 1_000, base: 890 },
    { key: 'saude', name: 'Saude', color: '#B33C86', icon: 'HeartPulse', budget: 900, base: 720 },
    { key: 'lazer', name: 'Lazer', color: '#5F8C1F', icon: 'Ticket', budget: 500, base: 640 },
    { key: 'assinaturas', name: 'Assinaturas', color: '#8257E5', icon: 'Repeat', budget: 350, base: 310 },
  ] as const;

  const categories: Record<string, string> = {};
  let sortOrder = 0;
  for (const spec of categorySpec) {
    const created = await prisma.category.create({
      data: {
        organizationId,
        name: spec.name,
        kind: 'EXPENSE',
        color: spec.color,
        icon: spec.icon,
        sortOrder: sortOrder++,
      },
    });
    categories[spec.key] = created.id;
  }

  const renda = await prisma.category.create({
    data: {
      organizationId,
      name: 'Renda',
      kind: 'INCOME',
      color: '#0F8A72',
      icon: 'TrendingUp',
      sortOrder: sortOrder++,
    },
  });
  categories.renda = renda.id;

  const encargos = await prisma.category.create({
    data: {
      organizationId,
      name: 'Encargos e anuidade',
      kind: 'EXPENSE',
      color: '#8C8A85',
      icon: 'Receipt',
      isFee: true,
      sortOrder: sortOrder++,
    },
  });
  categories.encargos = encargos.id;

  /* ------------------------------------------------------------------ */
  /*  Orcamentos                                                        */
  /* ------------------------------------------------------------------ */

  for (const spec of categorySpec) {
    await prisma.budget.create({
      data: {
        organizationId,
        categoryId: categories[spec.key],
        month: null, // Recorrente: vale para todo mes.
        limitAmount: reais(spec.budget),
        alertThreshold: 80,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Recorrencias                                                      */
  /* ------------------------------------------------------------------ */

  const recurrenceSpec = [
    {
      description: 'Salario Marina',
      amount: reais(9_200),
      type: 'INCOME',
      dayOfMonth: 5,
      categoryId: categories.renda,
      accountId: itau.id,
      paymentMethod: 'TRANSFER',
      label: 'Entrada fixa',
    },
    {
      description: 'Pro-labore Rafael',
      amount: reais(5_600),
      type: 'INCOME',
      dayOfMonth: 15,
      categoryId: categories.renda,
      accountId: itau.id,
      paymentMethod: 'TRANSFER',
      label: 'Entrada variavel',
    },
    {
      description: 'Aluguel · Imobiliaria Sul',
      amount: reais(3_200),
      type: 'EXPENSE',
      dayOfMonth: 10,
      categoryId: categories.moradia,
      accountId: itau.id,
      paymentMethod: 'AUTO_DEBIT',
      label: 'Debito automatico',
    },
    {
      description: 'Escola Bilingue Horizonte · Bruno',
      amount: reais(1_180),
      type: 'EXPENSE',
      dayOfMonth: 8,
      categoryId: categories.educacao,
      accountId: itau.id,
      paymentMethod: 'AUTO_DEBIT',
      label: 'Debito automatico',
    },
    {
      description: 'Plano de saude Unimed',
      amount: reais(890),
      type: 'EXPENSE',
      dayOfMonth: 20,
      categoryId: categories.saude,
      accountId: itau.id,
      paymentMethod: 'AUTO_DEBIT',
      label: 'Debito automatico',
    },
  ] as const;

  const recurrenceIds: Record<string, string> = {};
  for (const spec of recurrenceSpec) {
    const created = await prisma.recurringRule.create({
      data: {
        organizationId,
        description: spec.description,
        amount: spec.amount,
        type: spec.type,
        frequency: 'MONTHLY',
        dayOfMonth: spec.dayOfMonth,
        startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, -HISTORY_MONTHS), 1),
        categoryId: spec.categoryId,
        accountId: spec.accountId,
        paymentMethod: spec.paymentMethod,
        label: spec.label,
      },
    });
    recurrenceIds[spec.description] = created.id;
  }

  // Assinaturas caem no CARTAO, nao na conta: entram na fatura e so viram saida
  // de caixa no vencimento. E o caso que separa este produto de uma planilha.
  const subscriptions = [
    { description: 'Streaming familia', amount: reais(74.9), day: 12 },
    { description: 'Armazenamento em nuvem', amount: reais(34.9), day: 18 },
    { description: 'Academia · plano anual', amount: reais(199.9), day: 22 },
  ];

  for (const subscription of subscriptions) {
    const created = await prisma.recurringRule.create({
      data: {
        organizationId,
        description: subscription.description,
        amount: subscription.amount,
        type: 'EXPENSE',
        frequency: 'MONTHLY',
        dayOfMonth: subscription.day,
        startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, -HISTORY_MONTHS), 1),
        categoryId: categories.assinaturas,
        creditCardId: visa.id,
        paymentMethod: 'CREDIT',
        label: 'Assinatura no cartao',
      },
    });
    recurrenceIds[subscription.description] = created.id;
  }

  /* ------------------------------------------------------------------ */
  /*  Historico: recorrencias materializadas + gasto variavel           */
  /* ------------------------------------------------------------------ */

  const transactions: Parameters<typeof prisma.transaction.createMany>[0]['data'] = [];

  for (let offset = -HISTORY_MONTHS; offset <= 0; offset += 1) {
    const month = addMonthsToYearMonth(CURRENT_MONTH, offset);

    // Recorrencias em conta: viram lancamento real ate a data de hoje.
    for (const spec of recurrenceSpec) {
      const date = dateIn(month, spec.dayOfMonth);
      if (date > TODAY) continue;
      transactions.push({
        organizationId,
        description: spec.description,
        amount: spec.type === 'INCOME' && spec.description.includes('Pro-labore')
          ? jitter(spec.amount, 0.12)
          : spec.amount,
        type: spec.type,
        paymentMethod: spec.paymentMethod,
        date,
        accountId: spec.accountId,
        categoryId: spec.categoryId,
        status: 'POSTED',
        source: 'RECURRING',
        recurringRuleId: recurrenceIds[spec.description],
        externalId: `seed:rec:${spec.description}:${month}`,
      });
    }

    // Assinaturas no cartao.
    for (const subscription of subscriptions) {
      const date = dateIn(month, subscription.day);
      if (date > TODAY) continue;
      transactions.push({
        organizationId,
        description: subscription.description,
        amount: subscription.amount,
        type: 'EXPENSE',
        paymentMethod: 'CREDIT',
        date,
        creditCardId: visa.id,
        categoryId: categories.assinaturas,
        status: 'POSTED',
        source: 'RECURRING',
        recurringRuleId: recurrenceIds[subscription.description],
        externalId: `seed:sub:${subscription.description}:${month}`,
      });
    }

    // Anuidade do cartao, cobrada mensalmente.
    const feeDate = dateIn(month, 26);
    if (feeDate <= TODAY) {
      transactions.push({
        organizationId,
        description: 'Anuidade Visa Infinite',
        amount: reais(96.5),
        type: 'EXPENSE',
        paymentMethod: 'CREDIT',
        date: feeDate,
        creditCardId: visa.id,
        categoryId: categories.encargos,
        status: 'POSTED',
        source: 'MANUAL',
        externalId: `seed:fee:${month}`,
      });
    }

    // Gasto variavel: mercado, transporte e lazer distribuidos ao longo do mes.
    const variableSpec = [
      { key: 'mercado', base: 2_140, count: 6, merchants: ['Supermercado Zaffari', 'Mercado Sao Jose', 'Hortifruti Central'], card: visa.id },
      { key: 'transporte', base: 890, count: 4, merchants: ['Posto Ipiranga', 'Estacionamento Centro', 'Uber'], card: visa.id },
      { key: 'lazer', base: 640, count: 3, merchants: ['Restaurante Cabanha', 'Cinema Iguatemi', 'Bar do Zeca'], card: visa.id },
      { key: 'saude', base: 220, count: 2, merchants: ['Drogaria Sao Paulo', 'Laboratorio Weinmann'], card: master.id },
    ] as const;

    for (const spec of variableSpec) {
      const total = jitter(reais(spec.base), 0.22);
      const perTransaction = Math.round(total / spec.count / 100) * 100;
      for (let i = 0; i < spec.count; i += 1) {
        const day = 3 + Math.floor(random() * 24);
        const date = dateIn(month, day);
        if (date > TODAY) continue;
        transactions.push({
          organizationId,
          description: spec.merchants[i % spec.merchants.length],
          merchant: spec.merchants[i % spec.merchants.length].toUpperCase(),
          amount: jitter(perTransaction, 0.3),
          type: 'EXPENSE',
          paymentMethod: 'CREDIT',
          date,
          creditCardId: spec.card,
          categoryId: categories[spec.key],
          status: 'POSTED',
          source: 'OPEN_FINANCE',
          externalId: `seed:var:${spec.key}:${month}:${i}`,
        });
      }
    }
  }

  await prisma.transaction.createMany({ data: transactions });

  /* ------------------------------------------------------------------ */
  /*  Compras parceladas — os compromissos ja assumidos                 */
  /* ------------------------------------------------------------------ */

  const installmentSpec = [
    { description: 'Notebook Dell', merchant: 'FASTSHOP', total: reais(4_890), count: 10, startOffset: -3, category: 'assinaturas', card: visa },
    { description: 'Passagens Latam', merchant: 'LATAM AIRLINES', total: reais(8_904), count: 12, startOffset: -1, category: 'lazer', card: visa },
    { description: 'Geladeira Brastemp', merchant: 'MAGAZINE LUIZA', total: reais(3_600), count: 8, startOffset: -2, category: 'moradia', card: visa },
    { description: 'Curso de ingles Bruno', merchant: 'CULTURA INGLESA', total: reais(2_760), count: 6, startOffset: -1, category: 'educacao', card: visa },
    { description: 'Pneus do carro', merchant: 'PNEUSTORE', total: reais(2_400), count: 6, startOffset: 0, category: 'transporte', card: visa },
    { description: 'Cadeira ergonomica', merchant: 'HERMAN MILLER BR', total: reais(4_200), count: 10, startOffset: -2, category: 'moradia', card: master },
    { description: 'Oculos de grau Marina', merchant: 'OTICAS CAROL', total: reais(1_800), count: 6, startOffset: -1, category: 'saude', card: master },
    { description: 'Bicicleta Rafael', merchant: 'DECATHLON', total: reais(3_150), count: 9, startOffset: -2, category: 'lazer', card: visa },
    { description: 'Reforma do banheiro', merchant: 'LEROY MERLIN', total: reais(6_000), count: 12, startOffset: -4, category: 'moradia', card: visa },
  ] as const;

  for (const spec of installmentSpec) {
    const purchaseMonth = addMonthsToYearMonth(CURRENT_MONTH, spec.startOffset);
    const purchaseDate = dateIn(purchaseMonth, 6 + Math.floor(random() * 14));

    const plan = buildInstallmentPlan({
      purchaseDate,
      totalAmount: spec.total,
      installments: spec.count,
      card: { closingDay: spec.card.closingDay, dueDay: spec.card.dueDay },
    });

    const groupId = `ig_seed_${spec.description.replace(/\W+/g, '_').toLowerCase()}`;

    await prisma.transaction.createMany({
      data: plan.map((entry) => ({
        organizationId,
        description: `${spec.description} · parcela ${entry.installmentNumber}/${spec.count}`,
        merchant: spec.merchant,
        amount: entry.amount,
        type: 'EXPENSE',
        paymentMethod: 'CREDIT',
        // A parcela 1 fica na data da compra; as demais na data de fechamento do
        // ciclo que as recebe, mantendo `resolveCycleForPurchase` idempotente.
        date: entry.installmentNumber === 1 ? purchaseDate : entry.closingDate,
        creditCardId: spec.card.id,
        categoryId: categories[spec.category],
        status: entry.closingDate <= TODAY ? 'POSTED' : 'SCHEDULED',
        source: 'OPEN_FINANCE',
        installmentNumber: entry.installmentNumber,
        installmentTotal: spec.count,
        installmentGroupId: groupId,
        externalId: `${groupId}:${entry.installmentNumber}`,
      })),
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Cenarios "e se"                                                   */
  /* ------------------------------------------------------------------ */

  const trocaCarro = await prisma.scenario.create({
    data: {
      organizationId,
      name: 'Trocar o carro',
      description: 'Entrada a vista e o restante em 24x, a partir do proximo trimestre.',
      isActive: false,
      color: '#B8863A',
    },
  });
  await prisma.scenarioItem.createMany({
    data: [
      {
        scenarioId: trocaCarro.id,
        kind: 'ONE_OFF',
        description: 'Entrada do carro',
        amount: reais(25_000),
        type: 'EXPENSE',
        startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 3), 10),
        categoryId: categories.transporte,
        accountId: itau.id,
      },
      {
        scenarioId: trocaCarro.id,
        kind: 'RECURRING',
        description: 'Financiamento do carro',
        amount: reais(1_450),
        type: 'EXPENSE',
        startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 4), 10),
        months: 24,
        categoryId: categories.transporte,
        accountId: itau.id,
      },
    ],
  });

  const viagem = await prisma.scenario.create({
    data: {
      organizationId,
      name: 'Ferias em dezembro',
      description: 'Pacote para quatro pessoas parcelado no cartao.',
      isActive: false,
      color: '#5F8C1F',
    },
  });
  await prisma.scenarioItem.create({
    data: {
      scenarioId: viagem.id,
      kind: 'INSTALLMENT',
      description: 'Pacote de viagem',
      amount: reais(12_000),
      type: 'EXPENSE',
      startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 1), 15),
      months: 10,
      categoryId: categories.lazer,
      creditCardId: visa.id,
    },
  });

  await prisma.scenario.create({
    data: {
      organizationId,
      name: 'Aumento do pro-labore',
      description: 'Rafael passa a retirar R$ 7.800 a partir do proximo semestre.',
      isActive: false,
      color: '#0F8A72',
      items: {
        create: [
          {
            kind: 'RECURRING',
            description: 'Aumento de retirada',
            amount: reais(2_200),
            type: 'INCOME',
            startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 6), 15),
            months: 18,
            categoryId: categories.renda,
            accountId: itau.id,
          },
        ],
      },
    },
  });

  /* ------------------------------------------------------------------ */
  /*  Planos de gasto                                                   */
  /* ------------------------------------------------------------------ */

  // Proximo fim de semana a partir de hoje: o plano precisa estar no FUTURO
  // para aparecer nos KPIs — item com data vencida sai da projecao porque a
  // transacao real deveria ter assumido o lugar.
  const daysUntilFriday = (5 - new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 7) % 7 || 7;
  const sexta = addDaysISO(TODAY, daysUntilFriday);
  const domingo = addDaysISO(sexta, 2);

  await prisma.spendingPlan.create({
    data: {
      organizationId,
      name: 'Fim de semana',
      startDate: sexta,
      endDate: domingo,
      status: 'PLANNED',
      color: '#8257E5',
      notes: 'Saida com as criancas.',
      items: {
        create: [
          { description: 'Restaurante Cabanha', amount: reais(300), categoryId: categories.lazer, creditCardId: visa.id, paymentMethod: 'CREDIT', sortOrder: 0 },
          { description: 'Mercado da semana', amount: reais(200), categoryId: categories.mercado, accountId: itau.id, paymentMethod: 'PIX', date: addDaysISO(sexta, 1), sortOrder: 1 },
          { description: 'Cinema e estacionamento', amount: reais(120), categoryId: categories.lazer, creditCardId: visa.id, paymentMethod: 'CREDIT', sortOrder: 2 },
          { description: 'Combustivel', amount: reais(180), categoryId: categories.transporte, creditCardId: visa.id, paymentMethod: 'CREDIT', sortOrder: 3 },
        ],
      },
    },
  });

  await prisma.spendingPlan.create({
    data: {
      organizationId,
      name: 'Material escolar do semestre',
      startDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 1), 8),
      endDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 1), 8),
      status: 'PLANNED',
      color: '#3B6FE0',
      items: {
        create: [
          { description: 'Livros e apostilas', amount: reais(1_450), categoryId: categories.educacao, creditCardId: visa.id, paymentMethod: 'CREDIT', installments: 3, sortOrder: 0 },
          { description: 'Uniforme', amount: reais(480), categoryId: categories.educacao, creditCardId: visa.id, paymentMethod: 'CREDIT', sortOrder: 1 },
        ],
      },
    },
  });

  /* ------------------------------------------------------------------ */
  /*  Regras de categorizacao automatica                                */
  /* ------------------------------------------------------------------ */

  const rules = [
    { name: 'Supermercados', pattern: 'supermercado', category: 'mercado', priority: 10 },
    { name: 'Hortifruti', pattern: 'hortifruti', category: 'mercado', priority: 11 },
    { name: 'Postos de combustivel', pattern: 'posto', category: 'transporte', priority: 20 },
    { name: 'Aplicativos de mobilidade', pattern: 'uber|99pop|cabify', category: 'transporte', priority: 21, matchType: 'REGEX' },
    { name: 'Farmacias', pattern: 'drogaria|farmacia', category: 'saude', priority: 30, matchType: 'REGEX' },
    { name: 'Restaurantes', pattern: 'restaurante', category: 'lazer', priority: 40 },
    { name: 'Streaming', pattern: 'streaming', category: 'assinaturas', priority: 50 },
  ];

  for (const rule of rules) {
    await prisma.categorizationRule.create({
      data: {
        organizationId,
        name: rule.name,
        matchField: 'DESCRIPTION',
        matchType: rule.matchType ?? 'CONTAINS',
        pattern: rule.pattern,
        categoryId: categories[rule.category],
        priority: rule.priority,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Conexoes Open Finance                                             */
  /* ------------------------------------------------------------------ */

  await prisma.bankConnection.createMany({
    data: [
      {
        organizationId,
        provider: 'PLUGGY',
        institutionName: 'Itau Unibanco',
        status: 'CONNECTED',
        externalItemId: 'item_demo_itau',
        lastSyncAt: new Date(),
        // Consentimento perto do fim: exercita o alerta de renovacao.
        consentExpiresAt: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 0), 28),
        accountsLinked: 2,
      },
      {
        organizationId,
        provider: 'PLUGGY',
        institutionName: 'Nubank',
        status: 'CONNECTED',
        externalItemId: 'item_demo_nubank',
        lastSyncAt: new Date(),
        consentExpiresAt: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 9), 14),
        accountsLinked: 2,
      },
      {
        organizationId,
        provider: 'PLUGGY',
        institutionName: 'Banco Inter',
        status: 'NEEDS_ACTION',
        externalItemId: 'item_demo_inter',
        lastSyncAt: new Date(Date.now() - 6 * 86_400_000),
        consentExpiresAt: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 4), 2),
        accountsLinked: 1,
        lastError: 'A instituicao pediu nova autenticacao em dois fatores.',
      },
    ],
  });

  /* ------------------------------------------------------------------ */
  /*  Metas                                                             */
  /* ------------------------------------------------------------------ */

  await prisma.goal.createMany({
    data: [
      {
        organizationId,
        name: 'Reserva de emergencia',
        targetAmount: reais(60_000),
        currentAmount: reais(34_370),
        color: '#0F8A72',
        icon: 'ShieldCheck',
      },
      {
        organizationId,
        name: 'Entrada do carro',
        targetAmount: reais(25_000),
        currentAmount: reais(8_200),
        targetDate: dateIn(addMonthsToYearMonth(CURRENT_MONTH, 3), 10),
        color: '#B8863A',
        icon: 'Car',
      },
    ],
  });

  /* ------------------------------------------------------------------ */
  /*  Materializa as faturas ja fechadas                                */
  /* ------------------------------------------------------------------ */

  for (const card of [visa, master]) {
    const cardTransactions = await prisma.transaction.findMany({
      where: { organizationId, creditCardId: card.id },
      select: { date: true, amount: true },
    });

    const totalsByMonth = new Map<string, number>();
    for (const tx of cardTransactions) {
      const cycle = resolveCycleForPurchase(tx.date, card);
      totalsByMonth.set(
        cycle.referenceMonth,
        (totalsByMonth.get(cycle.referenceMonth) ?? 0) + tx.amount,
      );
    }

    for (const [referenceMonth, total] of totalsByMonth) {
      const cycle = resolveCycleForPurchase(dateIn(referenceMonth, 1), card);
      const closed = cycle.closingDate < TODAY;
      const paid = cycle.dueDate < TODAY;

      await prisma.invoice.create({
        data: {
          organizationId,
          creditCardId: card.id,
          referenceMonth,
          closingDate: cycle.closingDate,
          dueDate: cycle.dueDate,
          status: paid ? 'PAID' : closed ? 'CLOSED' : 'OPEN',
          total,
          paidAmount: paid ? total : 0,
          paidAt: paid ? cycle.dueDate : null,
        },
      });
    }
  }

  /* ------------------------------------------------------------------ */

  const counts = {
    transacoes: await prisma.transaction.count(),
    faturas: await prisma.invoice.count(),
    recorrencias: await prisma.recurringRule.count(),
    orcamentos: await prisma.budget.count(),
    cenarios: await prisma.scenario.count(),
  };

  console.log('Seed concluido:', counts);
  console.log('Login de demonstracao: marina@familia.com / finflow123');
}

main()
  .catch((error) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

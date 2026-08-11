import { formatISODateBR, formatYearMonthShort, type ISODate, type YearMonth } from '@finflow/shared';

/**
 * Formatacao de exibicao.
 *
 * DECISAO: os valores aparecem em REAIS INTEIROS, sem centavos. Em uma tela com
 * oito KPIs, ",00" ocupa espaco em todo numero e nao muda nenhuma decisao —
 * ninguem replaneja o mes por causa de oitenta centavos. Os centavos continuam
 * intactos no dominio e no banco; sao suprimidos apenas na leitura, e voltam a
 * aparecer no detalhe de um lancamento, onde o valor exato importa.
 */

const INTEGER_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const EXACT_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER_PLAIN = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** `R$ 34.370` — o formato padrao de leitura. */
export function money(cents: number): string {
  return INTEGER_BRL.format(Math.round(cents / 100));
}

/** `R$ 3.850,42` — usado no detalhe do lancamento, onde o exato importa. */
export function moneyExact(cents: number): string {
  return EXACT_BRL.format(cents / 100);
}

/** `34.370` — sem simbolo, para colunas que ja tem o R$ no cabecalho. */
export function amount(cents: number): string {
  return INTEGER_PLAIN.format(Math.round(cents / 100));
}

/** `+ 5.600` / `− 412`. Usa o sinal de menos tipografico, nao o hifen. */
export function signedAmount(cents: number, type: string): string {
  const value = INTEGER_PLAIN.format(Math.round(Math.abs(cents) / 100));
  return type === 'INCOME' ? `+ ${value}` : `− ${value}`;
}

/** `+2.840` / `-2.320` — badge de variacao ao lado do KPI. */
export function signedCompact(cents: number): string {
  const sign = cents >= 0 ? '+' : '-';
  return `${sign}${INTEGER_PLAIN.format(Math.round(Math.abs(cents) / 100))}`;
}

/** `8,5k` — rotulo acima das barras, onde nao cabe o numero cheio. */
export function compactAmount(cents: number): string {
  const value = Math.round(cents / 100);
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return INTEGER_PLAIN.format(value);
}

/** `8,3%` */
export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

/** `81%` — sem casas decimais, para percentuais de progresso. */
export function percentWhole(value: number): string {
  return `${Math.round(value)}%`;
}

/** `+8,3%` */
export function signedPercent(value: number, digits = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits).replace('.', ',')}%`;
}

/** `4,1` — meses de reserva, uma casa decimal. */
export function decimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

/** `24/07` — data curta para linhas de tabela dentro do ano corrente. */
export function dayMonth(date: ISODate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export const fullDate = formatISODateBR;
export const monthShort = formatYearMonthShort;

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** `Agosto 2026` — rotulo do seletor de mes no header. */
export function monthLong(ym: YearMonth): string {
  const [year, month] = ym.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** `Ago 26` — primeira coluna da tabela de projecoes. */
export function monthTitle(ym: YearMonth): string {
  const label = formatYearMonthShort(ym);
  const [name, year] = label.split('/');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Administradora',
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Somente leitura',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const CONNECTION_LABELS: Record<string, string> = {
  CONNECTED: 'Conectado',
  SYNCING: 'Sincronizando',
  NEEDS_ACTION: 'Precisa de acao',
  CONSENT_EXPIRED: 'Consentimento vencido',
  ERROR: 'Erro',
  DISCONNECTED: 'Desconectado',
};

export function connectionLabel(status: string): string {
  return CONNECTION_LABELS[status] ?? status;
}

const INVOICE_LINE_LABELS: Record<string, string> = {
  INSTALLMENT: 'Parcelas em curso',
  ONE_OFF: 'Compras a vista',
  SUBSCRIPTION: 'Assinaturas',
  FEE: 'Encargos e anuidade',
};

export function invoiceLineLabel(kind: string): string {
  return INVOICE_LINE_LABELS[kind] ?? kind;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupanca',
  INVESTMENT: 'Investimento',
  CASH: 'Dinheiro',
  WALLET: 'Carteira digital',
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type;
}

/** `ha 2 horas` — ultima sincronizacao. */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;
  const days = Math.round(hours / 24);
  return `ha ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

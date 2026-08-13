import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, ShieldCheck, TriangleAlert, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { fullDate, money } from '../lib/format';
import type { AccountRow } from '../lib/types';
import { Badge, Button } from './ui';

interface DraftEntry {
  key: string;
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  confidence: number;
  duplicate: boolean;
  raw?: string;
  page?: number;
}

interface Preview {
  format: 'OFX' | 'CSV' | 'PDF';
  fileHash: string;
  filename: string | null;
  alreadyImportedAt: string | null;
  detectedBank: string | null;
  entries: DraftEntry[];
  duplicates: number;
  warnings: string[];
  pages?: string[][];
}

/**
 * Importação de extrato, em dois passos.
 *
 * O passo de REVISÃO não é cerimônia: PDF é reconstruído de glifos
 * posicionados, o layout do banco muda sem aviso e um número lido errado vira
 * dinheiro errado no relatório. Quem confirma o que entra é a pessoa, com o
 * texto original à mão para conferir.
 *
 * O arquivo é lido e descartado — nada fica guardado no servidor.
 */
export function ImportStatementDialog({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AccountRow[];
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null);

  const targetAccount = accountId || accounts[0]?.id || '';

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', targetAccount);
      // FormData define o próprio content-type com o boundary; passar o nosso
      // JSON padrão quebraria o parsing no servidor.
      return api.postForm<Preview>('/statements/preview', form);
    },
    onSuccess: (result) => {
      setPreview(result);
      // Duplicado e baixa confiança entram DESMARCADOS: o padrão seguro é não
      // importar o que o sistema não tem certeza.
      setSelected(
        new Set(
          result.entries
            .filter((entry) => !entry.duplicate && entry.confidence >= 0.6)
            .map((entry) => entry.key),
        ),
      );
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel ler o arquivo.'),
  });

  const commit = useMutation({
    mutationFn: () =>
      api.post<{ imported: number; skipped: number }>('/statements/commit', {
        accountId: targetAccount,
        format: preview!.format,
        fileHash: preview!.fileHash,
        filename: preview!.filename ?? 'extrato',
        bank: preview!.detectedBank ?? undefined,
        entries: preview!.entries
          .filter((entry) => selected.has(entry.key))
          .map(({ date, description, amount, type }) => ({ date, description, amount, type })),
      }),
    onSuccess: (result) => {
      setDone(result);
      void queryClient.invalidateQueries();
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel importar.'),
  });

  if (!open) return null;

  function reset() {
    setPreview(null);
    setSelected(new Set());
    setError(null);
    setDone(null);
    setShowRaw(false);
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    reset();
    upload.mutate(file);
  }

  const selectedTotal = (preview?.entries ?? [])
    .filter((entry) => selected.has(entry.key))
    .reduce((sum, entry) => sum + (entry.type === 'INCOME' ? entry.amount : -entry.amount), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 pt-[6vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="importar-extrato"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card flex max-h-[86vh] w-full max-w-3xl flex-col p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="importar-extrato" className="text-[15px] font-semibold">
              Importar extrato
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
              PDF, OFX ou CSV. O arquivo e lido e descartado — nada fica guardado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-4" />
          </button>
        </div>

        {done ? (
          <div className="py-10 text-center">
            <ShieldCheck className="mx-auto size-8 text-[var(--color-teal)]" />
            <p className="num mt-3 text-[19px] font-semibold">{done.imported} lancamentos</p>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">
              importados{done.skipped > 0 && ` · ${done.skipped} ja existiam e foram ignorados`}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={reset}>Importar outro</Button>
              <Button variant="primary" onClick={onClose}>
                Concluir
              </Button>
            </div>
          </div>
        ) : (
          <>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">
                Conta de destino
              </span>
              <select
                value={targetAccount}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-teal)]"
              >
                {accounts
                  .filter((account) => account.isActive)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>

            {!preview && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className={
                  dragging
                    ? 'rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-6 py-12 text-center'
                    : 'rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-line-strong)] px-6 py-12 text-center'
                }
              >
                <Upload className="mx-auto size-6 text-[var(--color-faint)]" />
                <p className="mt-3 text-[13px] font-medium">
                  Arraste o extrato aqui ou{' '}
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="text-[var(--color-teal)] underline"
                  >
                    escolha um arquivo
                  </button>
                </p>
                <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
                  Prefira OFX quando o banco oferecer: tem identificador proprio e nao depende de
                  interpretar layout.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.ofx,.csv,.txt"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {upload.isPending && (
                  <p className="mt-4 text-[12px] text-[var(--color-teal)]">Lendo o arquivo...</p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-[var(--radius-control)] bg-[var(--color-negative-soft)] px-3 py-2.5 text-[13px] text-[var(--color-negative)]">
                {error}
              </p>
            )}

            {preview && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge tone="accent" mono={false}>
                    {preview.format}
                  </Badge>
                  {preview.detectedBank && (
                    <Badge tone="neutral" mono={false}>
                      {preview.detectedBank}
                    </Badge>
                  )}
                  <span className="num text-[var(--color-muted)]">
                    {preview.entries.length} linhas · {preview.duplicates} ja existem
                  </span>
                  {preview.pages && (
                    <button
                      type="button"
                      onClick={() => setShowRaw((v) => !v)}
                      className="ml-auto text-[11px] text-[var(--color-teal)] hover:underline"
                    >
                      {showRaw ? 'ocultar' : 'ver'} texto original
                    </button>
                  )}
                </div>

                {preview.warnings.map((warning) => (
                  <p
                    key={warning}
                    className="mb-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-warning-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-warning)]"
                  >
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {warning}
                  </p>
                ))}

                {showRaw && preview.pages && (
                  <pre className="num mb-3 max-h-40 overflow-auto rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-3 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                    {preview.pages.flat().join('\n')}
                  </pre>
                )}

                <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-control)] border border-[var(--color-line)]">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-[var(--color-surface)]">
                      <tr>
                        <th className="th w-9 px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Selecionar todos"
                            checked={selected.size === preview.entries.length}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? new Set(preview.entries.map((entry) => entry.key))
                                  : new Set(),
                              )
                            }
                            className="size-3.5 accent-[var(--color-teal)]"
                          />
                        </th>
                        <th className="th px-2 py-2 text-left">Data</th>
                        <th className="th px-2 py-2 text-left">Descricao</th>
                        <th className="th px-2 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((entry) => {
                        const checked = selected.has(entry.key);
                        return (
                          <tr
                            key={entry.key}
                            className={
                              entry.duplicate
                                ? 'border-t border-[var(--color-line)] opacity-45'
                                : 'border-t border-[var(--color-line)]'
                            }
                            title={entry.raw}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Incluir ${entry.description}`}
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(entry.key);
                                  else next.delete(entry.key);
                                  setSelected(next);
                                }}
                                className="size-3.5 accent-[var(--color-teal)]"
                              />
                            </td>
                            <td className="num px-2 py-2 whitespace-nowrap text-[var(--color-muted)]">
                              {fullDate(entry.date).slice(0, 5)}
                            </td>
                            <td className="px-2 py-2">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate">{entry.description}</span>
                                {entry.duplicate && (
                                  <Badge tone="neutral" mono={false}>
                                    ja existe
                                  </Badge>
                                )}
                                {!entry.duplicate && entry.confidence < 0.6 && (
                                  <Badge tone="warning" mono={false}>
                                    confira
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td
                              className={
                                entry.type === 'INCOME'
                                  ? 'num px-2 py-2 text-right whitespace-nowrap text-[var(--color-teal)]'
                                  : 'num px-2 py-2 text-right whitespace-nowrap'
                              }
                            >
                              {entry.type === 'INCOME' ? '+' : '−'} {money(entry.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="num text-[12px] text-[var(--color-muted)]">
                    {selected.size} selecionados · efeito no saldo{' '}
                    <strong
                      className={
                        selectedTotal >= 0
                          ? 'text-[var(--color-teal)]'
                          : 'text-[var(--color-negative)]'
                      }
                    >
                      {selectedTotal >= 0 ? '+' : '−'} {money(Math.abs(selectedTotal))}
                    </strong>
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={reset}>Trocar arquivo</Button>
                    <Button
                      variant="primary"
                      onClick={() => commit.mutate()}
                      disabled={selected.size === 0 || commit.isPending}
                    >
                      <FileText className="size-3.5" />
                      {commit.isPending ? 'Importando...' : `Importar ${selected.size}`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

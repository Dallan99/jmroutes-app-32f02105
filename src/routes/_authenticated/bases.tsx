import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  listarBasesComResumo,
  importarEscala,
  existeEscalaDoDia,
  listarDiasOperacionais,
  listarVersoesDoDia,
  listarEscalaPorImportacao,
  listarHistoricoImportacoes,
  excluirImportacao,
  renomearBase,
  type BaseResumo,
  type VersaoImportacao,
  type ImportacaoHistorico,
} from "@/lib/bases.functions";
import { listarOperadoresAudit } from "@/lib/audit.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  Upload,
  Package,
  FileSpreadsheet,
  Eye,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertTriangle,
  User as UserIcon,
  Search,
  FileDown,
  Printer,
  Layers,
  History as HistoryIcon,
  Archive,
  XCircle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { abrirRelatorio } from "@/lib/relatorio";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bases")({
  head: () => ({ meta: [{ title: "Bases JM — JM Transportes" }] }),
  component: BasesPage,
});

type LinhaEscala = {
  facility_id: string | null;
  shipment: string | null;
  nro_rota: string | null;
  ordem: number | null;
  planejada: string | null;
  otimizada: string | null;
  pacotes: number | null;
  paradas: number | null;
  modal: string | null;
  bairro: string | null;
  cidade: string | null;
  rua: string | null;
  numero: string | null;
  cep: string | null;
  referencias: string | null;
  duracao: number | null;
  distancia: number | null;
  order_id_veiculo: string | null;
  ocupacao: number | null;
  spr: number | null;
  parada: string | null;
  cluster: string | null;
  transportadora: string | null;
  giro: string | null;
  vaga: string | null;
  tipo: string | null;
  roteiro: string | null;
  placa: string | null;
  driver: string | null;
  placa_troca: string | null;
  data_operacional: string | null;
};

function BasesPage() {
  const listar = useServerFn(listarBasesComResumo);
  const q = useQuery({ queryKey: ["bases-resumo"], queryFn: () => listar(), refetchInterval: 30_000 });
  const [importBase, setImportBase] = useState<BaseResumo | null>(null);
  const [viewBase, setViewBase] = useState<{ base: BaseResumo; dia?: string | null } | null>(null);

  const bases = q.data ?? [];
  const hoje = new Date().toISOString().slice(0, 10);

  const resumo = useMemo(() => {
    const atualizadas = bases.filter((b) => b.status === "atualizada").length;
    const pendentes = bases.filter((b) => b.status === "aguardando").length;
    const erros = bases.filter((b) => b.status === "erro").length;
    const totalEscalasHoje = bases.reduce((s, b) => s + b.escalas_hoje, 0);
    const totalPacotesHoje = bases.reduce((s, b) => s + b.pacotes_hoje, 0);
    const ultima = bases
      .filter((b) => b.ultima_importacao)
      .sort((a, b) => (b.ultima_importacao ?? "").localeCompare(a.ultima_importacao ?? ""))[0];
    return { atualizadas, pendentes, erros, totalEscalasHoje, totalPacotesHoje, ultima };
  }, [bases]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <header className="space-y-4">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">Bases JM</h1>
            <p className="text-sm text-muted-foreground">
              Painel operacional · Dia{" "}
              <span className="font-mono font-semibold text-foreground/80">
                {new Date(hoje + "T00:00:00").toLocaleDateString("pt-BR")}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {resumo.atualizadas} atualizadas
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Clock className="w-3.5 h-3.5" /> {resumo.pendentes} pendentes
            </span>
            {resumo.erros > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" /> {resumo.erros} com erro
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryStat icon={Layers} label="Escalas do dia" value={resumo.totalEscalasHoje.toLocaleString("pt-BR")} />
          <SummaryStat icon={Package} label="Pacotes do dia" value={resumo.totalPacotesHoje.toLocaleString("pt-BR")} />
          <SummaryStat
            icon={Building2}
            label="Última base atualizada"
            value={resumo.ultima?.nome ?? "—"}
            hint={resumo.ultima?.codigo}
          />
          <SummaryStat
            icon={CalendarDays}
            label="Último horário"
            value={
              resumo.ultima?.ultima_importacao
                ? new Date(resumo.ultima.ultima_importacao).toLocaleTimeString("pt-BR")
                : "—"
            }
            hint={resumo.ultima?.ultimo_usuario ?? undefined}
          />
        </div>
      </header>

      <section className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bases.map((b) => (
            <BaseCard
              key={b.id}
              b={b}
              onImport={() => setImportBase(b)}
              onView={() => setViewBase({ base: b })}
              onCancelHoje={() => setViewBase({ base: b, dia: hoje })}
            />
          ))}
          {q.isLoading && <div className="text-sm text-muted-foreground">Carregando bases…</div>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <HistoryIcon className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-display text-lg font-bold">Histórico de importações</h2>
        </div>
        <HistoricoTab bases={bases} />
      </section>

      {importBase && <ImportDialog base={importBase} onClose={() => setImportBase(null)} />}
      {viewBase && (
        <ViewDialog
          base={viewBase.base}
          initialDia={viewBase.dia ?? null}
          onClose={() => setViewBase(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Small components
// ============================================================
function SummaryStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="font-display text-xl font-bold mt-1 truncate">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </Card>
  );
}

function StatusPill({ status }: { status: BaseResumo["status"] }) {
  if (status === "atualizada") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" /> Atualizada
      </span>
    );
  }
  if (status === "erro") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30">
        <AlertTriangle className="w-3 h-3" /> Erro
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
      <Clock className="w-3 h-3" /> Aguardando
    </span>
  );
}

function BaseCard({
  b,
  onImport,
  onView,
  onCancelHoje,
}: {
  b: BaseResumo;
  onImport: () => void;
  onView: () => void;
  onCancelHoje: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const ultimaHoje =
    b.ultima_importacao && b.ultima_importacao.slice(0, 10) === hoje
      ? b.ultima_importacao
      : null;
  const [renameOpen, setRenameOpen] = useState(false);
  return (
    <Card className="p-5 flex flex-col gap-4 transition hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md brand-gradient flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[var(--brand-yellow)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="font-display font-bold text-lg leading-tight truncate">{b.nome}</div>
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Editar nome da base"
                title="Editar nome da base"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {b.cidade ?? "—"} {b.uf ? `· ${b.uf}` : ""}
            </div>
            <div className="mt-1.5">
              <StatusPill status={b.status} />
            </div>
          </div>
        </div>
        <Badge variant="outline" className="font-mono">{b.codigo}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat icon={FileSpreadsheet} label="Escalas hoje" value={b.escalas_hoje.toLocaleString("pt-BR")} />
        <Stat icon={Package} label="Pacotes hoje" value={b.pacotes_hoje.toLocaleString("pt-BR")} />
        <Stat icon={CalendarDays} label="Dias op." value={b.dias_operacionais.toLocaleString("pt-BR")} />
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5" />
          Importação de hoje:{" "}
          {ultimaHoje ? new Date(ultimaHoje).toLocaleString("pt-BR") : "sem importação hoje"}
        </div>
        {ultimaHoje && b.ultimo_usuario && (
          <div className="flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5" />
            Por: <span className="text-foreground/80">{b.ultimo_usuario}</span>
          </div>
        )}
        {b.dias_operacionais > (b.escalas_hoje > 0 ? 1 : 0) && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <HistoryIcon className="w-3 h-3" />
            Dias anteriores disponíveis na aba <span className="font-semibold text-foreground/80">Histórico</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-auto">
        <Button onClick={onImport} className="flex-1">
          <Upload className="w-4 h-4 mr-1.5" />
          Importar escala
        </Button>
        <Button onClick={onView} variant="outline" size="icon" aria-label="Ver dias operacionais">
          <Eye className="w-4 h-4" />
        </Button>
      </div>
      {ultimaHoje && (
        <Button
          onClick={onCancelHoje}
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
        >
          <XCircle className="w-4 h-4 mr-1.5" /> Cancelar arquivo enviado
        </Button>
      )}
      {renameOpen && (
        <RenameBaseDialog base={b} onClose={() => setRenameOpen(false)} />
      )}
    </Card>
  );
}

function RenameBaseDialog({
  base,
  onClose,
}: {
  base: BaseResumo;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fn = useServerFn(renomearBase);
  const [nome, setNome] = useState(base.nome ?? "");
  const [cidade, setCidade] = useState(base.cidade ?? "");
  const [uf, setUf] = useState(base.uf ?? "");

  const salvar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          baseId: base.id,
          nome: nome.trim(),
          cidade: cidade.trim(),
          uf: uf.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Base atualizada.");
      qc.invalidateQueries({ queryKey: ["bases-resumo"] });
      qc.invalidateQueries({ queryKey: ["bases-historico"] });
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro ao renomear."),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar base</DialogTitle>
          <DialogDescription>
            Código <span className="font-mono">{base.codigo}</span> — atualize
            o nome exibido nesta base (ex.: “Petlove Barueri”).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rb-nome">Nome da base</Label>
            <Input
              id="rb-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Petlove Barueri"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="rb-cidade">Cidade</Label>
              <Input
                id="rb-cidade"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Cidade"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rb-uf">UF</Label>
              <Input
                id="rb-uf"
                value={uf}
                onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="SP"
                maxLength={2}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || nome.trim().length < 2}
          >
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="font-display text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

// ============================================================
// Import parsing
// ============================================================
const HEADER_MAP: Record<string, keyof LinhaEscala> = {
  // Formato JM ESCALA (uma linha por Shipment)
  facilityid: "facility_id",
  "facility id": "facility_id",
  facility_id: "facility_id",
  rota: "planejada",
  "rota otimizada": "otimizada",
  rota_otimizada: "otimizada",
  shipment: "shipment",
  "nro rota": "nro_rota",
  "n rota": "nro_rota",
  nro_rota: "nro_rota",
  ordem: "ordem",
  rua: "rua",
  numero: "numero",
  "numero ": "numero",
  cep: "cep",
  referencias: "referencias",
  "referências": "referencias",
  duracao: "duracao",
  "duração": "duracao",
  distancia: "distancia",
  "distância": "distancia",
  "orderid do veiculo": "order_id_veiculo",
  "orderid do veículo": "order_id_veiculo",
  "order id do veiculo": "order_id_veiculo",
  ocupacao: "ocupacao",
  "ocupação": "ocupacao",
  spr: "spr",
  parada: "parada",
  cluster: "cluster",
  transportadora: "transportadora",
  trasnportadora: "transportadora",
  // Legado
  planejada: "planejada",
  otimizada: "otimizada",
  pacotes: "pacotes",
  paradas: "paradas",
  modal: "modal",
  bairro: "bairro",
  cidade: "cidade",
  giro: "giro",
  vaga: "vaga",
  tipo: "tipo",
  roteiro: "roteiro",
  placa: "placa",
  driver: "driver",
  motorista: "driver",
  "placa troca": "placa_troca",
  placa_troca: "placa_troca",
  data: "data_operacional",
  "data operacional": "data_operacional",
  "data_operacional": "data_operacional",
  "dia": "data_operacional",
  "dia operacional": "data_operacional",
};

function normHeader(h: string) {
  return h.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function toISODate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseFile(file: File): Promise<LinhaEscala[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
        // Regra da operação: usar SOMENTE a aba "Base AM" (1 linha = 1 Shipment).
        // As colunas relevantes são "Rota Otimizada" e "Shipment".
        // Se a aba "Base AM" não existir, cai para a aba que tenha coluna
        // Shipment (evita usar o resumo "Escala AM" por engano).
        // Regra: usar a aba "Base AM" (1 linha = 1 Shipment). Se não existir,
        // escolhe a aba com MAIS linhas contendo shipment preenchido — evita
        // pegar o resumo "Escala AM" (1 linha por rota, sem shipment).
        const isShipmentHeader = (k: string) => {
          const nk = normHeader(k);
          return nk === "shipment" || nk === "shipment id" || nk === "id" || nk === "id do produto";
        };
        const countShipmentRows = (rows: Record<string, unknown>[]) => {
          let n = 0;
          for (const r of rows) {
            for (const [k, v] of Object.entries(r)) {
              if (v !== null && v !== undefined && v !== "" && isShipmentHeader(k)) {
                n++;
                break;
              }
            }
          }
          return n;
        };
        const pickSheet = () => {
          const norm = (s: string) =>
            s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
          type C = { name: string; rows: Record<string, unknown>[]; ships: number };
          const cands: C[] = wb.SheetNames.map((name) => {
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
              wb.Sheets[name],
              { defval: null, raw: true },
            );
            return { name, rows, ships: countShipmentRows(rows) };
          });
          // 1) Prefere aba "base *" com shipments válidos
          const baseSheet = cands
            .filter((c) => {
              const x = norm(c.name);
              return (x === "base am" || x.startsWith("base ") || x === "base") && c.ships > 0;
            })
            .sort((a, b) => b.ships - a.ships)[0];
          if (baseSheet) return baseSheet.rows;
          // 2) Senão, aba com MAIS linhas de shipment
          const best = cands
            .filter((c) => c.ships > 0)
            .sort((a, b) => b.ships - a.ships)[0];
          if (best) return best.rows;
          // 3) Fallback: primeira aba
          return cands[0]?.rows ?? [];
        };
        const raw = pickSheet();
        const linhas: LinhaEscala[] = raw
          .map((r) => {
            const out: LinhaEscala = {
              facility_id: null, shipment: null, nro_rota: null, ordem: null,
              planejada: null, otimizada: null, pacotes: null, paradas: null,
              modal: null, bairro: null, cidade: null,
              rua: null, numero: null, cep: null, referencias: null,
              duracao: null, distancia: null, order_id_veiculo: null,
              ocupacao: null, spr: null, parada: null, cluster: null, transportadora: null,
              giro: null, vaga: null, tipo: null, roteiro: null,
              placa: null, driver: null, placa_troca: null,
              data_operacional: null,
            };
            for (const [k, v] of Object.entries(r)) {
              const key = HEADER_MAP[normHeader(k)];
              if (!key) continue;
              if (v === null || v === undefined || v === "") continue;
              if (key === "pacotes" || key === "paradas" || key === "ordem") {
                const n = Number(v);
                (out as unknown as Record<string, unknown>)[key] =
                  Number.isFinite(n) ? Math.round(n) : null;
              } else if (
                key === "duracao" || key === "distancia" ||
                key === "ocupacao" || key === "spr"
              ) {
                const n = Number(v);
                (out as unknown as Record<string, unknown>)[key] =
                  Number.isFinite(n) ? n : null;
              } else if (key === "data_operacional") {
                out.data_operacional = toISODate(v);
              } else {
                (out as unknown as Record<string, unknown>)[key] =
                  String(v).trim() || null;
              }
            }
            return out;
          })
          .filter((l) => l.shipment || l.planejada || l.otimizada || l.driver || l.placa);
        resolve(linhas);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function validarLinhas(ls: LinhaEscala[]): string[] {
  const errs: string[] = [];
  if (!ls.length) {
    errs.push("Arquivo vazio ou sem linhas válidas.");
    return errs;
  }
  const temShipment = ls.some((l) => l.shipment);
  if (temShipment) {
    const vistos = new Set<string>();
    let dup = 0;
    let semId = 0;
    ls.forEach((l) => {
      if (!l.shipment) {
        semId++;
        return;
      }
      if (vistos.has(l.shipment)) dup++;
      vistos.add(l.shipment);
    });
    if (dup) errs.push(`${dup} Shipment(s) duplicado(s).`);
    if (semId) errs.push(`${semId} linha(s) sem Shipment.`);
  } else {
    const chaves = new Set<string>();
    let dup = 0;
    let semId = 0;
    let pacotesInv = 0;
    ls.forEach((l) => {
      const chave = `${l.planejada ?? ""}|${l.driver ?? ""}|${l.placa ?? ""}`;
      if (chaves.has(chave)) dup++;
      chaves.add(chave);
      if (!l.driver && !l.placa && !l.planejada) semId++;
      if (l.pacotes != null && (!Number.isFinite(l.pacotes) || l.pacotes < 0)) pacotesInv++;
    });
    if (dup) errs.push(`${dup} linha(s) duplicada(s).`);
    if (semId) errs.push(`${semId} linha(s) sem identificação (planejada/driver/placa).`);
    if (pacotesInv) errs.push(`${pacotesInv} linha(s) com pacotes inválidos.`);
  }
  return errs;
}

// ============================================================
// ImportDialog
// ============================================================
function ImportDialog({ base, onClose }: { base: BaseResumo; onClose: () => void }) {
  const qc = useQueryClient();
  const importFn = useServerFn(importarEscala);
  const checkFn = useServerFn(existeEscalaDoDia);
  const [linhas, setLinhas] = useState<LinhaEscala[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [dataRef, setDataRef] = useState(new Date().toISOString().slice(0, 10));
  const [erros, setErros] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState<{ ultimaVersao: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () =>
      importFn({
        data: {
          baseId: base.id,
          dataOperacional: dataRef,
          arquivoNome: fileName || null,
          linhas: (linhas ?? []).map((l) => ({
            facility_id: l.facility_id,
            shipment: l.shipment,
            nro_rota: l.nro_rota,
            ordem: l.ordem,
            planejada: l.planejada,
            otimizada: l.otimizada,
            pacotes: l.pacotes,
            paradas: l.paradas,
            modal: l.modal,
            bairro: l.bairro,
            cidade: l.cidade,
            rua: l.rua,
            numero: l.numero,
            cep: l.cep,
            referencias: l.referencias,
            duracao: l.duracao,
            distancia: l.distancia,
            order_id_veiculo: l.order_id_veiculo,
            ocupacao: l.ocupacao,
            spr: l.spr,
            parada: l.parada,
            cluster: l.cluster,
            transportadora: l.transportadora,
            giro: l.giro,
            vaga: l.vaga,
            tipo: l.tipo,
            roteiro: l.roteiro,
            placa: l.placa,
            driver: l.driver,
            placa_troca: l.placa_troca,
          })),
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.substituiu
          ? `Base substituída. Nova versão v${r.versao} com ${r.inseridos} linhas.`
          : `${r.inseridos} linhas importadas em ${base.codigo} (v${r.versao}).`,
      );
      qc.invalidateQueries({ queryKey: ["bases-resumo"] });
      qc.invalidateQueries({ queryKey: ["dias-operacionais", base.id] });
      qc.invalidateQueries({ queryKey: ["bases-historico"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao importar."),
  });

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setErros([]);
    setLinhas(null);
    try {
      const ls = await parseFile(file);
      const errs = validarLinhas(ls);
      if (errs.length) {
        setErros(errs);
        toast.error("Arquivo com erros. Corrija antes de importar.");
        return;
      }
      // Tenta detectar data operacional das linhas
      const datasNoArquivo = Array.from(
        new Set(ls.map((l) => l.data_operacional).filter(Boolean) as string[]),
      );
      if (datasNoArquivo.length === 1) setDataRef(datasNoArquivo[0]);
      setLinhas(ls);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    }
  };

  const tentarImportar = async () => {
    if (!linhas) return;
    try {
      const r = await checkFn({ data: { baseId: base.id, dataOperacional: dataRef } });
      if (r.existe) {
        setConfirmInfo({ ultimaVersao: r.ultimaVersao });
        setConfirmOpen(true);
        return;
      }
    } catch {
      /* prossegue */
    }
    mutation.mutate();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Importar escala</span>
              <Badge variant="outline" className="font-mono">{base.codigo}</Badge>
              <span className="text-sm font-normal text-muted-foreground">— {base.nome}</span>
            </DialogTitle>
            <DialogDescription>
              Formato JM ESCALA — uma linha por <b>Shipment</b>. Colunas reconhecidas:{" "}
              <b>FacilityID</b>, <b>Rota</b>, <b>Rota Otimizada</b>, <b>MODAL</b>, <b>DRIVER</b>,{" "}
              <b>Nro Rota</b>, <b>Ordem</b>, <b>Shipment</b>, Cidade, Bairro, Rua, Numero, CEP,
              Referências, Duração, Distância, OrderID do veículo, Ocupação, SPR, Parada, Cluster,
              Transportadora. Cabeçalhos legados (Planejada, Placa, Pacotes, etc.) também são aceitos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition"
            >
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <div className="font-medium">
                {fileName || "Arraste o arquivo aqui ou clique para selecionar"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">.xlsx, .xls ou .csv</div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="data-ref">Dia Operacional</Label>
                <Input
                  id="data-ref"
                  type="date"
                  value={dataRef}
                  onChange={(e) => setDataRef(e.target.value)}
                />
              </div>
            </div>

            {erros.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <AlertTriangle className="w-4 h-4" /> Erros encontrados
                </div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {erros.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {linhas && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium mb-2">
                  Pré-visualização — {linhas.length} linhas detectadas
                </div>
                <div className="max-h-48 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Shipment</TableHead>
                        <TableHead>Rota</TableHead>
                        <TableHead>Rota Otim.</TableHead>
                        <TableHead>MODAL</TableHead>
                        <TableHead>Driver</TableHead>
                        <TableHead>Cidade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.slice(0, 50).map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{l.shipment}</TableCell>
                          <TableCell className="font-mono text-xs">{l.planejada}</TableCell>
                          <TableCell className="font-mono text-xs">{l.otimizada}</TableCell>
                          <TableCell className="text-xs">{l.modal}</TableCell>
                          <TableCell className="text-xs">{l.driver}</TableCell>
                          <TableCell className="text-xs">{l.cidade}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button disabled={!linhas || mutation.isPending} onClick={tentarImportar}>
              {mutation.isPending ? "Importando…" : `Importar ${linhas?.length ?? 0} linhas`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe uma importação para este Dia Operacional</AlertDialogTitle>
            <AlertDialogDescription>
              Existe uma versão v{confirmInfo?.ultimaVersao ?? 1} de <b>{base.codigo}</b> em{" "}
              <b>{new Date(dataRef + "T00:00:00").toLocaleDateString("pt-BR")}</b>. Ao confirmar, a
              versão atual será <b>arquivada</b> (não apagada) e uma nova versão v
              {(confirmInfo?.ultimaVersao ?? 1) + 1} será criada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                mutation.mutate();
              }}
            >
              Substituir (nova versão)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================
// ViewDialog — árvore Base → Dias → Versões
// ============================================================
function ViewDialog({
  base,
  onClose,
  initialDia,
}: {
  base: BaseResumo;
  onClose: () => void;
  initialDia?: string | null;
}) {
  const fnDias = useServerFn(listarDiasOperacionais);
  const dq = useQuery({
    queryKey: ["dias-operacionais", base.id],
    queryFn: () => fnDias({ data: { baseId: base.id } }),
  });
  const dias = dq.data ?? [];
  const [selDia, setSelDia] = useState<string | null>(initialDia ?? null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>Base {base.nome}</span>
            <Badge variant="outline" className="font-mono">{base.codigo}</Badge>
            <StatusPill status={base.status} />
          </DialogTitle>
          <DialogDescription>
            {base.cidade ?? "—"} · {dias.length} dia(s) operacional(is) registrados
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-[240px_1fr] gap-4 max-h-[65vh]">
          <aside className="rounded-md border bg-muted/20 p-2 overflow-auto">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">
              Dias Operacionais
            </div>
            {dq.isLoading && <div className="text-sm text-muted-foreground p-2">Carregando…</div>}
            {!dq.isLoading && dias.length === 0 && (
              <div className="text-sm text-muted-foreground p-2">Nenhuma importação.</div>
            )}
            <ul className="space-y-0.5">
              {dias.map((d) => {
                const active = selDia === d.data_operacional;
                return (
                  <li key={d.data_operacional}>
                    <button
                      onClick={() => setSelDia(d.data_operacional)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition ${
                        active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <div className="font-mono">
                        {new Date(d.data_operacional + "T00:00:00").toLocaleDateString("pt-BR")}
                      </div>
                      <div className={`text-[11px] ${active ? "opacity-90" : "text-muted-foreground"}`}>
                        {d.total_linhas} linhas · {d.total_pacotes} pac ·{" "}
                        {d.versoes > 1 ? `${d.versoes} versões` : "1 versão"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="overflow-auto">
            {!selDia ? (
              <div className="h-full min-h-[300px] flex items-center justify-center text-sm text-muted-foreground">
                Selecione um dia para ver as versões e a escala.
              </div>
            ) : (
              <DiaDetalhe base={base} dia={selDia} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiaDetalhe({ base, dia }: { base: BaseResumo; dia: string }) {
  const fnVer = useServerFn(listarVersoesDoDia);
  const qc = useQueryClient();
  const vq = useQuery({
    queryKey: ["versoes-do-dia", base.id, dia],
    queryFn: () => fnVer({ data: { baseId: base.id, dataOperacional: dia } }),
  });
  const versoes = vq.data ?? [];
  const ativaId = versoes.find((v) => v.ativa)?.id ?? versoes[0]?.id ?? null;
  const [selImp, setSelImp] = useState<string | null>(null);
  const impId = selImp ?? ativaId;

  const excluirFn = useServerFn(excluirImportacao);
  const excluir = useMutation({
    mutationFn: (id: string) => excluirFn({ data: { importacaoId: id } }),
    onSuccess: (res) => {
      void res;
      toast.success("Importação excluída.");
      setSelImp(null);
      qc.invalidateQueries({ queryKey: ["versoes-do-dia", base.id, dia] });
      qc.invalidateQueries({ queryKey: ["dias-operacionais", base.id] });
      qc.invalidateQueries({ queryKey: ["bases-resumo"] });
      qc.invalidateQueries({ queryKey: ["bases-historico"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir."),
  });
  const pedirExcluir = (v: VersaoImportacao) => {
    const msg = v.ativa
      ? `Excluir a versão ATIVA v${v.versao}? Todas as ${v.total_linhas} linhas serão apagadas definitivamente.`
      : `Excluir a versão v${v.versao} (arquivada)? As ${v.total_linhas} linhas serão apagadas.`;
    if (confirm(msg)) excluir.mutate(v.id);
  };

  const fnEsc = useServerFn(listarEscalaPorImportacao);
  const eq = useQuery({
    queryKey: ["escala-por-importacao", impId],
    queryFn: () => fnEsc({ data: { importacaoId: impId! } }),
    enabled: !!impId,
  });
  const escala = eq.data ?? [];

  const exportarExcel = () => {
    const rows = escala.map((l) => ({
      Data: l.data_referencia,
      FacilityID: (l as { facility_id?: string | null }).facility_id ?? null,
      Rota: l.planejada,
      "Rota Otimizada": l.otimizada,
      MODAL: l.modal,
      DRIVER: l.driver,
      "Nro Rota": (l as { nro_rota?: string | null }).nro_rota ?? null,
      Ordem: (l as { ordem?: number | null }).ordem ?? null,
      Shipment: (l as { shipment?: string | null }).shipment ?? null,
      Cidade: l.cidade,
      Bairro: l.bairro,
      Rua: (l as { rua?: string | null }).rua ?? null,
      Numero: (l as { numero?: string | null }).numero ?? null,
      CEP: (l as { cep?: string | null }).cep ?? null,
      Transportadora: (l as { transportadora?: string | null }).transportadora ?? null,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, base.codigo);
    XLSX.writeFile(wb, `escala_${base.codigo}_${dia}.xlsx`);
  };

  const exportarPDF = () => {
    type Linha = (typeof escala)[number];
    const pacotes = escala.filter((l) => (l as { shipment?: string | null }).shipment).length
      || escala.reduce((s, l) => s + (l.pacotes ?? 0), 0);
    const motoristas = new Set(escala.map((l) => l.driver).filter(Boolean)).size;
    const rotas = new Set(escala.map((l) => l.planejada).filter(Boolean)).size;
    const opened = abrirRelatorio({
      titulo: `Escala — ${base.nome} (${base.codigo})`,
      subtitulo: `Dia ${new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")} · ${escala.length} linhas`,
      nomeArquivo: `escala_${base.codigo}_${dia}`,
      kpis: [
        { label: "Linhas", value: escala.length },
        { label: "Motoristas", value: motoristas },
        { label: "Rotas", value: rotas },
        { label: "Pacotes", value: pacotes },
      ],
      colunas: [
        { header: "Shipment", value: (r: Linha) => (r as { shipment?: string | null }).shipment ?? "" },
        { header: "Rota", value: (r: Linha) => r.planejada ?? "" },
        { header: "Rota Otimizada", value: (r: Linha) => r.otimizada ?? "" },
        { header: "MODAL", value: (r: Linha) => r.modal ?? "" },
        { header: "Driver", value: (r: Linha) => r.driver ?? "" },
        { header: "Cidade", value: (r: Linha) => r.cidade ?? "" },
      ],
      linhas: escala,
      autoPrint: true,
    });
    if (!opened) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-display font-semibold">
          Dia {new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {versoes.length} versão(ões)
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" onClick={exportarExcel} className="gap-2">
            <FileDown className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportarPDF} className="gap-2">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
          Versões
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {versoes.map((v) => (
            <VersaoRow
              key={v.id}
              v={v}
              selected={impId === v.id}
              onSelect={() => setSelImp(v.id)}
              onExcluir={() => pedirExcluir(v)}
              excluindo={excluir.isPending}
            />
          ))}
        </div>
      </div>

      <div className="rounded-md border overflow-auto max-h-[35vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shipment</TableHead>
              <TableHead>Rota</TableHead>
              <TableHead>Rota Otimizada</TableHead>
              <TableHead>MODAL</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Bairro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escala.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{(r as { shipment?: string | null }).shipment}</TableCell>
                <TableCell className="font-mono text-xs">{r.planejada}</TableCell>
                <TableCell className="font-mono text-xs">{r.otimizada}</TableCell>
                <TableCell className="text-xs">
                  {r.modal && (
                    <span className="inline-block px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-semibold uppercase tracking-wider">
                      {r.modal}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{r.driver}</TableCell>
                <TableCell className="text-xs">{r.cidade}</TableCell>
                <TableCell className="text-xs">{r.bairro}</TableCell>
              </TableRow>
            ))}
            {!eq.isLoading && escala.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma linha nesta versão.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function VersaoRow({
  v,
  selected,
  onSelect,
  onExcluir,
  excluindo,
}: {
  v: VersaoImportacao;
  selected: boolean;
  onSelect: () => void;
  onExcluir?: () => void;
  excluindo?: boolean;
}) {
  return (
    <div
      className={`text-left rounded border p-2 transition ${
        selected ? "border-primary bg-primary/5" : "hover:bg-muted"
      } ${v.ativa ? "" : "opacity-70"}`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <Badge variant={v.ativa ? "default" : "outline"} className="font-mono">
          v{v.versao}
        </Badge>
        {v.ativa ? (
          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            ATIVA
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Archive className="w-3 h-3" /> arquivada
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground font-mono">
          {new Date(v.importado_em).toLocaleString("pt-BR")}
        </span>
      </div>
      <button onClick={onSelect} className="block w-full text-left">
        <div className="text-[11px] text-muted-foreground">
          {v.total_linhas} linhas · {v.total_pacotes} pac · {v.total_motoristas} mot ·{" "}
          {v.total_rotas} rotas
        </div>
        <div className="text-[11px] mt-0.5">
          Por <b>{v.importado_por ?? "—"}</b>
          {v.arquivo_nome && <span className="text-muted-foreground"> · {v.arquivo_nome}</span>}
        </div>
      </button>
      {onExcluir && (
        <div className="mt-1.5 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onExcluir}
            disabled={excluindo}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir arquivo
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Histórico Tab — filtros completos
// ============================================================
function HistoricoTab({ bases }: { bases: BaseResumo[] }) {
  const fn = useServerFn(listarHistoricoImportacoes);
  const opsFn = useServerFn(listarOperadoresAudit);
  const excluirFn = useServerFn(excluirImportacao);
  const qc = useQueryClient();
  const opsQ = useQuery({ queryKey: ["operadores-audit"], queryFn: () => opsFn() });

  const [baseId, setBaseId] = useState<string>("todas");
  const [usuarioId, setUsuarioId] = useState<string>("todos");
  const [status, setStatus] = useState<"todas" | "ativa" | "arquivada">("todas");
  const [dataOp, setDataOp] = useState<string>("");
  const [inicio, setInicio] = useState<string>("");
  const [fim, setFim] = useState<string>("");
  const [busca, setBusca] = useState("");

  const q = useQuery({
    queryKey: ["bases-historico", baseId, usuarioId, status, dataOp, inicio, fim],
    queryFn: () =>
      fn({
        data: {
          baseId: baseId !== "todas" ? baseId : null,
          usuarioId: usuarioId !== "todos" ? usuarioId : null,
          status,
          dataOperacional: dataOp || null,
          periodoInicio: inicio || null,
          periodoFim: fim || null,
        },
      }),
  });
  const rows: ImportacaoHistorico[] = q.data ?? [];
  const excluir = useMutation({
    mutationFn: (id: string) => excluirFn({ data: { importacaoId: id } }),
    onSuccess: (res) => {
      void res;
      toast.success("Importação excluída.");
      qc.invalidateQueries({ queryKey: ["bases-historico"] });
      qc.invalidateQueries({ queryKey: ["bases-resumo"] });
      qc.invalidateQueries({ queryKey: ["dias-operacionais"] });
      qc.invalidateQueries({ queryKey: ["versoes-do-dia"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir."),
  });
  const pedirExcluir = (r: ImportacaoHistorico) => {
    const msg = r.ativa
      ? `Excluir a versão ATIVA v${r.versao} da base ${r.base_codigo} em ${r.data_operacional}? As ${r.linhas} linhas serão apagadas definitivamente.`
      : `Excluir a versão v${r.versao} (arquivada) da base ${r.base_codigo} em ${r.data_operacional}? As ${r.linhas} linhas serão apagadas.`;
    if (confirm(msg)) excluir.mutate(r.importacao_id);
  };
  const filtered = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.base_codigo, r.base_nome, r.importado_por, r.data_operacional]
        .some((v) => (v ?? "").toString().toLowerCase().includes(t)),
    );
  }, [rows, busca]);

  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        Base: r.base_codigo,
        Nome: r.base_nome,
        "Dia Operacional": r.data_operacional,
        Versão: r.versao,
        Status: r.ativa ? "Ativa" : "Arquivada",
        Linhas: r.linhas,
        Motoristas: r.motoristas,
        Rotas: r.rotas,
        Pacotes: r.pacotes,
        "Importado por": r.importado_por,
        "Importado em": r.importado_em,
        "Arquivada em": r.arquivada_em,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Historico");
    XLSX.writeFile(wb, `historico_bases_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="grid gap-2 md:grid-cols-6">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={baseId} onValueChange={setBaseId}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Base" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as bases</SelectItem>
            {bases.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.codigo} — {b.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={usuarioId} onValueChange={setUsuarioId}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Usuário" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os usuários</SelectItem>
            {(opsQ.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.nome ?? u.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os status</SelectItem>
            <SelectItem value="ativa">Somente ativas</SelectItem>
            <SelectItem value="arquivada">Somente arquivadas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportar} className="gap-2 h-9">
          <FileDown className="w-4 h-4" /> Excel
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div>
          <Label className="text-[11px]">Dia operacional</Label>
          <Input type="date" value={dataOp} onChange={(e) => setDataOp(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-[11px]">Período (início)</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-[11px]">Período (fim)</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9" />
        </div>
        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setBaseId("todas");
              setUsuarioId("todos");
              setStatus("todas");
              setDataOp("");
              setInicio("");
              setFim("");
              setBusca("");
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </div>

      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Base</TableHead>
              <TableHead>Dia Operacional</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Linhas</TableHead>
              <TableHead className="text-right">Motoristas</TableHead>
              <TableHead className="text-right">Rotas</TableHead>
              <TableHead className="text-right">Pacotes</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Importada em</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.importacao_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{r.base_codigo}</Badge>
                    <span className="text-xs">{r.base_nome}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {new Date(r.data_operacional + "T00:00:00").toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell><Badge variant={r.ativa ? "default" : "outline"} className="font-mono">v{r.versao}</Badge></TableCell>
                <TableCell>
                  {r.ativa ? (
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">ATIVA</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                      <Archive className="w-3 h-3" /> arquivada
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">{r.linhas}</TableCell>
                <TableCell className="text-right font-mono">{r.motoristas}</TableCell>
                <TableCell className="text-right font-mono">{r.rotas}</TableCell>
                <TableCell className="text-right font-mono">{r.pacotes.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-xs">{r.importado_por ?? "—"}</TableCell>
                <TableCell className="text-xs">{new Date(r.importado_em).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => pedirExcluir(r)}
                    disabled={excluir.isPending}
                    title="Excluir importação"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!q.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma importação encontrada com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}


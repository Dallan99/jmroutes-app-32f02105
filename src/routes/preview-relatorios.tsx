/**
 * ============================================================================
 * ⚠️  ROTA DE HOMOLOGAÇÃO VISUAL — REMOVER ANTES DE QUALQUER MERGE PARA PRODUÇÃO
 * ============================================================================
 *
 * Página temporária e isolada para revisão visual dos relatórios de Triagem e
 * Devoluções usando DADOS FICTÍCIOS EM MEMÓRIA. Não acessa banco, não usa
 * autenticação, não grava nada. Deve existir SOMENTE no playground de
 * homologação (`JMRoutes Dev Playground`).
 *
 * Regras respeitadas:
 *   - Nenhuma configuração de .env / Supabase.
 *   - Nenhuma alteração em migrations, RPCs, RLS, policies.
 *   - Nenhum bypass de autenticação nas rotas reais (esta rota vive fora do
 *     grupo `_authenticated` e não modifica o fluxo real).
 *   - Nenhum dado pessoal: sem CPF, telefone, endereço, destinatário real.
 *   - Reutiliza os helpers reais em `@/lib/relatorio` e o mesmo filtro de
 *     rota exposto em `@/lib/devolucoes.functions`.
 *
 * NÃO importar esta rota em nenhum outro arquivo do código oficial.
 * ============================================================================
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  abrirRelatorio,
  baixarCSV,
  montarLinhasTriagemRota,
  type RelatorioColuna,
  type TriagemLinhaImpressao,
} from "@/lib/relatorio";
import {
  filtrarDevolucoesPorRota,
  normalizarRotaDevolucao,
  MOTIVOS,
  type MotivoDevolucao,
} from "@/lib/devolucoes.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy, Printer, Download, Info } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/preview-relatorios")({
  head: () => ({
    meta: [
      { title: "Preview de Relatórios — HOMOLOGAÇÃO" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PreviewRelatoriosPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Dados sintéticos — cidades e nomes fictícios, sem correspondência com reais
// ─────────────────────────────────────────────────────────────────────────────
const BASE_FICTICIA = { codigo: "HOM-EMBU", nome: "Base Homologação Embu (FICTÍCIA)" };
const DIA_OP = "2099-01-15"; // Dia operacional claramente fictício

const CIDADES_FICT = [
  "Vila Alfa", "Vila Beta", "Bairro Gama", "Setor Delta", "Núcleo Épsilon",
  "Distrito Zeta", "Zona Eta", "Jardim Teta", "Loteamento Iota", "Vila Kappa",
];

const NOMES_FICT = [
  "Operador A", "Operador B", "Operador C", "Operador D",
  "Motorista Um", "Motorista Dois", "Motorista Três",
];

function pad(n: number, len = 6): string {
  return String(n).padStart(len, "0");
}

// ── Triagem: 249 IDs na rota TST_K1_AM1 (10 triados + 239 pendentes) ─────────
const TRIAGEM_ROTA = "TST_K1_AM1";
const TRIAGEM_TRIADOS = Array.from({ length: 10 }, (_, i) => ({
  shipment: `HOMTRI${pad(i + 1)}`,
  cidade: CIDADES_FICT[i % CIDADES_FICT.length],
}));
const TRIAGEM_PENDENTES = Array.from({ length: 239 }, (_, i) => ({
  shipment: `HOMTRI${pad(i + 11)}`,
  cidade: CIDADES_FICT[(i + 3) % CIDADES_FICT.length],
}));

// ── Devoluções: 300 em TST_V1_AM1, 50 em TST_K1_AM1, 5 sem rota, 10 canceladas
type DevolucaoFake = {
  id: string;
  shipment_codigo: string;
  motivo: MotivoDevolucao;
  observacao: string | null;
  rota: string | null;
  motorista: string | null;
  devolvido_em: string;
  cancelado: boolean;
  operador_nome: string | null;
};

const MOTIVO_VALUES: MotivoDevolucao[] = MOTIVOS.map((m) => m.value);

function fakeDevolucao(seq: number, rota: string | null, cancelado: boolean): DevolucaoFake {
  const motivo = MOTIVO_VALUES[seq % MOTIVO_VALUES.length];
  const hora = 8 + (seq % 10);
  const min = (seq * 7) % 60;
  return {
    id: `dev-${pad(seq, 5)}`,
    shipment_codigo: `HOMDEV${pad(seq)}`,
    motivo,
    observacao: seq % 5 === 0 ? "Observação fictícia" : null,
    rota,
    motorista: NOMES_FICT[(seq + 4) % NOMES_FICT.length],
    devolvido_em: `${DIA_OP}T${pad(hora, 2)}:${pad(min, 2)}:00-03:00`,
    cancelado,
    operador_nome: NOMES_FICT[seq % NOMES_FICT.length],
  };
}

const DEVOLUCOES_FAKE: DevolucaoFake[] = (() => {
  const out: DevolucaoFake[] = [];
  let seq = 1;
  // 300 em TST_V1_AM1
  for (let i = 0; i < 300; i++) out.push(fakeDevolucao(seq++, "TST_V1_AM1", false));
  // 50 em TST_K1_AM1
  for (let i = 0; i < 50; i++) out.push(fakeDevolucao(seq++, "TST_K1_AM1", false));
  // 5 sem rota
  for (let i = 0; i < 5; i++) out.push(fakeDevolucao(seq++, null, false));
  // 10 canceladas (distribuídas)
  for (let i = 0; i < 10; i++) {
    const rota = i % 2 === 0 ? "TST_V1_AM1" : "TST_K1_AM1";
    out.push(fakeDevolucao(seq++, rota, true));
  }
  return out;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Colunas (compartilhadas com os relatórios reais em estilo)
// ─────────────────────────────────────────────────────────────────────────────
const colunasTriagem: RelatorioColuna<TriagemLinhaImpressao>[] = [
  { header: "ID", value: (r) => r.shipment },
  { header: "Cidade", value: (r) => r.cidade ?? "—" },
  { header: "Status", value: (r) => (r.status === "triado" ? "Triado" : "Pendente") },
];

function labelMotivo(v: MotivoDevolucao): string {
  return MOTIVOS.find((m) => m.value === v)?.label ?? v;
}

const colunasDevolucoes: RelatorioColuna<DevolucaoFake>[] = [
  { header: "ID", value: (r) => r.shipment_codigo },
  { header: "Rota", value: (r) => r.rota ?? "(sem rota)" },
  { header: "Motivo", value: (r) => labelMotivo(r.motivo) },
  { header: "Motorista", value: (r) => r.motorista ?? "—" },
  { header: "Operador", value: (r) => r.operador_nome ?? "—" },
  {
    header: "Devolvido em",
    value: (r) => new Date(r.devolvido_em).toLocaleString("pt-BR"),
  },
  { header: "Observação", value: (r) => r.observacao ?? "" },
];

// ─────────────────────────────────────────────────────────────────────────────
function PreviewRelatoriosPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <BannerHomologacao />
        <SecaoTriagem />
        <SecaoDevolucoes />
      </div>
    </div>
  );
}

function BannerHomologacao() {
  return (
    <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-destructive">
      <div className="flex items-start gap-3">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-bold uppercase tracking-wide text-base">
            MODO DE HOMOLOGAÇÃO — DADOS FICTÍCIOS — NÃO É PRODUÇÃO
          </div>
          <p className="mt-1">
            Página temporária apenas para revisão visual dos relatórios. Nenhum dado é
            real, nenhum banco é acessado e nenhuma gravação é permitida. Base fictícia
            <b> {BASE_FICTICIA.codigo}</b> · Dia operacional <b>{DIA_OP}</b>. Remova esta
            rota antes de qualquer merge para produção.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── TRIAGEM ──────────────────────────────────────────────────────────────────
function SecaoTriagem() {
  const [modalOpen, setModalOpen] = useState(false);
  const total = TRIAGEM_TRIADOS.length + TRIAGEM_PENDENTES.length;

  const copiar = async () => {
    const linhas = [
      ...TRIAGEM_TRIADOS.map((t) => `${t.shipment}\t${t.cidade}\tTriado`),
      ...TRIAGEM_PENDENTES.map((p) => `${p.shipment}\t${p.cidade}\tPendente`),
    ];
    try {
      await navigator.clipboard.writeText(linhas.join("\n"));
      toast.success(`${linhas.length} IDs copiados`);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const imprimir = () => {
    const linhas = montarLinhasTriagemRota({
      pendentes: TRIAGEM_PENDENTES,
      triados: TRIAGEM_TRIADOS,
    });
    abrirRelatorio({
      titulo: `Triagem — Rota ${TRIAGEM_ROTA}`,
      subtitulo: `${BASE_FICTICIA.nome} · Dia ${DIA_OP} · DADOS FICTÍCIOS`,
      kpis: [
        { label: "Total", value: linhas.length },
        { label: "Triados", value: TRIAGEM_TRIADOS.length },
        { label: "Pendentes", value: TRIAGEM_PENDENTES.length },
      ],
      colunas: colunasTriagem,
      linhas,
      nomeArquivo: `triagem_${TRIAGEM_ROTA}_${DIA_OP}`,
    });
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-bold">Cenário Triagem</h2>
          <p className="text-sm text-muted-foreground">
            Rota <span className="font-mono font-semibold">{TRIAGEM_ROTA}</span> ·{" "}
            {total} IDs ({TRIAGEM_TRIADOS.length} triados, {TRIAGEM_PENDENTES.length} pendentes)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModalOpen(true)}>
            Abrir modal da rota
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">Base {BASE_FICTICIA.codigo}</Badge>
        <Badge variant="secondary">Dia {DIA_OP}</Badge>
        <Badge variant="outline">100% dos IDs no relatório</Badge>
      </div>

      <TriagemModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCopiar={copiar}
        onImprimir={imprimir}
      />
    </Card>
  );
}

function TriagemModal({
  open,
  onOpenChange,
  onCopiar,
  onImprimir,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCopiar: () => void;
  onImprimir: () => void;
}) {
  const total = TRIAGEM_TRIADOS.length + TRIAGEM_PENDENTES.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Rota <span className="font-mono">{TRIAGEM_ROTA}</span>
            <Badge variant="outline">{total} IDs</Badge>
          </DialogTitle>
          <DialogDescription>
            {TRIAGEM_TRIADOS.length} triados · {TRIAGEM_PENDENTES.length} pendentes ·
            dados fictícios
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onCopiar}>
            <Copy className="h-4 w-4 mr-1" /> Copiar
          </Button>
          <Button size="sm" onClick={onImprimir}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir rota
          </Button>
        </div>
        <div className="overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Cidade</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {TRIAGEM_TRIADOS.map((t) => (
                <tr key={t.shipment} className="border-t">
                  <td className="p-2 font-mono">{t.shipment}</td>
                  <td className="p-2">{t.cidade}</td>
                  <td className="p-2"><Badge variant="secondary">Triado</Badge></td>
                </tr>
              ))}
              {TRIAGEM_PENDENTES.map((p) => (
                <tr key={p.shipment} className="border-t">
                  <td className="p-2 font-mono">{p.shipment}</td>
                  <td className="p-2">{p.cidade}</td>
                  <td className="p-2"><Badge variant="outline">Pendente</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={onCopiar}>
            <Copy className="h-4 w-4 mr-1" /> Copiar
          </Button>
          <Button size="sm" onClick={onImprimir}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir rota
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── DEVOLUÇÕES ───────────────────────────────────────────────────────────────
function SecaoDevolucoes() {
  const [rotaDialog, setRotaDialog] = useState(false);
  const [busca, setBusca] = useState("");

  const ativas = useMemo(
    () => DEVOLUCOES_FAKE.filter((d) => !d.cancelado),
    [],
  );

  const gruposPorRota = useMemo(() => {
    const map = new Map<string, DevolucaoFake[]>();
    for (const d of ativas) {
      const rota = normalizarRotaDevolucao(d.rota) ?? "(sem rota)";
      const arr = map.get(rota) ?? [];
      arr.push(d);
      map.set(rota, arr);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "pt-BR", { numeric: true }),
    );
  }, [ativas]);

  const kpis = [
    { label: "Total (ativas)", value: ativas.length },
    { label: "Canceladas", value: DEVOLUCOES_FAKE.length - ativas.length },
    { label: "Rotas", value: gruposPorRota.length },
  ];

  const imprimirGeral = () => {
    abrirRelatorio({
      titulo: "Devoluções — Relatório geral",
      subtitulo: `${BASE_FICTICIA.nome} · Dia ${DIA_OP} · DADOS FICTÍCIOS`,
      kpis,
      colunas: colunasDevolucoes,
      linhas: ativas,
      nomeArquivo: `devolucoes_geral_${DIA_OP}`,
    });
  };

  const imprimirAgrupado = () => {
    abrirRelatorio({
      titulo: "Devoluções — Agrupado por rota",
      subtitulo: `${BASE_FICTICIA.nome} · Dia ${DIA_OP} · DADOS FICTÍCIOS`,
      kpis,
      colunas: colunasDevolucoes,
      linhas: ativas,
      agruparPor: (r) => r.rota,
      nomeArquivo: `devolucoes_agrupado_${DIA_OP}`,
    });
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg md:text-xl font-bold">Cenário Devoluções</h2>
        <p className="text-sm text-muted-foreground">
          {DEVOLUCOES_FAKE.length} registros no total · {ativas.length} ativas ·{" "}
          {DEVOLUCOES_FAKE.length - ativas.length} canceladas
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {gruposPorRota.map(([rota, linhas]) => (
          <div key={rota} className="border rounded-md p-2">
            <div className="font-mono font-semibold">{rota}</div>
            <div className="text-muted-foreground">{linhas.length} devoluções</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={imprimirGeral}>
          <Printer className="h-4 w-4 mr-1" /> Relatório geral
        </Button>
        <Button variant="outline" onClick={imprimirAgrupado}>
          <Printer className="h-4 w-4 mr-1" /> Agrupado por rota
        </Button>
        <Button onClick={() => setRotaDialog(true)}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir uma rota
        </Button>
      </div>

      <ImprimirRotaDialog
        open={rotaDialog}
        onOpenChange={setRotaDialog}
        busca={busca}
        setBusca={setBusca}
        grupos={gruposPorRota}
        devolucoes={DEVOLUCOES_FAKE}
      />
    </Card>
  );
}

function ImprimirRotaDialog({
  open,
  onOpenChange,
  busca,
  setBusca,
  grupos,
  devolucoes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busca: string;
  setBusca: (v: string) => void;
  grupos: Array<[string, DevolucaoFake[]]>;
  devolucoes: DevolucaoFake[];
}) {
  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    if (!q) return grupos;
    return grupos.filter(([rota]) => rota.includes(q));
  }, [grupos, busca]);

  const imprimirRota = (rota: string) => {
    const alvo = rota === "(sem rota)" ? null : rota;
    const linhas = filtrarDevolucoesPorRota(devolucoes, alvo);
    abrirRelatorio({
      titulo: `Devoluções — Rota ${rota}`,
      subtitulo: `${BASE_FICTICIA.nome} · Dia ${DIA_OP} · DADOS FICTÍCIOS`,
      kpis: [{ label: "Devoluções", value: linhas.length }],
      colunas: colunasDevolucoes,
      linhas,
      nomeArquivo: `devolucoes_${rota.replace(/\W+/g, "_")}_${DIA_OP}`,
    });
  };

  const baixarCsvRota = (rota: string) => {
    const alvo = rota === "(sem rota)" ? null : rota;
    const linhas = filtrarDevolucoesPorRota(devolucoes, alvo);
    baixarCSV({
      titulo: `Devoluções — Rota ${rota}`,
      colunas: colunasDevolucoes,
      linhas,
      nomeArquivo: `devolucoes_${rota.replace(/\W+/g, "_")}_${DIA_OP}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Imprimir uma rota</DialogTitle>
          <DialogDescription>
            Escolha a rota para imprimir ou exportar em CSV. Dados fictícios.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Buscar rota…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="max-h-[50vh] overflow-auto border rounded-md divide-y">
          {filtrados.map(([rota, linhas]) => (
            <div key={rota} className="flex items-center justify-between gap-2 p-2">
              <div>
                <div className="font-mono font-semibold text-sm">{rota}</div>
                <div className="text-xs text-muted-foreground">{linhas.length} devoluções</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => baixarCsvRota(rota)}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button size="sm" onClick={() => imprimirRota(rota)}>
                  <Printer className="h-4 w-4 mr-1" /> PDF
                </Button>
              </div>
            </div>
          ))}
          {filtrados.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">
              Nenhuma rota encontrada.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

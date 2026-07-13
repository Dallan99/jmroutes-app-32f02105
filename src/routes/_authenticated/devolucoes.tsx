import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  registrarDevolucao,
  listarDevolucoes,
  cancelarDevolucao,
  MOTIVOS,
  type MotivoDevolucao,
  type RegistrarDevolucaoResult,
} from "@/lib/devolucoes.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import { toast } from "sonner";
import { RotateCcw, ScanLine, AlertTriangle, XCircle, CheckCircle2, Trash2, Printer, Download } from "lucide-react";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/devolucoes")({
  head: () => ({ meta: [{ title: "Devoluções — JM Transportes" }] }),
  component: DevolucoesGuard,
});

function DevolucoesGuard() {
  return (
    <RequireBaseOperacional
      titulo="Devoluções"
      descricao="Selecione a Base e o Dia Operacional. Cada devolução ficará vinculada a esta seleção."
    >
      <DevolucoesComHeader />
    </RequireBaseOperacional>
  );
}

function DevolucoesComHeader() {
  const { base, diaOperacional } = useBaseOperacional();
  return (
    <>
      <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-display font-semibold text-sm">Devoluções</span>
        <span className="text-muted-foreground">·</span>
        <span>Base: <b>{base?.nome ?? "—"}</b>{base?.codigo && <span className="font-mono text-muted-foreground"> ({base.codigo})</span>}</span>
        <span className="text-muted-foreground">·</span>
        <span>Dia Operacional: <b className="font-mono">{diaOperacional ? new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</b></span>
      </div>
      <DevolucoesPage />
    </>
  );
}

function DevolucoesPage() {
  const qc = useQueryClient();
  const { base, diaOperacional } = useBaseOperacional();
  const registrarFn = useServerFn(registrarDevolucao);
  const listarFn = useServerFn(listarDevolucoes);
  const cancelarFn = useServerFn(cancelarDevolucao);
  const inputRef = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<MotivoDevolucao>("cliente_ausente");
  const [obs, setObs] = useState("");
  const [rotaSessao, setRotaSessao] = useState("");
  const [rotaInput, setRotaInput] = useState("");
  const [ultimo, setUltimo] = useState<RegistrarDevolucaoResult | null>(null);
  const [diaHistorico, setDiaHistorico] = useState<string>(diaOperacional ?? "");
  const diaAtivo = diaHistorico || diaOperacional;
  const consultandoHoje = diaAtivo === diaOperacional;

  const lista = useQuery({
    queryKey: ["devolucoes", base?.id, diaAtivo],
    queryFn: () => listarFn({ data: { baseId: base!.id, diaOperacional: diaAtivo! } }),
    enabled: !!base && !!diaAtivo,
    refetchInterval: consultandoHoje ? 6000 : false,
  });

  const registrar = useMutation({
    mutationFn: () =>
      registrarFn({
        data: {
          baseId: base!.id,
          diaOperacional: diaOperacional!,
          codigo: pendente!,
          motivo,
          observacao: obs.trim() ? obs.trim() : undefined,
          rota: rotaInput.trim() ? rotaInput.trim() : undefined,
        },
      }),
    onSuccess: (res) => {
      setUltimo(res);
      if (res.resultado === "ok") {
        beepOk();
        toast.success(res.mensagem);
        qc.invalidateQueries({ queryKey: ["devolucoes", base?.id, diaOperacional] });
        qc.invalidateQueries({ queryKey: ["devolucoes", base?.id, diaAtivo] });
      } else if (res.resultado === "duplicado") {
        beepWarn();
        toast.warning(res.mensagem);
      } else {
        beepError();
        toast.error(res.mensagem);
      }
      setPendente(null);
      setObs("");
      setRotaInput("");
      setMotivo("cliente_ausente");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (err) => {
      beepError();
      toast.error(err instanceof Error ? err.message : "Erro ao registrar devolução.");
    },
  });

  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Devolução cancelada.");
      qc.invalidateQueries({ queryKey: ["devolucoes", base?.id, diaAtivo] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro"),
  });

  const abrirModal = useCallback((cod: string) => {
    const c = cod.trim();
    if (c.length < 1) return;
    setPendente(c);
    setRotaInput(rotaSessao);
    setCodigo("");
  }, [rotaSessao]);

  const totalHoje = lista.data?.filter((d) => !d.cancelado).length ?? 0;
  const motivosCount = useMemo(() => {
    const map = new Map<MotivoDevolucao, number>();
    (lista.data ?? []).filter((d) => !d.cancelado).forEach((d) => {
      map.set(d.motivo, (map.get(d.motivo) ?? 0) + 1);
    });
    return map;
  }, [lista.data]);

  const relatorioConfig = () => {
    const linhas = (lista.data ?? []).filter((d) => !d.cancelado);
    return {
      titulo: "Devoluções do dia",
      subtitulo: `${base?.nome ?? ""} · ${diaAtivo ? new Date(diaAtivo + "T00:00:00").toLocaleDateString("pt-BR") : ""}`,
      nomeArquivo: `devolucoes_${base?.codigo ?? "base"}_${diaAtivo ?? ""}`,
      kpis: [
        { label: "Total devolvido", value: linhas.length },
        ...MOTIVOS.map((m) => ({
          label: m.label,
          value: linhas.filter((l) => l.motivo === m.value).length,
        })).filter((k) => Number(k.value) > 0),
      ],
      colunas: [
        { header: "Hora", value: (d: (typeof linhas)[number]) => new Date(d.devolvido_em).toLocaleTimeString("pt-BR") },
        { header: "ID do produto", value: (d: (typeof linhas)[number]) => d.shipment_codigo },
        { header: "Rota", value: (d: (typeof linhas)[number]) => d.rota ?? "" },
        { header: "Motorista", value: (d: (typeof linhas)[number]) => d.motorista ?? "" },
        { header: "Motivo", value: (d: (typeof linhas)[number]) => MOTIVOS.find((m) => m.value === d.motivo)?.label ?? d.motivo },
        { header: "Operador", value: (d: (typeof linhas)[number]) => d.operador_nome ?? "" },
        { header: "Observação", value: (d: (typeof linhas)[number]) => d.observacao ?? "" },
      ],
      linhas,
    };
  };
  const imprimir = () => {
    const ok = abrirRelatorio({ ...relatorioConfig(), autoPrint: true });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorioConfig());

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <RotateCcw className="w-5 h-5 text-[var(--brand-yellow)]" />
          <h1 className="font-display text-xl font-bold">Devolução de Insucessos</h1>
          <Badge variant="secondary" className="ml-auto">
            {totalHoje} devolvidos hoje
          </Badge>
        </div>

        <div className="mb-4 rounded-md border bg-muted/30 p-3 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="rota-sessao" className="text-xs">Rota atual (aplicada a todas as devoluções abaixo)</Label>
            <Input
              id="rota-sessao"
              value={rotaSessao}
              onChange={(e) => setRotaSessao(e.target.value.toUpperCase())}
              placeholder="Ex.: VN6_AM1"
              className="font-mono h-10 mt-1"
            />
          </div>
          {rotaSessao && (
            <Button variant="ghost" size="sm" onClick={() => setRotaSessao("")}>
              Limpar rota
            </Button>
          )}
          <div className="text-[11px] text-muted-foreground max-w-xs">
            Bipagens abaixo virão com esta rota preenchida automaticamente. Você ainda pode alterar no momento da confirmação.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={codigo}
              placeholder="Bipe o ID do produto devolvido…"
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  abrirModal(codigo);
                }
              }}
              className="pl-9 h-12 text-lg font-mono"
            />
          </div>
          <Button size="lg" onClick={() => abrirModal(codigo)} disabled={codigo.trim().length < 1}>
            Registrar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="lg" variant="outline"><Download className="w-4 h-4 mr-2" />Salvar/Imprimir</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={imprimir}>
                <Printer className="w-4 h-4 mr-2" /> Imprimir / Salvar PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={baixarCsv}>
                <Download className="w-4 h-4 mr-2" /> Baixar CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {ultimo && ultimo.resultado !== "ok" && (
          <div className={`mt-3 flex items-center gap-2 text-sm ${
            ultimo.resultado === "duplicado" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"
          }`}>
            {ultimo.resultado === "duplicado" ? <AlertTriangle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span>{ultimo.mensagem}</span>
          </div>
        )}

        {motivosCount.size > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {MOTIVOS.map((m) => {
              const c = motivosCount.get(m.value) ?? 0;
              if (c === 0) return null;
              return (
                <Badge key={m.value} variant="outline" className="font-normal">
                  {m.label}: <b className="ml-1">{c}</b>
                </Badge>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold text-sm">
              {consultandoHoje ? "Devoluções do dia" : "Histórico de devoluções"}
            </h2>
            <Input
              type="date"
              value={diaAtivo ?? ""}
              onChange={(e) => setDiaHistorico(e.target.value || (diaOperacional ?? ""))}
              className="h-8 w-[160px]"
            />
            {!consultandoHoje && (
              <Button variant="ghost" size="sm" onClick={() => setDiaHistorico(diaOperacional ?? "")}>
                Voltar para hoje
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {lista.data?.length ?? 0} registros
          </span>
        </div>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Horário</TableHead>
                <TableHead>ID do produto</TableHead>
                <TableHead>Rota</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead>Obs.</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>
              )}
              {!lista.isLoading && (lista.data?.length ?? 0) === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma devolução registrada hoje.</TableCell></TableRow>
              )}
              {(lista.data ?? []).map((d) => {
                const motivoLabel = MOTIVOS.find((m) => m.value === d.motivo)?.label ?? d.motivo;
                return (
                  <TableRow key={d.id} className={d.cancelado ? "opacity-50 line-through" : ""}>
                    <TableCell className="font-mono text-xs">
                      {new Date(d.devolvido_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="font-mono">{d.shipment_codigo}</TableCell>
                    <TableCell className="font-mono text-xs">{d.rota ?? "—"}</TableCell>
                    <TableCell className="text-xs">{d.motorista ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{motivoLabel}</Badge></TableCell>
                    <TableCell className="text-xs">{d.operador_nome ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate" title={d.observacao ?? ""}>{d.observacao ?? "—"}</TableCell>
                    <TableCell>
                      {!d.cancelado && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => cancelar.mutate(d.id)}
                          title="Cancelar devolução"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!pendente} onOpenChange={(o) => !o && setPendente(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar devolução</DialogTitle>
            <DialogDescription>
              ID do produto <b className="font-mono">{pendente}</b> — informe o motivo da devolução.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rota-dev">Rota (opcional)</Label>
              <Input
                id="rota-dev"
                value={rotaInput}
                onChange={(e) => setRotaInput(e.target.value.toUpperCase())}
                placeholder="Ex.: VN6_AM1"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <RadioGroup value={motivo} onValueChange={(v) => setMotivo(v as MotivoDevolucao)} className="grid grid-cols-1 gap-1.5">
                {MOTIVOS.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 border rounded-md p-2 cursor-pointer hover:bg-muted/30">
                    <RadioGroupItem value={m.value} />
                    <span className="text-sm">{m.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs">Observação (opcional)</Label>
              <Textarea id="obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalhes adicionais…" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendente(null)}>Cancelar</Button>
            <Button onClick={() => registrar.mutate()} disabled={registrar.isPending}>
              {registrar.isPending ? "Salvando…" : (<><CheckCircle2 className="w-4 h-4 mr-1" /> Confirmar devolução</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

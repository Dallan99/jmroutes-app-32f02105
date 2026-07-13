import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listarAudit, listarOperadoresAudit, type AuditRow } from "@/lib/audit.functions";
import { abrirRelatorio } from "@/lib/relatorio";
import { Filter, RefreshCw, FileDown, Printer, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({ meta: [{ title: "Auditoria — JM Transportes" }] }),
  component: AuditoriaPage,
});

const ACOES = [
  { value: "__all__", label: "Todas as ações" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "logout.inatividade", label: "Logout por inatividade" },
  { value: "recebimento.ok", label: "Recebimento OK" },
  { value: "recebimento.duplicado", label: "Recebimento duplicado" },
  { value: "recebimento.outra_base", label: "Recebimento outra base" },
  { value: "recebimento.inexistente", label: "Recebimento inexistente" },
  { value: "triagem.ok", label: "Triagem OK" },
  { value: "triagem.duplicado", label: "Triagem duplicada" },
  { value: "triagem.nao_recebido", label: "Triagem não recebido" },
  { value: "usuario.criado", label: "Usuário criado" },
  { value: "usuario.alterado", label: "Usuário alterado" },
  { value: "usuario.excluido", label: "Usuário excluído" },
  { value: "usuario.ativado", label: "Usuário ativado" },
  { value: "usuario.desativado", label: "Usuário desativado" },
  { value: "usuario.senha_resetada", label: "Senha resetada" },
  { value: "export.abrir", label: "Exportação (abrir)" },
  { value: "export.imprimir", label: "Exportação (imprimir)" },
];

function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function AuditoriaPage() {
  const listarFn = useServerFn(listarAudit);
  const operadoresFn = useServerFn(listarOperadoresAudit);

  const [inicio, setInicio] = useState<string>(todayIso(-7));
  const [fim, setFim] = useState<string>(todayIso());
  const [acao, setAcao] = useState<string>("__all__");
  const [usuarioId, setUsuarioId] = useState<string>("__all__");
  const [q, setQ] = useState<string>("");

  const operadores = useQuery({
    queryKey: ["audit-operadores"],
    queryFn: () => operadoresFn(),
  });

  const filtros = useMemo(
    () => ({
      inicio: inicio ? new Date(inicio + "T00:00:00").toISOString() : null,
      fim: fim ? new Date(fim + "T23:59:59").toISOString() : null,
      acao: acao === "__all__" ? null : acao,
      usuarioId: usuarioId === "__all__" ? null : usuarioId,
      q: q.trim() || null,
      limit: 500,
    }),
    [inicio, fim, acao, usuarioId, q],
  );

  const logs = useQuery({
    queryKey: ["audit-logs", filtros],
    queryFn: () => listarFn({ data: filtros }),
  });

  const rows = logs.data ?? [];

  const exportar = (autoPrint: boolean) => {
    abrirRelatorio<AuditRow>({
      titulo: "Auditoria — Log de Ações",
      subtitulo: `${rows.length} eventos · ${inicio} → ${fim}`,
      nomeArquivo: `auditoria_${inicio}_${fim}`,
      autoPrint,
      kpis: [
        { label: "Total", value: rows.length },
        { label: "Início", value: inicio },
        { label: "Fim", value: fim },
      ],
      colunas: [
        { header: "Data/Hora", value: (r) => new Date(r.created_at).toLocaleString("pt-BR") },
        { header: "Usuário", value: (r) => r.usuario_nome ?? r.usuario_email ?? r.user_id ?? "-" },
        { header: "Ação", value: (r) => r.acao },
        { header: "Entidade", value: (r) => r.entidade ?? "-" },
        { header: "Entidade ID", value: (r) => r.entidade_id ?? "-" },
        { header: "IP", value: (r) => r.ip ?? "-" },
        {
          header: "Detalhes",
          value: (r) => (r.detalhes ? JSON.stringify(r.detalhes) : ""),
        },
      ],
      linhas: rows,
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-md brand-gradient flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-[var(--brand-yellow)]" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="font-display text-2xl font-bold leading-tight">Auditoria</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Registro completo: login, logout, recebimento, triagem, alterações,
            exclusões e exportações.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => logs.refetch()}>
            <RefreshCw className={`w-4 h-4 ${logs.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => exportar(false)}>
            <FileDown className="w-4 h-4" /> Exportar
          </Button>
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => exportar(true)}>
            <Printer className="w-4 h-4" /> Imprimir
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
          <Filter className="w-3.5 h-3.5" /> Filtros
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Início</Label>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fim</Label>
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ação</Label>
            <Select value={acao} onValueChange={setAcao}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACOES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Usuário</Label>
            <Select value={usuarioId} onValueChange={setUsuarioId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {(operadores.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome ?? u.email ?? u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Buscar ação</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex: usuario." />
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {logs.isLoading ? "Carregando…" : `${rows.length} registro(s)`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Data/Hora</th>
                <th className="text-left px-3 py-2 font-medium">Usuário</th>
                <th className="text-left px-3 py-2 font-medium">Ação</th>
                <th className="text-left px-3 py-2 font-medium">Entidade</th>
                <th className="text-left px-3 py-2 font-medium">IP</th>
                <th className="text-left px-3 py-2 font-medium">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.usuario_nome ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.usuario_email ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <AcaoBadge acao={r.acao} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.entidade ? (
                      <>
                        <div>{r.entidade}</div>
                        {r.entidade_id && (
                          <div className="font-mono text-muted-foreground truncate max-w-[160px]">
                            {r.entidade_id}
                          </div>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.ip ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.detalhes ? (
                      <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-w-[380px]">
                        {JSON.stringify(r.detalhes)}
                      </pre>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !logs.isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                    Nenhum registro para os filtros escolhidos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AcaoBadge({ acao }: { acao: string }) {
  const tone = acao.startsWith("login")
    ? "bg-primary/10 text-primary"
    : acao.startsWith("logout")
      ? "bg-muted text-muted-foreground"
      : acao.startsWith("recebimento.ok") || acao.startsWith("triagem.ok")
        ? "bg-success/10 text-success"
        : acao.startsWith("recebimento.") || acao.startsWith("triagem.")
          ? "bg-warning/10 text-warning"
          : acao.startsWith("usuario.excluido")
            ? "bg-destructive/10 text-destructive"
            : acao.startsWith("usuario.")
              ? "bg-primary/10 text-primary"
              : acao.startsWith("export.")
                ? "bg-muted text-foreground"
                : "bg-muted text-foreground";
  return <Badge className={`${tone} font-mono text-[11px]`}>{acao}</Badge>;
}
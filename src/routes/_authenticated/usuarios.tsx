import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  setUsuarioAtivo,
  resetSenhaUsuario,
  excluirUsuario,
  listarBasesUsuario,
  listarUserBases,
  setUserBases,
  type UsuarioRow,
} from "@/lib/usuarios.functions";
import { meuPerfil } from "@/lib/recebimento.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, KeyRound, Power, Trash2, ShieldAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/usuarios")({
  ssr: false,
  head: () => ({ meta: [{ title: "Usuários — JM Transportes" }] }),
  component: UsuariosPage,
});

type Role = "admin" | "gerente" | "supervisor" | "operador";
const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  supervisor: "Supervisor",
  operador: "Operador",
};

function UsuariosPage() {
  const qc = useQueryClient();
  const fetchPerfil = useServerFn(meuPerfil);
  const perfilQuery = useQuery({ queryKey: ["meu-perfil"], queryFn: () => fetchPerfil() });
  const isAdmin = (perfilQuery.data?.roles ?? []).includes("admin");

  const fetchUsuarios = useServerFn(listarUsuarios);
  const fetchBases = useServerFn(listarBasesUsuario);
  const usuariosQuery = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => fetchUsuarios(),
    enabled: isAdmin,
  });
  const basesQuery = useQuery({
    queryKey: ["bases-usuarios"],
    queryFn: () => fetchBases(),
    enabled: isAdmin,
  });

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<UsuarioRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UsuarioRow | null>(null);

  if (perfilQuery.isLoading) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="p-6 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-destructive" />
          <div>
            <div className="font-medium">Acesso restrito</div>
            <div className="text-sm text-muted-foreground">Apenas administradores podem gerenciar usuários.</div>
          </div>
        </Card>
      </div>
    );
  }

  const usuarios = usuariosQuery.data ?? [];
  const bases = basesQuery.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">Criação, edição e controle de acesso da equipe.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpenForm(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Novo usuário
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {usuariosQuery.isLoading ? (
          <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando usuários…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Matrícula</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <Badge variant="outline">—</Badge>}
                      {u.roles.map((r) => (
                        <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                          {ROLE_LABEL[r as Role] ?? r}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{u.base_nome ?? "—"}</TableCell>
                  <TableCell>{u.matricula ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("pt-BR") : "Nunca"}
                  </TableCell>
                  <TableCell>
                    {u.ativo
                      ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700">Ativo</Badge>
                      : <Badge variant="secondary" className="bg-destructive/15 text-destructive">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Editar" onClick={() => { setEditing(u); setOpenForm(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Redefinir senha" onClick={() => setResetTarget(u)}>
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <ToggleAtivoButton usuario={u} onDone={() => qc.invalidateQueries({ queryKey: ["usuarios"] })} />
                      <ExcluirButton usuario={u} onDone={() => qc.invalidateQueries({ queryKey: ["usuarios"] })} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {usuarios.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum usuário cadastrado.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <UsuarioForm
        open={openForm}
        onOpenChange={setOpenForm}
        editing={editing}
        bases={bases}
        onDone={() => qc.invalidateQueries({ queryKey: ["usuarios"] })}
      />

      <ResetSenhaDialog target={resetTarget} onOpenChange={(v) => !v && setResetTarget(null)} />
    </div>
  );
}

function UsuarioForm({
  open, onOpenChange, editing, bases, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: UsuarioRow | null;
  bases: Array<{ id: string; codigo: string; nome: string }>;
  onDone: () => void;
}) {
  const isEdit = !!editing;
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [matricula, setMatricula] = useState("");
  const [baseId, setBaseId] = useState<string>("__none");
  const [role, setRole] = useState<Role>("operador");
  const [supervisorBases, setSupervisorBases] = useState<string[]>([]);

  const fnCriar = useServerFn(criarUsuario);
  const fnAtualizar = useServerFn(atualizarUsuario);
  const fnListarUserBases = useServerFn(listarUserBases);
  const fnSetUserBases = useServerFn(setUserBases);

  const mut = useMutation({
    mutationFn: async () => {
      if (isEdit && editing) {
        await fnAtualizar({ data: {
          user_id: editing.id, matricula: matricula || null,
          base_id: baseId === "__none" ? null : baseId, role,
        }});
        if (role === "supervisor") {
          await fnSetUserBases({ data: { user_id: editing.id, base_ids: supervisorBases } });
        } else {
          await fnSetUserBases({ data: { user_id: editing.id, base_ids: [] } });
        }
        return { ok: true };
      }
      const created = await fnCriar({ data: {
        email, nome, senha, role,
        matricula: matricula || null,
        base_id: baseId === "__none" ? null : baseId,
      }});
      if (role === "supervisor" && supervisorBases.length > 0 && created.id) {
        await fnSetUserBases({ data: { user_id: created.id, base_ids: supervisorBases } });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Usuário atualizado." : "Usuário criado.");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reset ao abrir
  function handleOpenChange(v: boolean) {
    if (v) {
      setNome(editing?.nome ?? "");
      setEmail(editing?.email ?? "");
      setSenha("");
      setMatricula(editing?.matricula ?? "");
      setBaseId(editing?.base_id ?? "__none");
      setRole((editing?.roles[0] as Role) ?? "operador");
      setSupervisorBases([]);
      if (editing && (editing.roles[0] as Role) === "supervisor") {
        fnListarUserBases({ data: { user_id: editing.id } })
          .then((ids) => setSupervisorBases(ids))
          .catch(() => setSupervisorBases([]));
      }
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `${editing?.nome} · ${editing?.email}`
              : "Somente emails @jmdistribuicao.com.br são permitidos."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          autoComplete="off"
          onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
        >
          {!isEdit && (
            <>
              {/* Honeypots para evitar autofill do navegador com credenciais do admin logado */}
              <input type="text" name="fake-user" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden />
              <input type="password" name="fake-pass" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden />
              <div className="space-y-1">
                <Label>Nome completo</Label>
                <Input required autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input required type="email" autoComplete="off" name="new-user-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@jmdistribuicao.com.br" />
              </div>
            </>
          )}
          {!isEdit && (
            <div className="space-y-1">
              <Label>Senha inicial</Label>
              <Input required type="password" autoComplete="new-password" name="new-user-password" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Mínimo 8 caracteres. O usuário poderá alterá-la depois.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Perfil</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operador">Operador</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Matrícula</Label>
              <Input value={matricula} onChange={(e) => setMatricula(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>
              Base {role === "operador" && <span className="text-destructive">*</span>}
            </Label>
            <Select value={baseId} onValueChange={setBaseId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">
                  {role === "admin" || role === "gerente"
                    ? "Todas as bases"
                    : "Nenhuma"}
                </SelectItem>
                {bases.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.codigo} — {b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {role === "operador"
                ? "Operadores devem estar vinculados a uma base."
                : role === "supervisor"
                ? "Base principal do supervisor. Adicione bases extras abaixo para acesso multi-base."
                : "Administradores e gerentes têm acesso a todas as bases quando nenhuma é selecionada."}
            </p>
          </div>
          {role === "supervisor" && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/20">
              <Label>Bases adicionais que este supervisor pode acessar</Label>
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-auto">
                {bases.map((b) => {
                  const isPrimary = baseId === b.id;
                  const checked = supervisorBases.includes(b.id) || isPrimary;
                  return (
                    <label
                      key={b.id}
                      className={`flex items-center gap-2 text-sm border rounded p-2 ${isPrimary ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={isPrimary}
                        onCheckedChange={(v) => {
                          setSupervisorBases((prev) =>
                            v ? Array.from(new Set([...prev, b.id])) : prev.filter((x) => x !== b.id),
                          );
                        }}
                      />
                      <span className="font-mono text-xs">{b.codigo}</span>
                      <span className="truncate">{b.nome}</span>
                      {isPrimary && <Badge variant="outline" className="ml-auto text-[10px]">principal</Badge>}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">A base principal já dá acesso; marque aqui as demais.</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? "Salvar alterações" : "Criar usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetSenhaDialog({ target, onOpenChange }: { target: UsuarioRow | null; onOpenChange: (v: boolean) => void }) {
  const [senha, setSenha] = useState("");
  const fn = useServerFn(resetSenhaUsuario);
  const mut = useMutation({
    mutationFn: () => fn({ data: { user_id: target!.id, senha } }),
    onSuccess: () => { toast.success("Senha redefinida."); setSenha(""); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>{target?.nome} · {target?.email}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
          <div className="space-y-1">
            <Label>Nova senha</Label>
            <Input type="password" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Redefinir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleAtivoButton({ usuario, onDone }: { usuario: UsuarioRow; onDone: () => void }) {
  const fn = useServerFn(setUsuarioAtivo);
  const mut = useMutation({
    mutationFn: () => fn({ data: { user_id: usuario.id, ativo: !usuario.ativo } }),
    onSuccess: () => { toast.success(usuario.ativo ? "Usuário desativado." : "Usuário ativado."); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button size="icon" variant="ghost" title={usuario.ativo ? "Desativar" : "Ativar"} disabled={mut.isPending}
      onClick={() => {
        if (!confirm(`${usuario.ativo ? "Desativar" : "Ativar"} ${usuario.nome}?`)) return;
        mut.mutate();
      }}>
      <Power className={`w-4 h-4 ${usuario.ativo ? "text-emerald-600" : "text-destructive"}`} />
    </Button>
  );
}

function ExcluirButton({ usuario, onDone }: { usuario: UsuarioRow; onDone: () => void }) {
  const fn = useServerFn(excluirUsuario);
  const mut = useMutation({
    mutationFn: () => fn({ data: { user_id: usuario.id } }),
    onSuccess: () => { toast.success("Usuário excluído."); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button size="icon" variant="ghost" title="Excluir" disabled={mut.isPending}
      onClick={() => {
        if (!confirm(`Excluir ${usuario.nome} permanentemente? Esta ação não pode ser desfeita.`)) return;
        mut.mutate();
      }}>
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  );
}
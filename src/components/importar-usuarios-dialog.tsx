import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, FileDown, AlertTriangle } from "lucide-react";
import {
  importarUsuarios,
  type ImportarUsuarioResultado,
} from "@/lib/usuarios.functions";

type Role = "admin" | "gerente" | "supervisor" | "operador";

type Linha = {
  linha: number;
  nome: string;
  email: string;
  role: Role;
  base_codigo: string;
  matricula: string;
  senha: string;
  erro?: string;
};

const HEADER = ["nome", "email", "role", "base_codigo", "matricula", "senha"] as const;

// Aceita tanto siglas (ESP15) quanto nomes das bases usados na planilha da JM.
const BASES_VALIDAS = ["ESP15", "ESP16", "ESP17", "ESP18"] as const;
const BASE_ALIASES: Record<string, (typeof BASES_VALIDAS)[number]> = {
  ESP15: "ESP15",
  ESP16: "ESP16",
  ESP17: "ESP17",
  ESP18: "ESP18",
  IBIUNA: "ESP15",
  "BASE DE IBIUNA": "ESP15",
  GUARUJA: "ESP16",
  GAURUJA: "ESP16",
  "BASE DE GUARUJA": "ESP16",
  "EMBU GUACU": "ESP17",
  "BASE DE EMBU GUACU": "ESP17",
  "SAO LOURENCO": "ESP17",
  "FRANCO DA ROCHA": "ESP18",
  "BASE DE FRANCO DA ROCHA": "ESP18",
};

function normalizarBase(entrada: string): string {
  const bruto = entrada.trim();
  if (!bruto) return "";
  // remove acentos, colapsa espaços, uppercase
  const norm = bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
  // procura sigla ESPxx dentro do texto (ex.: "São Lourenço ESP17")
  const sigla = norm.match(/ESP\s*1[5-8]/);
  if (sigla) return sigla[0].replace(/\s+/g, "");
  return BASE_ALIASES[norm] ?? norm;
}

function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === "," || c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim().length > 0));
}

function gerarSenha(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "JM-";
  for (let i = 0; i < 9; i++) out += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return out;
}

function validar(l: Omit<Linha, "linha" | "erro">): string | undefined {
  if (!l.nome || l.nome.length < 2) return "Nome inválido.";
  if (!l.email.includes("@")) return "Email inválido.";
  if (!l.email.toLowerCase().endsWith("@jmdistribuicao.com.br"))
    return "Domínio precisa ser @jmdistribuicao.com.br.";
  if (!["admin", "gerente", "supervisor", "operador"].includes(l.role))
    return "Role deve ser admin|gerente|supervisor|operador.";
  if (l.role === "operador" && !l.base_codigo) return "Operador exige base_codigo.";
  if (l.base_codigo && !BASES_VALIDAS.includes(l.base_codigo as (typeof BASES_VALIDAS)[number]))
    return `Base inválida: use ${BASES_VALIDAS.join(", ")} ou o nome (ex.: "Base de Ibiúna", "São Lourenço ESP17").`;
  if (l.senha.length < 8) return "Senha muito curta (mínimo 8).";
  return undefined;
}

export function ImportarUsuariosDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ImportarUsuarioResultado[] | null>(null);
  const importar = useServerFn(importarUsuarios);

  const linhas = useMemo<Linha[]>(() => {
    if (!texto.trim()) return [];
    const rows = parseCsv(texto);
    if (rows.length === 0) return [];
    // Detecta se primeira linha é header
    const first = rows[0].map((c) => c.trim().toLowerCase());
    const isHeader = first.includes("email") && first.includes("nome");
    const idxs = HEADER.map((h) => (isHeader ? first.indexOf(h) : HEADER.indexOf(h)));
    const dataRows = isHeader ? rows.slice(1) : rows;
    return dataRows.map((cols, i) => {
      const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");
      const item: Omit<Linha, "linha" | "erro"> = {
        nome: get(idxs[0]),
        email: get(idxs[1]).toLowerCase(),
        role: (get(idxs[2]).toLowerCase() as Role) || ("operador" as Role),
        base_codigo: normalizarBase(get(idxs[3])),
        matricula: get(idxs[4]),
        senha: get(idxs[5]) || gerarSenha(),
      };
      return { linha: i + (isHeader ? 2 : 1), ...item, erro: validar(item) };
    });
  }, [texto]);

  const erros = linhas.filter((l) => l.erro).length;
  const validos = linhas.length - erros;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = linhas
        .filter((l) => !l.erro)
        .map((l) => ({
          nome: l.nome,
          email: l.email,
          role: l.role,
          base_codigo: l.base_codigo || null,
          matricula: l.matricula || null,
          senha: l.senha,
        }));
      return importar({ data: { usuarios: payload } });
    },
    onSuccess: (res) => {
      setResultados(res);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      const criados = res.filter((r) => r.status === "criado").length;
      toast.success(`${criados} usuário(s) criado(s).`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function baixarModelo() {
    const csv =
      HEADER.join(",") +
      "\n" +
      "# base_codigo aceita: ESP15/ESP16/ESP17/ESP18 ou nomes (Base de Ibiúna, Base de Guarujá, São Lourenço ESP17, Franco da Rocha ESP18, Embu Guaçu)\n" +
      "João Silva,joao.silva@jmdistribuicao.com.br,operador,ESP15,12345,\n" +
      "Maria Souza,maria.souza@jmdistribuicao.com.br,supervisor,Base de Guarujá,,\n" +
      "Pedro Lima,pedro.lima@jmdistribuicao.com.br,operador,São Lourenço ESP17,54321,\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-usuarios.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function baixarResultado() {
    if (!resultados) return;
    const linhasCsv = [
      "email,status,senha_temporaria,mensagem",
      ...resultados.map(
        (r) =>
          `${r.email},${r.status},${r.senha_temporaria ?? ""},"${(r.mensagem ?? "").replace(/"/g, '""')}"`,
      ),
    ];
    const blob = new Blob([linhasCsv.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resultado-importacao.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setTexto("");
          setResultados(null);
        }
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4 mr-2" /> Importar CSV
      </Button>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar usuários (CSV)</DialogTitle>
          <DialogDescription>
            Colunas: <code>nome,email,role,base_codigo,matricula,senha</code>. Se a senha ficar em branco,
            uma temporária será gerada. Emails devem ser @jmdistribuicao.com.br.
          </DialogDescription>
        </DialogHeader>

        {!resultados && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={baixarModelo}>
                <FileDown className="w-4 h-4 mr-2" /> Baixar modelo
              </Button>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  f.text().then(setTexto);
                }}
                className="text-sm"
              />
            </div>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Cole aqui o CSV..."
              className="min-h-40 font-mono text-xs"
            />
            {linhas.length > 0 && (
              <>
                <div className="text-sm flex items-center gap-3">
                  <Badge variant="secondary">{linhas.length} linha(s)</Badge>
                  <Badge className="bg-emerald-600">{validos} válida(s)</Badge>
                  {erros > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="w-3 h-3 mr-1" /> {erros} com erro
                    </Badge>
                  )}
                </div>
                <div className="max-h-64 overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Base</TableHead>
                        <TableHead>Matrícula</TableHead>
                        <TableHead>Senha</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.map((l) => (
                        <TableRow key={l.linha}>
                          <TableCell>{l.linha}</TableCell>
                          <TableCell>{l.nome}</TableCell>
                          <TableCell className="text-xs">{l.email}</TableCell>
                          <TableCell>{l.role}</TableCell>
                          <TableCell>{l.base_codigo}</TableCell>
                          <TableCell>{l.matricula}</TableCell>
                          <TableCell className="text-xs font-mono">{l.senha}</TableCell>
                          <TableCell>
                            {l.erro ? (
                              <span className="text-destructive text-xs">{l.erro}</span>
                            ) : (
                              <span className="text-emerald-600 text-xs">OK</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {resultados && (
          <div className="space-y-3">
            <div className="text-sm flex items-center gap-3">
              <Badge className="bg-emerald-600">
                {resultados.filter((r) => r.status === "criado").length} criados
              </Badge>
              <Badge variant="secondary">
                {resultados.filter((r) => r.status === "ja_existia").length} já existiam
              </Badge>
              <Badge variant="destructive">
                {resultados.filter((r) => r.status === "erro").length} com erro
              </Badge>
            </div>
            <div className="rounded border bg-yellow-50 text-yellow-900 p-3 text-xs">
              <strong>Importante:</strong> anote as senhas temporárias abaixo — elas não serão
              exibidas novamente. Use "Baixar resultado" para salvar o arquivo.
            </div>
            <div className="max-h-72 overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Senha temporária</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultados.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{r.email}</TableCell>
                      <TableCell>
                        {r.status === "criado" && (
                          <Badge className="bg-emerald-600">criado</Badge>
                        )}
                        {r.status === "ja_existia" && <Badge variant="secondary">já existia</Badge>}
                        {r.status === "erro" && <Badge variant="destructive">erro</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.senha_temporaria ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.mensagem ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          {!resultados ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={validos === 0 || mutation.isPending}
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Importar {validos} usuário(s)
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={baixarResultado}>
                <FileDown className="w-4 h-4 mr-2" /> Baixar resultado
              </Button>
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Utilitário para gerar relatório navegável em nova aba
// com botões Imprimir (PDF via impressão) e Baixar CSV.

export type RelatorioColuna<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

export type RelatorioKpi = { label: string; value: string | number };

export type RelatorioAssinatura = { label: string; nome?: string };

export type RelatorioOptions<T> = {
  titulo: string;
  subtitulo?: string;
  kpis?: RelatorioKpi[];
  colunas: RelatorioColuna<T>[];
  linhas: T[];
  nomeArquivo?: string; // usado no CSV (sem extensão)
  autoPrint?: boolean; // abre o diálogo de impressão ao carregar
  /**
   * Bloco de assinaturas no rodapé do relatório impresso.
   * Passe `false` para desativar. Se omitido, usa o padrão
   * ["Conferente", "Motorista / Responsável"].
   */
  assinaturas?: RelatorioAssinatura[] | false;
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV<T>(colunas: RelatorioColuna<T>[], linhas: T[]): string {
  const head = colunas.map((c) => csvEscape(c.header)).join(";");
  const body = linhas
    .map((r) => colunas.map((c) => csvEscape(c.value(r))).join(";"))
    .join("\n");
  return `${head}\n${body}`;
}

export function baixarCSV<T>(opts: {
  titulo: string;
  nomeArquivo?: string;
  colunas: RelatorioColuna<T>[];
  linhas: T[];
}): void {
  if (typeof window === "undefined") return;
  const nomeArquivo = (opts.nomeArquivo ?? "relatorio").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const csv = toCSV(opts.colunas, opts.linhas);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);

  import("./audit.functions")
    .then(({ registrarAudit }) =>
      registrarAudit({
        data: {
          acao: "export.csv",
          entidade: "relatorio",
          entidade_id: nomeArquivo,
          detalhes: { titulo: opts.titulo, linhas: opts.linhas.length },
        },
      }),
    )
    .catch(() => {
      /* ignore */
    });
}

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function abrirRelatorio<T>(opts: RelatorioOptions<T>): boolean {
  const nomeArquivo = (opts.nomeArquivo ?? "relatorio").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const csv = toCSV(opts.colunas, opts.linhas);
  const csvB64 = typeof window !== "undefined" ? btoa(unescape(encodeURIComponent(csv))) : "";
  const geradoEm = new Date().toLocaleString("pt-BR");
  const autoPrint = opts.autoPrint ? "true" : "false";

  // Auditoria best-effort: registra a exportação/impressão
  if (typeof window !== "undefined") {
    import("./audit.functions")
      .then(({ registrarAudit }) =>
        registrarAudit({
          data: {
            acao: opts.autoPrint ? "export.imprimir" : "export.abrir",
            entidade: "relatorio",
            entidade_id: nomeArquivo,
            detalhes: { titulo: opts.titulo, linhas: opts.linhas.length },
          },
        }),
      )
      .catch(() => {
        /* ignore */
      });
  }

  const kpisHtml = (opts.kpis ?? [])
    .map(
      (k) =>
        `<div class="kpi"><span>${escapeHtml(k.label)}</span><b>${escapeHtml(k.value)}</b></div>`,
    )
    .join("");

  const thead = opts.colunas.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const tbody =
    opts.linhas.length === 0
      ? `<tr><td colspan="${opts.colunas.length}" style="text-align:center;color:#888;padding:24px">Sem dados</td></tr>`
      : opts.linhas
          .map(
            (r) =>
              `<tr>${opts.colunas
                .map((c) => `<td>${escapeHtml(c.value(r))}</td>`)
                .join("")}</tr>`,
          )
          .join("");

  const assinaturasList: RelatorioAssinatura[] | null =
    opts.assinaturas === false
      ? null
      : opts.assinaturas && opts.assinaturas.length > 0
        ? opts.assinaturas
        : [{ label: "Conferente" }, { label: "Motorista / Responsável" }];

  const assinaturasHtml = assinaturasList
    ? `<div class="signatures">${assinaturasList
        .map(
          (a) =>
            `<div class="sig">
              <div class="sig-line">${a.nome ? escapeHtml(a.nome) : ""}</div>
              <div class="sig-label">${escapeHtml(a.label)}</div>
            </div>`,
        )
        .join("")}</div>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(opts.titulo)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#111;background:#f7f7f8;margin:0}
  .sheet{max-width:1100px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{margin:0 0 4px;font-size:22px}
  .sub{color:#555;font-size:13px;margin-bottom:4px}
  .meta{color:#888;font-size:12px}
  .toolbar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px}
  .btn{border:1px solid #d1d5db;background:#fff;color:#111;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
  .btn.primary{background:#111827;color:#fff;border-color:#111827}
  .btn:hover{opacity:.9}
  .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin:16px 0 20px}
  .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#fafafa}
  .kpi span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666}
  .kpi b{display:block;font-size:20px;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{border-bottom:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#374151}
  tr:nth-child(even) td{background:#fafafa}
  .signatures{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:36px;margin-top:56px;page-break-inside:avoid}
  .sig{display:flex;flex-direction:column;align-items:center;text-align:center}
  .sig-line{width:100%;min-height:22px;border-bottom:1px solid #111;font-size:12px;color:#111;padding:0 6px 4px}
  .sig-label{margin-top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#374151}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;padding:16px}
    .toolbar{display:none}
    tr:nth-child(even) td{background:transparent}
    .signatures{margin-top:64px}
  }
</style>
</head><body>
<div class="sheet">
  <div class="toolbar">
    <button class="btn" id="csvBtn">Baixar CSV</button>
    <button class="btn primary" id="printBtn">Imprimir / Salvar PDF</button>
  </div>
  <h1>${escapeHtml(opts.titulo)}</h1>
  ${opts.subtitulo ? `<div class="sub">${escapeHtml(opts.subtitulo)}</div>` : ""}
  <div class="meta">Gerado em ${escapeHtml(geradoEm)}</div>
  ${kpisHtml ? `<div class="kpis">${kpisHtml}</div>` : ""}
  <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
  ${assinaturasHtml}
</div>
<script>
  (function(){
    var csvB64 = "${csvB64}";
    var nome = "${nomeArquivo}";
    document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });
    document.getElementById('csvBtn').addEventListener('click', function(){
      var bin = atob(csvB64);
      var bytes = new Uint8Array(bin.length);
      for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nome + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 200);
    });
    if (${autoPrint}) setTimeout(function(){ window.print(); }, 250);
  })();
</script>
</body></html>`;

  // Impressão silenciosa: renderiza num iframe oculto e chama print() sem abrir aba.
  if (opts.autoPrint && typeof window !== "undefined") {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const doPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* ignore */
      }
      setTimeout(() => iframe.remove(), 1000);
    };
    if (doc.readyState === "complete") setTimeout(doPrint, 250);
    else iframe.onload = () => setTimeout(doPrint, 250);
    return true;
  }

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
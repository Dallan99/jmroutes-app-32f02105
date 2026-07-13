# Instruções de backup — pré-condição do Gate 1

Não tenho como comprovar existência de backup recuperável a partir deste
ambiente. **Migrations A e B NÃO foram aplicadas.**

## O que preciso de você antes de aplicar

1. Confirme no painel do Lovable Cloud que o snapshot automático mais
   recente do banco está disponível e é recuperável (data/hora visível).
2. Opcional (recomendado): gere um snapshot manual imediatamente antes de
   autorizar a aplicação, para ter um ponto de restauração dedicado a esta
   janela.
3. Confirme que o snapshot cobre o schema `public` inteiro (todas as
   tabelas listadas abaixo estão no mesmo banco lógico, então um snapshot
   do banco cobre todas):
   - `public.recebimentos`
   - `public.importacoes_escala`
   - `public.escalas`
   - `public.bases`
   - `public.audit_logs`
   - enums e definições de schema
4. Responda neste chat com: "backup confirmado — hora HH:MM UTC do
   snapshot X" e a autorização para aplicar A e B.

## O que NÃO farei

- Não expor senha, token, service_role, connection string ou `.env`.
- Não executar `pg_dump` a partir do sandbox (proibido pela política de
  execução).
- Não usar `supabase--migration` sem sua confirmação de backup.

## Status atual

**BLOQUEADO POR AUSÊNCIA DE BACKUP CONFIRMADO.**
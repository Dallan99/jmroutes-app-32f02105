
DROP TABLE IF EXISTS public._meli_test_out;
CREATE TABLE public._meli_test_out (
  step text PRIMARY KEY,
  result jsonb,
  extra jsonb,
  created_at timestamptz DEFAULT now()
);

DO $test$
DECLARE
  v_admin uuid := '0742f108-771c-4a03-b10d-66dbcebe3b93';
  v_operador uuid := '158ef35a-a708-4afd-a56a-c4bea8f612c8';
  v_before int;
  v_after int;
  v_res jsonb;
  v_err text;
BEGIN
  -- Limpeza prévia idempotente
  DELETE FROM public.meli_rotas WHERE route_id LIKE 'TEST-%';
  DELETE FROM public.meli_importacoes WHERE arquivo_nome LIKE 'arquivo-%' OR arquivo_nome = 'x';

  -- T1: operador (sem permissão) → sem_permissao, sem log
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_operador, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_before FROM public.meli_importacoes;
  v_res := public.meli_importar_rota('{"meli_route_id":"TEST-NOP"}'::jsonb, 'x');
  SELECT count(*) INTO v_after FROM public.meli_importacoes;
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T1_sem_permissao', v_res,
     jsonb_build_object('delta_importacoes', v_after - v_before));

  -- T2: admin importa nova rota com 2 pacotes válidos
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","cluster":"ESP15","facility":"XPT-SP","data_rota":"2026-07-23","pacotes":[{"tracking_id":"TRK-A","destinatario":"Alice","sequencia":"1"},{"tracking_id":"TRK-B","destinatario":"Bob","sequencia":"2"}]}'::jsonb,
    'arquivo-1');
  INSERT INTO public._meli_test_out(step, result) VALUES ('T2_admin_import', v_res);

  -- T3: reimport idêntico → inalterados=2, inseridos=0, atualizados=0
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","cluster":"ESP15","facility":"XPT-SP","data_rota":"2026-07-23","pacotes":[{"tracking_id":"TRK-A","destinatario":"Alice","sequencia":"1"},{"tracking_id":"TRK-B","destinatario":"Bob","sequencia":"2"}]}'::jsonb,
    'arquivo-1-dup');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T3_reimport_identico', v_res,
     jsonb_build_object('total_pacotes_rota',
       (SELECT count(*) FROM public.meli_pacotes p
        JOIN public.meli_rotas r ON r.id=p.rota_id WHERE r.route_id='TEST-001')));

  -- T4: pacote duplicado no JSON — mantém última ocorrência (AliceV2)
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","pacotes":[{"tracking_id":"TRK-A","destinatario":"AliceV1"},{"tracking_id":"TRK-A","destinatario":"AliceV2"},{"tracking_id":"TRK-C","destinatario":"Carla"}]}'::jsonb,
    'arquivo-dup');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T4_dup_no_payload', v_res,
     jsonb_build_object(
       'trk_a_destinatario', (SELECT destinatario FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-001' AND p.tracking_id='TRK-A'),
       'total_pacotes_rota', (SELECT count(*) FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id WHERE r.route_id='TEST-001')
     ));

  -- T5: payload com pacotes não-array → erro; sem dados parciais; log gravado
  SELECT count(*) INTO v_before FROM public.meli_importacoes;
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-BAD","pacotes":"nao_e_array"}'::jsonb,
    'arquivo-bad');
  SELECT count(*) INTO v_after FROM public.meli_importacoes;
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T5_pacotes_nao_array', v_res,
     jsonb_build_object(
       'rota_test_bad_criada', (SELECT count(*) FROM public.meli_rotas WHERE route_id='TEST-BAD'),
       'payload_test_bad_criado', (SELECT count(*) FROM public.meli_rotas_payload rp
         JOIN public.meli_rotas r ON r.id=rp.rota_id WHERE r.route_id='TEST-BAD'),
       'log_status', (SELECT status FROM public.meli_importacoes WHERE arquivo_nome='arquivo-bad'),
       'log_msg', (SELECT mensagem_erro FROM public.meli_importacoes WHERE arquivo_nome='arquivo-bad'),
       'log_delta', v_after - v_before));

  -- T6: INSERT direto em meli_rotas como authenticated → bloqueado por RLS
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.meli_rotas(route_id) VALUES ('TEST-HACK-DIRECT');
      v_err := 'NAO_BLOQUEADO';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLSTATE || ':' || SQLERRM;
    END;
  END;
  RESET ROLE;
  INSERT INTO public._meli_test_out(step, result) VALUES
    ('T6_insert_direto_authenticated',
     jsonb_build_object('resultado', v_err,
       'rota_criada', (SELECT count(*) FROM public.meli_rotas WHERE route_id='TEST-HACK-DIRECT')));

  -- T7: sequência inválida → pacote entra com ordem=NULL, contabilizado
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-SEQ","pacotes":[{"tracking_id":"TRK-X","sequencia":"ABC"},{"tracking_id":"TRK-Y","sequencia":"5"},{"tracking_id":"","sequencia":"6"}]}'::jsonb,
    'arquivo-seq');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T7_sequencia_invalida', v_res,
     jsonb_build_object(
       'trk_x_ordem', (SELECT ordem FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-SEQ' AND p.tracking_id='TRK-X'),
       'trk_y_ordem', (SELECT ordem FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-SEQ' AND p.tracking_id='TRK-Y')));

  -- T8: listagem
  v_res := public.meli_listar_rotas(NULL, NULL, NULL, 'TEST-', 50, 0);
  INSERT INTO public._meli_test_out(step, result) VALUES ('T8_listar', v_res);

  -- T9: detalhamento (não retorna raw_payload)
  v_res := public.meli_detalhar_rota(
    (SELECT id FROM public.meli_rotas WHERE route_id='TEST-001'), 100, 0);
  INSERT INTO public._meli_test_out(step, result) VALUES
    ('T9_detalhar', v_res - 'pacotes'
      || jsonb_build_object(
           'qtd_pacotes_no_detalhe', jsonb_array_length(v_res->'pacotes'),
           'tem_raw_payload', v_res ? 'raw_payload'));
END $test$;

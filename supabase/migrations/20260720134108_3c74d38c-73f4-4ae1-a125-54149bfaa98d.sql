-- Restaurar EXECUTE nas funções usadas em políticas RLS.
-- Elas são SECURITY DEFINER (bypass RLS interno) mas o caller ainda precisa de EXECUTE
-- para que a policy consiga invocá-las durante SELECT/INSERT/UPDATE em transferencias/inventarios.
GRANT EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventario_global_access(uuid) TO authenticated;
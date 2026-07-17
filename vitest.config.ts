import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Vitest é usado APENAS para testes de caracterização unitária.
// - Não substitui integração PostgreSQL (RLS, SECURITY DEFINER, transações, locks).
// - Nenhum código funcional é alterado para viabilizar testes.
// - Nenhum teste toca banco real, rede ou variáveis de produção.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Exclui explicitamente qualquer teste do bundle de produção.
    // O Vite/nitro build só entra em src/ + vite.config.ts, portanto
    // tests/ nunca é bundlado.
    exclude: ["node_modules", "dist", ".output", ".vinxi"],
    reporters: ["default"],
    passWithNoTests: false,
  },
});

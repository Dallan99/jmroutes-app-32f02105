// @lovable.dev/vite-tanstack-config já inclui os plugins principais.
// Aqui definimos explicitamente o preset da Vercel para que as variáveis
// privadas de servidor sejam disponibilizadas corretamente no runtime.

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: {
      entry: "server",
    },
  },

  nitro: {
    preset: "vercel",
  },
});
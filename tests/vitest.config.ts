import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * El proyecto aún no trae vitest.config.ts en la raíz. Este archivo vive en
 * tests/ para no tocar archivos fuera de nuestro alcance; el agente que integra
 * puede moverlo a la raíz o pasar `--config tests/vitest.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

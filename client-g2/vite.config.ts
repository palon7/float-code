import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@float-code/shared/protocol/entry-guard",
        replacement: fileURLToPath(
          new URL("../shared/src/protocol/entry-guard.ts", import.meta.url),
        ),
      },
      {
        find: "@float-code/shared/protocol",
        replacement: fileURLToPath(
          new URL("../shared/src/protocol/types.ts", import.meta.url),
        ),
      },
    ],
  },
  server: {
    host: true,
    port: 5173,
  },
});

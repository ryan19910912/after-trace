import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const appDir = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-app-shell",
      generateBundle(_options, bundle) {
        const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
        const digest = createHash("sha256");
        for (const file of files) {
          const output = bundle[file];
          digest.update(file);
          digest.update(output.type === "chunk" ? output.code : output.source);
        }
        for (const file of [
          "sw.js",
          "manifest.webmanifest",
          "aftertrace-icon.svg",
          "aftertrace-icon-192.png",
          "aftertrace-icon-512.png",
        ])
          digest.update(readFileSync(resolve(appDir, "public", file)));
        const hash = digest.digest("hex").slice(0, 16);
        const source = readFileSync(resolve(appDir, "public/sw.js"), "utf8")
          .replace("__BUILD__", hash)
          .replace(
            "__PRECACHE__",
            JSON.stringify([
              "/index.html",
              "/manifest.webmanifest",
              "/aftertrace-icon.svg",
              "/aftertrace-icon-192.png",
              "/aftertrace-icon-512.png",
              ...files.filter((f) => f !== "index.html").map((f) => "/" + f),
            ]),
          );
        this.emitFile({ type: "asset", fileName: "sw.js", source });
      },
    },
  ],
  worker: {
    format: "es",
    plugins: () => [
      {
        name: "local-ai-runtime-assets",
        generateBundle(_options, bundle) {
          for (const [name, output] of Object.entries(bundle))
            if (output.type === "asset" && /ort-wasm.*\.wasm$/.test(name))
              delete bundle[name];
        },
      },
    ],
  },
});

import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
const folder = resolve("apps/web/dist"),
  port = Number(process.env.PORT ?? 15173),
  types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
  };
http
  .createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://localhost"),
        path = decodeURIComponent(url.pathname),
        target = resolve(folder, "." + path);
      if (!target.startsWith(folder + sep) && target !== folder) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      const file =
        existsSync(target) && statSync(target).isFile()
          ? target
          : !extname(path)
            ? resolve(folder, "index.html")
            : null;
      if (!file) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          file.endsWith("sw.js") || file.endsWith("index.html")
            ? "no-cache"
            : "public,max-age=3600",
        "Service-Worker-Allowed": "/",
      });
      response.end(request.method === "HEAD" ? undefined : readFileSync(file));
    } catch {
      response.writeHead(500);
      response.end("Local static server error");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log("AFTERTRACE PWA http://localhost:" + port),
  );

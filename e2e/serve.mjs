// Serves dist-e2e/ the way thorsteingames.com proxies the game: the page at
// /mastermind (no trailing slash) and files under /mastermind/. Anything else
// 404s, so a relative asset path (the old blank-page bug) fails the tests.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? "dist-e2e");
const PORT = Number(process.env.PORT ?? 4317);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = null;
    if (url.pathname === "/mastermind" || url.pathname === "/mastermind/") file = "index.html";
    else if (url.pathname.startsWith("/mastermind/")) file = decodeURIComponent(url.pathname.slice("/mastermind/".length));
    const full = file && path.join(ROOT, file);
    if (!full || !full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] ?? "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  })
  .listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/mastermind`));

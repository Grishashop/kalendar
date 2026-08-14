// Сборка офлайн-версии «Кармана транзакций» в ОДИН html-файл.
//
// Почему один файл, а не статический экспорт Next: экспорт даёт папку с
// абсолютными путями вида «/_next/...», которые с file:// не открываются.
// Один файл ещё и переносится как файл — по внутренней сети, на флешке.
//
// Запуск: npm run build:offline

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "public", "karman-offline.html");
const tmp = mkdtempSync(join(tmpdir(), "karman-offline-"));

try {
  // 1. JS одним куском, с React внутри: подгружать его с CDN нельзя, интернета нет.
  const bundle = await build({
    entryPoints: [join(here, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["chrome110", "firefox110", "safari16"],
    minify: true,
    jsx: "automatic",
    loader: { ".tsx": "tsx", ".ts": "ts" },
    // Тот же алиас, что в tsconfig: код компонентов не правится под сборку.
    alias: { "@": root },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = bundle.outputFiles[0].text;

  // 2. CSS: Tailwind сканирует только то, что входит в сборку.
  const cssPath = join(tmp, "out.css");
  execFileSync(
    join(root, "node_modules", ".bin", "tailwindcss"),
    ["-c", join(here, "tailwind.config.ts"), "-i", join(here, "index.css"), "-o", cssPath, "--minify"],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  const css = readFileSync(cssPath, "utf8");

  // 3. Склейка. Ни одной внешней ссылки: ни шрифта, ни скрипта, ни картинки —
  //    иначе файл в изолированной сети покажет пустоту или зависнет на запросе.
  const built = new Date().toISOString().slice(0, 16).replace("T", " ");
  const html = `<!doctype html>
<html lang="ru" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Карман транзакций — офлайн</title>
<!-- Собрано ${built} из исходников проекта kalendar (offline/build.mjs).
     Файл автономен: внешних запросов не делает. -->
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

  writeFileSync(out, html, "utf8");
  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
  console.log(`Готово: public/karman-offline.html — ${kb} КБ`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

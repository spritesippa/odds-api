// Builds a self-contained static copy of the dashboard in build/static/.
// It runs the same API code (src/api.mjs) in the browser against the mock
// provider, so it can be hosted anywhere without server.mjs. Mock data only:
// the live provider and any API key are never included.
//
//   node scripts/build-static.mjs

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "build", "static");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const copy = (from, to) => {
  mkdirSync(dirname(join(OUT, to)), { recursive: true });
  copyFileSync(join(ROOT, from), join(OUT, to));
};

for (const name of readdirSync(join(ROOT, "public"))) {
  if (name === "transport.js" || name === "index.html" || name.startsWith(".")) continue;
  copy(`public/${name}`, name);
}

// Browser-safe modules only (no Node APIs, no live provider).
const SRC = ["src/api.mjs", "src/analysis.mjs", "src/lib/odds-math.mjs", "src/providers/provider.mjs", "src/providers/mock-provider.mjs", "src/data/mock-events.mjs"];
for (const file of SRC) copy(file, file);
copy("src/lib/odds-math.mjs", "lib/odds-math.mjs");

writeFileSync(
  join(OUT, "transport.js"),
  `// Static build: the API runs in the browser against mock data. No network.
import { handleApi } from "./src/api.mjs";
import { createMockProvider } from "./src/providers/mock-provider.mjs";

const provider = createMockProvider();

export async function request(path) {
  const body = await handleApi(provider, new URL(path, "https://dashboard.local"));
  return JSON.parse(JSON.stringify(body)); // same shape as an HTTP response
}
`
);

// Hosts that supply their own <html>/<head>/<body> skeleton get the page
// content only: the head's title/links/script plus the body's markup.
const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/\s*<meta (charset|name="viewport")[^>]*>/g, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(join(OUT, "index.html"), `${head.trim()}\n${body.trim()}\n`);

console.log(`Static build written to ${OUT}`);

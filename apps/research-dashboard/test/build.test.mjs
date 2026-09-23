import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "build", "static");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test("static build is mock-only and self-contained", () => {
  execFileSync(process.execPath, [join(ROOT, "scripts/build-static.mjs")], { stdio: "pipe" });
  assert.ok(existsSync(join(OUT, "index.html")));
  assert.ok(existsSync(join(OUT, "transport.js")));

  const all = files(OUT);
  const text = all.filter((f) => /\.(m?js|html|css)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!all.some((f) => f.includes("odds-api-provider")), "live provider must not ship");
  assert.ok(!/X-API-Key|ODDS_API_KEY|process\.env/.test(text), "no key handling in the static build");
  assert.ok(!/\bconfirm\(/.test(text.replace(/confirm\(\) dialog/g, "")), "no native confirm() dialogs");

  // Every relative import in the build resolves to a file in the build.
  for (const file of all.filter((f) => /\.m?js$/.test(f))) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      assert.ok(existsSync(join(file, "..", spec)), `${file} imports missing ${spec}`);
    }
  }
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  assert.ok(!/<html|<body|<!doctype/i.test(html), "page content only; host supplies the skeleton");
  assert.match(html, /<title>Odds Research Dashboard<\/title>/);
});

test("static transport answers API calls in the browser-style runtime", async () => {
  const { request } = await import(join(OUT, "transport.js"));
  const meta = await request("/api/meta");
  assert.equal(meta.provider.id, "mock");
  const { events } = await request("/api/events?sport=nba");
  assert.equal(events.length, 3);
  const insights = await request("/api/insights");
  assert.ok(insights.movers.length > 0);
  await assert.rejects(request("/api/events/nope"), /Event not found/);
});

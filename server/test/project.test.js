// Checks on the code itself, no database needed: every API call in the client
// has a server route, every import resolves with the exact upper/lower case
// Linux needs, every package used is declared, and no source file is hidden
// from Git (which is how ReportChart.jsx once went missing on Vercel).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.JWT_SECRET ||= "test-only-".padEnd(40, "x");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");

function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sources(f, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(f);
  }
  return out;
}
const CLIENT = sources(path.join(ROOT, "client/src"));
const SERVER = sources(path.join(ROOT, "server/src"));

async function serverRoutes() {
  const src = fs.readFileSync(path.join(ROOT, "server/src/server.js"), "utf8");
  const files = Object.fromEntries([...src.matchAll(/import (\w+) from "\.\/(routes\/\w+\.js)"/g)].map((m) => [m[1], m[2]]));
  const routes = [...src.matchAll(/app\.(get|post)\("\/api(\/[^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
  for (const m of src.matchAll(/app\.use\("\/api(\/[^"]+)", (\w+)\)/g)) {
    const router = (await import(pathToFileURL(path.join(ROOT, "server/src", files[m[2]])).href)).default;
    for (const { route } of router.stack) {
      if (!route) continue;
      for (const method of Object.keys(route.methods)) routes.push({ method, path: m[1] + (route.path === "/" ? "" : route.path) });
    }
  }
  return routes;
}

test("every API call in the client has a matching server route", async () => {
  const routes = await serverRoutes();
  assert.ok(routes.length > 100, `only ${routes.length} routes found`);
  // One path segment matches when equal, when it's a :param on the server, or
  // when the client fills it in at run time.
  const matches = (call, route) => {
    const a = call.split("/"), b = route.split("/");
    return a.length === b.length && a.every((s, i) => s === b[i] || b[i].startsWith(":") || s === "*");
  };
  const missing = [];
  let calls = 0;
  for (const f of CLIENT) {
    const s = fs.readFileSync(f, "utf8");
    const found = [
      ...[...s.matchAll(/\bapi\s*\.\s*(get|post|put|patch|delete)\(\s*(["'`])((?:(?!\2).)*)\2/g)].map((m) => [m[1], m[3]]),
      ...[...s.matchAll(/\bdownloadFile\(\s*(["'`])((?:(?!\1).)*)\1/g)].map((m) => ["get", m[2]]),
    ];
    for (const [method, raw] of found) {
      calls++;
      const p = raw.split("?")[0].replace(/\$\{[^}]*\}/g, "*");
      if (!routes.some((r) => r.method === method && matches(p, r.path))) missing.push(`${method.toUpperCase()} ${raw} (${rel(f)})`);
    }
  }
  assert.ok(calls > 100, `only ${calls} client calls found`);
  assert.deepEqual(missing, []);
  for (const p of ["/reports/management", "/reports/management/options", "/reports/export"]) assert.ok(routes.some((r) => r.method === "get" && r.path === p), `GET ${p}`);
});

// `import`/`export ... from` statements only, so text in JSX isn't mistaken for one.
const importsOf = (s) => [
  ...[...s.matchAll(/^\s*(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']/gm)].map((m) => m[1]),
  ...[...s.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g)].map((m) => m[1]),
];

test("every relative import resolves with exact upper/lower case", () => {
  const exists = (f) => {
    const parts = path.relative(ROOT, f).split(path.sep);
    let dir = ROOT;
    return parts.every((p) => {
      const ok = fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).includes(p);
      dir = path.join(dir, p);
      return ok;
    });
  };
  const broken = [];
  let n = 0;
  for (const f of [...CLIENT, ...SERVER]) {
    for (const spec of importsOf(fs.readFileSync(f, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      n++;
      const t = path.resolve(path.dirname(f), spec.split("?")[0]);
      if (!["", ".js", ".jsx", "/index.js", "/index.jsx"].some((e) => exists(t + e) && fs.statSync(t + e).isFile())) broken.push(`${rel(f)} -> ${spec}`);
    }
  }
  assert.ok(n > 400, `only ${n} imports found`);
  assert.deepEqual(broken, []);
});

test("ReportChart is a default export, imported as one by both report pages", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "client/src/components/reports/ReportChart.jsx"), "utf8"), /export default function ReportChart\(/);
  for (const page of ["ManagementReports", "PartyDetail"])
    assert.match(fs.readFileSync(path.join(ROOT, `client/src/pages/${page}.jsx`), "utf8"), /^import ReportChart from "\.\.\/components\/reports\/ReportChart";$/m);
});

test("every package used is declared in package.json", () => {
  for (const [side, files] of [["client", CLIENT], ["server", SERVER]]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, side, "package.json"), "utf8"));
    const missing = new Set();
    for (const f of files)
      for (const spec of importsOf(fs.readFileSync(f, "utf8"))) {
        if (/^[./]|^node:/.test(spec) || builtinModules.includes(spec)) continue;
        const name = spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
        if (!pkg.dependencies[name]) missing.add(`${name} (${rel(f)})`);
      }
    assert.deepEqual([...missing], [], side);
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, side, "package-lock.json"), "utf8")).packages[""];
    assert.deepEqual({ ...lock.dependencies, ...lock.devDependencies }, { ...pkg.dependencies, ...pkg.devDependencies }, `${side} lock file`);
  }
});

test("no source file is hidden from Git by an ignore rule", () => {
  const out = execFileSync("git", ["ls-files", "-o", "-i", "--exclude-standard", "--", "client/src", "client/public", "server/src", "server/test"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.trim(), "");
});

#!/usr/bin/env node
/**
 * Užpildo wrangler.toml ir wrangler.mcp.toml: šeimos pavadinimą ir modulius (iš seima.json),
 * Cloudflare išteklių id ir workers.dev subdomeną (iš argumentų). Galima leisti kelis kartus —
 * nurodytos reikšmės perrašomos, kitos lieka kaip buvo. Pabaigoje parodo, kas dar neužpildyta.
 *
 *   node scripts/konfiguruoti.mjs                                (tik SEIMA ir MODULIAI)
 *   node scripts/konfiguruoti.mjs --d1 <id> --kv-kopijos <id> --kv-oauth <id> --subdomenas <vardas>
 *
 * Subdomenas — dalis tarp „namai.“ ir „.workers.dev“ (pvz., „jonas-pavardenis“).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kintamieji } from "./sukurti-seima.mjs";

const failas = (vardas) => fileURLToPath(new URL(`../${vardas}`, import.meta.url));
const args = process.argv.slice(2);
const arg = (vardas) => {
  const i = args.indexOf(vardas);
  return i >= 0 ? args[i + 1] : undefined;
};

const seimaJson = fileURLToPath(new URL("../../seima.json", import.meta.url));
if (!existsSync(seimaJson)) {
  console.error("Nėra seima.json projekto šaknyje (žr. docs/KLAUSIMYNAS.md).");
  process.exit(1);
}
const { SEIMA, MODULIAI } = kintamieji(JSON.parse(readFileSync(seimaJson, "utf8")));
const d1 = arg("--d1");
const kvKopijos = arg("--kv-kopijos");
const kvOauth = arg("--kv-oauth");
const subdomenas = arg("--subdomenas");

for (const [pavadinimas, reiksme] of [
  ["--d1", d1],
  ["--kv-kopijos", kvKopijos],
  ["--kv-oauth", kvOauth],
]) {
  if (reiksme !== undefined && !/^[0-9a-f-]{32,36}$/i.test(reiksme)) {
    console.error(`${pavadinimas}: „${reiksme}“ neatrodo kaip Cloudflare id (32 šešioliktainiai simboliai, D1 — su brūkšneliais).`);
    process.exit(1);
  }
}
if (subdomenas !== undefined && !/^[a-z0-9-]+$/.test(subdomenas)) {
  console.error(`--subdomenas: „${subdomenas}“ — tik mažosios raidės, skaičiai ir brūkšneliai (be „.workers.dev“).`);
  process.exit(1);
}

const toml = (s) => JSON.stringify(s); // TOML eilutė su kabutėmis — kaip JSON.

function keisti(tekstas, saltinis, keitiniai) {
  let t = tekstas;
  for (const [re, nauja] of keitiniai) {
    if (!re.test(t)) {
      console.error(`${saltinis}: nerasta vieta ${re} — ar failas keistas ranka?`);
      process.exit(1);
    }
    t = t.replace(re, nauja);
  }
  return t;
}

const bendri = (subdomenas ? [[/^APP_URL = .*$/m, `APP_URL = ${toml(`https://namai.${subdomenas}.workers.dev`)}`], [/^MCP_URL = .*$/m, `MCP_URL = ${toml(`https://namai-claude.${subdomenas}.workers.dev`)}`]] : []).concat(
  d1 ? [[/^database_id = .*$/m, `database_id = ${toml(d1)}`]] : []
);

const app = failas("wrangler.toml");
writeFileSync(
  app,
  keisti(readFileSync(app, "utf8"), "wrangler.toml", [
    [/^SEIMA = .*$/m, `SEIMA = ${toml(SEIMA)}`],
    [/^MODULIAI = .*$/m, `MODULIAI = ${toml(MODULIAI)}`],
    ...bendri,
    ...(kvKopijos ? [[/(binding = "BACKUPS"\r?\nid = ).*$/m, `$1${toml(kvKopijos)}`]] : []),
  ])
);

const mcp = failas("wrangler.mcp.toml");
writeFileSync(
  mcp,
  keisti(readFileSync(mcp, "utf8"), "wrangler.mcp.toml", [
    [/^MODULIAI = .*$/m, `MODULIAI = ${toml(MODULIAI)}`],
    ...bendri,
    ...(kvOauth ? [[/(binding = "OAUTH_KV"\r?\nid = ).*$/m, `$1${toml(kvOauth)}`]] : []),
  ])
);

console.log(`✓ SEIMA = ${toml(SEIMA)}, MODULIAI = ${toml(MODULIAI)}`);
for (const [vardas, kelias] of [
  ["wrangler.toml", app],
  ["wrangler.mcp.toml", mcp],
]) {
  const liko = [...new Set(readFileSync(kelias, "utf8").match(/<<[A-Z0-9_]+>>/g) ?? [])];
  console.log(liko.length ? `  ${vardas}: dar neužpildyta ${liko.join(", ")}` : `✓ ${vardas} užpildytas`);
}

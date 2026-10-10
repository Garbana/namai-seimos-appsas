/**
 * Pranešimų (Web Push) raktas: sukuria naują VAPID raktą (P-256) ir įrašo jį
 *  - į backend/.dev.vars (vietiniam bandymui; į git nekeliamas),
 *  - į Worker'io paslaptį VAPID_JWK (tikram appsui).
 * Raktas niekur nespausdinamas. Sukurti reikia vieną kartą: pakeitus raktą, telefonams
 * pranešimus reikės įjungti iš naujo.
 *
 *   node scripts/vapid-raktas.mjs            (iš backend/)
 *   node scripts/vapid-raktas.mjs --tik-vietoje
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const { kty, crv, d, x, y } = await crypto.subtle.exportKey("jwk", pair.privateKey);
const jwk = JSON.stringify({ kty, crv, d, x, y });

const devVars = path.join(backend, ".dev.vars");
const lines = existsSync(devVars) ? readFileSync(devVars, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("VAPID_JWK=")) : [];
writeFileSync(devVars, [...lines, `VAPID_JWK=${jwk}`].join("\n") + "\n");
console.log("✓ Įrašyta vietiniam bandymui (backend/.dev.vars)");

if (!process.argv.includes("--tik-vietoje")) {
  const wrangler = spawnSync(process.execPath, [path.join(backend, "node_modules/wrangler/bin/wrangler.js"), "secret", "put", "VAPID_JWK"], {
    cwd: backend,
    input: jwk,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (wrangler.status !== 0) {
    console.log("\n✗ Į Cloudflare įrašyti nepavyko (ar įvykdytas „npx wrangler login“ ir „npx wrangler deploy“?).");
    process.exit(1);
  }
  console.log("✓ Įrašyta į Cloudflare (VAPID_JWK)");
}

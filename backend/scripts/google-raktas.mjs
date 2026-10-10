/**
 * Google paslaugos paskyros raktą (JSON, parsisiųstą iš Google Cloud) įkelia kaip Worker'io
 * paslaptį GOOGLE_SERVICE_ACCOUNT. Raktas niekur nespausdinamas — rodomas tik paskyros el. paštas.
 *
 *   node scripts/google-raktas.mjs [kelias/iki/rakto.json]
 *
 * Be kelio — imamas naujausias „service_account“ JSON iš „Atsisiuntimai“ (Downloads). Po įkėlimo
 * failą verta ištrinti iš kompiuterio — su „--istrinti“ scenarijus tai padaro pats.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function rasti() {
  const kelias = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (kelias) return kelias;
  const dir = join(homedir(), "Downloads");
  const kandidatai = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => join(dir, f))
    .filter((f) => {
      try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        return j.type === "service_account" && j.client_email && j.private_key;
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (kandidatai.length === 0) throw new Error(`Atsisiuntimuose (${dir}) nerasta Google paslaugos paskyros rakto (.json).`);
  return kandidatai[0];
}

const failas = rasti();
const raktas = JSON.parse(readFileSync(failas, "utf8"));
if (raktas.type !== "service_account" || !raktas.client_email || !raktas.private_key) throw new Error("Tai ne Google paslaugos paskyros raktas.");
const reiksme = JSON.stringify({ client_email: raktas.client_email, private_key: raktas.private_key });

execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "put", "GOOGLE_SERVICE_ACCOUNT"], {
  input: reiksme,
  stdio: ["pipe", "ignore", "inherit"],
  cwd: new URL("..", import.meta.url),
});
console.log(`✓ Raktas įkeltas. Paslaugos paskyra: ${raktas.client_email}`);
if (process.argv.includes("--istrinti")) {
  unlinkSync(failas);
  console.log("✓ Rakto failas ištrintas iš kompiuterio.");
}

// Įrašo Anthropic API raktą ten, kur jo reikia asistentui:
//  - backend/.dev.vars (vietiniam bandymui; į git nekeliamas),
//  - Worker'io paslaptį ANTHROPIC_API_KEY (tikram appsui).
// Raktas paimamas iš iškarpinės (nukopijuotas console.anthropic.com), todėl jo nereikia
// niekur įklijuoti; paėmus iškarpinė išvaloma. Paleisti: node backend/scripts/anthropic-raktas.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const waitEnter = (question) =>
  new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });

const powershell = (command) => execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });

/** Iškarpinės turinys: Windows, macOS ir Linux (wl-paste arba xclip). */
function readClipboard() {
  if (process.platform === "win32") return powershell("Get-Clipboard");
  if (process.platform === "darwin") return execFileSync("pbpaste", { encoding: "utf8" });
  try {
    return execFileSync("wl-paste", ["--no-newline"], { encoding: "utf8" });
  } catch {
    return execFileSync("xclip", ["-o", "-selection", "clipboard"], { encoding: "utf8" });
  }
}

function clearClipboard() {
  if (process.platform === "win32") powershell("Set-Clipboard -Value ' '");
  else if (process.platform === "darwin") execFileSync("pbcopy", { input: " " });
}

/** Jei raktas kada buvo įklijuotas tiesiai į terminalą — išvalom jį iš PowerShell istorijos. */
function cleanHistory() {
  const file = path.join(os.homedir(), "AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt");
  if (!existsSync(file)) return;
  const before = readFileSync(file, "utf8").split(/\r?\n/);
  const after = before.filter((line) => !/^\s*(sk-ant-|apikey_)/.test(line));
  if (after.length !== before.length) {
    writeFileSync(file, after.join("\r\n"));
    console.log("✓ Iš terminalo istorijos išvalyti ten įklijuoti raktai");
  }
}

cleanHistory();
console.log("1. Anthropic puslapyje nukopijuokite raktą (mygtukas „Copy“ prie rakto).");
await waitEnter("2. Tada grįžkite čia ir spauskite Enter… ");

let key = "";
try {
  key = readClipboard().trim();
} catch {
  console.log("\n✗ Nepavyko perskaityti iškarpinės (Linux'e reikia „wl-clipboard“ arba „xclip“).");
  process.exit(1);
}
if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
  console.log("\n✗ Iškarpinėje ne Anthropic raktas (jis prasideda „sk-ant-“). Nukopijuokite patį raktą ir paleiskite dar kartą.");
  process.exit(1);
}
// Kad raktas netyčia nebūtų įklijuotas kur nors kitur.
try {
  clearClipboard();
} catch {
  // Neišvalė — nieko baisaus.
}

process.stdout.write("Tikrinu raktą Anthropic'e… ");
const check = await fetch("https://api.anthropic.com/v1/models", {
  headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
}).catch((error) => ({ ok: false, status: 0, error }));
if (check.status === 401) {
  console.log("\n✗ Anthropic sako, kad šis raktas netinka. Console'e: API Keys → Create Key, nukopijuokite naują ir paleiskite dar kartą.");
  process.exit(1);
}
if (check.ok) console.log("✓ tinka");
// Iš šio terminalo Anthropic nepasiekiamas (tinklas, antivirusinė) — įrašom vis tiek, patikrins AI asistentas.
else console.log(`nepavyko patikrinti (${check.status || check.error?.cause?.code || check.error?.message}) — įrašau vis tiek, patikrins AI asistentas.`);

const devVars = path.join(backend, ".dev.vars");
const lines = existsSync(devVars) ? readFileSync(devVars, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("ANTHROPIC_API_KEY=")) : [];
writeFileSync(devVars, [...lines, `ANTHROPIC_API_KEY=${key}`].join("\n") + "\n");
console.log("✓ Įrašyta vietiniam bandymui (backend/.dev.vars)");

console.log("Įrašau į tikrą appsą (Cloudflare)…");
const wrangler = spawnSync(process.execPath, [path.join(backend, "node_modules/wrangler/bin/wrangler.js"), "secret", "put", "ANTHROPIC_API_KEY"], {
  cwd: backend,
  input: key,
  stdio: ["pipe", "inherit", "inherit"],
});
if (wrangler.status !== 0) {
  console.log("\n✗ Į Cloudflare įrašyti nepavyko — parašykite AI asistentui „Cloudflare nepavyko“; vietinis raktas jau įrašytas.");
  process.exit(1);
}
console.log("\n✓ Viskas. Nieko daugiau įklijuoti nereikia — grįžkite į pokalbį ir parašykite „raktas yra“.");

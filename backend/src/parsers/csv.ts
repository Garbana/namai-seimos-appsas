import Papa from "papaparse";
import { ParseError } from "./types";

/**
 * LT bankų failai būna UTF-8 (su BOM arba be jo), bet pasitaiko ir CP1257.
 * Jei UTF-8 dekodavimas duoda pakaitinių simbolių, bandom windows-1257 —
 * kitaip lietuviškos raidės virstų šiukšlėmis, o importas tęstųsi tyliai.
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return stripBom(utf8);

  try {
    const cp1257 = new TextDecoder("windows-1257").decode(bytes);
    if (!cp1257.includes("�")) return stripBom(cp1257);
  } catch {
    // TextDecoder aplinkoje nepalaiko windows-1257 — krentam į klaidą žemiau.
  }

  throw new ParseError(
    "Nepavyko nuskaityti failo koduotės. Išsaugok išrašą UTF-8 formatu ir bandyk dar kartą."
  );
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseRows(text: string, delimiter: string): string[][] {
  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: true,
  });
  return result.data;
}

/**
 * "-12,50", "1 234.56", "18.00" -> centai (sveikas skaičius).
 * Dirbam su tekstu, o ne su float, kad neatsirastų apvalinimo paklaidų.
 */
export function parseAmountToCents(raw: string): number {
  const cleaned = (raw ?? "").replace(/[\s ]/g, "").trim();
  if (!cleaned) throw new ParseError(`Tuščia suma`);

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalPos = Math.max(lastComma, lastDot);

  let digits: string;
  let fraction: string;
  if (decimalPos === -1) {
    digits = cleaned;
    fraction = "00";
  } else {
    digits = cleaned.slice(0, decimalPos);
    fraction = cleaned.slice(decimalPos + 1);
  }

  // Likę skyrikliai yra tūkstančių skyrikliai.
  digits = digits.replace(/[.,]/g, "");
  const negative = digits.startsWith("-");
  digits = digits.replace(/^[+-]/, "");

  if (!/^\d*$/.test(digits) || !/^\d*$/.test(fraction)) {
    throw new ParseError(`Neatpažintas sumos formatas: "${raw}"`);
  }

  const cents = Number(digits || "0") * 100 + Number(fraction.padEnd(2, "0").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

/** Priima 2026-07-01, 2026.07.01, 01/07/2026 ir grąžina YYYY-MM-DD. */
export function normalizeDate(raw: string): string {
  const text = (raw ?? "").trim().replace(/^'/, "");

  let m = text.match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = text.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  throw new ParseError(`Neatpažintas datos formatas: "${raw}"`);
}

/**
 * Šalies kodas iš kortelės operacijos aprašymo.
 * SEB: „PARDUOTUVĖ/VILNIUS/LTU #043860" — kodas visada prieš „#".
 * Swedbank: retas adreso formatas „...\VILNIUS\09208\LTULTU"; kitais atvejais
 * šalies nenurodo, ir tada geriau nežinoti, nei spėti.
 */
export function extractCountry(description: string | null): string | null {
  if (!description) return null;

  const seb = description.match(/\/([A-Z]{3})\s*#/);
  if (seb) return seb[1];

  const swedbank = description.match(/\\([A-Z]{3})(?:[A-Z]{3})?\s*$/);
  if (swedbank) return swedbank[1];

  return null;
}

/** Tikrina, ar antraštėje yra visi laukiami stulpeliai. */
export function assertColumns(
  header: string[],
  expected: { index: number; name: string }[],
  bankName: string
): void {
  const missing = expected.filter(
    (col) => (header[col.index] ?? "").trim().toLowerCase() !== col.name.toLowerCase()
  );

  if (missing.length > 0) {
    const details = missing
      .map((col) => `${col.index + 1} stulpelyje tikėtasi „${col.name}", rasta „${header[col.index] ?? ""}"`)
      .join("; ");
    throw new ParseError(
      `${bankName} išrašo stulpeliai neatpažinti — galbūt pasikeitė banko formatas arba įkeltas ne to banko failas. ${details}.`
    );
  }
}

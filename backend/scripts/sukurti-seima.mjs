#!/usr/bin/env node
/**
 * Šeimos duomenys bazei: iš seima.json (projekto šaknyje) sukuria backend/seima.sql —
 * šeimos narius, darbų sričių atsakingus ir (jei įjungti finansai) kiekvieno suaugusiojo
 * finansų grupę, jo atlyginimo kategoriją ir šeimos pervedimų taisyklę.
 *
 *   node scripts/sukurti-seima.mjs                 (iš backend/)
 *   npx wrangler d1 execute namai-db --remote --file=seima.sql
 *
 * Scenarijų galima leisti pakartotinai: nariai atnaujinami (el. paštai, spalvos), o
 * kategorijos ir taisyklės nedubliuojamos. Pavyzdys — seima.pavyzdys.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Spalvos nariams, kuriems nenurodyta (appse jas galima matyti ant darbų ir įvykių). */
const SPALVOS = ["#2a78d6", "#1baf7a", "#eda100", "#d6455d", "#8a5cd1", "#1aa3b8"];

/** Suaugusiojo asmeninė finansų grupė (kaip „Bendros išlaidos“, tik vieno žmogaus). */
const ASMENINES_KATEGORIJOS = [
  ["Drabužiai ir avalynė", "butinosios"],
  ["Grožis", "norai"],
  ["Sportas ir hobiai", "norai"],
  ["Sveikata", "butinosios"],
  ["Telefonas", "butinosios"],
  ["Taksi", "butinosios"],
  ["Viešasis transportas", "butinosios"],
  ["Kita", "norai"],
];

const MODULIAI = ["finansai", "asistentas", "claude", "google"];

/** Grupės, kuriomis remiasi appso skiltys (Turtas, Biudžetas, priminimai) — jų šalinti negalima. */
const BUTINOS_GRUPES = ["Bendros išlaidos", "Kreditai", "Draudimas", "Taupymas", "Pensijos", "Pajamos", "Vidiniai pervedimai"];

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** „Rūta“ -> „RUTA“: bankai kartais rašo be lietuviškų raidžių. */
const beDiakritiku = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** Patikrina seima.json ir užpildo numatytas reikšmes. Klaida — aiškiu sakiniu. */
export function patikrinti(raw) {
  const klaida = (t) => {
    throw new Error(`seima.json: ${t}`);
  };
  if (!raw || typeof raw !== "object") klaida("turi būti JSON objektas.");
  if (!Array.isArray(raw.nariai) || raw.nariai.length === 0) klaida("„nariai“ — bent vienas šeimos narys.");
  const vardai = new Set();
  const nariai = raw.nariai.map((n, i) => {
    if (!n || typeof n.vardas !== "string" || !n.vardas.trim()) klaida(`nario nr. ${i + 1} „vardas“ tuščias.`);
    const vardas = n.vardas.trim();
    if (vardai.has(vardas)) klaida(`vardas „${vardas}“ kartojasi — vardai turi skirtis.`);
    vardai.add(vardas);
    const vaikas = n.vaikas === true;
    const elPastai = (n.el_pastai ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    for (const e of elPastai) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) klaida(`„${vardas}“ el. paštas „${e}“ neatrodo kaip el. paštas.`);
    const naudojaAppsa = n.naudoja_appsa ?? !vaikas;
    if (naudojaAppsa && elPastai.length === 0 && !raw.bendras_el_pastas)
      klaida(`„${vardas}“ naudoja appsą, bet neturi el. pašto (ir nėra „bendras_el_pastas“).`);
    const spalva = n.spalva ?? SPALVOS[i % SPALVOS.length];
    if (!/^#[0-9a-fA-F]{6}$/.test(spalva)) klaida(`„${vardas}“ spalva turi būti #RRGGBB.`);
    return { vardas, pavarde: n.pavarde?.trim() || null, spalva, elPastai, naudojaAppsa: Boolean(naudojaAppsa), vaikas };
  });
  const moduliai = raw.moduliai ?? MODULIAI;
  for (const m of moduliai) if (!MODULIAI.includes(m)) klaida(`nežinomas modulis „${m}“ (galimi: ${MODULIAI.join(", ")}).`);
  const sritys = raw.sritys ?? {};
  for (const [sritis, vardas] of Object.entries(sritys))
    if (vardas !== null && !vardai.has(vardas)) klaida(`srities „${sritis}“ atsakingas „${vardas}“ — tokio nario nėra.`);
  for (const g of raw.pasalintos_finansu_grupes ?? [])
    if (BUTINOS_GRUPES.includes(g)) klaida(`finansų grupės „${g}“ šalinti negalima — ja remiasi appso skiltys (gali likti tuščia).`);
  return {
    seima: String(raw.seima ?? "Mūsų šeima").trim(),
    nariai,
    moduliai,
    sritys,
    pasalintosSritys: raw.pasalintos_sritys ?? [],
    pasalintosFinansuGrupes: raw.pasalintos_finansu_grupes ?? [],
    bendrasElPastas: raw.bendras_el_pastas?.trim().toLowerCase() || null,
  };
}

/** SQL bazei (po migracijų). */
export function seimosSql(raw) {
  const s = patikrinti(raw);
  const out = [
    `-- Sugeneravo scripts/sukurti-seima.mjs iš seima.json („${s.seima}“). Ranka neredaguoti —`,
    "-- pakeisk seima.json ir paleisk scenarijų iš naujo.",
    "",
    "-- Šeimos nariai. Bendro pašto čia nėra — tada appsas klausia, kas naudoja įrenginį.",
  ];
  s.nariai.forEach((n, i) => {
    out.push(
      `INSERT INTO members (name, color, emails, uses_app, sort_order) VALUES (${q(n.vardas)}, ${q(n.spalva)}, ${q(JSON.stringify(n.elPastai))}, ${n.naudojaAppsa ? 1 : 0}, ${i + 1})`,
      "  ON CONFLICT(name) DO UPDATE SET color = excluded.color, emails = excluded.emails, uses_app = excluded.uses_app, sort_order = excluded.sort_order;"
    );
  });

  out.push("", "-- Darbų sritys: nereikalingos pašalinamos, atsakingi — pagal seima.json.");
  for (const sritis of s.pasalintosSritys) out.push(`DELETE FROM task_areas WHERE name = ${q(sritis)};`);
  for (const [sritis, vardas] of Object.entries(s.sritys))
    out.push(
      `UPDATE task_areas SET default_member_id = ${vardas === null ? "NULL" : `(SELECT id FROM members WHERE name = ${q(vardas)})`} WHERE name = ${q(sritis)};`
    );

  if (s.moduliai.includes("finansai")) {
    out.push("", "-- Finansai: nereikalingos grupės (su jų taisyklėmis) pašalinamos.");
    for (const grupe of s.pasalintosFinansuGrupes) {
      const vaikai = `(SELECT id FROM categories WHERE parent_id = (SELECT id FROM categories WHERE name = ${q(grupe)} AND parent_id IS NULL))`;
      out.push(
        `DELETE FROM rules WHERE category_id IN ${vaikai};`,
        `DELETE FROM categories WHERE id IN ${vaikai};`,
        `DELETE FROM categories WHERE name = ${q(grupe)} AND parent_id IS NULL;`
      );
    }

    const suauge = s.nariai.filter((n) => !n.vaikas);
    out.push("", "-- Kiekvieno suaugusiojo asmeninė grupė („Taksi“, „Telefonas“ taisyklės ją randa pagal sąskaitos savininką).");
    suauge.forEach((n, i) => {
      const grupe = `(SELECT id FROM categories WHERE name = ${q(n.vardas)} AND parent_id IS NULL)`;
      out.push(
        `INSERT INTO categories (name, parent_id, type, necessity, sort_order) SELECT ${q(n.vardas)}, NULL, 'expense', NULL, ${80 + i} WHERE NOT EXISTS ${grupe.replace("SELECT id", "SELECT 1")};`
      );
      ASMENINES_KATEGORIJOS.forEach(([pavadinimas, butinumas], j) => {
        out.push(
          `INSERT INTO categories (name, parent_id, type, necessity, sort_order) SELECT ${q(pavadinimas)}, ${grupe}, 'expense', ${q(butinumas)}, ${(j + 1) * 10} WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = ${q(pavadinimas)} AND parent_id = ${grupe});`
        );
      });
    });

    out.push("", "-- Atlyginimas: taisyklė „{owner} DU“ jį priskiria tam, kurio sąskaitoje jis gautas.");
    const pajamos = "(SELECT id FROM categories WHERE name = 'Pajamos' AND parent_id IS NULL)";
    suauge.forEach((n, i) => {
      const du = `${n.vardas} DU`;
      out.push(
        `INSERT INTO categories (name, parent_id, type, necessity, sort_order) SELECT ${q(du)}, ${pajamos}, 'income', NULL, ${30 + i * 10} WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = ${q(du)} AND parent_id = ${pajamos});`
      );
    });

    // Pervedimai tarp šeimos narių — ne išlaidos ir ne pajamos.
    const variantai = new Set();
    for (const n of suauge) {
      if (!n.pavarde) continue;
      for (const [v, p] of [
        [n.vardas, n.pavarde],
        [beDiakritiku(n.vardas), beDiakritiku(n.pavarde)],
      ]) {
        variantai.add(`${v} ${p}`.toUpperCase());
        variantai.add(`${p} ${v}`.toUpperCase());
      }
    }
    if (variantai.size > 0) {
      const pastaba = "Vidinis šeimos pervedimas";
      out.push(
        "",
        "-- Pervedimai tarp šeimos narių — vidiniai. Tik gavėjo laukelis: paskirtyje vardas būna ir komunaliniuose (buto savininkas).",
        `DELETE FROM rules WHERE note = ${q(pastaba)} AND mark_transfer = 1;`,
        `INSERT INTO rules (priority, field, operator, value, category_id, owner_category_name, mark_transfer, direction, note) VALUES (11, 'counterparty', 'regex', ${q([...variantai].map(regexEscape).join("|"))}, NULL, NULL, 1, NULL, ${q(pastaba)});`
      );
    }
  }
  return out.join("\n") + "\n";
}

/** wrangler.toml [vars] reikšmės iš seima.json — kad AI įrašytų tas pačias. */
export function kintamieji(raw) {
  const s = patikrinti(raw);
  return { SEIMA: s.seima, MODULIAI: s.moduliai.join(",") };
}

// Paleistas tiesiogiai: seima.json -> seima.sql
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failas = fileURLToPath(new URL("../../seima.json", import.meta.url));
  if (!existsSync(failas)) {
    console.error("Nėra seima.json projekto šaknyje. Nukopijuok seima.pavyzdys.json į seima.json ir užpildyk (žr. docs/KLAUSIMYNAS.md).");
    process.exit(1);
  }
  try {
    const raw = JSON.parse(readFileSync(failas, "utf8"));
    const sql = seimosSql(raw);
    const isvestis = fileURLToPath(new URL("../seima.sql", import.meta.url));
    writeFileSync(isvestis, sql);
    const v = kintamieji(raw);
    console.log(`Sukurta backend/seima.sql („${v.SEIMA}“, ${raw.nariai.length} nariai).`);
    console.log(`wrangler.toml ir wrangler.mcp.toml [vars]: SEIMA = "${v.SEIMA}", MODULIAI = "${v.MODULIAI}"`);
    console.log("Toliau: npx wrangler d1 execute namai-db --remote --file=seima.sql");
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

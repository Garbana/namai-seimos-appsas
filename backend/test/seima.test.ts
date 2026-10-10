import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorize, type CategoryRow, type MatchableTransaction, type Rule } from "../src/rules";
import { fakeD1, MIGRATIONS } from "./d1-node";
// @ts-expect-error — scenarijus be tipų (scripts/*.mjs)
import { kintamieji, seimosSql } from "../scripts/sukurti-seima.mjs";

const PAVYZDYS = JSON.parse(readFileSync(new URL("../../seima.pavyzdys.json", import.meta.url), "utf8"));

/** Bazė po migracijų; seima.sql paleidžiamas atskirai (kaip diegiant). */
function base() {
  const d = fakeD1(...MIGRATIONS);
  const exec = async (sql: string) => {
    // D1 „execute --file“ vykdo visą failą; čia — sakinys po sakinio.
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.split("\n").every((l) => l.startsWith("--"))))
      await d.prepare(stmt).run();
  };
  return { d, exec };
}

describe("sukurti-seima.mjs", () => {
  it("nariai, sritys, asmeninės grupės ir atlyginimai — kaip seima.json", async () => {
    const { d, exec } = base();
    await exec(seimosSql(PAVYZDYS));
    const { results: nariai } = await d.prepare("SELECT id, name, color, emails, uses_app FROM members ORDER BY id").all();
    expect(nariai).toEqual([
      { id: 1, name: "Jonas", color: "#2a78d6", emails: '["jonas@example.com"]', uses_app: 1 },
      { id: 2, name: "Rūta", color: "#1baf7a", emails: '["ruta@example.com"]', uses_app: 1 },
      { id: 3, name: "Ema", color: "#eda100", emails: "[]", uses_app: 0 },
    ]);
    const vaikai = await d.prepare("SELECT m.name FROM task_areas a JOIN members m ON m.id = a.default_member_id WHERE a.name = 'Vaikai'").first();
    expect(vaikai).toEqual({ name: "Rūta" });
    // Vaikui asmeninės grupės ir atlyginimo nėra.
    const { results: grupes } = await d.prepare("SELECT name FROM categories WHERE parent_id IS NULL AND name IN ('Jonas', 'Rūta', 'Ema')").all();
    expect(grupes.map((g) => (g as { name: string }).name).sort()).toEqual(["Jonas", "Rūta"]);
    expect(await d.prepare("SELECT COUNT(*) AS n FROM categories WHERE name IN ('Jonas DU', 'Rūta DU', 'Ema DU')").first()).toEqual({ n: 2 });
    expect(kintamieji(PAVYZDYS)).toEqual({ SEIMA: "Pavardenių šeima", MODULIAI: "finansai,asistentas,claude,google" });
  });

  it("paleidus antrą kartą — nariai atnaujinami, kategorijos ir taisyklės nesidubliuoja", async () => {
    const { d, exec } = base();
    await exec(seimosSql(PAVYZDYS));
    const count = async () => (await d.prepare("SELECT (SELECT COUNT(*) FROM categories) AS c, (SELECT COUNT(*) FROM rules) AS r").first()) as object;
    const before = await count();
    const pakeista = structuredClone(PAVYZDYS);
    pakeista.nariai[1].el_pastai = ["ruta.kitas@example.com"];
    await exec(seimosSql(pakeista));
    expect(await count()).toEqual(before);
    expect(await d.prepare("SELECT emails FROM members WHERE name = 'Rūta'").first()).toEqual({ emails: '["ruta.kitas@example.com"]' });
  });

  it("taisyklės: pervedimas šeimos nariui — vidinis; atlyginimas ir „Taksi“ — sąskaitos savininkui", async () => {
    const { d, exec } = base();
    await exec(seimosSql(PAVYZDYS));
    const { results: categories } = await d.prepare("SELECT id, name, parent_id, type FROM categories").all<CategoryRow>();
    const { results: rules } = await d.prepare("SELECT * FROM rules WHERE is_active = 1").all<Rule>();
    const name = (id: number | null) => categories.find((c) => c.id === id)?.name;
    const tx = (counterpartyName: string, amountCents: number, description = ""): MatchableTransaction => ({ counterpartyName, description, amountCents, country: "LTU" });

    // Bankai rašo ir „PAVARDĖ VARDAS“, ir be lietuviškų raidžių.
    expect(categorize(tx("PAVARDENE RUTA", -5000), rules, categories, "Jonas").isTransfer).toBe(true);
    expect(categorize(tx("Jonas Pavardenis", 20000), rules, categories, "Rūta").isTransfer).toBe(true);
    // Vardas paskirtyje (komunaliniai — buto savininkas) — ne pervedimas.
    expect(categorize(tx("UAB ADMI", -7977, "ADM:RŪTA PAVARDENĖ(1234567)"), rules, categories, "Rūta").isTransfer).toBe(false);
    expect(categorize(tx("UAB Darbdavys", 250000, "Atlyginimas už rugsėjį"), rules, categories, "Rūta")).toMatchObject({ isTransfer: false });
    expect(name(categorize(tx("UAB Darbdavys", 250000, "Atlyginimas už rugsėjį"), rules, categories, "Rūta").categoryId)).toBe("Rūta DU");
    expect(name(categorize(tx("BOLT.EU", -890), rules, categories, "Jonas").categoryId)).toBe("Taksi");
  });

  it("be finansų — tik nariai ir sritys; pašalintos sritys ir finansų grupės", async () => {
    const be = { ...PAVYZDYS, moduliai: ["asistentas"], pasalintos_sritys: ["Augintiniai"] };
    expect(seimosSql(be)).not.toContain("categories");
    const su = { ...PAVYZDYS, pasalintos_finansu_grupes: ["Augintiniai"], pasalintos_sritys: ["Augintiniai"] };
    const { d, exec } = base();
    await exec(seimosSql(su));
    expect(await d.prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Augintiniai'").first()).toEqual({ n: 0 });
    expect(await d.prepare("SELECT COUNT(*) AS n FROM rules WHERE value LIKE '%VETERINAR%'").first()).toEqual({ n: 0 });
    expect(await d.prepare("SELECT COUNT(*) AS n FROM task_areas WHERE name = 'Augintiniai'").first()).toEqual({ n: 0 });
  });

  it("klaidos — aiškiu sakiniu", () => {
    expect(() => seimosSql({ nariai: [] })).toThrow("„nariai“ — bent vienas šeimos narys.");
    expect(() => seimosSql({ nariai: [{ vardas: "Jonas" }] })).toThrow("„Jonas“ naudoja appsą, bet neturi el. pašto");
    expect(() => seimosSql({ nariai: [{ vardas: "Jonas", el_pastai: ["jonas"] }] })).toThrow("neatrodo kaip el. paštas");
    expect(() => seimosSql({ ...PAVYZDYS, sritys: { Vaikai: "Petras" } })).toThrow("tokio nario nėra");
    expect(() => seimosSql({ ...PAVYZDYS, moduliai: ["finansai", "pastas"] })).toThrow("nežinomas modulis „pastas“");
    expect(() => seimosSql({ ...PAVYZDYS, pasalintos_finansu_grupes: ["Kreditai"] })).toThrow("grupės „Kreditai“ šalinti negalima");
  });
});

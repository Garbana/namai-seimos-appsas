import { describe, expect, it } from "vitest";
import { ask } from "../src/ai/asistentas";
import { compact, financeFreshness, financeSubgroups, runFinanceTool } from "../src/ai/finansai";
import { buildContext } from "../src/ai/kontekstas";
import type { ContentBlock, ModelCaller, ModelRequest } from "../src/ai/modelis";
import { fakeD1, visaBaze } from "./d1-node";

const JONAS = 1;
/** 2026-10-10, šeštadienis, 9:00 Vilniuje. */
const NOW = new Date("2026-10-10T06:00:00Z");

/** Visa bazė (finansai ir darbai) su keliomis operacijomis. */
async function setup() {
  const d = visaBaze();
  await d.prepare("INSERT INTO accounts (id, bank, name, owner) VALUES (1, 'seb', 'SEB', 'Jonas'), (2, 'swedbank', 'Swedbank', 'Rūta')").run();
  const elektra = await d.prepare("SELECT id FROM categories WHERE name = 'Elektra ir dujos'").first<{ id: number }>();
  const ops: [number, string, number, string, number | null, number][] = [
    [1, "2026-09-03", -4520, "IGNITIS", elektra!.id, 0],
    [1, "2026-09-12", -2310, "MAXIMA LT", null, 0],
    [2, "2026-09-25", 250000, "DARBDAVYS UAB", null, 0],
    [1, "2026-09-28", -50000, "Jonas Pavardenis", null, 1],
    [2, "2026-10-04", -4710, "IGNITIS", elektra!.id, 0],
  ];
  for (const [acc, date, cents, name, cat, transfer] of ops) {
    await d
      .prepare("INSERT INTO transactions (account_id, booking_date, amount_cents, counterparty_name, category_id, is_transfer) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(acc, date, cents, name, cat, transfer)
      .run();
  }
  return d;
}

describe("finansų įrankiai", () => {
  it("mėnesių suvestinė — eurais, išlaidos teigiamais, pervedimai neįskaičiuoti", async () => {
    const d = await setup();
    const text = await runFinanceTool(d, "finance_months", { from_month: "2026-09", to_month: "2026-10" }, NOW);
    expect(text).toContain("2026-09: pajamos 2500, išlaidos 68.3, likutis 2431.7");
    expect(text).toMatch(/Komunaliniai \[grupė 1\] 45\.2/);
    expect(text).toContain("2026-10: pajamos 0, išlaidos 47.1");
  });

  it("grupės kategorijos", async () => {
    const d = await setup();
    const text = await runFinanceTool(d, "finance_group", { group_id: 1, from_month: "2026-09", to_month: "2026-10" }, NOW);
    expect(text).toMatch(/Elektra ir dujos \[kategorija \d+\]: 2026-09: 45\.2 \(1 op\.\), 2026-10: 47\.1 \(1 op\.\)/);
  });

  it("poskyris „Būreliai“ — visos būrelių kategorijos sudedamos; asistentas žino, kas yra būreliai", async () => {
    const d = await setup();
    const vaikai = (await d.prepare("SELECT id FROM categories WHERE name = 'Vaikai' AND parent_id IS NULL").first<{ id: number }>())!.id;
    const cat = async (name: string) => (await d.prepare("SELECT id FROM categories WHERE name = ? AND parent_id = ?").bind(name, vaikai).first<{ id: number }>())!.id;
    for (const [name, cents] of [["Būrelis — menai", -2000], ["Būrelis — sportas", -9000], ["Būrelis — kalbos", -7079], ["Žaislai ir knygos", -1500]] as const) {
      await d
        .prepare("INSERT INTO transactions (account_id, booking_date, amount_cents, counterparty_name, category_id) VALUES (1, '2026-09-20', ?, 'X', ?)")
        .bind(cents, await cat(name))
        .run();
    }
    const text = await runFinanceTool(d, "finance_group", { group_id: vaikai, from_month: "2026-09", to_month: "2026-09" }, NOW);
    expect(text).toMatch(/Būrelis — menai \[kategorija \d+\] \(poskyris „Būreliai“\): 2026-09: 20/);
    expect(text).toMatch(/Žaislai ir knygos \[kategorija \d+\]: 2026-09: 15/);
    expect(text).toContain("Poskyris „Būreliai“ iš viso: 2026-09: 180.79");

    const subgroups = await financeSubgroups(d);
    expect(subgroups).toContain(`Poskyris „Būreliai“ grupėje Vaikai (group_id ${vaikai}):`);
    for (const name of ["Būrelis — sportas", "Būrelis — menai", "Būrelis — kalbos"]) expect(subgroups).toContain(name);
    expect(await buildContext(d, JONAS, NOW)).toContain("Poskyris „Būreliai“ grupėje Vaikai");
  });

  it("operacijų paieška pagal gavėją", async () => {
    const d = await setup();
    const text = await runFinanceTool(d, "search_transactions", { search: "ignitis" }, NOW);
    expect(text).toContain("Rasta 2 operacijų: pajamos 0 €, išlaidos 92.3 €");
    expect(text).toContain("2026-10-04 -47.1 € IGNITIS [Komunaliniai / Elektra ir dujos] (Rūta)");
  });

  it("kiti ekranai (reguliarūs mokėjimai, biudžetai, turtas) — be klaidų", async () => {
    const d = await setup();
    for (const name of ["recurring_payments", "budgets", "savings", "credits", "insurance", "pensions"]) {
      const text = await runFinanceTool(d, name, {}, NOW);
      expect(text, name).not.toMatch(/^Nepavyko/);
      expect(() => JSON.parse(text), name).not.toThrow();
    }
  });

  it("kada įkelti išrašai", async () => {
    expect(await financeFreshness(await setup())).toBe("Banko operacijos įkeltos: Jonas — iki 2026-09-28, Rūta — iki 2026-10-04.");
    // Bazė be finansų lentelių.
    expect(await financeFreshness(visaBaze())).toBe("Banko operacijų dar neįkelta.");
    expect(await financeFreshness(fakeD1())).toBe("Finansų duomenų nėra.");
  });

  it("glaudinimas: centai → eurai, be tuščių ir sunkių laukų, ilgi sąrašai sutrumpinti", () => {
    expect(
      compact({ balanceCents: 123456, monthly_payment_cents: 9999, name: "Būstas", note: null, history: [1, 2], rate: 1.234567, list: [1, 2, 3] }, 2)
    ).toEqual({ balanceEur: 1234.56, monthly_paymentEur: 99.99, name: "Būstas", rate: 1.2346, list: [1, 2, "… ir dar 1"] });
  });
});

describe("asistentas su finansų įrankiais", () => {
  it("paprašo duomenų, gauna juos ir atsako; pokalbis tęsiamas su visais ėjimais", async () => {
    const d = await setup();
    const requests: ModelRequest[] = [];
    const responses: ContentBlock[][] = [
      [{ type: "tool_use", id: "r1", name: "finance_months", input: { from_month: "2026-09", to_month: "2026-09" } }],
      [{ type: "text", text: "Rugsėjį išleidote 68,30 €." }],
      [{ type: "text", text: "Elektrai — 45,20 €." }],
    ];
    const model: ModelCaller = async (request) => {
      requests.push(structuredClone(request));
      return { content: responses.shift()!, usage: { input_tokens: 1000, output_tokens: 50 }, model: "claude-haiku-5-5" };
    };

    const r = await ask(d, model, { tekstas: "Kiek išleidom praėjusį mėnesį?", memberId: JONAS }, NOW);
    expect(r).toMatchObject({ atsakymas: "Rugsėjį išleidote 68,30 €.", veiksmai: [], klaida: null });
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((t) => t.name)).toContain("search_transactions");
    expect(requests[0].context).toContain("Banko operacijos įkeltos: Jonas — iki 2026-09-28");
    const result = requests[1].messages[2].content[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(result.tool_use_id).toBe("r1");
    expect(result.content).toContain("2026-09: pajamos 2500, išlaidos 68.3");

    const row = await d.prepare("SELECT input_tokens, output_tokens FROM ai_requests WHERE id = ?").bind(r.id).first();
    expect(row).toEqual({ input_tokens: 2000, output_tokens: 100 });

    await ask(d, model, { tekstas: "O elektrai?", memberId: JONAS, pokalbisId: r.pokalbisId }, NOW);
    expect(requests[2].messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(requests[2].messages[4].content).toEqual([{ type: "text", text: "O elektrai?" }]);
  });

  it("ne daugiau kaip 4 duomenų užklausos vienai žinutei", async () => {
    const d = await setup();
    let calls = 0;
    const model: ModelCaller = async () => {
      calls++;
      return {
        content: [{ type: "tool_use", id: `r${calls}`, name: "finance_months", input: {} }],
        usage: { input_tokens: 10, output_tokens: 1 },
        model: "m",
      };
    };
    const r = await ask(d, model, { tekstas: "Viskas apie finansus", memberId: JONAS }, NOW);
    expect(calls).toBe(4);
    expect(r.klaida).toBeNull();
  });
});

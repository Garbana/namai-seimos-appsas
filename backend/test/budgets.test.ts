import { describe, expect, it } from "vitest";
import { NUMATYTA, summarizeBudgets, type BudgetInput, type BudgetRow } from "../src/budgets";

const riba = (categoryId: number, planned_cents: number, period = NUMATYTA): BudgetRow => ({
  id: categoryId,
  category_id: categoryId,
  period,
  planned_cents,
  note: null,
});

const input = (over: Partial<BudgetInput>): BudgetInput => ({
  budgets: [],
  grupes: [
    { id: 1, name: "Komunaliniai", sort_order: 10 },
    { id: 2, name: "Bendros išlaidos", sort_order: 20 },
    { id: 3, name: "Katės", sort_order: 30 },
  ],
  islaidos: [],
  paskirstymas: [],
  month: "2026-09",
  ...over,
});

describe("biudžeto ribos", () => {
  it("skaičiuoja būsenas pagal panaudotą ribos dalį", () => {
    const r = summarizeBudgets(
      input({
        budgets: [riba(1, 10000), riba(2, 10000), riba(3, 10000)],
        islaidos: [
          { group_id: 1, cents: 5000 }, // 50 %
          { group_id: 2, cents: 9000 }, // 90 %
          { group_id: 3, cents: 12000 }, // 120 %
        ],
      }),
      "2026-09-30"
    );

    expect(r.eilutes.map((e) => e.busena)).toEqual(["gerai", "baigiasi", "virsyta"]);
    expect(r.eilutes[0].leftCents).toBe(5000);
    expect(r.eilutes[2].leftCents).toBe(-2000);
    expect(r.totals.virsytos).toBe(1);
  });

  it("grupę be ribos rodo tik jei joje yra išlaidų", () => {
    const r = summarizeBudgets(
      input({
        budgets: [riba(1, 10000)],
        islaidos: [{ group_id: 2, cents: 4000 }],
      }),
      "2026-09-30"
    );

    expect(r.eilutes.map((e) => e.name)).toEqual(["Komunaliniai", "Bendros išlaidos"]);
    expect(r.eilutes[1].busena).toBe("neribota");
    expect(r.eilutes[1].plannedCents).toBeNull();
    expect(r.totals.beRibos).toBe(1);
    expect(r.totals.beRibosCents).toBe(4000);
    // Riba turinčių grupių suma neįtraukia neribotų išlaidų.
    expect(r.totals.plannedCents).toBe(10000);
    expect(r.totals.spentWithLimitCents).toBe(0);
    expect(r.totals.spentCents).toBe(4000);
  });

  it("einamąjį mėnesį skaičiuoja tempą ir prognozę pagal praėjusias dienas", () => {
    const r = summarizeBudgets(
      input({
        budgets: [riba(1, 30000)],
        islaidos: [{ group_id: 1, cents: 12000 }],
      }),
      "2026-09-10"
    );

    // Rugsėjis — 30 dienų, praėjo 10.
    expect(r.dienos).toEqual({ praejo: 10, viso: 30, dalis: 1 / 3 });
    expect(r.eilutes[0].tempasCents).toBe(10000);
    expect(r.eilutes[0].prognozeCents).toBe(36000);
    expect(r.totals.tempasCents).toBe(10000);
  });

  it("pasibaigusiam mėnesiui prognozė lygi faktui", () => {
    const r = summarizeBudgets(
      input({
        budgets: [riba(1, 30000)],
        islaidos: [{ group_id: 1, cents: 12000 }],
        month: "2026-08",
      }),
      "2026-09-10"
    );

    expect(r.dienos).toEqual({ praejo: 31, viso: 31, dalis: 1 });
    expect(r.eilutes[0].prognozeCents).toBe(12000);
    expect(r.eilutes[0].tempasCents).toBe(30000);
  });

  it("mėnesio išimtis nustelbia numatytąją ribą", () => {
    const r = summarizeBudgets(
      input({
        budgets: [riba(1, 10000), riba(1, 25000, "2026-09"), riba(2, 5000, "2026-08")],
        islaidos: [{ group_id: 1, cents: 12000 }],
      }),
      "2026-09-30"
    );

    expect(r.eilutes[0].plannedCents).toBe(25000);
    expect(r.eilutes[0].periodas).toBe("2026-09");
    expect(r.eilutes[0].busena).toBe("gerai");
    // Kito mėnesio išimtis šiam mėnesiui negalioja.
    expect(r.eilutes.find((e) => e.categoryId === 2)).toBeUndefined();
  });

  it("dalija išlaidas pagal 50/30/20 taisyklę", () => {
    const r = summarizeBudgets(
      input({
        paskirstymas: [
          { necessity: "butinosios", cents: 60000 },
          { necessity: "norai", cents: 30000 },
          { necessity: "taupymas", cents: 10000 },
        ],
      }),
      "2026-09-30"
    );

    expect(r.paskirstymas.map((p) => [p.necessity, p.dalis, p.tikslas])).toEqual([
      ["butinosios", 0.6, 0.5],
      ["norai", 0.3, 0.3],
      ["taupymas", 0.1, 0.2],
    ]);
  });

  it("be išlaidų dalys lygios nuliui, o ne NaN", () => {
    const r = summarizeBudgets(input({}), "2026-09-30");
    expect(r.paskirstymas.every((p) => p.dalis === 0)).toBe(true);
    expect(r.totals.pct).toBeNull();
  });
});

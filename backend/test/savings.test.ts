import { describe, expect, it } from "vitest";
import {
  entryCentsFor,
  suggestGoal,
  summarizeSavings,
  type CandidateRow,
  type EntryRow,
  type GoalRow,
  type SavingsInput,
  type ValuationRow,
} from "../src/savings";

const TODAY = "2026-09-16";

const tikslas = (over: Partial<GoalRow>): GoalRow => ({
  id: 1,
  code: "rezervas",
  name: "Rūtos rezervas",
  owner: "Rūta",
  kind: "rezervas",
  where_kept: "E. taupyklė",
  target_cents: null,
  target_date: null,
  monthly_plan_cents: null,
  match_keywords: "[]",
  note: null,
  is_active: 1,
  sort_order: 10,
  category_id: null,
  interest_category_id: null,
  ...over,
});

const irasas = (over: Partial<EntryRow>): EntryRow => ({
  id: 1,
  goal_id: 1,
  date: "2026-05-30",
  cents: 21000,
  kind: "inasas",
  transaction_id: null,
  source: "excel",
  note: null,
  ...over,
});

const verte = (over: Partial<ValuationRow>): ValuationRow => ({
  id: 1,
  goal_id: 1,
  date: "2026-08-31",
  value_cents: 100000,
  source: "rankinis",
  note: null,
  ...over,
});

const kandidatas = (over: Partial<CandidateRow>): CandidateRow => ({
  id: 100,
  booking_date: "2026-09-16",
  amount_cents: -51000,
  counterparty_name: "Jonas Pavardenis",
  description: "Investavimui",
  account_owner: "Jonas",
  iban_last4: "4254",
  ...over,
});

const input = (over: Partial<SavingsInput>): SavingsInput => ({
  goals: [],
  entries: [],
  valuations: [],
  candidates: [],
  ...over,
});

describe("taupymas", () => {
  it("be įvestos vertės sukaupta suma yra įnašų ir išėmimų suma", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({})],
        entries: [
          irasas({ id: 1, date: "2026-04-30", cents: 21000 }),
          irasas({ id: 2, date: "2026-05-30", cents: 21000 }),
          irasas({ id: 3, date: "2026-06-30", cents: 21450 }),
          irasas({ id: 4, date: "2026-06-30", cents: 320, kind: "palukanos" }),
          irasas({ id: 5, date: "2026-07-10", cents: -10000, kind: "isemimas" }),
        ],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.valueCents).toBe(53770);
    expect(g.contributedCents).toBe(63450);
    expect(g.withdrawnCents).toBe(10000);
    expect(g.interestCents).toBe(320);
    // Be tikros vertės augimo nėra iš kur paimti.
    expect(g.gainCents).toBeNull();
  });

  it("įvedus tikrą vertę nuo jos skaičiuojama toliau ir matomas uždarbis", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ kind: "investicijos", name: "Jono ETF", owner: "Jonas" })],
        entries: [
          irasas({ id: 1, date: "2026-06-30", cents: 46200 }),
          irasas({ id: 2, date: "2026-09-16", cents: 51000 }),
        ],
        valuations: [verte({ date: "2026-08-31", value_cents: 50000 })],
      }),
      TODAY
    );

    const g = r.goals[0];
    // 500 € vertė rugpjūčio 31 d. + 510 € įnašas po jos.
    expect(g.valueCents).toBe(101000);
    expect(g.valueEstimated).toBe(true);
    // Įnešta 972 €, verta 1010 € — 38 € uždirbta.
    expect(g.gainCents).toBe(3800);
    expect(g.lastValuation?.date).toBe("2026-08-31");
  });

  it("skaičiuoja, kiek liko iki tikslo ir po kiek reikia atidėti", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ target_cents: 1000000, target_date: "2029-07-31", monthly_plan_cents: 25000 })],
        entries: [irasas({ id: 1, date: "2026-09-06", cents: 137030 })],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.leftCents).toBe(862970);
    expect(g.monthsLeft).toBe(34);
    expect(g.neededMonthlyCents).toBe(Math.ceil(862970 / 34));
    expect(g.thisMonthCents).toBe(137030);
    expect(g.progress).toBeCloseTo(0.137, 3);
  });

  it("pervedimą siūlo tam katiliukui, kurio raktažodis ir savininkas sutampa", () => {
    const goals = [
      tikslas({ id: 1, code: "rūtos-rezervas", owner: "Rūta", match_keywords: '["taupymui"]', sort_order: 10 }),
      tikslas({
        id: 2,
        code: "jono-investicijos",
        name: "Jono investicijos",
        owner: "Jonas",
        match_keywords: '["investavimui", "taupymui"]',
        sort_order: 30,
      }),
      tikslas({
        id: 3,
        code: "emos-pagalve",
        name: "Emos pagalvė",
        owner: "Ema",
        match_keywords: '["emos pinigai"]',
        sort_order: 20,
      }),
    ];

    // Rūtos sąskaitos „Taupymui" — jos rezervas, ne Jono.
    expect(
      suggestGoal(kandidatas({ description: "Taupymui", account_owner: "Rūta" }), goals)?.code
    ).toBe("rūtos-rezervas");
    // Jono „Investavimui" — jo investicijos.
    expect(suggestGoal(kandidatas({ description: "Investavimui" }), goals)?.code).toBe("jono-investicijos");
    // Emos pinigus perveda Jonas, tad savininkas nesutampa, bet raktažodis aiškus.
    expect(
      suggestGoal(kandidatas({ description: "Emos pinigai 08-09" }), goals)?.code
    ).toBe("emos-pagalve");
    expect(suggestGoal(kandidatas({ description: "Pinigų pervedimas" }), goals)).toBeNull();
  });

  it("išlaida yra įnašas, o įplauka — išėmimas", () => {
    expect(entryCentsFor(-25000)).toBe(25000);
    expect(entryCentsFor(100000)).toBe(-100000);

    const r = summarizeSavings(
      input({
        goals: [tikslas({ match_keywords: '["taupyklės"]' })],
        candidates: [
          kandidatas({
            id: 200,
            amount_cents: 100000,
            description: "Pervedimas iš E. taupyklės",
            account_owner: "Rūta",
          }),
        ],
      }),
      TODAY
    );

    expect(r.candidates[0].centsIfAssigned).toBe(-100000);
    expect(r.candidates[0].suggestedCode).toBe("rezervas");
    expect(r.totals.unassignedCount).toBe(1);
  });

  it("jau priskirtų pervedimų tarp kandidatų nerodo", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({})],
        entries: [irasas({ id: 1, transaction_id: 100, source: "pervedimas", cents: 51000 })],
        candidates: [kandidatas({ id: 100 }), kandidatas({ id: 101, description: "Kažkas kita" })],
      }),
      TODAY
    );

    expect(r.candidates.map((c) => c.id)).toEqual([101]);
  });

  it("fondo vienetai sumuojami, o vertė imama pagal naujausią kainą", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ kind: "investicijos", name: "Jono investicijos", owner: "Jonas" })],
        entries: [
          irasas({ id: 1, date: "2026-07-15", cents: 46200, source: "pervedimas" }),
          irasas({ id: 2, date: "2026-09-16", cents: 51000, source: "pervedimas" }),
        ],
        funds: [
          {
            id: 1,
            goal_id: 1,
            symbol: "VWCE.DE",
            name: "Vanguard FTSE All-World",
            currency: "EUR",
            price_source: "yahoo",
            sort_order: 10,
          },
        ],
        purchases: [
          { id: 1, fund_id: 1, date: "2026-07-16", units: 2.78648974, unit_price: 165.8, cents: 46200, source: "israsas", note: null },
          { id: 2, fund_id: 1, date: "2026-09-16", units: 3.06564077, unit_price: 166.36, cents: 51000, source: "israsas", note: null },
        ],
        prices: [
          { isin: "VWCE.DE", date: "2026-07-16", price: 165.8 },
          { isin: "VWCE.DE", date: "2026-08-03", price: 160 },
          { isin: "VWCE.DE", date: "2026-09-16", price: 166.3 },
        ],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.funds[0].units).toBeCloseTo(5.85213051, 8);
    expect(g.investedCents).toBe(97200);
    // Visi įnašai jau investuoti, tad neinvestuotų pinigų nelieka.
    expect(g.cashCents).toBe(0);
    expect(g.valueCents).toBe(g.fundsValueCents);
    expect(g.gainCents).toBe(g.fundsValueCents - 97200);
    expect(g.funds[0].price).toBe(166.3);
    expect(g.funds[0].priceDate).toBe("2026-09-16");
  });

  it("neinvestuoti pinigai lieka katiliuke", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({})],
        entries: [irasas({ id: 1, date: "2026-08-09", cents: 25000, source: "pervedimas" })],
        funds: [
          { id: 1, goal_id: 1, symbol: "VWCE.DE", name: "VWCE", currency: "EUR", price_source: "yahoo", sort_order: 10 },
        ],
        purchases: [
          { id: 1, fund_id: 1, date: "2026-08-10", units: 0.5, unit_price: 168.96, cents: 8448, source: "rankinis", note: null },
        ],
        prices: [{ isin: "VWCE.DE", date: "2026-08-10", price: 168.96 }],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.cashCents).toBe(25000 - 8448);
    expect(g.valueCents).toBe(g.fundsValueCents + g.cashCents);
  });

  it("grafikas rodo portfelio vertę pagal dienas nuo pirmo pirkimo", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({})],
        funds: [
          { id: 1, goal_id: 1, symbol: "VWCE.DE", name: "VWCE", currency: "EUR", price_source: "yahoo", sort_order: 10 },
        ],
        purchases: [
          { id: 1, fund_id: 1, date: "2026-07-16", units: 2.78648974, unit_price: 165.8, cents: 46200, source: "israsas", note: null },
        ],
        prices: [
          // Diena prieš pirkimą į grafiką nepatenka — portfelio dar nebuvo.
          { isin: "VWCE.DE", date: "2026-07-01", price: 164 },
          { isin: "VWCE.DE", date: "2026-07-16", price: 165.8 },
          { isin: "VWCE.DE", date: "2026-09-16", price: 166.3 },
        ],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.chart.map((p) => p.date)).toEqual(["2026-07-16", "2026-09-16"]);
    expect(g.chart[0].valueCents).toBe(46200);
    expect(g.chart.at(-1)!.valueCents).toBe(g.fundsValueCents);
  });

  it("kategorijai priskirtos operacijos pačios tampa įnašais", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ category_id: 110, interest_category_id: 120 })],
        transactions: [
          // Išlaida — įnašas į katiliuką.
          { id: 500, booking_date: "2026-09-06", amount_cents: -25000, category_id: 110, counterparty_name: "RŪTA", description: "Taupymui" },
          // Įplauka toje pačioje kategorijoje — išėmimas.
          { id: 501, booking_date: "2026-09-10", amount_cents: 10000, category_id: 110, counterparty_name: "RŪTA", description: "Pervedimas iš E. taupyklės" },
          // Palūkanos ateina kaip įplauka, bet katiliuką didina.
          { id: 502, booking_date: "2026-09-08", amount_cents: 323, category_id: 120, counterparty_name: null, description: "Indėlio palūkanų suma" },
          // Svetima kategorija — neliečiama.
          { id: 503, booking_date: "2026-09-09", amount_cents: -5000, category_id: 999, counterparty_name: null, description: "Kažkas kita" },
        ],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.valueCents).toBe(25000 - 10000 + 323);
    expect(g.entries.map((e) => e.transactionId)).toEqual([501, 502, 500]);
    expect(g.entries.every((e) => e.source === "kategorija")).toBe(true);
    expect(g.interestCents).toBe(323);
    expect(g.withdrawnCents).toBe(10000);
  });

  it("operacija, kuri jau turi įrašą, neskaičiuojama dukart", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ category_id: 110 })],
        entries: [irasas({ id: 1, date: "2026-09-16", cents: 51000, source: "pervedimas", transaction_id: 500 })],
        transactions: [
          { id: 500, booking_date: "2026-09-16", amount_cents: -51000, category_id: 110, counterparty_name: null, description: "Investavimui" },
        ],
      }),
      TODAY
    );

    expect(r.goals[0].valueCents).toBe(51000);
    expect(r.goals[0].entries).toHaveLength(1);
  });

  it("grąžą rodo ir procentais", () => {
    const r = summarizeSavings(
      input({
        goals: [tikslas({ category_id: 110 })],
        transactions: [
          { id: 500, booking_date: "2026-07-16", amount_cents: -100000, category_id: 110, counterparty_name: null, description: "Investavimui" },
        ],
        funds: [
          { id: 1, goal_id: 1, symbol: "VWCE.DE", name: "VWCE", currency: "EUR", price_source: "yahoo", sort_order: 10 },
        ],
        purchases: [
          { id: 1, fund_id: 1, date: "2026-07-16", units: 10, unit_price: 100, cents: 100000, source: "rankinis", note: null },
        ],
        prices: [{ isin: "VWCE.DE", date: "2026-09-16", price: 110 }],
      }),
      TODAY
    );

    const g = r.goals[0];
    expect(g.fundsValueCents).toBe(110000);
    expect(g.gainCents).toBe(10000);
    expect(g.gainPct).toBe(10);
    expect(g.funds[0].gainPct).toBe(10);
    expect(r.totals.gainPct).toBe(10);
  });

  it("suvestinėje sumuoja visus katiliukus", () => {
    const r = summarizeSavings(
      input({
        goals: [
          tikslas({ id: 1, code: "a", monthly_plan_cents: 25000 }),
          tikslas({ id: 2, code: "b", name: "Atostogos", kind: "tikslas", monthly_plan_cents: 10000 }),
        ],
        entries: [
          irasas({ id: 1, goal_id: 1, date: "2026-09-06", cents: 25000, source: "pervedimas" }),
          irasas({ id: 2, goal_id: 2, date: "2026-09-06", cents: 23525, source: "pervedimas" }),
          irasas({ id: 3, goal_id: 2, date: "2026-08-09", cents: 29452, source: "pervedimas" }),
        ],
      }),
      TODAY
    );

    expect(r.totals.valueCents).toBe(77977);
    expect(r.totals.thisMonthCents).toBe(48525);
    expect(r.totals.monthlyPlanCents).toBe(35000);
    expect(r.goals.map((g) => g.code)).toEqual(["a", "b"]);
  });
});

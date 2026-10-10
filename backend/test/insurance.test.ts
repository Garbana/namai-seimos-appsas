import { describe, expect, it } from "vitest";
import { summarizeInsurance, type InsurancePolicyRow } from "../src/insurance";

const row = (over: Partial<InsurancePolicyRow>): InsurancePolicyRow => ({
  id: 1,
  code: "x",
  policy_no: "P1",
  kind: "bustas",
  object_group: "Būstas",
  title: "Būsto draudimas",
  insurer: "Draudikas",
  policyholder: "A",
  insured: "Butas",
  beneficiary: null,
  contract_start: null,
  contract_end: null,
  period_start: "2025-09-30",
  period_end: "2026-09-29",
  premium_cents: 9734,
  security_levy_cents: 0,
  monthly_cents: 811,
  payment_category_id: 20,
  pension_product_code: null,
  coverages: "[]",
  conditions: "[]",
  schedule: JSON.stringify([{ data: "2026-08-31", cents: 811 }]),
  changes: "[]",
  notes: "[]",
  investment: null,
  sort_order: 60,
  ...over,
});

describe("summarizeInsurance", () => {
  const rows = [
    row({ id: 1, code: "bustas-2025" }),
    row({
      id: 2,
      code: "bustas-2026",
      period_start: "2026-09-30",
      period_end: "2027-09-29",
      premium_cents: 12447,
      security_levy_cents: 1132,
      monthly_cents: 1037,
      schedule: JSON.stringify([{ data: "2026-09-29", cents: 1040 }, { data: "2026-10-31", cents: 1037 }]),
      changes: JSON.stringify(["CA 15 000 → 30 000"]),
    }),
    row({
      id: 3,
      code: "pzu",
      policy_no: "PZU1",
      kind: "gyvybes",
      object_group: "Ema",
      insured: "Ema",
      contract_start: "2021-05-28",
      contract_end: "2046-05-27",
      period_start: "2026-05-28",
      period_end: "2027-05-27",
      premium_cents: 58800,
      monthly_cents: 4900,
      payment_category_id: 21,
      schedule: "[]",
      coverages: JSON.stringify([{ rizika: "Kritinės ligos", suma_cents: 1500000, iki: "2045-05-27" }]),
      sort_order: 30,
    }),
    row({
      id: 4,
      code: "tpvca",
      policy_no: "T1",
      kind: "civiline",
      object_group: "Automobilis",
      period_start: "2026-02-04",
      period_end: "2027-02-03",
      premium_cents: 21217,
      monthly_cents: null,
      payment_category_id: 19,
      schedule: JSON.stringify([{ data: "2026-02-04", cents: 21217 }]),
      sort_order: 50,
    }),
  ];
  const payments = [
    { booking_date: "2026-08-28", amount_cents: -811, category_id: 20, history: 0 },
    { booking_date: "2026-08-27", amount_cents: -4900, category_id: 21, history: 0 },
    { booking_date: "2026-08-24", amount_cents: -5460, category_id: 19, history: 0 },
    { booking_date: "2026-02-15", amount_cents: -24671, category_id: 19, history: 1 },
  ];
  const s = summarizeInsurance(rows, payments, "2026-09-15");

  it("atnaujinama metinė sutartis: galiojantis ir būsimas laikotarpis su tuo pačiu poliso numeriu", () => {
    const bustas = s.policies.find((p) => p.policyNo === "P1")!;
    expect(bustas.code).toBe("bustas-2025");
    expect(bustas.status).toBe("galioja");
    expect(bustas.upcoming?.monthlyCents).toBe(1037);
    expect(bustas.upcoming?.changes).toEqual(["CA 15 000 → 30 000"]);
    expect(bustas.nextPayment).toEqual({ date: "2026-09-29", cents: 1040, estimated: false });
    expect(bustas.lastPayment).toEqual({ date: "2026-08-28", cents: 811 });
  });

  it("gyvybės draudimas: kita įmoka apskaičiuojama nuo paskutinio nurašymo, grupės eina žmonės pirma", () => {
    const pzu = s.policies.find((p) => p.policyNo === "PZU1")!;
    expect(pzu.nextPayment).toEqual({ date: "2026-09-27", cents: 4900, estimated: true });
    expect(s.policies.map((p) => p.objectGroup)).toEqual(["Ema", "Automobilis", "Būstas"]);
  });

  it("nurašymas priskiriamas polisui tik kai suma atitinka jo įmokas (istorija neįskaitoma)", () => {
    const tpvca = s.policies.find((p) => p.policyNo === "T1")!;
    expect(tpvca.lastPayment).toBeNull();
    expect(tpvca.monthlyEquivalentCents).toBe(1768);
  });

  it("sumos ir artėjantys įvykiai", () => {
    expect(s.totals.monthlyEquivalentCents).toBe(811 + 4900 + 1768);
    expect(s.totals.yearlyCents).toBe(9734 + 58800 + 21217);
    expect(s.totals.monthlyAfterChangesCents).toBe(1037 + 4900 + 1768);
    expect(s.totals.nextChangeDate).toBe("2026-09-30");
    const titles = s.events.map((e) => `${e.date} ${e.title}`);
    expect(titles).toContain("2026-09-30 Būstas: būsto draudimas — naujas laikotarpis");
    expect(titles).toContain("2027-02-03 Automobilis: privalomasis draudimas — baigiasi, reikės atnaujinti");
    expect(titles).toContain("2027-05-28 Ema: gyvybės draudimas — sutarties metinės (įmoka ir sumos gali būti indeksuojamos)");
    expect(titles).toContain("2045-05-27 Ema: baigiasi „Kritinės ligos“");
  });
});

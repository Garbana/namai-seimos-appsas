import { describe, expect, it } from "vitest";
import { extractCountry } from "../src/parsers/csv";
import { categorize, type CategoryRow, type Rule } from "../src/rules";

const KATEGORIJOS: CategoryRow[] = [
  { id: 1, name: "Bendros išlaidos", parent_id: null },
  { id: 2, name: "Kavinės", parent_id: 1 },
  { id: 3, name: "Atostogos – transportas", parent_id: 1 },
  { id: 4, name: "Automobilis", parent_id: null },
  { id: 5, name: "Kuras", parent_id: 4 },
];

const taisykle = (dalis: Partial<Rule>): Rule => ({
  id: 1,
  priority: 100,
  field: "any",
  operator: "regex",
  value: "NESTE",
  category_id: null,
  owner_category_name: null,
  mark_transfer: 0,
  direction: null,
  country_scope: null,
  amount_min_cents: null,
  amount_max_cents: null,
  ...dalis,
});

const operacija = (dalis: Partial<Parameters<typeof categorize>[0]> = {}) => ({
  counterpartyName: "NESTE LIETUVA",
  description: "Degalai",
  amountCents: -4500,
  country: "LTU",
  ...dalis,
});

describe("šalies kodo atpažinimas", () => {
  it("randa SEB kortelės operacijos šalį", () => {
    expect(
      extractCountry("07/07/2026 20:02 kortelė...000123 K-supermarket/HELSINKI/FIN #772170")
    ).toBe("FIN");
    expect(
      extractCountry("30/06/2026 12:10 kortelė...000123 UAB PARDUOTUVE/VILNIUS/LTU #043860")
    ).toBe("LTU");
  });

  it("randa Swedbank adreso formato šalį", () => {
    expect(extractCountry("UAB EUROVAISTINE\\TUSKULENU G. 66\\VILNIUS\\09208\\LTULTU")).toBe("LTU");
  });

  it("nespėja, kai šalies nenurodyta", () => {
    expect(extractCountry("PIRKINYS 400000 2026.07.18 3.69 EUR (984621) MAISTO PREKES TRAKU R.")).toBeNull();
    expect(extractCountry(null)).toBeNull();
  });
});

describe("sumos rėžiai taisyklėse", () => {
  const smulkus = taisykle({ id: 10, priority: 10, category_id: 2, amount_max_cents: 1000 });
  const kuras = taisykle({ id: 11, priority: 50, category_id: 5 });

  it("smulkus pirkinys degalinėje keliauja į kavines", () => {
    const verdict = categorize(operacija({ amountCents: -650 }), [smulkus, kuras], KATEGORIJOS, null);
    expect(verdict.categoryId).toBe(2);
  });

  it("pilnas bakas lieka kuru", () => {
    const verdict = categorize(operacija({ amountCents: -6500 }), [smulkus, kuras], KATEGORIJOS, null);
    expect(verdict.categoryId).toBe(5);
  });
});

describe("šalies sąlyga taisyklėse", () => {
  const uzsienyje = taisykle({ id: 20, priority: 10, category_id: 3, country_scope: "foreign" });
  const kuras = taisykle({ id: 21, priority: 50, category_id: 5 });

  it("degalai užsienyje virsta atostogų transportu", () => {
    const verdict = categorize(operacija({ country: "FIN" }), [uzsienyje, kuras], KATEGORIJOS, null);
    expect(verdict.categoryId).toBe(3);
  });

  it("degalai Lietuvoje lieka kuru", () => {
    const verdict = categorize(operacija({ country: "LTU" }), [uzsienyje, kuras], KATEGORIJOS, null);
    expect(verdict.categoryId).toBe(5);
  });

  it("nežinant šalies užsienio taisyklė nesuveikia", () => {
    const verdict = categorize(operacija({ country: null }), [uzsienyje, kuras], KATEGORIJOS, null);
    expect(verdict.categoryId).toBe(5);
  });
});

describe("vidinių pervedimų atpažinimas", () => {
  it("šeimos vardas mokėjimo paskirtyje nepaverčia mokesčio pervedimu", () => {
    const rule = taisykle({
      id: 30,
      priority: 11,
      field: "counterparty",
      value: "RŪTA PAVARDEN",
      mark_transfer: 1,
    });

    const komunaliniai = categorize(
      {
        counterpartyName: "Admi UAB",
        description: "NIPS10000 ADM:RŪTA PAVARDENIENĖ(1234567):79.77",
        amountCents: -7977,
        country: null,
      },
      [rule],
      KATEGORIJOS,
      null
    );
    expect(komunaliniai.isTransfer).toBe(false);

    const pervedimas = categorize(
      {
        counterpartyName: "RŪTA PAVARDENIENĖ",
        description: "Pinigų pervedimas",
        amountCents: -5000,
        country: null,
      },
      [rule],
      KATEGORIJOS,
      null
    );
    expect(pervedimas.isTransfer).toBe(true);
  });
});

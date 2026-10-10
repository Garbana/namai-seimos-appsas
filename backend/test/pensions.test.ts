import { describe, expect, it } from "vitest";
import {
  buildPriceIndex,
  gpmRefundCents,
  holdingUnitsAt,
  parseSebFundPage,
  parseSwedbankFundList,
  summarizePensions,
  xirr,
  type HoldingRow,
  type PensionInput,
  type PensionProductRow,
} from "../src/pensions";

const product = (over: Partial<PensionProductRow>): PensionProductRow => ({
  id: 1,
  code: "p",
  owner: "A",
  pillar: "II",
  name: "II pakopa",
  provider: null,
  fund_label: null,
  contract_no: null,
  start_date: null,
  end_date: null,
  valuation: "vienetai",
  monthly_contribution_cents: null,
  contribution_day: null,
  contribution_category_id: null,
  gpm: 0,
  gpm_portfolio: null,
  gpm_payer: null,
  details: null,
  sort_order: 0,
  ...over,
});

describe("xirr", () => {
  it("vienkartinė investicija, uždirbusi 10 % per metus", () => {
    const r = xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 1100 },
    ]);
    expect(r).toBeCloseTo(0.1, 3);
  });

  it("be teigiamo ar neigiamo srauto grąžina null", () => {
    expect(xirr([{ date: "2021-01-01", amount: -1000 }])).toBeNull();
  });
});

describe("gpmRefundCents", () => {
  it("20 % nuo įmokų, bet ne daugiau kaip nuo 1 500 €", () => {
    expect(gpmRefundCents(60_000)).toBe(12_000);
    expect(gpmRefundCents(200_000)).toBe(30_000);
  });
});

describe("parseSebFundPage", () => {
  it("atpažįsta vertę su data skliaustuose", () => {
    const html = "<td>Vieneto vert&#279;</td><td>2,3469 (2026-09-10)</td>";
    expect(parseSebFundPage(html)).toEqual({ price: 2.3469, date: "2026-09-10" });
  });

  it("praleidžia antraštę ir datą ima iš „Data“ eilutės", () => {
    const html =
      "<h3>Vieneto vertė ir rizikos rodikliai</h3><table><tr><td>Vieneto vertė*</td><td>10,02810 EUR</td></tr></table>" +
      "<p>* Prieš tai buvusios darbo dienos kaina.</p><p>Data 2026-09-10</p>";
    expect(parseSebFundPage(html)).toEqual({ price: 10.0281, date: "2026-09-10" });
  });

  it("be vertės grąžina null", () => {
    expect(parseSebFundPage("<p>Prisijunkite</p>")).toBeNull();
  });
});

describe("parseSwedbankFundList", () => {
  const html = `
    <tr id="tableRow2"><td><a href="javascript:linkAction('x','tunnusnr','PE1996_2002')">Pensija 1996-2002</a></td>
      <td><span class="units">EUR</span></td><td>2026 09 10</td><td>2.1437</td></tr>
    <tr id="tableRow3"><td><a href="javascript:linkAction('x','tunnusnr','PE1989_1995')">Pensija 1989-1995</a></td>
      <td><span class="units">EUR</span></td>
      <td>2026 09 10</td>
      <td>2.1630</td>
      <td><ui-percentchange value="-0.62"></ui-percentchange></td></tr>`;

  it("randa fondo eilutę pagal kodą", () => {
    expect(parseSwedbankFundList(html, "PE1989_1995")).toEqual({ price: 2.163, date: "2026-09-10" });
  });

  it("nežinomam kodui grąžina null", () => {
    expect(parseSwedbankFundList(html, "PE2003_2009")).toBeNull();
  });

  it("Swedbank Life kryptys: praleidžia lentelę be kainos, supranta td atributus", () => {
    const life = `
      <tr><td><a href="javascript:linkAction('d','id','1541' , 'nominal' , 'true')">Pasaulio akcijų investavimo kryptis</a></td>
        <td><ui-percentchange value="-0.76"></ui-percentchange></td></tr>
      <tr class="fund-row"><td class="fund-name"><a href="javascript:linkAction('d','id','1541' , 'nominal' , 'true')">Pasaulio akcijų investavimo kryptis</a></td>
        <td>EUR</td>
        <td class="-nowrap">2026 09 10</td>
        <td class="col-pull-right">201.32</td></tr>`;
    expect(parseSwedbankFundList(life, "1541", "id")).toEqual({ price: 201.32, date: "2026-09-10" });
  });
});

describe("GPM lengvata", () => {
  const imoka = (date: string, portfolio: string, cents: number) => ({
    product_id: 5, portfolio, date, kind: "imoka" as const, amount_cents: cents, isin: null, units: null, price: null,
  });
  const s = summarizePensions(
    {
      products: [
        product({ id: 5, code: "iii", owner: "A", pillar: "III", valuation: "rankinis", gpm: 1, gpm_portfolio: "Papildoma" }),
        product({
          id: 6,
          code: "pzu",
          owner: "Vaikas",
          pillar: "PZU",
          valuation: "rankinis",
          gpm: 1,
          gpm_payer: "A",
          monthly_contribution_cents: 1000,
          contribution_category_id: 7,
        }),
      ],
      holdings: [],
      operations: [
        imoka("2024-01-02", "Pagrindinė", 8000), imoka("2024-01-02", "Papildoma", 4000),
        imoka("2024-02-02", "Pagrindinė", 8000), imoka("2024-02-02", "Papildoma", 4000),
        imoka("2024-03-02", "Pagrindinė", 8000), imoka("2024-03-02", "Papildoma", 4000),
      ],
      valuations: [],
      prices: [],
      payments: [
        { booking_date: "2023-12-15", amount_cents: -1000, category_id: 7, owner: "Bendra", history: 1 },
        { booking_date: "2024-01-15", amount_cents: -1000, category_id: 7, owner: "Bendra", history: 1 },
        { booking_date: "2024-02-14", amount_cents: -1000, category_id: 7, owner: "E", history: 0 },
      ],
      people: [],
    },
    "2024-03-05"
  );
  const iii = s.products.find((p) => p.code === "iii")!;
  const pzu = s.products.find((p) => p.code === "pzu")!;

  it("skaičiuojama tik nuo tinkamos sutarties dalies (pagrindinę moka darbdavys)", () => {
    expect(iii.gpm).toEqual({ payer: "A", paidCents: 12_000, projectedCents: 12_000 + 4000 * 9, portfolio: "Papildoma" });
  });

  it("PZU: įmokos ir iš Excel istorijos, mokėtojas nurodytas, šį mėnesį dar nesumokėta", () => {
    expect(pzu.gpm).toEqual({ payer: "A", paidCents: 2000, projectedCents: 2000 + 1000 * 10, portfolio: null });
    expect(pzu.contributions.totalCents).toBe(3000);
  });
});

describe("rankinė vertė su krypčių kainomis", () => {
  const s = summarizePensions(
    {
      products: [product({ id: 3, code: "life", owner: "E", pillar: "III", valuation: "rankinis" })],
      holdings: [
        { product_id: 3, portfolio: "", isin: "A", fund_name: "A", price_source: "swedbank:life:1", units: null, units_date: null, share: 0.5, portfolio_monthly_cents: null },
        { product_id: 3, portfolio: "", isin: "B", fund_name: "B", price_source: "swedbank:life:2", units: null, units_date: null, share: 0.5, portfolio_monthly_cents: null },
      ],
      operations: [
        { product_id: 3, portfolio: "", date: "2024-02-10", kind: "imoka", amount_cents: 5000, isin: null, units: null, price: null },
      ],
      valuations: [
        { id: 1, product_id: 3, date: "2024-01-31", value_cents: 100_000, contributed_total_cents: null, source: "ataskaita", note: null },
      ],
      prices: [
        { isin: "A", date: "2024-01-31", price: 10 },
        { isin: "B", date: "2024-01-29", price: 20 },
        { isin: "A", date: "2024-03-01", price: 11 },
        { isin: "B", date: "2024-03-01", price: 20 },
      ],
      payments: [],
      people: [],
    },
    "2024-03-05"
  );
  const life = s.products[0];

  it("vertė = įvesta vertė × krypčių kainų pokytis + vėlesnės įmokos, pažymima kaip apytikslė", () => {
    expect(life.valueCents).toBe(110_000);
    expect(life.valueDate).toBe("2024-03-01");
    expect(life.valueEstimated).toBe(true);
  });
});

describe("holdingUnitsAt su operacijomis ir žinomu likučiu", () => {
  const index = buildPriceIndex([{ isin: "S", date: "2023-01-01", price: 2 }]);
  const holding: HoldingRow = {
    product_id: 1,
    portfolio: "",
    isin: "S",
    fund_name: "Fondas",
    price_source: null,
    units: 100,
    units_date: "2024-06-30",
    share: 1,
    portfolio_monthly_cents: null,
  };
  const op = (date: string, units: number) => ({
    product_id: 1, portfolio: "", date, kind: "imoka" as const, amount_cents: 1000, isin: "S", units, price: 2,
  });
  const ops = [op("2024-01-12", 10), op("2024-06-12", 5), op("2024-07-12", 4)];

  it("pradinis likutis = žinomas likutis − vėlesnės operacijos", () => {
    expect(holdingUnitsAt(holding, ops, index, "2023-12-31", null)?.units).toBeCloseTo(85, 9);
    expect(holdingUnitsAt(holding, ops, index, "2024-02-01", null)?.units).toBeCloseTo(95, 9);
  });

  it("po likučio datos pridedamos tikros operacijos", () => {
    expect(holdingUnitsAt(holding, ops, index, "2024-07-20", null)).toEqual({ units: 104, estimated: false });
  });
});

describe("holdingUnitsAt", () => {
  const index = buildPriceIndex([
    { isin: "F", date: "2024-06-01", price: 50 },
    { isin: "F", date: "2024-07-02", price: 40 },
  ]);
  const holding: HoldingRow = {
    product_id: 1,
    portfolio: "",
    isin: "F",
    fund_name: "Fondas",
    price_source: null,
    units: 10,
    units_date: "2024-06-30",
    share: 1,
    portfolio_monthly_cents: 8000,
  };
  const ops = [
    { product_id: 1, portfolio: "", date: "2024-06-15", kind: "imoka" as const, amount_cents: 10_000, isin: null, units: null, price: null },
  ];

  it("ankstesnei datai atima vėlesnes įmokas pagal tos dienos kainą", () => {
    expect(holdingUnitsAt(holding, ops, index, "2024-06-10", 2)).toEqual({ units: 8, estimated: false });
  });

  it("vėlesnei datai prideda apytiksles įmokas pagal planą", () => {
    const u = holdingUnitsAt(holding, ops, index, "2024-07-05", 2);
    expect(u?.estimated).toBe(true);
    expect(u?.units).toBeCloseTo(12, 6);
  });
});

describe("summarizePensions", () => {
  const input: PensionInput = {
    products: [
      product({ id: 1, code: "a-ii", owner: "A", pillar: "II", valuation: "vienetai", contribution_day: 10 }),
      product({
        id: 2,
        code: "e-iii",
        owner: "E",
        pillar: "III",
        valuation: "rankinis",
        monthly_contribution_cents: 5000,
        contribution_category_id: 9,
        gpm: 1,
        sort_order: 1,
      }),
    ],
    holdings: [
      { product_id: 1, portfolio: "", isin: "F", fund_name: "Fondas", price_source: "seb", units: null, units_date: null, share: 1, portfolio_monthly_cents: null },
    ],
    operations: [
      { product_id: 1, portfolio: "", date: "2024-01-10", kind: "perkelimas", amount_cents: 100_000, isin: "F", units: 100, price: 10 },
      { product_id: 1, portfolio: "", date: "2024-02-10", kind: "imoka", amount_cents: 10_000, isin: "F", units: 10, price: 10 },
    ],
    valuations: [
      { id: 1, product_id: 2, date: "2024-01-31", value_cents: 50_000, contributed_total_cents: null, source: "excel", note: null },
      { id: 2, product_id: 2, date: "2024-03-01", value_cents: 70_000, contributed_total_cents: 60_000, source: "ataskaita", note: null },
    ],
    prices: [
      { isin: "F", date: "2024-01-10", price: 10 },
      { isin: "F", date: "2024-02-10", price: 10 },
      { isin: "F", date: "2024-03-01", price: 12 },
    ],
    payments: [{ booking_date: "2024-03-05", amount_cents: -5000, category_id: 9, owner: "E", history: 0 }],
    people: [{ owner: "A", birth_date: "1990-01-01", payout_date: "2055-01-01" }],
  };

  const s = summarizePensions(input, "2024-03-05");
  const a = s.products.find((p) => p.code === "a-ii")!;
  const e = s.products.find((p) => p.code === "e-iii")!;

  it("vienetų produktas: vertė = vienetai × naujausia kaina, grąža nuo pirmos operacijos", () => {
    expect(a.valueCents).toBe(132_000);
    expect(a.returns?.contributedCents).toBe(110_000);
    expect(a.returns?.gainCents).toBe(22_000);
    expect(a.valueEstimated).toBe(false);
  });

  it("rankinis produktas: grąža skaičiuojama tik su įmokomis iki paskutinės vertės datos", () => {
    expect(e.valueCents).toBe(70_000);
    expect(e.returns?.gainCents).toBe(20_000);
    expect(e.returns?.lifetime?.contributedCents).toBe(60_000);
    expect(e.returns?.lifetime?.gainCents).toBe(10_000);
  });

  it("GPM: šių metų įmokos iš banko ir prognozė metų pabaigai", () => {
    expect(e.gpm).toEqual({ payer: "E", paidCents: 5000, projectedCents: 50_000, portfolio: null });
    expect(a.gpm).toBeNull();
  });

  it("istorija prasideda, kai yra visų produktų vertės, rankinės vertės pratęsiamos", () => {
    expect(s.history.months).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(s.history.series.find((x) => x.code === "a-ii")?.points).toEqual([100_000, 110_000, 132_000]);
    expect(s.history.series.find((x) => x.code === "e-iii")?.points).toEqual([50_000, 50_000, 70_000]);
  });
});

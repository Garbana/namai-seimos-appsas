import { describe, expect, it } from "vitest";
import {
  summarizeReminders,
  shiftMonth,
  type CategoryRow,
  type HistoryRow,
  type ReminderInput,
} from "../src/reminders";

const TODAY = "2026-09-16";

const kategorija = (id: number, name: string, group: string, groupId = 1): CategoryRow => ({
  id,
  name,
  group_id: groupId,
  group_name: group,
  group_sort: 10,
  sort_order: id,
});

/** Mėnesio sumos 12-ai mėnesių iki 2026-09. */
const istorija = (categoryId: number, sums: number[], count = 1): HistoryRow[] =>
  sums.map((cents, i) => ({
    category_id: categoryId,
    month: shiftMonth("2026-09", -(sums.length - i)),
    cents,
    count,
    isReal: 1,
  }));

const kartok = (cents: number, n = 12) => Array.from({ length: n }, () => cents);

const input = (over: Partial<ReminderInput>): ReminderInput => ({
  history: [],
  categories: [],
  settings: [],
  planned: [],
  payments: [],
  accounts: [],
  dataThrough: TODAY,
  ...over,
});

describe("priminimai", () => {
  it("įtraukia reguliarią sąskaitą ir praleidžia kintančias išlaidas", () => {
    const r = summarizeReminders(
      input({
        categories: [
          kategorija(14, "Elektra", "Komunaliniai"),
          kategorija(72, "Grožis", "Rūta", 2),
          kategorija(45, "Maisto produktai", "Bendros išlaidos", 3),
        ],
        history: [
          ...istorija(14, [3400, 3600, 3300, 3500, 3700, 3400, 3600, 3500, 3400, 3600, 3500, 3400]),
          // Netaisyklingos sumos ir ne įsipareigojimų grupė — nerodoma.
          ...istorija(72, [2000, 12000, 3000, 9500, 1500, 20000, 4000, 8000, 2500, 11000, 3000, 7000]),
          // Stabili suma, bet 20 operacijų per mėnesį — tai ne sąskaita.
          ...istorija(45, kartok(52000), 20),
        ],
      }),
      TODAY
    );

    expect(r.items.map((i) => i.name)).toEqual(["Elektra"]);
    expect(r.items[0].expectedCents).toBe(3500);
  });

  it("mokėjimą randa pagal šio mėnesio nurašymą, o dieną — iš istorijos", () => {
    const r = summarizeReminders(
      input({
        categories: [kategorija(24, "Automobilio lizingas", "Kreditai")],
        history: istorija(24, kartok(26621)),
        payments: [
          { category_id: 24, booking_date: "2026-07-07", cents: 26621 },
          { category_id: 24, booking_date: "2026-08-07", cents: 26621 },
          { category_id: 24, booking_date: "2026-09-04", cents: 26648 },
        ],
      }),
      TODAY
    );

    expect(r.items[0].state).toBe("sumoketa");
    expect(r.items[0].dueDay).toBe(7);
    expect(r.items[0].lastPaid).toBe("2026-09-04");
    expect(r.totals.leftCents).toBe(0);
  });

  it("praėjus terminui žymi neapmokėtą, o iki jo — laukiamą", () => {
    const bendra = {
      categories: [
        kategorija(13, "ADMI", "Komunaliniai"),
        kategorija(16, "Internetas", "Komunaliniai"),
      ],
      history: [...istorija(13, kartok(4000)), ...istorija(16, kartok(1820))],
      payments: [
        { category_id: 13, booking_date: "2026-08-10", cents: 4000 },
        { category_id: 16, booking_date: "2026-08-25", cents: 1820 },
      ],
    };
    const r = summarizeReminders(input(bendra), TODAY);

    const admi = r.items.find((i) => i.categoryId === 13)!;
    const internetas = r.items.find((i) => i.categoryId === 16)!;
    // ADMI mokamas 10 d. — rugsėjo 16 d. jo jau turėtų būti matyti.
    expect(admi.state).toBe("neapmoketa");
    expect(internetas.state).toBe("laukiama");
    expect(r.totals.lateCount).toBe(1);
    expect(r.totals.leftCents).toBe(5820);
  });

  it("neįkėlus naujo išrašo nesumokėtų nekaltina", () => {
    const r = summarizeReminders(
      input({
        categories: [kategorija(13, "ADMI", "Komunaliniai")],
        history: istorija(13, kartok(4000)),
        payments: [{ category_id: 13, booking_date: "2026-08-10", cents: 4000 }],
        dataThrough: "2026-09-05",
      }),
      TODAY
    );

    expect(r.items[0].state).toBe("laukiama");
    expect(r.dataThrough).toBe("2026-09-05");
  });

  it("dalinį mokėjimą skiria nuo viso", () => {
    const r = summarizeReminders(
      input({
        categories: [kategorija(64, "Mokestis už darželį", "Ema")],
        history: istorija(64, kartok(8000)),
        settings: [
          { source: "kategorija", ref: "64", is_active: 1, expected_cents: null, due_day: 20, note: null },
        ],
        payments: [{ category_id: 64, booking_date: "2026-09-03", cents: 2000 }],
      }),
      TODAY
    );

    expect(r.items[0].state).toBe("dalinai");
    expect(r.items[0].leftCents).toBe(6000);
  });

  it("kintančių sumų prie konkrečios sumos neriša", () => {
    // Šilumos tinklai: žiemą 60 €, vasarą 10 €. Mažesnis nurašymas nėra skola.
    const r = summarizeReminders(
      input({
        categories: [
          kategorija(18, "Šilumos tinklai", "Komunaliniai"),
          kategorija(24, "Automobilio lizingas", "Kreditai", 2),
        ],
        history: [
          ...istorija(18, [6000, 5500, 4800, 3000, 1500, 1000, 1000, 1200, 1800, 3500, 5000, 5800]),
          ...istorija(24, kartok(26621)),
        ],
        payments: [
          { category_id: 18, booking_date: "2026-09-16", cents: 1291 },
          { category_id: 24, booking_date: "2026-09-04", cents: 10000 },
        ],
      }),
      TODAY
    );

    const silumos = r.items.find((i) => i.categoryId === 18)!;
    expect(silumos.fixed).toBe(false);
    expect(silumos.state).toBe("sumoketa");
    expect(silumos.minCents).toBe(1000);
    expect(silumos.maxCents).toBe(6000);
    expect(silumos.leftCents).toBe(0);

    // O fiksuota įmoka su per mažu nurašymu lieka „iš dalies".
    const lizingas = r.items.find((i) => i.categoryId === 24)!;
    expect(lizingas.fixed).toBe(true);
    expect(lizingas.state).toBe("dalinai");
  });

  it("rankiniai nustatymai išjungia ir įjungia įrašus", () => {
    const bendra = {
      categories: [
        kategorija(14, "Elektra", "Komunaliniai"),
        kategorija(50, "Spotify", "Bendros išlaidos", 3),
      ],
      history: [...istorija(14, kartok(3500)), ...istorija(50, [661, 1099, 661, 1099, 661])],
    };

    const be = summarizeReminders(input(bendra), TODAY);
    expect(be.items.map((i) => i.name)).toEqual(["Elektra"]);

    const su = summarizeReminders(
      input({
        ...bendra,
        settings: [
          { source: "kategorija", ref: "14", is_active: 0, expected_cents: null, due_day: null, note: null },
          { source: "kategorija", ref: "50", is_active: 1, expected_cents: 1099, due_day: 5, note: "prenumerata" },
        ],
      }),
      TODAY
    );

    expect(su.items.map((i) => i.name)).toEqual(["Spotify"]);
    expect(su.items[0].expectedCents).toBe(1099);
    expect(su.items[0].dueDay).toBe(5);
    expect(su.items[0].basis).toBe("rankinis");
  });

  it("sutarties grafikas duoda tikslią sumą ir datą", () => {
    const r = summarizeReminders(
      input({
        categories: [kategorija(19, "Automobilio draudimas", "Draudimas")],
        history: [],
        planned: [
          { category_id: 19, due_date: "2026-09-24", cents: 5460, source: "draudimas" },
        ],
      }),
      TODAY
    );

    expect(r.items[0].expectedCents).toBe(5460);
    expect(r.items[0].dueDate).toBe("2026-09-24");
    expect(r.items[0].state).toBe("laukiama");
    expect(r.items[0].basis).toBe("grafikas");
  });

  it("dieną ima iš tikro nurašymo, o ne iš sutarties grafiko", () => {
    // KASKO grafike įrašyta 3 d., bet bankas nurašo 24 d. — pagal grafiką
    // mokėjimas nuo mėnesio pradžios klaidingai atrodytų vėluojantis.
    const r = summarizeReminders(
      input({
        categories: [kategorija(19, "Automobilio draudimas (IF)", "Draudimas")],
        history: istorija(19, kartok(5460)),
        planned: [{ category_id: 19, due_date: "2026-09-03", cents: 5460, source: "draudimas" }],
        payments: [
          { category_id: 19, booking_date: "2026-07-24", cents: 5460 },
          { category_id: 19, booking_date: "2026-08-24", cents: 5460 },
        ],
      }),
      TODAY
    );

    expect(r.items[0].dueDay).toBe(24);
    expect(r.items[0].state).toBe("laukiama");
    expect(r.totals.lateCount).toBe(0);
  });

  it("kiekvienos sąskaitos išrašų šviežumą vertina atskirai", () => {
    // Jono SEB įkeltas iki 09-16, Rūtos Swedbank — tik iki 09-13.
    const r = summarizeReminders(
      input({
        categories: [
          kategorija(22, "PZU – Jonas", "Draudimas"),
          kategorija(23, "PZU – Rūta", "Draudimas"),
        ],
        history: [...istorija(22, kartok(3638)), ...istorija(23, kartok(3661))],
        payments: [
          { category_id: 22, booking_date: "2026-08-14", cents: 3638, account_id: 1 },
          { category_id: 23, booking_date: "2026-08-14", cents: 3661, account_id: 6 },
        ],
        accounts: [
          { account_id: 1, owner: "Jonas", through: "2026-09-16" },
          { account_id: 6, owner: "Rūta", through: "2026-09-13" },
        ],
      }),
      TODAY
    );

    const jono = r.items.find((i) => i.categoryId === 22)!;
    const rūtos = r.items.find((i) => i.categoryId === 23)!;
    expect(jono.state).toBe("neapmoketa");
    expect(rūtos.state).toBe("laukiama");
    expect(rūtos.knownThrough).toBe("2026-09-13");
    expect(r.sources).toEqual([
      { owner: "Rūta", through: "2026-09-13" },
      { owner: "Jonas", through: "2026-09-16" },
    ]);
  });

  it("taupymo planas rodomas kartu su mokėjimais", () => {
    const r = summarizeReminders(
      input({
        categories: [kategorija(14, "Elektra", "Komunaliniai")],
        history: istorija(14, kartok(3500)),
        savings: [
          { code: "rūtos-rezervas", name: "Rūtos rezervas", plan_cents: 25000, paid_cents: 25000 },
          { code: "jono-investicijos", name: "Jono investicijos", plan_cents: 17000, paid_cents: 0 },
          // Be plano katiliukai į priminimus nepatenka.
          { code: "atostogu-taupymas", name: "Atostogos", plan_cents: 0, paid_cents: 0 },
        ],
      }),
      TODAY
    );

    const rezervas = r.items.find((i) => i.ref === "rūtos-rezervas")!;
    const investicijos = r.items.find((i) => i.ref === "jono-investicijos")!;
    expect(rezervas.source).toBe("taupymas");
    expect(rezervas.state).toBe("sumoketa");
    expect(investicijos.state).toBe("laukiama");
    expect(investicijos.leftCents).toBe(17000);
    expect(r.items.some((i) => i.ref === "atostogu-taupymas")).toBe(false);
    // Taupymas rikiuojasi po kreditų, draudimų ir komunalinių, o tarpusavyje —
    // pagal pavadinimą, nes konkrečios dienos taupymo planai neturi.
    expect(r.items.map((i) => i.name)).toEqual(["Elektra", "Jono investicijos", "Rūtos rezervas"]);
  });

  it("išjungtas taupymo priminimas nerodomas", () => {
    const r = summarizeReminders(
      input({
        settings: [
          { source: "taupymas", ref: "jono-investicijos", is_active: 0, expected_cents: null, due_day: null, note: null },
        ],
        savings: [{ code: "jono-investicijos", name: "Jono investicijos", plan_cents: 17000, paid_cents: 0 }],
      }),
      TODAY
    );

    expect(r.items).toEqual([]);
  });

  it("rikiuoja pagal svarbą: kreditai, draudimai, komunaliniai, kiti", () => {
    const r = summarizeReminders(
      input({
        categories: [
          kategorija(94, "Telefonas", "Jonas", 4),
          kategorija(14, "Elektra", "Komunaliniai"),
          kategorija(24, "Lizingas", "Kreditai", 5),
          kategorija(22, "PZU", "Draudimas", 6),
        ],
        history: [
          ...istorija(94, kartok(4955)),
          ...istorija(14, kartok(3500)),
          ...istorija(24, kartok(26621)),
          ...istorija(22, kartok(3638)),
        ],
      }),
      TODAY
    );

    expect(r.items.map((i) => i.name)).toEqual(["Lizingas", "PZU", "Elektra", "Telefonas"]);
    expect(r.totals.count).toBe(4);
    expect(r.totals.expectedCents).toBe(26621 + 3638 + 3500 + 4955);
  });
});

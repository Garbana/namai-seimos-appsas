/**
 * Taupymas ir investicijos.
 *
 * Sukaupta suma skaičiuojama taip pat, kaip pensijose: jei yra rankiniu būdu
 * įvesta vertė (pvz. ETF portfelio likutis), imama ji ir pridedami vėlesni
 * įnašai; jei nėra — tiesiog sumuojami įnašai ir išėmimai.
 *
 * Duomenys nedubliuojami: įnašas rišamas prie esamos banko operacijos
 * (`transaction_id`), o ne įvedamas iš naujo. Vidiniai pervedimai į pajamas ir
 * išlaidas neįeina, tad apžvalgos sumos nuo to nepasikeičia.
 */

import { monthsBetween } from "./credits";

export type GoalRow = {
  id: number;
  code: string;
  name: string;
  owner: string;
  kind: "rezervas" | "investicijos" | "tikslas";
  where_kept: string | null;
  target_cents: number | null;
  target_date: string | null;
  monthly_plan_cents: number | null;
  match_keywords: string;
  note: string | null;
  is_active: number;
  sort_order: number;
  /** Kategorija, kurios operacijos pačios tampa šio katiliuko įnašais. */
  category_id: number | null;
  /** Indėlio palūkanų kategorija (įplauka), jei katiliukas jas kaupia. */
  interest_category_id: number | null;
};

/** Operacija, priskirta katiliuko kategorijai. */
export type SavingsTransactionRow = {
  id: number;
  booking_date: string;
  amount_cents: number;
  category_id: number;
  counterparty_name: string | null;
  description: string | null;
};

export type EntryRow = {
  id: number;
  goal_id: number;
  date: string;
  cents: number;
  kind: "inasas" | "isemimas" | "palukanos";
  transaction_id: number | null;
  /** `kategorija` — įrašas ne saugomas, o suskaičiuotas iš operacijos. */
  source: "pervedimas" | "rankinis" | "excel" | "kategorija";
  note: string | null;
};

export type ValuationRow = {
  id: number;
  goal_id: number;
  date: string;
  value_cents: number;
  source: "rankinis" | "excel";
  note: string | null;
};

/** Dar nepriskirtas vidinis pervedimas — kandidatas į taupymo įrašą. */
export type CandidateRow = {
  id: number;
  booking_date: string;
  amount_cents: number;
  counterparty_name: string | null;
  description: string | null;
  account_owner: string | null;
  iban_last4: string | null;
};

/** ETF fondas katiliuke. */
export type FundRow = {
  id: number;
  goal_id: number;
  symbol: string;
  name: string;
  currency: string;
  price_source: string;
  sort_order: number;
};

/** Vienas fondo pirkimas: pinigai virto vienetais. */
export type PurchaseRow = {
  id: number;
  fund_id: number;
  date: string;
  units: number;
  unit_price: number;
  cents: number;
  source: "rankinis" | "israsas";
  note: string | null;
};

/** Kainos iš `fund_prices`; `isin` čia yra Yahoo simbolis. */
export type PriceRow = { isin: string; date: string; price: number };

export type SavingsInput = {
  goals: GoalRow[];
  entries: EntryRow[];
  valuations: ValuationRow[];
  candidates: CandidateRow[];
  funds?: FundRow[];
  purchases?: PurchaseRow[];
  prices?: PriceRow[];
  /** Operacijos katiliukų kategorijose — iš jų įrašai skaičiuojami patys. */
  transactions?: SavingsTransactionRow[];
};

/** Grąža procentais nuo investuotos sumos. */
const procentai = (gainCents: number, baseCents: number) =>
  baseCents > 0 ? Math.round((gainCents / baseCents) * 10000) / 100 : null;

/** Kainos pagal simbolį su surikiuotomis datomis — kad paieška nebūtų O(n²). */
function indeksuotiKainas(prices: PriceRow[]) {
  const pagalSimboli = new Map<string, { dates: string[]; map: Map<string, number> }>();
  for (const p of prices) {
    let irasas = pagalSimboli.get(p.isin);
    if (!irasas) {
      irasas = { dates: [], map: new Map() };
      pagalSimboli.set(p.isin, irasas);
    }
    irasas.map.set(p.date, p.price);
  }
  for (const irasas of pagalSimboli.values()) irasas.dates = [...irasas.map.keys()].sort();
  return pagalSimboli;
}

type KainuIndeksas = ReturnType<typeof indeksuotiKainas>;

/** Naujausia kaina ne vėlesnė nei `date`. */
function kainaData(kainos: KainuIndeksas, symbol: string, date: string) {
  const irasas = kainos.get(symbol);
  if (!irasas) return null;
  let rasta: string | null = null;
  for (const d of irasas.dates) {
    if (d > date) break;
    rasta = d;
  }
  return rasta === null ? null : { date: rasta, price: irasas.map.get(rasta)! };
}

/**
 * Portfelio vertė pagal dienas: kiekvienai dienai sudedami tos dienos vienetai
 * × tos dienos kaina. Pradedama nuo pirmo pirkimo — anksčiau portfelio nebuvo.
 */
function portfelioGrafikas(
  fondai: { symbol: string; purchases: PurchaseRow[] }[],
  kainos: KainuIndeksas,
  today: string
) {
  const pirmas = fondai
    .flatMap((f) => f.purchases.map((p) => p.date))
    .sort()[0];
  if (!pirmas) return [];

  const datos = [
    ...new Set(
      fondai.flatMap((f) => kainos.get(f.symbol)?.dates ?? []).filter((d) => d >= pirmas && d <= today)
    ),
  ].sort();

  return datos.map((data) => {
    let cents = 0;
    for (const fondas of fondai) {
      const vienetai = fondas.purchases
        .filter((p) => p.date <= data)
        .reduce((s, p) => s + p.units, 0);
      if (vienetai === 0) continue;
      const kaina = kainaData(kainos, fondas.symbol, data);
      if (kaina) cents += Math.round(vienetai * kaina.price * 100);
    }
    return { date: data, valueCents: cents };
  });
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

const parseKeywords = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((k) => String(k).toLowerCase()) : [];
  } catch {
    return [];
  }
};

/**
 * Kuriam katiliukui pervedimas panašiausias.
 *
 * Pirmiausia ieškoma tarp to paties žmogaus katiliukų (Rūtos „Taupymui" —
 * jos rezervas, ne Jono), o neradus — tarp visų, nes pvz. Emos pinigus
 * perveda Jonas.
 */
export function suggestGoal(candidate: CandidateRow, goals: GoalRow[]): GoalRow | null {
  const text = `${candidate.counterparty_name ?? ""} ${candidate.description ?? ""}`.toLowerCase();
  const matching = goals.filter(
    (g) => g.is_active === 1 && parseKeywords(g.match_keywords).some((k) => k && text.includes(k))
  );
  if (matching.length === 0) return null;
  const own = matching.filter((g) => g.owner === candidate.account_owner);
  return (own.length > 0 ? own : matching).sort((a, b) => a.sort_order - b.sort_order)[0];
}

/**
 * Pervedimo suma katiliuke: išlaida (pinigai išeina iš einamosios sąskaitos) yra
 * įnašas, o įplauka (pvz. „Pervedimas iš E. taupyklės") — išėmimas.
 */
export const entryCentsFor = (amountCents: number) => -amountCents;

export function summarizeSavings(input: SavingsInput, today: string) {
  const month = today.slice(0, 7);
  const visiFondai = input.funds ?? [];
  const visiPirkimai = input.purchases ?? [];
  const kainos = indeksuotiKainas(input.prices ?? []);
  /** Operacijos, kurios jau turi išsaugotą įrašą — antrą kartą neskaičiuojamos. */
  const suIrasu = new Set(input.entries.map((e) => e.transaction_id).filter((id): id is number => id !== null));

  const goals = input.goals
    .filter((g) => g.is_active === 1)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((goal) => {
      // Operacijos, priskirtos katiliuko kategorijai, tampa įnašais pačios —
      // taip importas iškart matomas taupyme. Operacijos, kurios jau turi įrašą
      // (anksčiau priskirtos rankomis), praleidžiamos, kad nesidubliuotų.
      const derived: EntryRow[] = (input.transactions ?? [])
        .filter(
          (t) =>
            !suIrasu.has(t.id) &&
            ((goal.category_id !== null && t.category_id === goal.category_id) ||
              (goal.interest_category_id !== null && t.category_id === goal.interest_category_id))
        )
        .map((t) => {
          const palukanos = goal.interest_category_id !== null && t.category_id === goal.interest_category_id;
          // Išlaida (pinigai išeina iš einamosios sąskaitos) — įnašas;
          // įplauka — išėmimas. Palūkanos ateina kaip įplauka į katiliuką.
          const cents = palukanos ? t.amount_cents : -t.amount_cents;
          return {
            // Neigiamas id — kad nesusidurtų su tikrų įrašų numeriais.
            id: -t.id,
            goal_id: goal.id,
            date: t.booking_date,
            cents,
            kind: palukanos ? "palukanos" : cents < 0 ? "isemimas" : "inasas",
            transaction_id: t.id,
            source: "kategorija",
            note: t.description?.split(",")[0]?.trim() || t.counterparty_name,
          } satisfies EntryRow;
        });

      const entries = [...input.entries.filter((e) => e.goal_id === goal.id), ...derived].sort(
        (a, b) => a.date.localeCompare(b.date) || a.id - b.id
      );
      const valuations = input.valuations
        .filter((v) => v.goal_id === goal.id && v.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const anchor = valuations.at(-1) ?? null;

      const netCents = sum(entries.map((e) => e.cents));
      const afterAnchor = anchor ? entries.filter((e) => e.date > anchor.date) : [];

      // Fondai: dalis įnašų virtusi vienetais. Vienetai sumuojami iš pirkimų, o
      // vertė imama pagal naujausią kainą — kaip pensijose.
      const fondai = visiFondai
        .filter((f) => f.goal_id === goal.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((fund) => {
          const own = visiPirkimai
            .filter((p) => p.fund_id === fund.id && p.date <= today)
            .sort((a, b) => a.date.localeCompare(b.date));
          const units = own.reduce((s, p) => s + p.units, 0);
          const investedCents = sum(own.map((p) => p.cents));
          const kaina = kainaData(kainos, fund.symbol, today);
          const valueCents = kaina ? Math.round(units * kaina.price * 100) : investedCents;
          return {
            id: fund.id,
            symbol: fund.symbol,
            name: fund.name,
            units,
            investedCents,
            price: kaina?.price ?? null,
            priceDate: kaina?.date ?? null,
            valueCents,
            gainCents: kaina ? valueCents - investedCents : null,
            gainPct: kaina ? procentai(valueCents - investedCents, investedCents) : null,
            purchases: own,
          };
        });

      const investedCents = sum(fondai.map((f) => f.investedCents));
      const fundsValueCents = sum(fondai.map((f) => f.valueCents));
      // Neinvestuoti pinigai: įnašai minus tai, kas jau virto vienetais.
      const cashCents = netCents - investedCents;

      const valueCents =
        fondai.length > 0
          ? fundsValueCents + cashCents
          : anchor
            ? anchor.value_cents + sum(afterAnchor.map((e) => e.cents))
            : netCents;

      const contributedCents = sum(entries.filter((e) => e.cents > 0 && e.kind !== "palukanos").map((e) => e.cents));
      const withdrawnCents = -sum(entries.filter((e) => e.cents < 0).map((e) => e.cents));
      const interestCents = sum(entries.filter((e) => e.kind === "palukanos").map((e) => e.cents));

      // Uždirbta: su fondais — rinkos vertės ir investuotos sumos skirtumas; be
      // jų — tik tada, kai yra rankiniu būdu įvesta tikra vertė.
      const gainCents =
        fondai.length > 0 ? fundsValueCents - investedCents : anchor ? valueCents - netCents : null;

      const chart = portfelioGrafikas(
        fondai.map((f) => ({ symbol: f.symbol, purchases: f.purchases })),
        kainos,
        today
      );

      const thisMonthCents = sum(entries.filter((e) => e.date.slice(0, 7) === month).map((e) => e.cents));

      const monthsLeft = goal.target_date ? monthsBetween(today, goal.target_date) : null;
      const leftCents = goal.target_cents === null ? null : Math.max(0, goal.target_cents - valueCents);
      const neededMonthlyCents =
        leftCents !== null && monthsLeft !== null && monthsLeft > 0 ? Math.ceil(leftCents / monthsLeft) : null;

      // Istorija pagal mėnesius su besikaupiančiu likučiu — grafikui ir lentelei.
      const byMonth = new Map<string, number>();
      for (const e of entries) {
        byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + e.cents);
      }
      let running = 0;
      const history = [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, cents]) => {
          running += cents;
          return { month: m, cents, balanceCents: running };
        });

      return {
        id: goal.id,
        code: goal.code,
        name: goal.name,
        owner: goal.owner,
        kind: goal.kind,
        whereKept: goal.where_kept,
        note: goal.note,
        targetCents: goal.target_cents,
        targetDate: goal.target_date,
        monthlyPlanCents: goal.monthly_plan_cents,
        valueCents,
        categoryId: goal.category_id,
        interestCategoryId: goal.interest_category_id,
        /** Vienetuose laikoma dalis ir dar neinvestuoti pinigai. */
        fundsValueCents,
        cashCents,
        investedCents,
        /** Grąža procentais nuo investuotos sumos. */
        gainPct: fondai.length > 0 ? procentai(fundsValueCents - investedCents, investedCents) : null,
        funds: fondai.map(({ purchases, ...f }) => ({
          ...f,
          purchases: purchases
            .slice()
            .reverse()
            .map((p) => ({
              id: p.id,
              date: p.date,
              units: p.units,
              unitPrice: p.unit_price,
              cents: p.cents,
              source: p.source,
            })),
        })),
        /** Portfelio vertė pagal dienas — grafikui. */
        chart,
        /** Sukaupta suma po paskutinės įvestos vertės pasikeitė tik dėl įnašų. */
        valueEstimated: fondai.length === 0 && anchor !== null && afterAnchor.length > 0,
        lastValuation: anchor ? { id: anchor.id, date: anchor.date, valueCents: anchor.value_cents } : null,
        contributedCents,
        withdrawnCents,
        interestCents,
        netCents,
        gainCents,
        thisMonthCents,
        progress: goal.target_cents && goal.target_cents > 0 ? valueCents / goal.target_cents : null,
        leftCents,
        monthsLeft,
        neededMonthlyCents,
        history,
        entries: entries
          .slice()
          .reverse()
          .map((e) => ({
            id: e.id,
            date: e.date,
            cents: e.cents,
            kind: e.kind,
            source: e.source,
            transactionId: e.transaction_id,
            note: e.note,
          })),
        valuations: valuations.map((v) => ({
          id: v.id,
          date: v.date,
          valueCents: v.value_cents,
          source: v.source,
          note: v.note,
        })),
      };
    });

  const assigned = new Set(input.entries.map((e) => e.transaction_id).filter((id): id is number => id !== null));
  const candidates = input.candidates
    .filter((c) => !assigned.has(c.id))
    .map((c) => {
      const goal = suggestGoal(c, input.goals);
      return {
        id: c.id,
        date: c.booking_date,
        amountCents: c.amount_cents,
        /** Kiek įrašas pridėtų katiliukui: išlaida — įnašas, įplauka — išėmimas. */
        centsIfAssigned: entryCentsFor(c.amount_cents),
        counterpartyName: c.counterparty_name,
        description: c.description,
        accountOwner: c.account_owner,
        ibanLast4: c.iban_last4,
        suggestedCode: goal?.code ?? null,
        suggestedName: goal?.name ?? null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    today,
    month,
    goals,
    candidates,
    totals: {
      valueCents: sum(goals.map((g) => g.valueCents)),
      fundsValueCents: sum(goals.map((g) => g.fundsValueCents)),
      cashCents: sum(goals.map((g) => g.cashCents)),
      investedCents: sum(goals.map((g) => g.investedCents)),
      contributedCents: sum(goals.map((g) => g.contributedCents)),
      withdrawnCents: sum(goals.map((g) => g.withdrawnCents)),
      interestCents: sum(goals.map((g) => g.interestCents)),
      gainCents: goals.some((g) => g.gainCents !== null) ? sum(goals.map((g) => g.gainCents ?? 0)) : null,
      gainPct: procentai(
        sum(goals.map((g) => g.fundsValueCents)) - sum(goals.map((g) => g.investedCents)),
        sum(goals.map((g) => g.investedCents))
      ),
      thisMonthCents: sum(goals.map((g) => g.thisMonthCents)),
      monthlyPlanCents: sum(goals.map((g) => g.monthlyPlanCents ?? 0)),
      unassignedCount: candidates.length,
    },
  };
}

export async function buildSavings(db: D1Database, today: string) {
  const [goals, entries, valuations, candidates, funds, purchases, prices, transactions] = await Promise.all([
    db.prepare("SELECT * FROM savings_goals ORDER BY sort_order, id").all<GoalRow>(),
    db.prepare("SELECT * FROM savings_entries").all<EntryRow>(),
    db.prepare("SELECT * FROM savings_valuations").all<ValuationRow>(),
    db
      .prepare(
        `SELECT t.id, t.booking_date, t.amount_cents, t.counterparty_name, t.description,
                a.owner AS account_owner, a.iban_last4
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.is_transfer = 1 AND t.is_split_parent = 0
           AND t.id NOT IN (SELECT transaction_id FROM savings_entries WHERE transaction_id IS NOT NULL)
         ORDER BY t.booking_date DESC
         LIMIT 120`
      )
      .all<CandidateRow>(),

    db.prepare("SELECT * FROM savings_funds ORDER BY sort_order, id").all<FundRow>(),
    db.prepare("SELECT * FROM savings_purchases").all<PurchaseRow>(),
    db
      .prepare(
        `SELECT isin, date, price FROM fund_prices
         WHERE isin IN (SELECT DISTINCT symbol FROM savings_funds)`
      )
      .all<PriceRow>(),

    db
      .prepare(
        `SELECT t.id, t.booking_date, t.amount_cents, t.category_id, t.counterparty_name, t.description
         FROM transactions t
         WHERE t.is_split_parent = 0 AND t.category_id IS NOT NULL
           AND (t.category_id IN (SELECT category_id FROM savings_goals WHERE category_id IS NOT NULL)
             OR t.category_id IN (SELECT interest_category_id FROM savings_goals WHERE interest_category_id IS NOT NULL))`
      )
      .all<SavingsTransactionRow>(),
  ]);

  return summarizeSavings(
    {
      goals: goals.results,
      entries: entries.results,
      valuations: valuations.results,
      candidates: candidates.results,
      funds: funds.results,
      purchases: purchases.results,
      prices: prices.results,
      transactions: transactions.results,
    },
    today
  );
}

const findGoal = async (db: D1Database, code: string) => {
  const goal = await db.prepare("SELECT * FROM savings_goals WHERE code = ?").bind(code).first<GoalRow>();
  if (!goal) throw new Error("Tokio taupymo tikslo nėra.");
  return goal;
};

/** Priskirti banko pervedimą katiliukui arba įvesti įrašą ranka. */
export async function addSavingsEntry(
  db: D1Database,
  code: string,
  body: { transactionId?: number; date?: string; cents?: number; kind?: EntryRow["kind"]; note?: string | null }
) {
  const goal = await findGoal(db, code);

  if (body.transactionId != null) {
    const tx = await db
      .prepare("SELECT id, booking_date, amount_cents FROM transactions WHERE id = ?")
      .bind(body.transactionId)
      .first<{ id: number; booking_date: string; amount_cents: number }>();
    if (!tx) throw new Error("Tokios operacijos nėra.");

    const jau = await db
      .prepare("SELECT id FROM savings_entries WHERE transaction_id = ?")
      .bind(tx.id)
      .first<{ id: number }>();
    if (jau) throw new Error("Ši operacija jau priskirta taupymui.");

    // Ženklas spėjamas iš operacijos krypties, bet paskutinis žodis — vartotojo:
    // pvz. Rūtos pervedimas Jonui „Už atostogas“ yra atostogų pinigų
    // panaudojimas, o ne įnašas.
    const numatytas = entryCentsFor(tx.amount_cents);
    const kind: EntryRow["kind"] =
      body.kind === "inasas" || body.kind === "isemimas" || body.kind === "palukanos"
        ? body.kind
        : numatytas < 0
          ? "isemimas"
          : "inasas";
    const cents = kind === "isemimas" ? -Math.abs(numatytas) : Math.abs(numatytas);

    // Vidinis pervedimas išraše matomas iš abiejų pusių. Priskyrus abi, suma
    // padvigubėtų, todėl antroji pusė neįleidžiama.
    const antraPuse = await db
      .prepare(
        `SELECT e.id FROM savings_entries e JOIN transactions t ON t.id = e.transaction_id
         WHERE e.goal_id = ? AND t.amount_cents = ? AND ABS(julianday(t.booking_date) - julianday(?)) <= 3`
      )
      .bind(goal.id, -tx.amount_cents, tx.booking_date)
      .first<{ id: number }>();
    if (antraPuse) {
      throw new Error("Kita to paties pervedimo pusė jau priskirta — pinigai būtų suskaičiuoti dukart.");
    }

    await db
      .prepare(
        `INSERT INTO savings_entries (goal_id, date, cents, kind, transaction_id, source, note)
         VALUES (?, ?, ?, ?, ?, 'pervedimas', ?)`
      )
      .bind(goal.id, tx.booking_date, cents, kind, tx.id, body.note ?? null)
      .run();
    return;
  }

  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error("Nenurodyta data.");
  if (typeof body.cents !== "number" || body.cents === 0) throw new Error("Nenurodyta suma.");

  await db
    .prepare(
      `INSERT INTO savings_entries (goal_id, date, cents, kind, transaction_id, source, note)
       VALUES (?, ?, ?, ?, NULL, 'rankinis', ?)`
    )
    .bind(goal.id, body.date, body.cents, body.kind ?? (body.cents < 0 ? "isemimas" : "inasas"), body.note ?? null)
    .run();
}

export async function deleteSavingsEntry(db: D1Database, id: number) {
  const row = await db.prepare("SELECT source FROM savings_entries WHERE id = ?").bind(id).first<{ source: string }>();
  if (!row) throw new Error("Tokio įrašo nėra.");
  if (row.source === "excel") throw new Error("Istorinio įrašo iš Excel trinti negalima.");
  await db.prepare("DELETE FROM savings_entries WHERE id = ?").bind(id).run();
}

/** Tikra likučio ar portfelio vertė — nuo jos skaičiuojama toliau. */
export async function addSavingsValuation(
  db: D1Database,
  code: string,
  body: { date: string; valueCents: number; note?: string | null },
  today: string
) {
  const goal = await findGoal(db, code);
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error("Nenurodyta data.");
  if (body.date > today) throw new Error("Data negali būti ateityje.");
  if (typeof body.valueCents !== "number" || body.valueCents < 0) throw new Error("Netinkama suma.");

  await db
    .prepare(
      `INSERT INTO savings_valuations (goal_id, date, value_cents, source, note)
       VALUES (?, ?, ?, 'rankinis', ?)
       ON CONFLICT (goal_id, date) DO UPDATE SET value_cents = excluded.value_cents, note = excluded.note`
    )
    .bind(goal.id, body.date, body.valueCents, body.note ?? null)
    .run();
}

export async function deleteSavingsValuation(db: D1Database, id: number) {
  const row = await db
    .prepare("SELECT source FROM savings_valuations WHERE id = ?")
    .bind(id)
    .first<{ source: string }>();
  if (!row) throw new Error("Tokios vertės nėra.");
  if (row.source === "excel") throw new Error("Istorinės vertės iš Excel trinti negalima.");
  await db.prepare("DELETE FROM savings_valuations WHERE id = ?").bind(id).run();
}

export type NewGoal = {
  name: string;
  owner: string;
  kind: GoalRow["kind"];
  whereKept?: string | null;
  targetCents?: number | null;
  targetDate?: string | null;
  monthlyPlanCents?: number | null;
  note?: string | null;
};

/** Kodas iš pavadinimo: „Naujas tikslas" -> „naujas-tikslas". */
const toCode = (name: string) =>
  name
    .toLowerCase()
    .replace(/[ąčęėįšųūž]/g, (c) => "aceeisuuz"["ąčęėįšųūž".indexOf(c)])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export async function createGoal(db: D1Database, body: NewGoal) {
  const name = body.name?.trim();
  if (!name) throw new Error("Nenurodytas pavadinimas.");
  if (!body.owner?.trim()) throw new Error("Nenurodyta, kieno tai taupymas.");
  if (!["rezervas", "investicijos", "tikslas"].includes(body.kind)) throw new Error("Netinkamas tipas.");

  let code = toCode(name) || "tikslas";
  const esamas = await db.prepare("SELECT id FROM savings_goals WHERE code = ?").bind(code).first();
  if (esamas) code = `${code}-${Date.now().toString().slice(-4)}`;

  const { results } = await db
    .prepare(
      `INSERT INTO savings_goals
         (code, name, owner, kind, where_kept, target_cents, target_date, monthly_plan_cents, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM savings_goals))
       RETURNING *`
    )
    .bind(
      code,
      name,
      body.owner.trim(),
      body.kind,
      body.whereKept ?? null,
      body.targetCents ?? null,
      body.targetDate ?? null,
      body.monthlyPlanCents ?? null,
      body.note ?? null
    )
    .all<GoalRow>();
  return results[0];
}

export async function updateGoal(db: D1Database, code: string, body: Partial<NewGoal> & { isActive?: boolean }) {
  const goal = await findGoal(db, code);
  await db
    .prepare(
      `UPDATE savings_goals SET
         name = COALESCE(?, name),
         where_kept = ?,
         target_cents = ?,
         target_date = ?,
         monthly_plan_cents = ?,
         note = ?,
         is_active = COALESCE(?, is_active)
       WHERE id = ?`
    )
    .bind(
      body.name?.trim() ?? null,
      body.whereKept ?? goal.where_kept,
      body.targetCents ?? null,
      body.targetDate ?? null,
      body.monthlyPlanCents ?? null,
      body.note ?? goal.note,
      body.isActive === undefined ? null : body.isActive ? 1 : 0,
      goal.id
    )
    .run();
}

/** Naujas fondas katiliuke (Yahoo simbolis, pvz. „VWCE.DE"). */
export async function addFund(
  db: D1Database,
  code: string,
  body: { symbol?: string; name?: string; currency?: string }
) {
  const goal = await findGoal(db, code);
  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-]{2,20}$/.test(symbol)) {
    throw new Error("Netinkamas fondo simbolis (pvz. VWCE.DE).");
  }
  if (!body.name?.trim()) throw new Error("Nenurodytas fondo pavadinimas.");

  await db
    .prepare(
      `INSERT INTO savings_funds (goal_id, symbol, name, currency, sort_order)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM savings_funds WHERE goal_id = ?))
       ON CONFLICT (goal_id, symbol) DO UPDATE SET name = excluded.name`
    )
    .bind(goal.id, symbol, body.name.trim(), body.currency ?? "EUR", goal.id)
    .run();
}

/**
 * Fondo pirkimas: kiek vienetų ir už kiek. Sumą galima praleisti — tada ji
 * suskaičiuojama iš vienetų ir kainos.
 */
export async function addPurchase(
  db: D1Database,
  code: string,
  body: { symbol?: string; date?: string; units?: number; unitPrice?: number; cents?: number; note?: string | null }
) {
  const goal = await findGoal(db, code);
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error("Nenurodyta data.");
  if (typeof body.units !== "number" || body.units <= 0) throw new Error("Nenurodytas vienetų kiekis.");
  if (typeof body.unitPrice !== "number" || body.unitPrice <= 0) throw new Error("Nenurodyta vieneto kaina.");

  const fund = await db
    .prepare("SELECT id FROM savings_funds WHERE goal_id = ? AND symbol = ?")
    .bind(goal.id, body.symbol?.trim().toUpperCase() ?? "")
    .first<{ id: number }>();
  if (!fund) throw new Error("Tokio fondo šiame katiliuke nėra — pirma jį pridėk.");

  const cents = body.cents ?? Math.round(body.units * body.unitPrice * 100);
  const laukiama = Math.round(body.units * body.unitPrice * 100);
  // Brokeris rodo vieneto kainą suapvalintą iki centų, tad paklaida auga su
  // vienetų skaičiumi (18,2 vieneto × 0,005 € ≈ 9 ct). Tikra yra sumokėta suma.
  const riba = Math.max(3, Math.round(Math.abs(body.units) * 0.5) + 2);
  if (Math.abs(cents - laukiama) > riba) {
    throw new Error(
      `Vienetai × kaina = ${(laukiama / 100).toFixed(2)} €, o nurodyta ${(cents / 100).toFixed(2)} €.`
    );
  }

  await db
    .prepare(
      `INSERT INTO savings_purchases (fund_id, date, units, unit_price, cents, source, note)
       VALUES (?, ?, ?, ?, ?, 'rankinis', ?)`
    )
    .bind(fund.id, body.date, body.units, body.unitPrice, cents, body.note ?? null)
    .run();
}

export async function deletePurchase(db: D1Database, id: number) {
  const row = await db
    .prepare("SELECT source FROM savings_purchases WHERE id = ?")
    .bind(id)
    .first<{ source: string }>();
  if (!row) throw new Error("Tokio pirkimo nėra.");
  if (row.source === "israsas") throw new Error("Iš išrašo perkelto pirkimo trinti negalima.");
  await db.prepare("DELETE FROM savings_purchases WHERE id = ?").bind(id).run();
}

export type SavingsSummary = ReturnType<typeof summarizeSavings>;

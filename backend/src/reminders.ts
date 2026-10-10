/**
 * Priminimai: ar šį mėnesį jau atlikti visi reguliarūs mokėjimai.
 *
 * Sąrašas nesaugomas — jis atstatomas iš to, kas jau yra bazėje:
 *  - kategorijos, kurios istoriškai mokamos beveik kas mėnesį;
 *  - kreditų grafikas ir draudimų mokėjimo grafikai (tikslios datos ir sumos);
 *  - `recurring_settings` — rankiniai pataisymai, kai automatika klysta.
 *
 * Svarbu: „nesumokėta" čia reiškia „banko išraše dar nematyti". Jei naujausias
 * išrašas neįkeltas, mokėjimų tiesiog dar nėra duomenyse, todėl kartu grąžinama
 * `dataThrough` — iki kurios dienos duomenys tikri.
 */

export type HistoryRow = {
  category_id: number;
  month: string;
  /** Teigiama mėnesio išlaidų suma centais. */
  cents: number;
  count: number;
  /** 1 — tikri banko įrašai, 0 — Excel istorijos mėnesio suma. */
  isReal: number;
};

export type CategoryRow = {
  id: number;
  name: string;
  group_id: number;
  group_name: string;
  group_sort: number;
  sort_order: number;
};

export type SettingRow = {
  source: string;
  ref: string;
  is_active: number;
  expected_cents: number | null;
  due_day: number | null;
  note: string | null;
};

/** Iš sutarčių žinomas mokėjimas: tiksli diena ir suma. */
export type PlannedRow = {
  category_id: number;
  due_date: string;
  cents: number;
  source: "kreditas" | "draudimas";
};

export type PaymentRow = {
  category_id: number;
  booking_date: string;
  /** Teigiama suma centais. */
  cents: number;
  account_id?: number;
};

/** Kiek toli siekia kiekvienos sąskaitos įkelti išrašai. */
export type AccountRow = {
  account_id: number;
  owner: string | null;
  through: string;
};

/** Taupymo katiliukas su mėnesio planu — ar šį mėnesį jau atidėta. */
export type SavingsPlanRow = {
  code: string;
  name: string;
  plan_cents: number;
  paid_cents: number;
};

export type ReminderInput = {
  history: HistoryRow[];
  categories: CategoryRow[];
  settings: SettingRow[];
  planned: PlannedRow[];
  /** Tikri nurašymai per paskutinius kelis mėnesius (su datomis). */
  payments: PaymentRow[];
  accounts: AccountRow[];
  savings?: SavingsPlanRow[];
  /** Vėliausia diena, kurią dengia įkelti išrašai (visų sąskaitų). */
  dataThrough: string | null;
};

/** Grupės, kurių visos kategorijos yra įsipareigojimai — tvarka pagal svarbą. */
const PRIORITY_GROUPS = ["Kreditai", "Draudimas", "Komunaliniai", "Pensijos", "Taupymas"];

/** Įsipareigojimų grupėms pakanka, kad mokėta bent tiek mėnesių iš 12. */
const MONTHS_PRIORITY = 8;
/** Kitoms grupėms reikalavimai griežtesni, kad neįlįstų drabužiai ar pramogos. */
const MONTHS_OTHER = 10;
/** Sumų svyravimas (standartinis nuokrypis / vidurkis). */
const MAX_CV_OTHER = 0.35;
/** Daugiau operacijų per mėnesį — tai jau ne sąskaita, o kasdienis pirkimas. */
const MAX_COUNT_OTHER = 2;
/** Kiek laukiamos sumos pakanka, kad mokėjimą laikytume atliktu. */
const PAID_RATIO = 0.6;
/**
 * Iki kiek sumos gali svyruoti, kad mokėjimą dar laikytume fiksuotu. Komunaliniai,
 * būreliai ir panašūs kas mėnesį būna kitokie, tad jų prie konkrečios sumos rišti
 * negalima — kitaip mažesnė sąskaita atrodytų kaip nedamokėta.
 */
const MAX_CV_FIXED = 0.12;

export type ReminderState = "sumoketa" | "dalinai" | "laukiama" | "neapmoketa";

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/** Variacijos koeficientas: kiek sumos svyruoja lyginant su vidurkiu. */
const variation = (values: number[]): number => {
  if (values.length === 0) return 9;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  if (avg <= 0) return 9;
  const varianta = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(varianta) / avg;
};

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

/** Paskutinė mėnesio diena — „iki mėnesio pabaigos", kai tikslios dienos nežinom. */
const lastDayOfMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const dateOf = (month: string, day: number) =>
  `${month}-${String(Math.min(day, lastDayOfMonth(month))).padStart(2, "0")}`;

export function summarizeReminders(input: ReminderInput, today: string) {
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const firstMonth = shiftMonth(month, -12);

  const byCategory = new Map(input.categories.map((c) => [c.id, c]));
  const settings = new Map(
    input.settings.filter((s) => s.source === "kategorija").map((s) => [Number(s.ref), s])
  );

  // Istorija — tik pilni mėnesiai iki šio; šis mėnuo vertinamas atskirai.
  const history = input.history.filter((h) => h.month >= firstMonth && h.month < month);
  const historyByCategory = new Map<number, HistoryRow[]>();
  for (const row of history) {
    const list = historyByCategory.get(row.category_id) ?? [];
    list.push(row);
    historyByCategory.set(row.category_id, list);
  }

  // Tikri nurašymai: šio mėnesio — „ar sumokėta", ankstesnių — „kurią dieną".
  const paidByCategory = new Map<number, PaymentRow[]>();
  const earlierByCategory = new Map<number, PaymentRow[]>();
  for (const p of input.payments) {
    const target = p.booking_date >= monthStart ? paidByCategory : earlierByCategory;
    const list = target.get(p.category_id) ?? [];
    list.push(p);
    target.set(p.category_id, list);
  }

  const plannedByCategory = new Map<number, PlannedRow[]>();
  for (const p of input.planned) {
    if (p.due_date.slice(0, 7) !== month) continue;
    const list = plannedByCategory.get(p.category_id) ?? [];
    list.push(p);
    plannedByCategory.set(p.category_id, list);
  }

  const candidates = new Set<number>([
    ...historyByCategory.keys(),
    ...plannedByCategory.keys(),
    ...[...settings.entries()].filter(([, s]) => s.is_active === 1).map(([id]) => id),
  ]);

  const items = [];
  for (const categoryId of candidates) {
    const category = byCategory.get(categoryId);
    if (!category) continue;

    const setting = settings.get(categoryId);
    if (setting?.is_active === 0) continue;

    const rows = historyByCategory.get(categoryId) ?? [];
    const sums = rows.map((r) => r.cents);
    const monthsPaid = rows.length;
    const avgCount = monthsPaid > 0 ? rows.reduce((s, r) => s + r.count, 0) / monthsPaid : 0;
    const cv = variation(sums);
    const priority = PRIORITY_GROUPS.indexOf(category.group_name);
    const planned = plannedByCategory.get(categoryId) ?? [];

    // Į sąrašą patenka: rankiniu būdu įjungti, žinomi iš sutarčių grafiko,
    // įsipareigojimų grupės su pakankama istorija ir kitos — tik jei sumos
    // stabilios ir mokama viena operacija per mėnesį.
    const included =
      setting?.is_active === 1 ||
      planned.length > 0 ||
      (priority >= 0 && monthsPaid >= MONTHS_PRIORITY) ||
      (monthsPaid >= MONTHS_OTHER && cv <= MAX_CV_OTHER && avgCount <= MAX_COUNT_OTHER);
    if (!included) continue;

    const plannedCents = planned.reduce((s, p) => s + p.cents, 0);
    const expectedCents =
      setting?.expected_cents ?? (plannedCents > 0 ? plannedCents : median(sums));

    // Fiksuota suma tik tada, kai ji tikrai žinoma: nurodyta ranka, yra sutarties
    // grafike arba istoriškai beveik nekinta. Visur kitur laukiama suma tėra
    // orientyras, o nurašyta mažesnė suma nereiškia skolos.
    const fixed =
      setting?.expected_cents != null || plannedCents > 0 || (sums.length >= 3 && cv <= MAX_CV_FIXED);
    const minCents = sums.length > 0 ? Math.min(...sums) : expectedCents;
    const maxCents = sums.length > 0 ? Math.max(...sums) : expectedCents;

    // Diena: rankinė -> iš sutarties grafiko -> tipinė diena iš istorijos.
    const earlier = earlierByCategory.get(categoryId) ?? [];
    const firstDayPerMonth = new Map<string, number>();
    for (const p of [...earlier].sort((a, b) => a.booking_date.localeCompare(b.booking_date))) {
      const m = p.booking_date.slice(0, 7);
      if (!firstDayPerMonth.has(m)) firstDayPerMonth.set(m, Number(p.booking_date.slice(8, 10)));
    }
    const typicalDay = firstDayPerMonth.size > 0 ? median([...firstDayPerMonth.values()]) : null;
    const plannedDay = planned.length > 0 ? Number(planned[0].due_date.slice(8, 10)) : null;
    // Svarbiausia, kada bankas realiai nurašo: KASKO grafike įrašyta 3 d., o
    // nurašoma 24 d. — pagal grafiką mokėjimas visą mėnesį atrodytų vėluojantis.
    const dueDay = setting?.due_day ?? typicalDay ?? plannedDay;
    const dueDate = dueDay === null ? null : dateOf(month, dueDay);

    const paidRows = paidByCategory.get(categoryId) ?? [];
    const paidCents = paidRows.reduce((s, p) => s + p.cents, 0);
    const lastPaid = paidRows.map((p) => p.booking_date).sort().at(-1) ?? null;

    // „Nesumokėta" tikima tik tiek, kiek toli siekia tos sąskaitos išrašai, iš
    // kurios ta kategorija mokama: Rūtos Swedbank išrašas gali baigtis
    // anksčiau nei Jono SEB, ir jos mokėjimai dar tiesiog nematomi.
    const usedAccounts = new Set([...earlier, ...paidRows].map((p) => p.account_id ?? 0));
    const accountDates = input.accounts
      .filter((a) => usedAccounts.has(a.account_id))
      .map((a) => a.through)
      .sort();
    const known = (accountDates.at(-1) ?? input.dataThrough) ?? monthStart;
    const deadline = dueDate ?? dateOf(month, lastDayOfMonth(month));
    let state: ReminderState;
    if (paidCents > 0 && (!fixed || paidCents >= expectedCents * PAID_RATIO)) state = "sumoketa";
    else if (paidCents > 0) state = "dalinai";
    else state = known >= deadline ? "neapmoketa" : "laukiama";

    items.push({
      source: "kategorija" as const,
      ref: String(categoryId),
      categoryId,
      name: category.name,
      groupId: category.group_id,
      groupName: category.group_name,
      priority: priority >= 0 ? priority : PRIORITY_GROUPS.length,
      expectedCents,
      /** false — suma kas mėnesį kitokia, tad tai tik orientyras. */
      fixed,
      minCents,
      maxCents,
      paidCents,
      /** Kiek dar laukiama nurašymo; sumokėjus — 0. */
      leftCents: state === "sumoketa" ? 0 : Math.max(0, expectedCents - paidCents),
      dueDay,
      dueDate,
      state,
      /** Iki kurios dienos matomi tos sąskaitos nurašymai. */
      knownThrough: known,
      lastPaid,
      monthsPaid,
      /** Kaip įrašas atsirado — kad būtų aišku, ką reiškia „laukiama suma". */
      basis: setting?.expected_cents != null ? "rankinis" : planned.length > 0 ? "grafikas" : "istorija",
      manual: setting != null,
      note: setting?.note ?? null,
    });
  }

  // Taupymo planai: ar šį mėnesį jau atidėta tiek, kiek užsibrėžta.
  const savingsSettings = new Map(
    input.settings.filter((s) => s.source === "taupymas").map((s) => [s.ref, s])
  );
  for (const plan of input.savings ?? []) {
    const setting = savingsSettings.get(plan.code);
    if (setting?.is_active === 0) continue;

    const expectedCents = setting?.expected_cents ?? plan.plan_cents;
    if (expectedCents <= 0) continue;

    const dueDay = setting?.due_day ?? null;
    const dueDate = dueDay === null ? null : dateOf(month, dueDay);
    const known = input.dataThrough ?? monthStart;
    const deadline = dueDate ?? dateOf(month, lastDayOfMonth(month));
    const paidCents = plan.paid_cents;

    let state: ReminderState;
    if (paidCents >= expectedCents * PAID_RATIO) state = "sumoketa";
    else if (paidCents > 0) state = "dalinai";
    else state = known >= deadline ? "neapmoketa" : "laukiama";

    items.push({
      source: "taupymas" as const,
      ref: plan.code,
      categoryId: 0,
      name: plan.name,
      groupId: 0,
      groupName: "Taupymas",
      priority: PRIORITY_GROUPS.indexOf("Taupymas"),
      expectedCents,
      fixed: true,
      minCents: expectedCents,
      maxCents: expectedCents,
      paidCents,
      leftCents: state === "sumoketa" ? 0 : Math.max(0, expectedCents - paidCents),
      dueDay,
      dueDate,
      state,
      knownThrough: known,
      lastPaid: null,
      monthsPaid: 0,
      basis: setting?.expected_cents != null ? "rankinis" : "istorija",
      manual: setting != null,
      note: setting?.note ?? null,
    });
  }

  items.sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.dueDay ?? 99) - (b.dueDay ?? 99) ||
      a.name.localeCompare(b.name, "lt")
  );

  // Kieno išrašai kiek seni — kad būtų aišku, ar „dar nematyti" reiškia
  // nesumokėta, ar tiesiog neįkeltą išrašą.
  const byOwner = new Map<string, string>();
  for (const a of input.accounts) {
    const owner = a.owner ?? "Bendra";
    const esamas = byOwner.get(owner);
    if (!esamas || a.through > esamas) byOwner.set(owner, a.through);
  }

  const unpaid = items.filter((i) => i.state !== "sumoketa");
  return {
    today,
    month,
    dataThrough: input.dataThrough,
    sources: [...byOwner.entries()]
      .map(([owner, through]) => ({ owner, through }))
      .sort((a, b) => a.through.localeCompare(b.through)),
    items,
    totals: {
      count: items.length,
      paidCount: items.length - unpaid.length,
      lateCount: items.filter((i) => i.state === "neapmoketa").length,
      expectedCents: items.reduce((s, i) => s + i.expectedCents, 0),
      paidCents: items.reduce((s, i) => s + i.paidCents, 0),
      leftCents: unpaid.reduce((s, i) => s + i.leftCents, 0),
    },
  };
}

export async function buildReminders(db: D1Database, today: string) {
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const historyFrom = `${shiftMonth(month, -12)}-01`;
  const paymentsFrom = `${shiftMonth(month, -6)}-01`;

  const [history, categories, settings, payments, credits, policies, through, accounts, savings] = await Promise.all([
    db
      .prepare(
        `SELECT t.category_id, substr(t.booking_date, 1, 7) AS month,
                SUM(-t.amount_cents) AS cents, COUNT(*) AS count,
                MAX(CASE WHEN t.notes IS 'excel-istorija' THEN 0 ELSE 1 END) AS isReal
         FROM transactions t
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND t.amount_cents < 0
           AND t.category_id IS NOT NULL AND t.booking_date >= ?
         GROUP BY t.category_id, month`
      )
      .bind(historyFrom)
      .all<HistoryRow>(),

    db
      .prepare(
        `SELECT c.id, c.name, p.id AS group_id, p.name AS group_name,
                p.sort_order AS group_sort, c.sort_order
         FROM categories c JOIN categories p ON p.id = c.parent_id
         WHERE COALESCE(p.type, c.type) = 'expense'`
      )
      .all<CategoryRow>(),

    db.prepare("SELECT source, ref, is_active, expected_cents, due_day, note FROM recurring_settings").all<SettingRow>(),

    db
      .prepare(
        `SELECT t.category_id, t.booking_date, -t.amount_cents AS cents, t.account_id
         FROM transactions t
         WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND t.amount_cents < 0
           AND t.category_id IS NOT NULL AND t.notes IS NOT 'excel-istorija'
           AND t.booking_date >= ?`
      )
      .bind(paymentsFrom)
      .all<PaymentRow>(),

    db
      .prepare(
        `SELECT c.payment_category_id AS category_id, s.due_date, s.payment_cents AS cents
         FROM credit_schedule s JOIN credits c ON c.id = s.credit_id
         WHERE c.payment_category_id IS NOT NULL AND s.due_date BETWEEN ? AND ?`
      )
      .bind(monthStart, monthEnd)
      .all<{ category_id: number; due_date: string; cents: number }>(),

    db
      .prepare(
        `SELECT payment_category_id AS category_id, schedule
         FROM insurance_policies
         WHERE payment_category_id IS NOT NULL AND period_end >= ?`
      )
      .bind(monthStart)
      .all<{ category_id: number; schedule: string }>(),

    db
      .prepare("SELECT MAX(booking_date) AS data FROM transactions WHERE notes IS NOT 'excel-istorija'")
      .first<{ data: string | null }>(),

    db
      .prepare(
        `SELECT t.account_id, a.owner, MAX(t.booking_date) AS through
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.notes IS NOT 'excel-istorija'
         GROUP BY t.account_id`
      )
      .all<AccountRow>(),

    db
      .prepare(
        `SELECT g.code, g.name, g.monthly_plan_cents AS plan_cents,
                COALESCE((SELECT SUM(e.cents) FROM savings_entries e
                          WHERE e.goal_id = g.id AND substr(e.date, 1, 7) = ?), 0) AS paid_cents
         FROM savings_goals g
         WHERE g.is_active = 1 AND COALESCE(g.monthly_plan_cents, 0) > 0`
      )
      .bind(month)
      .all<SavingsPlanRow>(),
  ]);

  const planned: PlannedRow[] = credits.results.map((r) => ({ ...r, source: "kreditas" }));
  for (const row of policies.results) {
    let schedule: { data: string; cents: number }[] = [];
    try {
      schedule = JSON.parse(row.schedule ?? "[]");
    } catch {
      schedule = [];
    }
    for (const s of schedule) {
      if (s.data?.slice(0, 7) === month) {
        planned.push({ category_id: row.category_id, due_date: s.data, cents: s.cents, source: "draudimas" });
      }
    }
  }

  return summarizeReminders(
    {
      history: history.results,
      categories: categories.results,
      settings: settings.results,
      planned,
      payments: payments.results,
      accounts: accounts.results,
      savings: savings.results,
      dataThrough: through?.data ?? null,
    },
    today
  );
}

/** Rankinis pataisymas: išjungti, įjungti arba nurodyti kitą sumą ir dieną. */
export async function saveReminderSetting(
  db: D1Database,
  source: string,
  ref: string,
  body: { isActive?: boolean; expectedCents?: number | null; dueDay?: number | null; note?: string | null }
) {
  if (source !== "kategorija" && source !== "taupymas") {
    throw new Error("Nežinomas priminimo tipas.");
  }
  if (body.dueDay != null && (body.dueDay < 1 || body.dueDay > 31)) {
    throw new Error("Diena turi būti nuo 1 iki 31.");
  }
  if (body.expectedCents != null && body.expectedCents < 0) {
    throw new Error("Suma negali būti neigiama.");
  }

  await db
    .prepare(
      `INSERT INTO recurring_settings (source, ref, is_active, expected_cents, due_day, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, ref) DO UPDATE SET
         is_active = COALESCE(excluded.is_active, recurring_settings.is_active),
         expected_cents = excluded.expected_cents,
         due_day = excluded.due_day,
         note = excluded.note`
    )
    .bind(
      source,
      ref,
      body.isActive === undefined ? 1 : body.isActive ? 1 : 0,
      body.expectedCents ?? null,
      body.dueDay ?? null,
      body.note ?? null
    )
    .run();
}

export type Reminders = ReturnType<typeof summarizeReminders>;

export type CreditRecord = {
  id: number;
  kind: string;
  name: string;
  asset: string | null;
  lender: string;
  contract_no: string | null;
  contract_date: string | null;
  end_date: string;
  original_cents: number;
  rate_type: "kintama" | "fiksuota";
  rate_pct: number;
  base_rate_name: string | null;
  base_rate_pct: number | null;
  margin_pct: number | null;
  next_rate_change: string | null;
  monthly_payment_cents: number;
  residual_cents: number | null;
  balance_cents: number;
  balance_date: string;
  principal_category_id: number | null;
  interest_category_id: number | null;
  payment_category_id: number | null;
  details: string | null;
  sort_order: number;
};

export type ScheduleRow = {
  seq: number;
  due_date: string;
  principal_cents: number;
  interest_cents: number;
  payment_cents: number;
  balance_after_cents: number;
};

export type CreditPayment = { booking_date: string; amount_cents: number; category_id: number };

type Detail = { etikete: string; reiksme: string; data?: string; ivykis?: string };
type MonthTotals = { month: string; principal: number; interest: number; total: number };

/** Kiek įmoka gali būti mažesnė už grafiko sumą, kad dar būtų laikoma sumokėta. */
const TOLERANCE_CENTS = 100;

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Anuiteto įmoka: kiek reikėtų mokėti per mėnesį, kad likutis būtų grąžintas per `months`. */
export function annuityPaymentCents(balanceCents: number, ratePct: number, months: number): number {
  if (months <= 0) return balanceCents;
  const r = ratePct / 100 / 12;
  if (r === 0) return Math.round(balanceCents / months);
  return Math.round((balanceCents * r) / (1 - Math.pow(1 + r, -months)));
}

/** Pilni mėnesiai tarp dviejų datų („2026-09-13" -> „2049-09-10" = 275). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * Vieno kredito būsena šiandien.
 *
 * Likutis = banko nurodytas likutis atskaitos datai − po jos faktiškai grąžinta
 * kredito dalis. Kai bankas kredito ir palūkanų dalis nurašo atskirai, grąžinta
 * dalis imama iš išrašų; kai nurašo bendrą įmoką, sumokėtos įmokos „nubraukiamos"
 * nuo grafiko ir kredito dalis imama iš jo.
 */
export function summarizeCredit(
  credit: CreditRecord,
  schedule: ScheduleRow[],
  payments: CreditPayment[],
  today: string
) {
  const rows = [...schedule].sort((a, b) => a.seq - b.seq);
  const categoryIds = [
    credit.principal_category_id,
    credit.interest_category_id,
    credit.payment_category_id,
  ].filter((id): id is number => id !== null);

  const linked = payments.filter((p) => categoryIds.includes(p.category_id));
  const afterAnchor = linked.filter((p) => p.booking_date > credit.balance_date);
  const paidAfterCents = -sum(afterAnchor.map((p) => p.amount_cents));

  // Grafiko eilutės, kurias bankas jau buvo įskaitęs atskaitos dieną: po jų
  // likutis dar ne mažesnis už tą dieną nurodytą.
  let anchorIndex = rows.findIndex((r) => r.balance_after_cents < credit.balance_cents);
  if (anchorIndex === -1) anchorIndex = rows.length;

  let next = anchorIndex;
  let rest = paidAfterCents;
  while (next < rows.length && rest >= rows[next].payment_cents - TOLERANCE_CENTS) {
    rest -= rows[next].payment_cents;
    next++;
  }

  const principalAfterCents =
    credit.principal_category_id !== null
      ? -sum(
          afterAnchor
            .filter((p) => p.category_id === credit.principal_category_id)
            .map((p) => p.amount_cents)
        )
      : sum(rows.slice(anchorIndex, next).map((r) => r.principal_cents));

  const balanceCents = Math.max(0, credit.balance_cents - principalAfterCents);
  const paidCents = credit.original_cents - balanceCents;
  const remaining = rows.slice(next);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;

  // Istorija: iš išrašų, jei bankas atskiria dalis, kitaip — sumokėtos grafiko eilutės.
  const historySource: "israsai" | "grafikas" =
    credit.principal_category_id !== null ? "israsai" : "grafikas";
  const byMonth = new Map<string, MonthTotals>();
  const add = (month: string, principal: number, interest: number, total: number) => {
    const entry = byMonth.get(month) ?? { month, principal: 0, interest: 0, total: 0 };
    entry.principal += principal;
    entry.interest += interest;
    entry.total += total;
    byMonth.set(month, entry);
  };

  if (historySource === "israsai") {
    for (const p of linked) {
      const amount = -p.amount_cents;
      add(
        p.booking_date.slice(0, 7),
        p.category_id === credit.principal_category_id ? amount : 0,
        p.category_id === credit.interest_category_id ? amount : 0,
        amount
      );
    }
  } else {
    for (const r of rows.slice(0, next)) {
      add(r.due_date.slice(0, 7), r.principal_cents, r.interest_cents, r.payment_cents);
    }
  }

  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const years: (MonthTotals & { year: string; months: MonthTotals[] })[] = [];
  for (const m of months) {
    const year = m.month.slice(0, 4);
    let entry = years.find((y) => y.year === year);
    if (!entry) {
      entry = { year, month: year, principal: 0, interest: 0, total: 0, months: [] };
      years.push(entry);
    }
    entry.principal += m.principal;
    entry.interest += m.interest;
    entry.total += m.total;
    entry.months.push(m);
  }

  const details = JSON.parse(credit.details ?? "[]") as Detail[];

  const events: { date: string; title: string; amountCents: number | null }[] = [];
  if (credit.next_rate_change && credit.next_rate_change >= today) {
    events.push({
      date: credit.next_rate_change,
      title: `${credit.name}: palūkanų normos perskaičiavimas`,
      amountCents: null,
    });
  }
  for (const d of details) {
    if (d.data && d.data >= today) {
      events.push({ date: d.data, title: d.ivykis ?? d.etikete, amountCents: null });
    }
  }
  if (last && last.due_date >= today) {
    events.push({
      date: last.due_date,
      title: credit.residual_cents
        ? `${credit.name}: paskutinė įmoka su likutine verte`
        : `${credit.name}: paskutinė įmoka`,
      amountCents: last.payment_cents,
    });
  }

  const sensitivity =
    credit.rate_type === "kintama" && remaining.length > 0
      ? {
          basePaymentCents: annuityPaymentCents(balanceCents, credit.rate_pct, remaining.length),
          variants: [-0.5, 0.5, 1].map((deltaPct) => ({
            deltaPct,
            paymentCents: annuityPaymentCents(balanceCents, credit.rate_pct + deltaPct, remaining.length),
          })),
        }
      : null;

  const chart = [
    anchorIndex === 0
      ? { date: credit.balance_date, balance: credit.balance_cents, payment: null, principal: null, interest: null }
      : {
          date: credit.contract_date ?? rows[0].due_date,
          balance: credit.original_cents,
          payment: null,
          principal: null,
          interest: null,
        },
    ...rows.map((r) => ({
      date: r.due_date,
      balance: r.balance_after_cents,
      payment: r.payment_cents,
      principal: r.principal_cents,
      interest: r.interest_cents,
    })),
  ];

  return {
    id: credit.id,
    kind: credit.kind,
    name: credit.name,
    asset: credit.asset,
    lender: credit.lender,
    contractNo: credit.contract_no,
    contractDate: credit.contract_date,
    endDate: credit.end_date,
    originalCents: credit.original_cents,
    rateType: credit.rate_type,
    ratePct: credit.rate_pct,
    baseRateName: credit.base_rate_name,
    baseRatePct: credit.base_rate_pct,
    marginPct: credit.margin_pct,
    nextRateChange: credit.next_rate_change,
    monthlyPaymentCents: credit.monthly_payment_cents,
    residualCents: credit.residual_cents,
    balanceCents,
    anchor: {
      balanceCents: credit.balance_cents,
      date: credit.balance_date,
      paymentsAfter: afterAnchor.length,
      principalAfterCents,
    },
    paidCents,
    progress: credit.original_cents > 0 ? paidCents / credit.original_cents : 0,
    nextPayment: remaining[0] ?? null,
    remaining: {
      count: remaining.length,
      interestCents: sum(remaining.map((r) => r.interest_cents)),
      totalCents: sum(remaining.map((r) => r.payment_cents)),
      monthsLeft: monthsBetween(today, credit.end_date),
    },
    lastPayment: last,
    interestPaid: {
      cents: sum(months.map((m) => m.interest)),
      since: months.length > 0 ? months[months.length - 1].month : null,
    },
    sensitivity,
    residualSavingCents:
      credit.residual_cents && remaining.length > 0
        ? Math.ceil(credit.residual_cents / remaining.length)
        : null,
    events,
    history: years.map(({ month: _month, ...y }) => y),
    historySource,
    schedule: rows.map((r, i) => ({ ...r, paid: i < next })),
    chart,
    details: details.map(({ etikete, reiksme }) => ({ etikete, reiksme })),
    categoryIds,
  };
}

export async function buildCredits(db: D1Database, today: string) {
  const { results: credits } = await db
    .prepare("SELECT * FROM credits ORDER BY sort_order, id")
    .all<CreditRecord>();
  if (credits.length === 0) return [];

  const { results: schedule } = await db
    .prepare(
      `SELECT credit_id, seq, due_date, principal_cents, interest_cents, payment_cents, balance_after_cents
       FROM credit_schedule ORDER BY credit_id, seq`
    )
    .all<ScheduleRow & { credit_id: number }>();

  const categoryIds = [
    ...new Set(
      credits.flatMap((c) =>
        [c.principal_category_id, c.interest_category_id, c.payment_category_id].filter(
          (id): id is number => id !== null
        )
      )
    ),
  ];

  const payments =
    categoryIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT booking_date, amount_cents, category_id FROM transactions
               WHERE is_split_parent = 0 AND category_id IN (${categoryIds.map(() => "?").join(",")})`
            )
            .bind(...categoryIds)
            .all<CreditPayment>()
        ).results;

  return credits.map((credit) =>
    summarizeCredit(
      credit,
      schedule.filter((r) => r.credit_id === credit.id),
      payments,
      today
    )
  );
}

export type CreditSummary = ReturnType<typeof summarizeCredit>;

import { shiftMonths } from "./pensions";

export type InsurancePolicyRow = {
  id: number;
  code: string;
  policy_no: string;
  kind: "gyvybes" | "kasko" | "civiline" | "bustas" | "kita";
  object_group: string;
  title: string;
  insurer: string;
  policyholder: string | null;
  insured: string | null;
  beneficiary: string | null;
  contract_start: string | null;
  contract_end: string | null;
  period_start: string;
  period_end: string;
  premium_cents: number;
  security_levy_cents: number;
  monthly_cents: number | null;
  payment_category_id: number | null;
  pension_product_code: string | null;
  coverages: string;
  conditions: string;
  schedule: string;
  changes: string;
  notes: string;
  investment: string | null;
  sort_order: number;
};

export type InsurancePaymentRow = {
  booking_date: string;
  amount_cents: number;
  category_id: number;
  /** 1 — mėnesio suma iš Excel istorijos, ne tikras nurašymas. */
  history: number;
};

type ScheduleItem = { data: string; cents: number };

export type Coverage = {
  rizika: string;
  suma_cents?: number | null;
  suma_tekstas?: string | null;
  isskaita?: string | null;
  iki?: string | null;
};

/** Grupių tvarka skiltyje: žmonės, tada turtas. */
/** Kam priklauso: pirma žmonės (šeimos nariai — abėcėlės tvarka), tada turtas. */
const OBJECT_ORDER = ["Automobilis", "Būstas"];
const KIND_LABEL: Record<InsurancePolicyRow["kind"], string> = {
  gyvybes: "gyvybės draudimas",
  kasko: "KASKO",
  civiline: "privalomasis draudimas",
  bustas: "būsto draudimas",
  kita: "draudimas",
};

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Mėnesio ekvivalentas: mėnesinė įmoka arba metinė kaina / 12. */
export const monthlyEquivalent = (p: Pick<InsurancePolicyRow, "monthly_cents" | "premium_cents">) =>
  p.monthly_cents ?? Math.round(p.premium_cents / 12);

export function summarizeInsurance(rows: InsurancePolicyRow[], payments: InsurancePaymentRow[], today: string) {
  const byPolicy = new Map<string, InsurancePolicyRow[]>();
  for (const row of [...rows].sort((a, b) => a.period_start.localeCompare(b.period_start))) {
    const list = byPolicy.get(row.policy_no) ?? [];
    list.push(row);
    byPolicy.set(row.policy_no, list);
  }

  const policies = [...byPolicy.values()].map((periods) => {
    const current =
      periods.find((p) => p.period_start <= today && today <= p.period_end) ??
      [...periods].reverse().find((p) => p.period_start <= today) ??
      periods[0];
    const upcoming = periods.find((p) => p.period_start > today && p.period_start > current.period_start) ?? null;
    const status: "galioja" | "baigesi" | "busima" =
      current.period_start > today ? "busima" : current.period_end < today ? "baigesi" : "galioja";

    const schedule = parse<ScheduleItem[]>(current.schedule, []);
    const upcomingSchedule = upcoming ? parse<ScheduleItem[]>(upcoming.schedule, []) : [];

    // Tikri nurašymai iš kategorijos, kurių suma atitinka šio poliso įmokas
    // (ta pati kategorija gali turėti kelis polisus, pvz. KASKO ir privalomąjį).
    const expectedAmounts = new Set(
      [current.monthly_cents, current.premium_cents, ...schedule.map((s) => s.cents), ...upcomingSchedule.map((s) => s.cents)]
        .filter((a): a is number => typeof a === "number" && a > 0)
    );
    const matches = (cents: number) =>
      [...expectedAmounts].some((a) => Math.abs(cents - a) <= Math.max(2, Math.round(a * 0.01)));
    const bankPayments = payments
      .filter((pm) => pm.category_id === current.payment_category_id && !pm.history && matches(-pm.amount_cents))
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const lastPayment = bankPayments.length > 0 ? bankPayments[bankPayments.length - 1] : null;

    let nextPayment: { date: string; cents: number; estimated: boolean } | null = null;
    const planned = [...schedule, ...upcomingSchedule].find((s) => s.data >= today);
    if (planned) nextPayment = { date: planned.data, cents: planned.cents, estimated: false };
    else if (status === "galioja" && current.monthly_cents && lastPayment) {
      let d = shiftMonths(lastPayment.booking_date, 1);
      while (d < today) d = shiftMonths(d, 1);
      nextPayment = { date: d, cents: current.monthly_cents, estimated: true };
    }

    return {
      policyNo: current.policy_no,
      code: current.code,
      kind: current.kind,
      kindLabel: KIND_LABEL[current.kind],
      objectGroup: current.object_group,
      title: current.title,
      insurer: current.insurer,
      policyholder: current.policyholder,
      insured: current.insured,
      beneficiary: current.beneficiary,
      contractStart: current.contract_start,
      contractEnd: current.contract_end,
      periodStart: current.period_start,
      periodEnd: current.period_end,
      status,
      premiumCents: current.premium_cents,
      securityLevyCents: current.security_levy_cents,
      monthlyCents: current.monthly_cents,
      monthlyEquivalentCents: monthlyEquivalent(current),
      paymentCategoryId: current.payment_category_id,
      pensionProductCode: current.pension_product_code,
      coverages: parse<Coverage[]>(current.coverages, []),
      conditions: parse<string[]>(current.conditions, []),
      schedule,
      changes: parse<string[]>(current.changes, []),
      notes: parse<string[]>(current.notes, []),
      investment: parse<unknown>(current.investment, null),
      lastPayment: lastPayment ? { date: lastPayment.booking_date, cents: -lastPayment.amount_cents } : null,
      nextPayment,
      upcoming: upcoming
        ? {
            periodStart: upcoming.period_start,
            periodEnd: upcoming.period_end,
            premiumCents: upcoming.premium_cents,
            securityLevyCents: upcoming.security_levy_cents,
            monthlyCents: upcoming.monthly_cents,
            monthlyEquivalentCents: monthlyEquivalent(upcoming),
            coverages: parse<Coverage[]>(upcoming.coverages, []),
            changes: parse<string[]>(upcoming.changes, []),
            notes: parse<string[]>(upcoming.notes, []),
          }
        : null,
      sortOrder: current.sort_order,
    };
  });

  // Pirma žmonės (abėcėlės tvarka), tada turtas OBJECT_ORDER tvarka.
  const rank = (g: string) => OBJECT_ORDER.indexOf(g);
  policies.sort(
    (a, b) =>
      rank(a.objectGroup) - rank(b.objectGroup) ||
      (rank(a.objectGroup) < 0 ? a.objectGroup.localeCompare(b.objectGroup, "lt") : 0) ||
      a.sortOrder - b.sortOrder
  );

  const events: { date: string; policyNo: string; title: string; amountCents: number | null; note: string | null }[] = [];
  for (const p of policies) {
    if (p.status === "baigesi") continue;
    const label = p.kind === "gyvybes" ? `${p.insured}: ${p.kindLabel}` : `${p.objectGroup}: ${p.kindLabel}`;
    if (p.upcoming) {
      events.push({
        date: p.upcoming.periodStart,
        policyNo: p.policyNo,
        title: `${label} — naujas laikotarpis`,
        amountCents: p.upcoming.monthlyCents ?? p.upcoming.premiumCents,
        note: p.upcoming.monthlyCents ? "per mėnesį" : "už metus",
      });
    } else if (p.kind === "gyvybes") {
      events.push({
        date: addDays(p.periodEnd, 1),
        policyNo: p.policyNo,
        title: `${label} — sutarties metinės (įmoka ir sumos gali būti indeksuojamos)`,
        amountCents: null,
        note: null,
      });
    } else {
      events.push({
        date: p.periodEnd,
        policyNo: p.policyNo,
        title: `${label} — baigiasi, reikės atnaujinti`,
        amountCents: null,
        note: null,
      });
    }
    if (p.nextPayment && !p.monthlyCents && p.nextPayment.cents >= 5000) {
      events.push({
        date: p.nextPayment.date,
        policyNo: p.policyNo,
        title: `${label} — įmoka`,
        amountCents: p.nextPayment.cents,
        note: null,
      });
    }
    for (const c of p.coverages) {
      if (c.iki && (!p.contractEnd || c.iki < p.contractEnd) && c.iki >= today) {
        events.push({ date: c.iki, policyNo: p.policyNo, title: `${p.insured}: baigiasi „${c.rizika}“`, amountCents: null, note: null });
      }
    }
    if (p.contractEnd && p.contractEnd >= today) {
      events.push({ date: p.contractEnd, policyNo: p.policyNo, title: `${label} — sutarties pabaiga`, amountCents: null, note: null });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const active = policies.filter((p) => p.status === "galioja");
  const groups = [...new Set(policies.map((p) => p.objectGroup))].map((group) => {
    const own = active.filter((p) => p.objectGroup === group);
    return {
      group,
      monthlyEquivalentCents: own.reduce((s, p) => s + p.monthlyEquivalentCents, 0),
      yearlyCents: own.reduce((s, p) => s + p.premiumCents, 0),
    };
  });

  return {
    today,
    policies,
    events,
    groups,
    totals: {
      activeCount: active.length,
      monthlyEquivalentCents: active.reduce((s, p) => s + p.monthlyEquivalentCents, 0),
      yearlyCents: active.reduce((s, p) => s + p.premiumCents, 0),
      /** Mėnesio suma po artėjančių laikotarpių pakeitimų. */
      monthlyAfterChangesCents: active.reduce((s, p) => s + (p.upcoming?.monthlyEquivalentCents ?? p.monthlyEquivalentCents), 0),
      nextChangeDate: active
        .map((p) => p.upcoming?.periodStart)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null,
    },
  };
}

export async function buildInsurance(db: D1Database, today: string) {
  const [policies, payments] = await Promise.all([
    db.prepare("SELECT * FROM insurance_policies ORDER BY sort_order, period_start").all<InsurancePolicyRow>(),
    db
      .prepare(
        `SELECT t.booking_date, t.amount_cents, t.category_id,
                CASE WHEN t.notes = 'excel-istorija' THEN 1 ELSE 0 END AS history
         FROM transactions t
         WHERE t.is_split_parent = 0
           AND t.category_id IN (SELECT payment_category_id FROM insurance_policies WHERE payment_category_id IS NOT NULL)
           AND t.booking_date >= ?`
      )
      .bind(shiftMonths(today, -14))
      .all<InsurancePaymentRow>(),
  ]);
  return summarizeInsurance(policies.results, payments.results, today);
}

export type InsuranceSummary = ReturnType<typeof summarizeInsurance>;

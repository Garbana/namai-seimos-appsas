export type PensionProductRow = {
  id: number;
  code: string;
  owner: string;
  pillar: "II" | "III" | "PZU";
  name: string;
  provider: string | null;
  fund_label: string | null;
  contract_no: string | null;
  start_date: string | null;
  end_date: string | null;
  valuation: "vienetai" | "rankinis";
  monthly_contribution_cents: number | null;
  contribution_day: number | null;
  contribution_category_id: number | null;
  gpm: number;
  /** GPM lengvatai tinka tik šios sutarties dalies įmokos (NULL — visos). */
  gpm_portfolio: string | null;
  /** Kieno susigrąžinimui priskiriamos įmokos (NULL — pagal banko sąskaitą). */
  gpm_payer: string | null;
  details: string | null;
  sort_order: number;
};

export type HoldingRow = {
  product_id: number;
  portfolio: string;
  isin: string;
  fund_name: string;
  price_source: string | null;
  units: number | null;
  units_date: string | null;
  share: number;
  portfolio_monthly_cents: number | null;
};

export type OperationRow = {
  product_id: number;
  portfolio: string;
  date: string;
  kind: "imoka" | "perkelimas";
  amount_cents: number;
  isin: string | null;
  units: number | null;
  price: number | null;
};

export type ValuationRow = {
  id: number;
  product_id: number;
  date: string;
  value_cents: number;
  contributed_total_cents: number | null;
  source: "rankinis" | "excel" | "ataskaita";
  note: string | null;
};

export type PriceRow = { isin: string; date: string; price: number; source?: string | null };
export type BankPaymentRow = {
  booking_date: string;
  amount_cents: number;
  category_id: number;
  owner: string | null;
  /** 1 — mėnesio suma iš Excel istorijos, ne tikras banko nurašymas. */
  history: number;
};
export type PersonRow = { owner: string; birth_date: string; payout_date: string };

export type PensionInput = {
  products: PensionProductRow[];
  holdings: HoldingRow[];
  operations: OperationRow[];
  valuations: ValuationRow[];
  prices: PriceRow[];
  payments: BankPaymentRow[];
  people: PersonRow[];
};

/** GPM lengvata: 20 % nuo įmokų, bet ne daugiau kaip nuo 1 500 € per metus vienam žmogui. */
export const GPM_RATE = 0.2;
export const GPM_LIMIT_CENTS = 150_000;

const DAY_MS = 86_400_000;
const MAX_BASE_PRICE_AGE_DAYS = 10;
const time = (d: string) => Date.parse(`${d}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

export function gpmRefundCents(contributedCents: number): number {
  return Math.round(Math.min(Math.max(contributedCents, 0), GPM_LIMIT_CENTS) * GPM_RATE);
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Data po `months` mėnesių; `day` — pageidaujama mėnesio diena (apribojama mėnesio ilgiu). */
export function shiftMonths(date: string, months: number, day?: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day ?? d, last))}`;
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type PriceIndex = Map<string, PriceRow[]>;

export function buildPriceIndex(prices: PriceRow[]): PriceIndex {
  const index: PriceIndex = new Map();
  for (const p of prices) {
    const list = index.get(p.isin) ?? [];
    list.push(p);
    index.set(p.isin, list);
  }
  for (const list of index.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return index;
}

/** Paskutinė žinoma kaina ne vėlesnė nei `date`. */
export function priceAt(index: PriceIndex, isin: string, date: string): PriceRow | null {
  const list = index.get(isin);
  if (!list || list.length === 0 || list[0].date > date) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (list[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

/**
 * Metinė grąža pagal pinigų srautus (XIRR): įmokos neigiamos, dabartinė vertė
 * teigiama. Grąžina null, kai srautų nepakanka arba sprendinio nėra.
 */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...flows.map((f) => time(f.date)));
  const npv = (r: number) =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (time(f.date) - t0) / (365 * DAY_MS)), 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  if (!Number.isFinite(fLo) || fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Fondo vienetai datai.
 *  - Jei yra operacijos su vienetais (II pakopos ataskaita) — jų suma; jei dar žinomas
 *    likutis datai (units + units_date), skaičiuojama nuo jo (pradinis likutis gali būti
 *    ne ataskaitoje). Po paskutinės operacijos kas mėnesį pridedama apytikslė įmoka
 *    (paskutinių 3 vidurkis).
 *  - Jei žinomi vienetai datai (units + units_date) — ankstesnėms datoms atimamos
 *    vėlesnės įmokos pagal tų dienų kainą, vėlesnėms pridedamos apytikslės pagal planą.
 */
export function holdingUnitsAt(
  holding: HoldingRow,
  ops: OperationRow[],
  index: PriceIndex,
  date: string,
  contributionDay: number | null
): { units: number; estimated: boolean } | null {
  const own = ops
    .filter((o) => o.isin === holding.isin && o.units !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (own.length > 0) {
    let units = 0;
    if (holding.units !== null && holding.units_date) {
      units = holding.units;
      for (const o of own) {
        if (o.date > date && o.date <= holding.units_date) units -= o.units as number;
        else if (o.date <= date && o.date > holding.units_date) units += o.units as number;
      }
    } else {
      for (const o of own) if (o.date <= date) units += o.units as number;
    }
    const last = own[own.length - 1];
    let estimated = false;
    if (date > last.date) {
      const recent = own.filter((o) => o.kind === "imoka").slice(-3);
      const avg = recent.length > 0 ? sum(recent.map((o) => o.amount_cents)) / recent.length : 0;
      for (let k = 1; avg > 0; k++) {
        const d = shiftMonths(last.date, k);
        if (d > date) break;
        const p = priceAt(index, holding.isin, d);
        if (p) {
          units += avg / 100 / p.price;
          estimated = true;
        }
      }
    }
    return units > 1e-9 ? { units, estimated } : null;
  }

  if (holding.units !== null && holding.units_date) {
    let units = holding.units;
    if (date <= holding.units_date) {
      for (const o of ops) {
        if (o.kind !== "imoka" || o.portfolio !== holding.portfolio) continue;
        if (o.date <= date || o.date > holding.units_date) continue;
        const p = priceAt(index, holding.isin, o.date);
        if (!p) return null;
        units -= ((o.amount_cents / 100) * holding.share) / p.price;
      }
      return units > 0 ? { units, estimated: false } : null;
    }
    let estimated = false;
    const monthly = holding.portfolio_monthly_cents ?? 0;
    for (let k = 1; monthly > 0; k++) {
      const d = shiftMonths(holding.units_date, k, contributionDay ?? undefined);
      if (d > date) break;
      const p = priceAt(index, holding.isin, d);
      if (p) {
        units += ((monthly / 100) * holding.share) / p.price;
        estimated = true;
      }
    }
    return { units, estimated };
  }

  return null;
}

/** Apytikslės įmokos po paskutinių žinomų duomenų (tos pačios, kurias skaičiuoja holdingUnitsAt). */
function estimatedContributions(
  product: PensionProductRow,
  holdings: HoldingRow[],
  ops: OperationRow[],
  today: string
): { date: string; cents: number; portfolio: string }[] {
  const unitOps = ops.filter((o) => o.units !== null).sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; cents: number; portfolio: string }[] = [];
  if (unitOps.length > 0) {
    const recent = unitOps.filter((o) => o.kind === "imoka").slice(-3);
    const avg = recent.length > 0 ? Math.round(sum(recent.map((o) => o.amount_cents)) / recent.length) : 0;
    const last = unitOps[unitOps.length - 1].date;
    for (let k = 1; avg > 0; k++) {
      const d = shiftMonths(last, k);
      if (d > today) break;
      out.push({ date: d, cents: avg, portfolio: "" });
    }
    return out;
  }
  const portfolios = new Map<string, HoldingRow>();
  for (const h of holdings) if (h.units_date && h.portfolio_monthly_cents) portfolios.set(h.portfolio, h);
  for (const h of portfolios.values()) {
    for (let k = 1; ; k++) {
      const d = shiftMonths(h.units_date as string, k, product.contribution_day ?? undefined);
      if (d > today) break;
      out.push({ date: d, cents: h.portfolio_monthly_cents as number, portfolio: h.portfolio });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function unitValueAt(product: PensionProductRow, holdings: HoldingRow[], ops: OperationRow[], index: PriceIndex, date: string) {
  if (holdings.length === 0) return null;
  let total = 0;
  let estimated = false;
  let priceDate = null as string | null;
  const parts = [];
  for (const h of holdings) {
    const u = holdingUnitsAt(h, ops, index, date, product.contribution_day);
    const p = priceAt(index, h.isin, date);
    if (!u || !p) return null;
    const value = u.units * p.price;
    total += value;
    estimated = estimated || u.estimated;
    priceDate = priceDate === null || p.date < priceDate ? p.date : priceDate;
    parts.push({
      portfolio: h.portfolio,
      isin: h.isin,
      fundName: h.fund_name,
      units: Math.round(u.units * 10_000) / 10_000,
      price: p.price,
      priceDate: p.date,
      priceSource: p.source ?? null,
      valueCents: Math.round(value * 100),
      estimated: u.estimated,
    });
  }
  return { cents: Math.round(total * 100), estimated, priceDate: priceDate as string, parts };
}

export function summarizePensions(input: PensionInput, today: string) {
  const index = buildPriceIndex(input.prices);
  const year = today.slice(0, 4);
  const currentMonth = today.slice(0, 7);
  const products = [...input.products].sort((a, b) => a.sort_order - b.sort_order);

  const summaries = products.map((product) => {
    const holdings = input.holdings.filter((h) => h.product_id === product.id);
    const ops = input.operations
      .filter((o) => o.product_id === product.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const valuations = input.valuations
      .filter((v) => v.product_id === product.id)
      .sort((a, b) => a.date.localeCompare(b.date));

    const lastValuationBefore = (date: string) => {
      for (let i = valuations.length - 1; i >= 0; i--) if (valuations[i].date <= date) return valuations[i];
      return null;
    };

    /**
     * Rankinė vertė pratęsiama iki datos, jei žinomos produkto krypčių kainos:
     * vertė keičiama pagal kainų pokytį nuo įvedimo dienos (svoriai — share),
     * o vėliau sumokėtos įmokos pridedamos. Be kainų — tiesiog paskutinė įvesta vertė.
     */
    const manualValueAt = (date: string) => {
      const v = lastValuationBefore(date);
      if (!v) return null;
      const plain = { cents: v.value_cents, date: v.date, estimated: false };
      const priced = holdings.filter((h) => h.share > 0);
      if (priced.length === 0) return plain;

      let weighted = 0;
      let weights = 0;
      let priceDate = v.date;
      for (const h of priced) {
        const base = priceAt(index, h.isin, v.date);
        const now = priceAt(index, h.isin, date);
        // Kaina įvedimo dieną turi būti žinoma (leidžiama kelių dienų paklaida).
        if (!base || !now || time(v.date) - time(base.date) > MAX_BASE_PRICE_AGE_DAYS * DAY_MS) return plain;
        weighted += h.share * (now.price / base.price);
        weights += h.share;
        if (now.date > priceDate) priceDate = now.date;
      }
      const later = contributions.filter((c) => c.date > v.date && c.date <= date);
      const lastContribution = later.length > 0 ? later[later.length - 1].date : v.date;
      const valueDate = priceDate > lastContribution ? priceDate : lastContribution;
      return {
        cents: Math.round(v.value_cents * (weighted / weights)) + sum(later.map((c) => c.cents)),
        date: valueDate,
        estimated: valueDate > v.date,
      };
    };

    const valueAt = (date: string) => {
      if (product.valuation === "vienetai") {
        const v = unitValueAt(product, holdings, ops, index, date);
        return v ? { cents: v.cents, date: v.priceDate, estimated: v.estimated } : null;
      }
      return manualValueAt(date);
    };

    /** Mėnesio vertė grafikui: vienetų produktams pirmenybė tą mėnesį užfiksuotai ataskaitos/Excel vertei. */
    const monthValue = (month: string): number | null => {
      const end = month === currentMonth ? today : lastDayOfMonth(month);
      if (product.valuation === "vienetai") {
        for (let i = valuations.length - 1; i >= 0; i--) {
          const v = valuations[i];
          if (v.date.startsWith(month) && v.date <= end) return v.value_cents;
        }
      }
      return valueAt(end)?.cents ?? null;
    };

    const contributionOps = ops.filter((o) => o.kind === "imoka");
    const lastOpDate = contributionOps.length > 0 ? contributionOps[contributionOps.length - 1].date : null;
    const bank = product.contribution_category_id
      ? input.payments
          // Excel istorijos sumos tinka tik produktams be ataskaitos operacijų (PZU) — kitur jas dengia operacijos.
          .filter(
            (p) =>
              p.category_id === product.contribution_category_id &&
              (!lastOpDate || p.booking_date > lastOpDate) &&
              (!p.history || contributionOps.length === 0)
          )
          .map((p) => ({
            date: p.booking_date,
            cents: -p.amount_cents,
            payer: p.owner ?? product.owner,
            portfolio: "",
            source: p.history ? ("excel" as const) : ("bankas" as const),
          }))
      : [];
    const estimates =
      product.valuation === "vienetai"
        ? estimatedContributions(product, holdings, ops, today).map((e) => ({ ...e, payer: product.owner, source: "apytiksle" as const }))
        : [];
    const contributions = [
      ...contributionOps.map((o) => ({
        date: o.date,
        cents: o.amount_cents,
        payer: product.owner,
        portfolio: o.portfolio,
        source: "ataskaita" as const,
      })),
      ...bank,
      ...estimates,
    ].sort((a, b) => a.date.localeCompare(b.date));
    const transfers = ops.filter((o) => o.kind === "perkelimas");

    const current = valueAt(today);
    const unitDetail = product.valuation === "vienetai" ? unitValueAt(product, holdings, ops, index, today) : null;

    const recentContributions = contributions.filter((c) => c.source !== "apytiksle").slice(-3);
    const monthlyCents =
      product.monthly_contribution_cents ??
      (recentContributions.length > 0 ? Math.round(sum(recentContributions.map((c) => c.cents)) / recentContributions.length) : null);

    const byYear = new Map<string, number>();
    for (const c of contributions) byYear.set(c.date.slice(0, 4), (byYear.get(c.date.slice(0, 4)) ?? 0) + c.cents);

    const yearAgo = shiftMonths(today, -12);

    let returns: {
      since: string;
      startValueCents: number;
      contributedCents: number;
      gainCents: number;
      xirr: number | null;
      lifetime: { contributedCents: number; gainCents: number; since: string | null } | null;
    } | null = null;

    if (current && product.pillar !== "PZU") {
      const end = { date: current.date > today ? today : current.date, amount: current.cents / 100 };
      if (transfers.length > 0 || (ops.length > 0 && ops[0].units !== null && valuations.length === 0)) {
        const flows = [...transfers.map((t) => ({ date: t.date, cents: t.amount_cents })), ...contributions]
          .filter((c) => c.date <= end.date);
        const contributed = sum(flows.map((f) => f.cents));
        returns = {
          since: flows.length > 0 ? flows[0].date : end.date,
          startValueCents: 0,
          contributedCents: contributed,
          gainCents: current.cents - contributed,
          xirr: xirr([...flows.map((f) => ({ date: f.date, amount: -f.cents / 100 })), end]),
          lifetime: { contributedCents: contributed, gainCents: current.cents - contributed, since: flows[0]?.date ?? null },
        };
      } else if (valuations.length > 0) {
        const v0 = valuations[0];
        const after = contributions.filter((c) => c.date > v0.date && c.date <= end.date);
        const contributed = sum(after.map((c) => c.cents));
        let lifetime = null;
        for (let i = valuations.length - 1; i >= 0; i--) {
          const v = valuations[i];
          if (v.contributed_total_cents !== null) {
            const total =
              v.contributed_total_cents +
              sum(contributions.filter((c) => c.date > v.date && c.date <= end.date).map((c) => c.cents));
            lifetime = { contributedCents: total, gainCents: current.cents - total, since: product.start_date };
            break;
          }
        }
        returns = {
          since: v0.date,
          startValueCents: v0.value_cents,
          contributedCents: contributed,
          gainCents: current.cents - v0.value_cents - contributed,
          xirr: xirr([{ date: v0.date, amount: -v0.value_cents / 100 }, ...after.map((c) => ({ date: c.date, amount: -c.cents / 100 })), end]),
          lifetime,
        };
      }
    }

    // Pokytis per 12 mėn.: vertės pokytis atėmus tų mėnesių įmokas.
    const yearAgoValue = valueAt(yearAgo);
    const last12Contributed = sum(contributions.filter((c) => c.date > yearAgo && c.date <= today).map((c) => c.cents));
    const last12 = current && yearAgoValue
      ? { contributedCents: last12Contributed, gainCents: current.cents - yearAgoValue.cents - last12Contributed, startValueCents: yearAgoValue.cents }
      : { contributedCents: last12Contributed, gainCents: null, startValueCents: null };

    // GPM: tik lengvatai tinkamos šių metų įmokos (pvz. tik papildoma dalis, jei
    // pagrindinę moka darbdavys) ir prognozė metų pabaigai.
    const gpmContributions = product.gpm_portfolio
      ? contributions.filter((c) => c.portfolio === product.gpm_portfolio)
      : contributions;
    const thisYear = gpmContributions.filter((c) => c.date.startsWith(year) && c.date <= today && c.source !== "apytiksle");
    const estimatedThisYear = gpmContributions.filter((c) => c.date.startsWith(year) && c.source === "apytiksle");
    const payerCounts = new Map<string, number>();
    for (const c of thisYear) payerCounts.set(c.payer, (payerCounts.get(c.payer) ?? 0) + 1);
    const payer =
      product.gpm_payer ?? [...payerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? product.owner;
    const monthNow = Number(today.slice(5, 7));
    const paidThisMonth = [...thisYear, ...estimatedThisYear].some((c) => c.date.startsWith(currentMonth));
    const remaining = 12 - monthNow + (paidThisMonth ? 0 : 1);
    const paidYear = sum([...thisYear, ...estimatedThisYear].map((c) => c.cents));
    const recentGpm = gpmContributions.filter((c) => c.source !== "apytiksle").slice(-3);
    const gpmMonthlyCents = product.gpm_portfolio
      ? recentGpm.length > 0
        ? Math.round(sum(recentGpm.map((c) => c.cents)) / recentGpm.length)
        : 0
      : (monthlyCents ?? 0);

    return {
      product,
      holdings,
      valuations,
      monthValue,
      current,
      unitDetail,
      contributions,
      transfers,
      monthlyCents,
      byYear,
      returns,
      last12,
      gpm: product.gpm
        ? {
            payer,
            paidCents: paidYear,
            projectedCents: paidYear + gpmMonthlyCents * Math.max(0, remaining),
            portfolio: product.gpm_portfolio,
          }
        : null,
    };
  });

  // Istorija nuo mėnesio, kai jau yra visų (ne PZU) produktų vertės.
  const candidates = monthsBetween("2020-01", currentMonth);
  const chartProducts = summaries.filter((s) => s.product.pillar !== "PZU");
  let startIndex = 0;
  for (const s of chartProducts) {
    const first = candidates.findIndex((m) => s.monthValue(m) !== null);
    if (first > startIndex) startIndex = first;
  }
  const months = candidates.slice(startIndex);

  const people = input.people.map((person) => {
    const own = summaries.filter((s) => s.product.owner === person.owner && s.product.pillar !== "PZU");
    const monthsToPayout = Math.max(
      0,
      (Number(person.payout_date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
        (Number(person.payout_date.slice(5, 7)) - Number(today.slice(5, 7)))
    );
    return {
      owner: person.owner,
      birthDate: person.birth_date,
      payoutDate: person.payout_date,
      monthsToPayout,
      valueCents: sum(own.map((s) => s.current?.cents ?? 0)),
      monthlyContributionCents: sum(own.map((s) => s.monthlyCents ?? 0)),
      products: own.map((s) => ({ code: s.product.code, pillar: s.product.pillar, valueCents: s.current?.cents ?? 0, monthlyCents: s.monthlyCents ?? 0 })),
    };
  });

  const isins = new Map<string, string>();
  for (const h of input.holdings) isins.set(h.isin, h.fund_name);
  const funds = [...isins.entries()].map(([isin, fundName]) => {
    const latest = priceAt(index, isin, today);
    const change = (years: number) => {
      if (!latest) return null;
      const past = priceAt(index, isin, shiftMonths(latest.date, -12 * years));
      const first = index.get(isin)?.[0];
      if (!past || !first || first.date > shiftMonths(latest.date, -12 * years)) return null;
      return latest.price / past.price - 1;
    };
    return {
      isin,
      fundName,
      price: latest?.price ?? null,
      date: latest?.date ?? null,
      source: latest?.source ?? null,
      returns: { y1: change(1), y3: change(3), y5: change(5) },
    };
  });

  return {
    today,
    products: summaries.map((s) => ({
      id: s.product.id,
      code: s.product.code,
      owner: s.product.owner,
      pillar: s.product.pillar,
      name: s.product.name,
      provider: s.product.provider,
      fundLabel: s.product.fund_label,
      contractNo: s.product.contract_no,
      startDate: s.product.start_date,
      endDate: s.product.end_date,
      valuation: s.product.valuation,
      contributionCategoryId: s.product.contribution_category_id,
      valueCents: s.current?.cents ?? null,
      valueDate: s.current?.date ?? null,
      valueEstimated: s.current?.estimated ?? false,
      holdings: s.unitDetail?.parts ?? [],
      monthlyContributionCents: s.monthlyCents,
      contributions: {
        totalCents: sum(s.contributions.map((c) => c.cents)),
        since: s.contributions[0]?.date ?? null,
        estimatedCents: sum(s.contributions.filter((c) => c.source === "apytiksle").map((c) => c.cents)),
        years: [...s.byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([y, cents]) => ({ year: y, cents })),
        recent: s.contributions.slice(-12).reverse(),
      },
      transfersCents: sum(s.transfers.map((t) => t.amount_cents)),
      returns: s.returns,
      last12: s.last12,
      valuations: s.valuations.slice(-12).reverse().map((v) => ({
        id: v.id,
        date: v.date,
        valueCents: v.value_cents,
        source: v.source,
        note: v.note,
      })),
      details: JSON.parse(s.product.details ?? "[]") as { etikete: string; reiksme: string }[],
      gpm: s.gpm,
    })),
    history: {
      months,
      series: chartProducts.map((s) => ({
        code: s.product.code,
        owner: s.product.owner,
        pillar: s.product.pillar,
        name: `${s.product.owner} · ${s.product.pillar} pakopa`,
        points: months.map((m) => s.monthValue(m)),
      })),
    },
    people,
    funds,
    gpm: {
      year,
      rate: GPM_RATE,
      limitCents: GPM_LIMIT_CENTS,
      deadline: `${Number(year) + 1}-05-01`,
    },
  };
}

export type PensionSummary = ReturnType<typeof summarizePensions>;

export async function buildPensions(db: D1Database, today: string) {
  const [products, holdings, operations, valuations, prices, people, state, group] = await Promise.all([
    db.prepare("SELECT * FROM pension_products ORDER BY sort_order, id").all<PensionProductRow>(),
    db.prepare("SELECT * FROM pension_holdings").all<HoldingRow>(),
    db.prepare("SELECT product_id, portfolio, date, kind, amount_cents, isin, units, price FROM pension_operations ORDER BY date").all<OperationRow>(),
    db.prepare("SELECT * FROM pension_valuations ORDER BY date").all<ValuationRow>(),
    db.prepare("SELECT isin, date, price, source FROM fund_prices ORDER BY isin, date").all<PriceRow>(),
    db.prepare("SELECT * FROM pension_people ORDER BY owner").all<PersonRow>(),
    db.prepare(`SELECT value, updated_at FROM app_state WHERE key = '${PRICE_STATE_KEY}'`).first<{ value: string; updated_at: string }>(),
    db.prepare("SELECT id FROM categories WHERE name = 'Pensijos' AND parent_id IS NULL").first<{ id: number }>(),
  ]);

  const categoryIds = [
    ...new Set(products.results.map((p) => p.contribution_category_id).filter((id): id is number => id !== null)),
  ];
  const payments =
    categoryIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT t.booking_date, t.amount_cents, t.category_id, a.owner,
                      CASE WHEN t.notes = 'excel-istorija' THEN 1 ELSE 0 END AS history
               FROM transactions t JOIN accounts a ON a.id = t.account_id
               WHERE t.is_split_parent = 0
                 AND t.category_id IN (${categoryIds.map(() => "?").join(",")})`
            )
            .bind(...categoryIds)
            .all<BankPaymentRow>()
        ).results;

  const summary = summarizePensions(
    {
      products: products.results,
      holdings: holdings.results,
      operations: operations.results,
      valuations: valuations.results,
      prices: prices.results,
      payments,
      people: people.results,
    },
    today
  );

  return {
    ...summary,
    groupId: group?.id ?? null,
    priceUpdate: state ? { ...(JSON.parse(state.value) as FundRefreshResult), updatedAt: state.updated_at } : null,
  };
}

// ---------- Fondų kainos iš viešų SEB ir Swedbank puslapių ----------

const PRICE_STATE_KEY = "fondu_kainos";

export type FundRefreshResult = {
  at: string;
  results: {
    isin: string;
    fundName: string;
    provider: "SEB" | "Swedbank";
    ok: boolean;
    price?: number;
    date?: string;
    error?: string;
  }[];
};

/**
 * Swedbank fondų sąrašai (vieneto vertė visų fondų lentelėje). key — kuriuo
 * nuorodos parametru sąraše identifikuojamas fondas.
 */
const SWEDBANK_LISTS: Record<string, { url: string; key: string }> = {
  pillar2: { url: "https://www.swedbank.lt/private/pensions/pillar2/allFunds/list/details", key: "tunnusnr" },
  pillar3: { url: "https://www.swedbank.lt/private/pensions/pillar3/allFunds?language=LIT", key: "tunnusnr" },
  // Swedbank Life investicinio gyvybės draudimo kryptys.
  life: { url: "https://www.swedbank.lt/private/investor/funds/products?language=LIT", key: "id" },
};

/**
 * Iš Swedbank fondų sąrašo ištraukia fondo eilutę pagal jo kodą (pvz. PE1989_1995
 * arba krypties id 1541): stulpeliai „Data" (2026 09 10) ir kaina (2.1630). Tas pats
 * fondas gali būti keliose lentelėse — imama pirma eilutė, kurioje yra kaina.
 */
export function parseSwedbankFundList(
  html: string,
  code: string,
  key = "tunnusnr"
): { price: number; date: string } | null {
  const needle = `'${key}','${code}'`;
  for (let start = html.indexOf(needle); start >= 0; start = html.indexOf(needle, start + needle.length)) {
    const end = html.indexOf("</tr>", start);
    const row = html.slice(start, end < 0 ? undefined : end);
    const match = row.match(/<td[^>]*>\s*(\d{4}) (\d{2}) (\d{2})\s*<\/td>\s*<td[^>]*>\s*(\d+(?:[.,]\d+)?)\s*<\/td>/);
    if (!match) continue;
    const price = Number(match[4].replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) continue;
    return { price, date: `${match[1]}-${match[2]}-${match[3]}` };
  }
  return null;
}

export const sebFundUrl = (isin: string) =>
  `https://e.seb.lt/cgi-bin/ipank/ipank.p?sesskey=&lang=LIT&act=VPFONDINFO&isin=${encodeURIComponent(isin)}&frnam=X&unetmenuhigh=`;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', scaron: "š", Scaron: "Š", zcaron: "ž", Zcaron: "Ž",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/** Iš SEB fondo puslapio ištraukia vieneto vertę ir jos datą. */
export function parseSebFundPage(html: string): { price: number; date: string } | null {
  const text = decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " | ")
  )
    .replace(/\s+/g, " ")
    .replace(/(\s*\|\s*)+/g, " | ");

  const match = text.match(/Vieneto vertė\*?(?: \|)* (\d[\d ]*,\d+)(?: EUR)?(?: \|)*(?: \((\d{4}-\d{2}-\d{2})\))?/);
  if (!match) return null;
  const price = Number(match[1].replace(/ /g, "").replace(",", "."));
  const date = match[2] ?? text.match(/Data(?: \|)* (\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || !Number.isFinite(price) || price <= 0) return null;
  return { price, date };
}

export async function refreshFundPrices(db: D1Database, fetcher: typeof fetch = fetch): Promise<FundRefreshResult> {
  const { results: funds } = await db
    .prepare(
      `SELECT isin, price_source, MIN(fund_name) AS fund_name FROM pension_holdings
       WHERE price_source = 'seb' OR price_source LIKE 'swedbank:%' GROUP BY isin, price_source`
    )
    .all<{ isin: string; price_source: string; fund_name: string }>();

  // Vienas Swedbank sąrašas tinka keliems fondams — parsisiunčiamas vieną kartą.
  const pages = new Map<string, Promise<string>>();
  const load = (url: string, provider: string) => {
    let page = pages.get(url);
    if (!page) {
      page = fetcher(url, {
        headers: { "User-Agent": "Mozilla/5.0 (namai)", "Accept-Language": "lt" },
        signal: AbortSignal.timeout(15_000),
      }).then((response) => {
        if (!response.ok) throw new Error(`${provider} atsakė HTTP ${response.status}`);
        return response.text();
      });
      pages.set(url, page);
    }
    return page;
  };

  const results: FundRefreshResult["results"] = [];
  for (const fund of funds) {
    const provider = fund.price_source === "seb" ? "SEB" : "Swedbank";
    try {
      let parsed: { price: number; date: string } | null;
      if (provider === "SEB") {
        parsed = parseSebFundPage(await load(sebFundUrl(fund.isin), provider));
      } else {
        const [, list, code] = fund.price_source.split(":");
        const source = SWEDBANK_LISTS[list];
        if (!source || !code) throw new Error(`netinkamas kainos šaltinis ${fund.price_source}`);
        parsed = parseSwedbankFundList(await load(source.url, provider), code, source.key);
      }
      if (!parsed) throw new Error("puslapyje nerasta vieneto vertės");
      await db
        .prepare("INSERT OR REPLACE INTO fund_prices (isin, date, price, source) VALUES (?, ?, ?, ?)")
        .bind(fund.isin, parsed.date, parsed.price, provider.toLowerCase())
        .run();
      results.push({ isin: fund.isin, fundName: fund.fund_name, provider, ok: true, ...parsed });
    } catch (error) {
      results.push({
        isin: fund.isin,
        fundName: fund.fund_name,
        provider,
        ok: false,
        error: error instanceof Error ? error.message : "nežinoma klaida",
      });
    }
  }

  const state: FundRefreshResult = { at: new Date().toISOString(), results };
  await db
    .prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(PRICE_STATE_KEY, JSON.stringify(state))
    .run();
  return state;
}

/** Ar kainas laikas atnaujinti (daugiau nei 12 val. nuo paskutinio bandymo). */
export async function fundPricesStale(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT updated_at FROM app_state WHERE key = ?")
    .bind(PRICE_STATE_KEY)
    .first<{ updated_at: string }>();
  if (!row) return true;
  return Date.now() - Date.parse(`${row.updated_at.replace(" ", "T")}Z`) > 12 * 3600 * 1000;
}

// ---------- Rankiniai atnaujinimai ----------

async function productByCode(db: D1Database, code: string) {
  const product = await db.prepare("SELECT * FROM pension_products WHERE code = ?").bind(code).first<PensionProductRow>();
  if (!product) throw new Error("Tokio pensijų produkto nėra.");
  return product;
}

const validDate = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export async function addManualValuation(
  db: D1Database,
  code: string,
  body: { date?: string; valueCents?: number; note?: string | null },
  today: string
) {
  const product = await productByCode(db, code);
  if (product.valuation !== "rankinis") {
    throw new Error("Šio produkto vertė skaičiuojama automatiškai iš vienetų ir kainų — patikslink vienetus.");
  }
  if (!validDate(body.date) || body.date > today) throw new Error("Nurodyk datą (ne vėlesnę nei šiandien).");
  if (typeof body.valueCents !== "number" || !Number.isInteger(body.valueCents) || body.valueCents <= 0) {
    throw new Error("Įrašyk sukauptą sumą.");
  }
  await db
    .prepare(
      `INSERT INTO pension_valuations (product_id, date, value_cents, source, note) VALUES (?, ?, ?, 'rankinis', ?)
       ON CONFLICT(product_id, date) DO UPDATE SET value_cents = excluded.value_cents, source = 'rankinis', note = excluded.note`
    )
    .bind(product.id, body.date, body.valueCents, body.note?.trim() || null)
    .run();
}

export async function deleteManualValuation(db: D1Database, id: number) {
  const result = await db.prepare("DELETE FROM pension_valuations WHERE id = ? AND source = 'rankinis'").bind(id).run();
  if (!result.meta.changes) throw new Error("Ištrinti galima tik rankiniu būdu įvestą vertę.");
}

export async function updateHoldingUnits(
  db: D1Database,
  code: string,
  body: { portfolio?: string; isin?: string; units?: number; unitsDate?: string },
  today: string
) {
  const product = await productByCode(db, code);
  if (typeof body.units !== "number" || !(body.units > 0)) throw new Error("Įrašyk vienetų skaičių.");
  if (!validDate(body.unitsDate) || body.unitsDate > today) throw new Error("Nurodyk datą (ne vėlesnę nei šiandien).");
  const result = await db
    .prepare("UPDATE pension_holdings SET units = ?, units_date = ? WHERE product_id = ? AND portfolio = ? AND isin = ?")
    .bind(body.units, body.unitsDate, product.id, body.portfolio ?? "", body.isin ?? "")
    .run();
  if (!result.meta.changes) throw new Error("Tokio fondo šiame produkte nėra.");
}

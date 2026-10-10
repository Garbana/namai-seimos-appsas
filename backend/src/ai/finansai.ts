/**
 * Asistento „akys“ į finansus — tik skaitymui. Kiekvienas įrankis naudoja tas pačias
 * funkcijas, kaip appso ekranai (buildOverview, listTransactions…), todėl asistentas mato
 * tuos pačius skaičius. Rezultatas — glaustas tekstas ar JSON eurais (ne centais).
 *
 * Šie įrankiai vykdomi iš karto, o rezultatas grąžinamas modeliui, kad jis galėtų
 * atsakyti (žr. asistentas.ts — įrankių ciklas).
 */
import { buildBudgets } from "../budgets";
import { buildCredits } from "../credits";
import { vilniusNow } from "../darbai/bendra";
import { buildInsurance } from "../insurance";
import { buildGroupOverview, buildOverview } from "../overview";
import { buildPensions } from "../pensions";
import { buildReminders } from "../reminders";
import { buildSavings } from "../savings";
import { listTransactions } from "../transactions";
import type { Tool } from "./modelis";

const month = { type: "string", description: "Mėnuo YYYY-MM" };
const empty = { type: "object", properties: {} };

export const FINANCE_TOOLS: Tool[] = [
  {
    name: "finance_months",
    description:
      "Mėnesių pajamos ir išlaidos bei išlaidos pagal grupes (kaip appso „Biudžetas“ / Excel lapas „Bendras“). Numatytai — paskutiniai 6 mėnesiai.",
    input_schema: { type: "object", properties: { from_month: month, to_month: month } },
  },
  {
    name: "finance_group",
    description: "Vienos grupės (pvz., Maistas, Komunaliniai) išlaidos pagal kategorijas ir mėnesius. group_id — iš finance_months.",
    input_schema: { type: "object", properties: { group_id: { type: "integer" }, from_month: month, to_month: month }, required: ["group_id"] },
  },
  {
    name: "search_transactions",
    description:
      "Banko operacijų paieška: pagal gavėją ar aprašymą (search — ieško tik gavėjo pavadinime ir aprašyme, ne kategorijose), laikotarpį, kategoriją (category_id), kryptį (income/expense), sąskaitos savininką (šeimos nario vardą). Grąžina operacijas ir sumas.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Gavėjo ar aprašymo fragmentas, pvz., „Maxima“" },
        from: { type: "string", description: "Nuo YYYY-MM-DD" },
        to: { type: "string", description: "Iki YYYY-MM-DD" },
        category_id: { type: "integer" },
        direction: { type: "string", enum: ["income", "expense"] },
        owner: { type: "string", description: "Sąskaitos savininko vardas (šeimos narys)" },
        limit: { type: "integer", description: "Kiek operacijų parodyti (iki 50)" },
      },
    },
  },
  {
    name: "recurring_payments",
    description: "Reguliarūs mokėjimai šį mėnesį (paskolos, komunaliniai, draudimai…): ar sumokėta, kiek laukiama, kada.",
    input_schema: empty,
  },
  {
    name: "budgets",
    description: "Mėnesio biudžeto ribos pagal grupes: planas, išleista, ar viršyta.",
    input_schema: { type: "object", properties: { month } },
  },
  { name: "savings", description: "Taupymo katiliukai ir investicijos (ETF): vertė, įnašai, grąža, mėnesio planas.", input_schema: empty },
  { name: "credits", description: "Kreditai ir paskolos: likutis, įmoka, palūkanos, pabaiga, kitas mokėjimas.", input_schema: empty },
  { name: "insurance", description: "Draudimai: polisai, kas apdrausta, įmokos, galiojimas, artėjantys pakeitimai.", input_schema: empty },
  { name: "pensions", description: "Pensijų kaupimas (II ir III pakopos, gyvybės draudimas su kaupimu): vertė, įmokos, grąža, GPM lengvata.", input_schema: empty },
];

export const FINANCE_TOOL_NAMES = new Set(FINANCE_TOOLS.map((t) => t.name));

const eur = (cents: number) => Math.round(cents) / 100;

/** Sunkūs, modeliui nereikalingi laukai (grafikų istorijos, kandidatai priskyrimui…). */
const DROP = new Set([
  "history",
  "series",
  "candidates",
  "schedule",
  "sensitivity",
  "valuations",
  "recent",
  "years",
  "grupes",
  "sources",
  "contributionCategoryId",
  "id",
  "ibanLast4",
]);

/**
 * Glaudina appso API atsakymą modeliui: be tuščių ir sunkių laukų, ilgi sąrašai
 * sutrumpinti, `…Cents` / `…_cents` — eurais (`…Eur`).
 */
export function compact(value: unknown, maxItems = 40): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map((v) => compact(v, maxItems));
    if (value.length > maxItems) items.push(`… ir dar ${value.length - maxItems}`);
    return items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === "" || DROP.has(key) || (Array.isArray(v) && v.length === 0)) continue;
      if (/_?cents$/i.test(key) && typeof v === "number") out[key.replace(/_?cents$/i, "") + "Eur"] = eur(v);
      else out[key] = compact(v, maxItems);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) return Math.round(value * 10_000) / 10_000;
  return value;
}

const lastMonths = (to: string, n: number) => {
  const [y, m] = to.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - (n - 1), 1));
  return d.toISOString().slice(0, 7);
};

const validMonth = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : null);

function monthRange(input: Record<string, unknown>, today: string): [string, string] {
  const to = validMonth(input.to_month) ?? today.slice(0, 7);
  const from = validMonth(input.from_month) ?? lastMonths(to, 6);
  return from <= to ? [from, to] : [to, from];
}

async function financeMonths(db: D1Database, input: Record<string, unknown>, today: string): Promise<string> {
  const [from, to] = monthRange(input, today);
  const overview = await buildOverview(db);
  const months = overview.months.filter((m) => m.month >= from && m.month <= to);
  if (months.length === 0) return `Laikotarpiu ${from}–${to} operacijų nėra.`;
  const lines = [`Pajamos ir išlaidos (EUR; išlaidos teigiamais skaičiais, vidiniai pervedimai neįskaičiuoti):`];
  for (const m of months) {
    lines.push(`\n${m.month}: pajamos ${eur(m.income)}, išlaidos ${eur(-m.expense)}, likutis ${eur(m.income + m.expense)}`);
    const cells = overview.cells.filter((c) => c.month === m.month).sort((a, b) => a.amount - b.amount);
    const expenses = cells.filter((c) => c.side === "expense" && c.amount !== 0);
    const income = cells.filter((c) => c.side === "income" && c.amount !== 0);
    lines.push(`  išlaidos: ${expenses.map((c) => `${c.groupName}${c.groupId ? ` [grupė ${c.groupId}]` : ""} ${eur(-c.amount)}`).join("; ")}`);
    if (income.length > 0) lines.push(`  pajamos: ${income.map((c) => `${c.groupName} ${eur(c.amount)}`).join("; ")}`);
  }
  return lines.join("\n");
}

async function financeGroup(db: D1Database, input: Record<string, unknown>, today: string): Promise<string> {
  const groupId = Number(input.group_id);
  if (!Number.isInteger(groupId)) return "Nenurodyta grupė (group_id iš finance_months).";
  const [from, to] = monthRange(input, today);
  const cells = (await buildGroupOverview(db, groupId)).filter((c) => c.month >= from && c.month <= to);
  if (cells.length === 0) return `Šioje grupėje laikotarpiu ${from}–${to} operacijų nėra.`;
  const byCategory = new Map<string, string[]>();
  // Poskyriai (pvz., „Būreliai“) — jų kategorijų suma pagal mėnesius.
  const bySubgroup = new Map<string, Map<string, number>>();
  for (const c of cells.sort((a, b) => a.month.localeCompare(b.month))) {
    const key = `${c.categoryName} [kategorija ${c.categoryId}]${c.subgroup ? ` (poskyris „${c.subgroup}“)` : ""}${c.related ? ` (iš grupės ${c.originGroupName})` : ""}`;
    byCategory.set(key, [...(byCategory.get(key) ?? []), `${c.month}: ${eur(-c.amount)} (${c.count} op.)`]);
    if (c.subgroup) {
      const months = bySubgroup.get(c.subgroup) ?? new Map<string, number>();
      months.set(c.month, (months.get(c.month) ?? 0) + c.amount);
      bySubgroup.set(c.subgroup, months);
    }
  }
  return [
    `Grupės kategorijos (EUR, išlaidos teigiamais skaičiais):`,
    ...[...byCategory].map(([k, v]) => `${k}: ${v.join(", ")}`),
    ...[...bySubgroup].map(([name, months]) => `Poskyris „${name}“ iš viso: ${[...months].map(([m, sum]) => `${m}: ${eur(-sum)}`).join(", ")}`),
  ].join("\n");
}

async function searchTransactions(db: D1Database, input: Record<string, unknown>): Promise<string> {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 50);
  const { rows, totals } = await listTransactions(db, {
    search: str(input.search),
    from: date(input.from),
    to: date(input.to),
    categoryId: Number.isInteger(input.category_id) ? (input.category_id as number) : undefined,
    direction: input.direction === "income" || input.direction === "expense" ? input.direction : undefined,
    owner: typeof input.owner === "string" && input.owner.trim() ? input.owner.trim() : undefined,
    hideOffsets: true,
    limit,
    offset: 0,
  });
  const lines = rows.map((r) => {
    const t = r as Record<string, unknown>;
    const desc = typeof t.description === "string" ? ` — ${t.description.slice(0, 70)}` : "";
    const cat = t.category_name ? ` [${t.group_name ? `${t.group_name} / ` : ""}${t.category_name}]` : " [be kategorijos]";
    return `${t.booking_date} ${eur(t.amount_cents as number)} € ${t.counterparty_name ?? ""}${desc}${cat} (${t.account_owner})`;
  });
  // Ieškota žodžio, kuris yra kategorijos pavadinimas (pvz., „elektra“)? Pasakom modeliui.
  const search = str(input.search);
  const categories = search
    ? (
        await db
          .prepare(
            `SELECT c.id, c.name, p.name AS grp FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
             WHERE c.name LIKE ? LIMIT 5`
          )
          .bind(`%${search}%`)
          .all<{ id: number; name: string; grp: string | null }>()
      ).results
    : [];
  const hint = categories.map((c) => `„${c.grp ? `${c.grp} / ` : ""}${c.name}“ [kategorija ${c.id}]`).join(", ");
  return [
    `Rasta ${totals?.count ?? 0} operacijų: pajamos ${eur(totals?.income ?? 0)} €, išlaidos ${eur(-(totals?.expense ?? 0))} €` +
      (rows.length < (totals?.count ?? 0) ? ` (rodoma ${rows.length} naujausių)` : "") +
      ". Išlaidos — minusas.",
    ...lines,
    ...(hint ? [`Pastaba: yra kategorijos ${hint} — jų operacijoms naudok category_id.`] : []),
  ].join("\n");
}

/** Įvykdo finansų įrankį; klaidą grąžina tekstu (modelis ją perteiks žmogui). */
export async function runFinanceTool(db: D1Database, name: string, input: Record<string, unknown>, now = new Date()): Promise<string> {
  const today = vilniusNow(now).date;
  try {
    switch (name) {
      case "finance_months":
        return await financeMonths(db, input, today);
      case "finance_group":
        return await financeGroup(db, input, today);
      case "search_transactions":
        return await searchTransactions(db, input);
      case "recurring_payments":
        return JSON.stringify(compact(await buildReminders(db, today)));
      case "budgets":
        return JSON.stringify(compact(await buildBudgets(db, validMonth(input.month) ?? today.slice(0, 7), today)));
      case "savings":
        return JSON.stringify(compact(await buildSavings(db, today)));
      case "credits":
        return JSON.stringify(compact(await buildCredits(db, today)));
      case "insurance":
        return JSON.stringify(compact(await buildInsurance(db, today)));
      case "pensions":
        return JSON.stringify(compact(await buildPensions(db, today)));
      default:
        return `Nežinomas įrankis „${name}“.`;
    }
  } catch (error) {
    console.error("Finansų įrankis", name, error);
    return `Nepavyko gauti duomenų (${error instanceof Error ? error.message : error}).`;
  }
}

/**
 * Poskyriai — kad asistentas žinotų, kad „būreliai“ yra kelios Emos kategorijos
 * (Dailė, Karate…), o ne operacijos su žodžiu „būrelis“.
 */
export async function financeSubgroups(db: D1Database): Promise<string> {
  try {
    const { results } = await db
      .prepare(
        `SELECT g.id AS groupId, g.name AS groupName, c.subgroup AS subgroup, group_concat(c.name, ', ') AS names
         FROM categories c JOIN categories g ON g.id = c.parent_id
         WHERE c.subgroup IS NOT NULL GROUP BY g.id, c.subgroup ORDER BY g.sort_order, c.subgroup`
      )
      .all<{ groupId: number; groupName: string; subgroup: string; names: string }>();
    return results.map((r) => `Poskyris „${r.subgroup}“ grupėje ${r.groupName} (group_id ${r.groupId}): ${r.names}.`).join("\n");
  } catch {
    return "";
  }
}

/** Iki kada įkelti banko išrašai — kad asistentas žinotų, ar duomenys pilni. */
export async function financeFreshness(db: D1Database): Promise<string> {
  try {
    const { results } = await db
      .prepare(
        `SELECT a.owner AS owner, MAX(t.booking_date) AS through
         FROM transactions t JOIN accounts a ON a.id = t.account_id GROUP BY a.owner ORDER BY a.owner`
      )
      .all<{ owner: string; through: string }>();
    return results.length > 0
      ? `Banko operacijos įkeltos: ${results.map((r) => `${r.owner} — iki ${r.through}`).join(", ")}.`
      : "Banko operacijų dar neįkelta.";
  } catch {
    return "Finansų duomenų nėra.";
  }
}

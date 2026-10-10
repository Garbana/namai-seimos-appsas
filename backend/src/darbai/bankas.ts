/**
 * Projektas ↔ banko operacijos (7 etapas). Projektas — pjūvis, ne kategorija: operacija lieka
 * savo finansų kategorijoje, o projektas tik parodo, kiek iš jos buvo, pvz., gimtadieniui.
 *
 * Operacija susiejama su projekto biudžeto eilute. Kol eilutei susieta bent viena operacija,
 * jos faktas = operacijų suma (išlaidos teigiamai, grąžinimai mažina), o ranka įvesta suma
 * pasilieka `manual_actual_cents` ir grįžta atsiejus — niekas nesidubliuoja.
 *
 * „Gali būti šio projekto“ — operacijos projekto laikotarpiu, kurių gavėjas ar aprašymas
 * primena projektą (žodžiai iš pavadinimo, tikslo, eilučių, darbų) arba suma artima eilutės planui.
 */
import { buildSavings } from "../savings";
import { KlaidaVartotojui, text } from "./bendra";
import { addDays } from "./pakartojimai";
import { createCost, linkCount } from "./projektai";

export interface BankTransaction {
  transaction_id: number;
  booking_date: string;
  amount_cents: number;
  counterparty_name: string | null;
  description: string | null;
  account_owner: string | null;
  category_name: string | null;
}

export interface BankLink extends BankTransaction {
  cost_id: number;
  cost_name: string;
}

export interface BankSuggestion extends BankTransaction {
  /** Kodėl siūloma: „gavėjas primena „Tortas““, „suma artima „Salė“ planui“. */
  reason: string;
  /** Kuriai eilutei siūloma priskirti (null — naujai). */
  cost_id: number | null;
}

const MAX_SUGGESTIONS = 10;

/** Žodžiai, kurie projektų darbų pavadinimuose nieko nesako apie gavėją. */
const STOP = new Set([
  "užsakyti", "nupirkti", "pirkti", "sumokėti", "išsiųsti", "paruošti", "sutarti", "susitarti", "nuvežti", "pasirinkti",
  "išsirinkti", "paskambinti", "patikrinti", "sudaryti", "parašyti", "papuošti", "sukurti", "padaryti", "gauti", "rasti",
  "atsiimti", "aptarti", "sudėti", "surinkti", "pakviesti", "išsiaiškinti", "rezervas", "kita", "kitos", "kiti", "vieta",
  "svečiams", "svečių", "šventė", "šventei", "dienai", "dieną", "prieš", "išlaidos", "pinigai", "biudžetas", "namai", "namams",
]);

const TX_COLUMNS = `t.id AS transaction_id, t.booking_date, t.amount_cents, t.counterparty_name, t.description,
  a.owner AS account_owner, c.name AS category_name`;

/** Žodžių pradžios paieškai: „tortą“ → „tort“, „gimtadienis“ → „gimtadien“. */
export function stems(texts: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const word of (t ?? "").toLocaleLowerCase("lt").split(/[^\p{L}\d]+/u)) {
      if (word.length < 4 || STOP.has(word) || /^\d+$/.test(word)) continue;
      out.add(word.slice(0, Math.max(4, word.length - 2)));
    }
  }
  return [...out];
}

const words = (s: string | null) => (s ?? "").toLocaleLowerCase("lt").split(/[^\p{L}\d]+/u).filter(Boolean);

async function liveProject(db: D1Database, projectId: number) {
  const p = await db
    .prepare("SELECT id, title, goal, target_date, created_at, deleted_at FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ id: number; title: string; goal: string | null; target_date: string | null; created_at: string; deleted_at: string | null }>();
  if (!p || p.deleted_at) throw new KlaidaVartotojui("Tokio projekto nėra.");
  return p;
}

/** Eilutės faktas = susietų operacijų suma (jei jų yra); atsiejus visas — grįžta ranka įvesta suma. */
async function syncActual(db: D1Database, costId: number): Promise<void> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(-t.amount_cents), 0) AS cents
       FROM project_cost_links l JOIN transactions t ON t.id = l.transaction_id WHERE l.cost_id = ?`
    )
    .bind(costId)
    .first<{ n: number; cents: number }>();
  if (r && r.n > 0) {
    await db.prepare("UPDATE project_costs SET actual_cents = ? WHERE id = ?").bind(r.cents, costId).run();
  } else {
    await db
      .prepare("UPDATE project_costs SET actual_cents = manual_actual_cents, manual_actual_cents = NULL WHERE id = ?")
      .bind(costId)
      .run();
  }
}

/**
 * Susieja operaciją su projektu: su esama eilute (costId) arba nauja (pavadinimas — nurodytas
 * arba gavėjo). Jau susieta su kitu projektu ar eilute — perkeliama.
 */
export async function linkTransaction(
  db: D1Database,
  projectId: number,
  input: { transactionId?: unknown; costId?: unknown; costName?: unknown },
  memberId: number | null,
  now = new Date()
): Promise<void> {
  await liveProject(db, projectId);
  const txId = Number(input.transactionId);
  const tx = Number.isInteger(txId)
    ? await db
        .prepare("SELECT id, counterparty_name, is_split_parent, is_transfer FROM transactions WHERE id = ?")
        .bind(txId)
        .first<{ id: number; counterparty_name: string | null; is_split_parent: number; is_transfer: number }>()
    : null;
  if (!tx) throw new KlaidaVartotojui("Tokios operacijos nėra.");
  if (tx.is_split_parent) throw new KlaidaVartotojui("Ši operacija išskaidyta — priskirk jos dalį.");
  if (tx.is_transfer) throw new KlaidaVartotojui("Vidinio pervedimo projektui priskirti negalima.");

  let costId: number;
  if (input.costId != null && input.costId !== "") {
    const c = await db
      .prepare("SELECT id FROM project_costs WHERE id = ? AND project_id = ?")
      .bind(Number(input.costId), projectId)
      .first<{ id: number }>();
    if (!c) throw new KlaidaVartotojui("Tokios biudžeto eilutės šiame projekte nėra.");
    costId = c.id;
  } else {
    const name = text(input.costName, "eilutė", 100) ?? tx.counterparty_name?.slice(0, 100) ?? "Banko operacija";
    costId = (await createCost(db, projectId, { name })).id;
  }

  await unlinkTransaction(db, txId, true);
  // Pirmoji operacija eilutei: ranka įvesta suma pasilieka atsargai.
  if ((await linkCount(db, costId)) === 0) {
    await db.prepare("UPDATE project_costs SET manual_actual_cents = actual_cents WHERE id = ?").bind(costId).run();
  }
  await db.batch([
    db
      .prepare("INSERT INTO project_cost_links (transaction_id, project_id, cost_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(txId, projectId, costId, now.toISOString(), memberId),
    db.prepare("DELETE FROM project_link_dismissals WHERE project_id = ? AND transaction_id = ?").bind(projectId, txId),
  ]);
  await syncActual(db, costId);
}

/** Atsieja operaciją nuo projekto (jei susieta). */
export async function unlinkTransaction(db: D1Database, transactionId: number, quiet = false): Promise<void> {
  const link = await db.prepare("SELECT cost_id FROM project_cost_links WHERE transaction_id = ?").bind(transactionId).first<{ cost_id: number }>();
  if (!link) {
    if (quiet) return;
    throw new KlaidaVartotojui("Ši operacija nepriskirta jokiam projektui.");
  }
  await db.prepare("DELETE FROM project_cost_links WHERE transaction_id = ?").bind(transactionId).run();
  await syncActual(db, link.cost_id);
}

/** „Ne šio projekto“ — pasiūlymas daugiau nerodomas. */
export async function dismissSuggestion(db: D1Database, projectId: number, transactionId: unknown): Promise<void> {
  await liveProject(db, projectId);
  const id = Number(transactionId);
  if (!Number.isInteger(id)) throw new KlaidaVartotojui("Tokios operacijos nėra.");
  await db.prepare("INSERT OR IGNORE INTO project_link_dismissals (project_id, transaction_id) VALUES (?, ?)").bind(projectId, id).run();
}

/** Projekto banko operacijos ir pasiūlymai. */
export async function projectBank(
  db: D1Database,
  projectId: number,
  today: string
): Promise<{ links: BankLink[]; suggestions: BankSuggestion[] }> {
  const p = await liveProject(db, projectId);
  const [links, costs, tasks] = await db.batch([
    db
      .prepare(
        `SELECT ${TX_COLUMNS}, l.cost_id, pc.name AS cost_name FROM project_cost_links l
         JOIN transactions t ON t.id = l.transaction_id JOIN project_costs pc ON pc.id = l.cost_id
         LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
         WHERE l.project_id = ? ORDER BY t.booking_date DESC, t.id DESC`
      )
      .bind(projectId),
    db.prepare("SELECT id, name, planned_cents, actual_cents FROM project_costs WHERE project_id = ? ORDER BY sort_order, id").bind(projectId),
    db.prepare("SELECT title FROM tasks WHERE project_id = ? AND deleted_at IS NULL").bind(projectId),
  ]);
  const costRows = costs.results as { id: number; name: string; planned_cents: number | null; actual_cents: number | null }[];

  // Laikotarpis: nuo mėnesio prieš projekto sukūrimą iki 2 sav. po šventės (arba iki šiandien).
  const created = p.created_at.slice(0, 10);
  const from = addDays(created, -30);
  const to = p.target_date ? addDays(p.target_date, 14) : today;
  const { results: candidates } = await db
    .prepare(
      `SELECT ${TX_COLUMNS} FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.is_split_parent = 0 AND t.is_transfer = 0 AND t.amount_cents < 0 AND t.offset_of_id IS NULL
         AND t.booking_date BETWEEN ? AND ?
         AND NOT EXISTS (
           SELECT 1 FROM project_cost_links l JOIN projects lp ON lp.id = l.project_id
           WHERE l.transaction_id = t.id AND lp.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM project_link_dismissals d WHERE d.project_id = ? AND d.transaction_id = t.id)
       ORDER BY t.booking_date DESC LIMIT 1000`
    )
    .bind(from, to, projectId)
    .all<BankTransaction>();

  // Žodžiai iš projekto ir kiekvienos eilutės atskirai — kad žinotume, kuriai eilutei siūlyti.
  const projectStems = stems([p.title, p.goal, ...(tasks.results as { title: string }[]).map((t) => t.title)]);
  const costStems = costRows.map((c) => ({ cost: c, stems: stems([c.name]) }));
  // Suma artima planui — tik eilutėms be fakto ir tik arti šventės (kitaip — per daug atsitiktinumų).
  const near = p.target_date ? { from: addDays(p.target_date, -21), to: addDays(p.target_date, 7) } : null;
  const open = costRows.filter((c) => (c.planned_cents ?? 0) >= 1000 && !c.actual_cents);

  const scored: (BankSuggestion & { score: number })[] = [];
  for (const t of candidates) {
    const w = [...words(t.counterparty_name), ...words(t.description)];
    const has = (stem: string) => w.some((x) => x.startsWith(stem));
    const lineByText = costStems.find((c) => c.stems.some(has));
    const projectHit = projectStems.find(has);
    const amount = -t.amount_cents;
    const lineByAmount =
      near && t.booking_date >= near.from && t.booking_date <= near.to
        ? open.find((c) => Math.abs(amount - c.planned_cents!) <= c.planned_cents! * 0.15)
        : undefined;

    if (lineByText) scored.push({ ...t, score: 3, cost_id: lineByText.cost.id, reason: `primena „${lineByText.cost.name}“` });
    else if (projectHit) scored.push({ ...t, score: 2, cost_id: lineByAmount?.id ?? null, reason: "primena projektą" });
    else if (lineByAmount) scored.push({ ...t, score: 1, cost_id: lineByAmount.id, reason: `suma artima „${lineByAmount.name}“ planui` });
  }

  return {
    links: links.results as unknown as BankLink[],
    suggestions: scored
      .sort((a, b) => b.score - a.score || b.booking_date.localeCompare(a.booking_date))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ score: _, ...s }) => s),
  };
}

/** Operacijos ekranui: kuriam projektui priskirta ir kuriems galima (aktyvūs su eilutėmis). */
export async function transactionProject(db: D1Database, transactionId: number) {
  const [link, projects, costs] = await db.batch([
    db
      .prepare(
        `SELECT l.project_id, p.title AS project_title, l.cost_id, pc.name AS cost_name FROM project_cost_links l
         JOIN projects p ON p.id = l.project_id JOIN project_costs pc ON pc.id = l.cost_id
         WHERE l.transaction_id = ? AND p.deleted_at IS NULL`
      )
      .bind(transactionId),
    db.prepare("SELECT id, title FROM projects WHERE deleted_at IS NULL AND status != 'baigtas' ORDER BY target_date IS NULL, target_date, id"),
    db.prepare(
      `SELECT c.id, c.project_id, c.name FROM project_costs c JOIN projects p ON p.id = c.project_id
       WHERE p.deleted_at IS NULL AND p.status != 'baigtas' ORDER BY c.sort_order, c.id`
    ),
  ]);
  const costRows = costs.results as { id: number; project_id: number; name: string }[];
  return {
    link: (link.results[0] as { project_id: number; project_title: string; cost_id: number; cost_name: string } | undefined) ?? null,
    projects: (projects.results as { id: number; title: string }[]).map((p) => ({
      ...p,
      costs: costRows.filter((c) => c.project_id === p.id).map(({ id, name }) => ({ id, name })),
    })),
  };
}

/** Projekto katiliukas: kiek jame sukaupta (taip pat, kaip rodo „Turtas → Taupymas“). */
export async function projectSavings(
  db: D1Database,
  savingsGoalId: number | null,
  today: string
): Promise<{ id: number; name: string; valueCents: number; targetCents: number | null } | null> {
  if (savingsGoalId === null) return null;
  const { goals } = await buildSavings(db, today);
  const g = goals.find((x) => x.id === savingsGoalId);
  return g ? { id: g.id, name: g.name, valueCents: g.valueCents, targetCents: g.targetCents } : null;
}

/** Katiliukai projektui pasirinkti. */
export async function savingsGoalList(db: D1Database): Promise<{ id: number; name: string; owner: string }[]> {
  const { results } = await db
    .prepare("SELECT id, name, owner FROM savings_goals WHERE is_active = 1 ORDER BY sort_order, id")
    .all<{ id: number; name: string; owner: string }>();
  return results;
}

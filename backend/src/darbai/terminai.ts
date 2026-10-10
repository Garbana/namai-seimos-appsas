/**
 * Finansų terminai virsta darbais (7 etapas): likus 30 d. iki draudimo laikotarpio pabaigos,
 * kintamų palūkanų perskaičiavimo ar paskutinės kredito įmokos atsiranda užduotis
 * („Atnaujinti KASKO draudimą“). Kiekvienas terminas įrašomas į finance_deadline_tasks, tad
 * darbas sukuriamas vieną kartą; ištrynus jį — nebeatsiranda („nerodyti“).
 *
 * Vykdoma kartą per dieną iš laikmačio (index.ts → scheduled).
 */
import { todayVilnius } from "./bendra";
import { addDays } from "./pakartojimai";
import { createTask } from "./uzduotys";

/** Kiek dienų prieš terminą atsiranda darbas. */
export const PRIES_DIENU = 30;
/** Draudimą atnaujinti verta savaitę prieš pabaigą. */
const DRAUDIMAS_PRIES = 7;
const STATE_KEY = "finansu-terminai";

const DRAUDIMAI: Record<string, string> = {
  kasko: "Atnaujinti KASKO draudimą",
  civiline: "Atnaujinti civilinės atsakomybės draudimą",
  bustas: "Atnaujinti būsto draudimą",
  gyvybes: "Gyvybės draudimo sutartis baigiasi",
};

/** Sritis pagal tai, kas apdrausta: automobilis, būstas, kita — dokumentai ir mokėjimai. */
const SRITIS: Record<string, string> = { Automobilis: "Automobilis", Būstas: "Namai" };

interface Policy {
  policy_no: string;
  kind: string;
  title: string;
  insurer: string;
  object_group: string;
  period_end: string;
  contract_end: string | null;
}

interface Credit {
  id: number;
  name: string;
  end_date: string;
  rate_type: string;
  next_rate_change: string | null;
}

async function areaFor(db: D1Database, name: string): Promise<{ id: number; default_member_id: number | null } | null> {
  return db.prepare("SELECT id, default_member_id FROM task_areas WHERE name = ?").bind(name).first();
}

/** Sukuria darbą terminui, jei jis dar nebuvo sukurtas (ir neištrintas „nerodyti“). */
async function ensure(
  db: D1Database,
  key: { kind: "draudimas" | "palukanos" | "kreditas"; ref: string; date: string },
  task: { title: string; dueDate: string; notes: string; area: string },
  now: Date
): Promise<boolean> {
  const inserted = await db
    .prepare("INSERT OR IGNORE INTO finance_deadline_tasks (kind, ref, date, created_at) VALUES (?, ?, ?, ?)")
    .bind(key.kind, key.ref, key.date, now.toISOString())
    .run();
  if (!inserted.meta.changes) return false;
  const area = (await areaFor(db, task.area)) ?? (await areaFor(db, "Dokumentai ir mokėjimai"));
  const created = await createTask(
    db,
    { title: task.title, dueDate: task.dueDate, notes: task.notes, areaId: area?.id ?? null, assigneeId: area?.default_member_id ?? null, priority: "svarbu" },
    null,
    now,
    "automatinis"
  );
  await db
    .prepare("UPDATE finance_deadline_tasks SET task_id = ? WHERE kind = ? AND ref = ? AND date = ?")
    .bind(created.id, key.kind, key.ref, key.date)
    .run();
  return true;
}

/** Sukuria artėjančių finansų terminų darbus. Grąžina, kiek sukurta. */
export async function syncFinanceDeadlines(db: D1Database, now = new Date()): Promise<number> {
  const today = todayVilnius(now);
  const horizon = addDays(today, PRIES_DIENU);
  const within = (date: string | null): date is string => date !== null && date >= today && date <= horizon;
  let created = 0;

  // Draudimai: kiekvieno poliso naujausias laikotarpis (jei jau įvestas kitų metų — senas nebeaktualus).
  const { results: policies } = await db
    .prepare(
      `SELECT policy_no, kind, title, insurer, object_group, period_end, contract_end FROM insurance_policies p
       WHERE period_end = (SELECT MAX(period_end) FROM insurance_policies q WHERE q.policy_no = p.policy_no)`
    )
    .all<Policy>();
  for (const p of policies) {
    // Gyvybės draudimas metams atsinaujina pats — darbas tik baigiantis visai sutarčiai.
    const date = p.kind === "gyvybes" ? p.contract_end : p.period_end;
    if (!within(date)) continue;
    const due = addDays(date, -DRAUDIMAS_PRIES) > today ? addDays(date, -DRAUDIMAS_PRIES) : today;
    if (
      await ensure(
        db,
        { kind: "draudimas", ref: p.policy_no, date },
        {
          title: DRAUDIMAI[p.kind] ?? `Atnaujinti draudimą: ${p.title}`,
          dueDate: due,
          notes: `${p.title} (${p.insurer}, ${p.object_group}) galioja iki ${date}. Palygink pasiūlymus ir atnaujink — naują polisą įkelk į Finansai → Turtas → Draudimai.`,
          area: SRITIS[p.object_group] ?? "Dokumentai ir mokėjimai",
        },
        now
      )
    )
      created++;
  }

  // Kreditai: kintamų palūkanų perskaičiavimas ir paskutinė įmoka.
  const { results: credits } = await db.prepare("SELECT id, name, end_date, rate_type, next_rate_change FROM credits").all<Credit>();
  for (const c of credits) {
    if (c.rate_type === "kintama" && within(c.next_rate_change)) {
      if (
        await ensure(
          db,
          { kind: "palukanos", ref: String(c.id), date: c.next_rate_change },
          {
            title: `Palūkanų perskaičiavimas: ${c.name}`,
            dueDate: c.next_rate_change,
            notes: `${c.next_rate_change} perskaičiuojamos kintamos palūkanos. Patikrink naują įmoką ir, jei reikia, atnaujink ją Finansai → Turtas → Kreditai.`,
            area: "Dokumentai ir mokėjimai",
          },
          now
        )
      )
        created++;
    }
    if (within(c.end_date)) {
      if (
        await ensure(
          db,
          { kind: "kreditas", ref: String(c.id), date: c.end_date },
          {
            title: `Paskutinė įmoka: ${c.name}`,
            dueDate: c.end_date,
            notes: `${c.name} baigiasi ${c.end_date}. Po paskutinės įmokos — sutvarkyti dokumentus (pvz., įkeitimo panaikinimą).`,
            area: "Dokumentai ir mokėjimai",
          },
          now
        )
      )
        created++;
    }
  }
  return created;
}

/** Laikmačiui: vieną kartą per dieną (Vilniaus laiku). */
export async function dailyFinanceDeadlines(db: D1Database, now = new Date()): Promise<void> {
  const today = todayVilnius(now);
  const row = await db.prepare("SELECT value FROM app_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  if (row?.value === today) return;
  await syncFinanceDeadlines(db, now);
  await db
    .prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(STATE_KEY, today)
    .run();
}

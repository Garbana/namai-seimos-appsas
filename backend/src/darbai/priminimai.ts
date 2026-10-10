/**
 * Užduočių priminimai. Priminimas saugomas santykiškai su terminu („dieną prieš
 * 18:00“, „prieš 1 val.“), todėl pasislinkus terminui — pakeitus jį ar užbaigus
 * pasikartojančią užduotį — pasislenka kartu. Čia tik skaičiuojami momentai; išsiunčia
 * laikmatis (src/pranesimai/pranesimai.ts).
 *
 * Formatas: '60m' — 60 min. prieš terminą (tik užduočiai su laiku; '0m' — laiku),
 * '1d@18:00' — prieš 1 dieną 18:00 ('0d@09:00' — tą dieną 9:00).
 */
import { KlaidaVartotojui, vilniusToUtc } from "./bendra";
import { addDays } from "./pakartojimai";

export type Spec = { kind: "min"; minutes: number } | { kind: "day"; days: number; time: string };

/** Daugiausia priminimų vienai užduočiai. */
const MAX_REMINDERS = 5;

/** Kiek daugiausia galima atidėti iš pranešimo (minutėmis). */
const MAX_SNOOZE = 7 * 24 * 60;

export function parseSpec(text: string): Spec | null {
  let m = /^(\d{1,5})m$/.exec(text);
  if (m) {
    const minutes = Number(m[1]);
    return minutes <= 7 * 24 * 60 ? { kind: "min", minutes } : null;
  }
  m = /^(\d{1,2})d@([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (m) {
    const days = Number(m[1]);
    return days <= 31 ? { kind: "day", days, time: `${m[2]}:${m[3]}` } : null;
  }
  return null;
}

export const formatSpec = (s: Spec) => (s.kind === "min" ? `${s.minutes}m` : `${s.days}d@${s.time}`);

/** Priminimo momentas (UTC, ISO); null — kai jis neįmanomas (nėra termino ar laiko). */
export function remindAt(spec: string, dueDate: string | null, dueTime: string | null): string | null {
  const s = parseSpec(spec);
  if (!s || !dueDate) return null;
  if (s.kind === "min") {
    if (!dueTime) return null;
    return new Date(vilniusToUtc(dueDate, dueTime).getTime() - s.minutes * 60_000).toISOString();
  }
  return vilniusToUtc(addDays(dueDate, -s.days), s.time).toISOString();
}

/** Patikrina iš appso atsiųstą priminimų sąrašą; dublikatai sutraukiami. */
export function reminderSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new KlaidaVartotojui("Netinkami priminimai.");
  const specs = new Set<string>();
  for (const item of value) {
    const s = typeof item === "string" ? parseSpec(item.trim()) : null;
    if (!s) throw new KlaidaVartotojui("Netinkamas priminimas.");
    specs.add(formatSpec(s));
  }
  if (specs.size > MAX_REMINDERS) throw new KlaidaVartotojui(`Daugiausia ${MAX_REMINDERS} priminimai vienai užduočiai.`);
  return [...specs];
}

/** Užduočių priminimai (be atidėtų) — rodyti užduoties lange. */
export async function remindersByTask(db: D1Database, taskIds: number[]): Promise<Map<number, string[]>> {
  const byTask = new Map<number, string[]>();
  if (taskIds.length === 0) return byTask;
  const { results } = await db
    .prepare(
      `SELECT task_id, spec FROM task_reminders
       WHERE spec IS NOT NULL AND task_id IN (SELECT value FROM json_each(?)) ORDER BY id`
    )
    .bind(JSON.stringify(taskIds))
    .all<{ task_id: number; spec: string }>();
  for (const r of results) byTask.set(r.task_id, [...(byTask.get(r.task_id) ?? []), r.spec]);
  return byTask;
}

/** Nustato užduoties priminimus (atidėtų neliečia) ir apskaičiuoja jų momentus. */
export async function setReminders(db: D1Database, taskId: number, specs: string[], now = new Date()): Promise<void> {
  const { results } = await db
    .prepare("SELECT spec FROM task_reminders WHERE task_id = ? AND spec IS NOT NULL")
    .bind(taskId)
    .all<{ spec: string }>();
  const existing = new Set(results.map((r) => r.spec));

  const statements = [
    ...[...existing]
      .filter((s) => !specs.includes(s))
      .map((s) => db.prepare("DELETE FROM task_reminders WHERE task_id = ? AND spec = ?").bind(taskId, s)),
    ...specs
      .filter((s) => !existing.has(s))
      .map((s) => db.prepare("INSERT INTO task_reminders (task_id, spec) VALUES (?, ?)").bind(taskId, s)),
  ];
  if (statements.length > 0) await db.batch(statements);
  await rescheduleReminders(db, taskId, now);
}

/**
 * Perskaičiuoja momentus pagal dabartinį terminą. Ateities priminimas laukia siuntimo;
 * naujas momentas, jau praėjęs, nebesiunčiamas (kad pakeitus terminą neateitų pavėluotas
 * priminimas); nepasikeitęs momentas lieka koks buvo — taip neprarandamas ką tik
 * suėjęs, bet laikmačio dar neišsiųstas priminimas.
 */
export async function rescheduleReminders(db: D1Database, taskId: number, now = new Date()): Promise<void> {
  const task = await db
    .prepare("SELECT due_date, due_time FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ due_date: string | null; due_time: string | null }>();
  if (!task) return;

  const { results } = await db
    .prepare("SELECT id, spec, remind_at, sent_at FROM task_reminders WHERE task_id = ? AND spec IS NOT NULL")
    .bind(taskId)
    .all<{ id: number; spec: string; remind_at: string | null; sent_at: string | null }>();

  const at = now.toISOString();
  const statements = [];
  for (const r of results) {
    const next = remindAt(r.spec, task.due_date, task.due_time);
    const sent = next === null || next > at ? null : next === r.remind_at ? r.sent_at : at;
    if (next === r.remind_at && sent === r.sent_at) continue;
    statements.push(db.prepare("UPDATE task_reminders SET remind_at = ?, sent_at = ? WHERE id = ?").bind(next, sent, r.id));
  }
  if (statements.length > 0) await db.batch(statements);
}

/**
 * Užbaigus ar ištrynus užduotį dar neišsiųsti priminimai nebesiunčiami. Atšaukus ar
 * atkūrus juos vėl perskaičiuoja rescheduleReminders: ateities priminimai grįžta.
 */
export const settleReminders = (db: D1Database, taskId: number, now: Date) =>
  db.prepare("UPDATE task_reminders SET sent_at = ? WHERE task_id = ? AND sent_at IS NULL").bind(now.toISOString(), taskId);

/** „Atidėti“ iš pranešimo: vienkartinis priminimas tik tam, kas atidėjo. */
export async function snoozeTask(
  db: D1Database,
  taskId: number,
  memberId: number | null,
  minutes: unknown,
  now = new Date()
): Promise<{ remindAt: string }> {
  const m = minutes === undefined ? 60 : Number(minutes);
  if (!Number.isInteger(m) || m < 5 || m > MAX_SNOOZE) throw new KlaidaVartotojui("Netinkamas atidėjimo laikas.");

  const task = await db
    .prepare("SELECT status, deleted_at FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ status: string; deleted_at: string | null }>();
  if (!task || task.deleted_at) throw new KlaidaVartotojui("Tokios užduoties nėra — gal ją kas tik ką ištrynė.");
  if (task.status !== "atvira") throw new KlaidaVartotojui("Užduotis jau atlikta.");

  const at = new Date(now.getTime() + m * 60_000).toISOString();
  await db
    .prepare("INSERT INTO task_reminders (task_id, spec, member_id, remind_at) VALUES (?, NULL, ?, ?)")
    .bind(taskId, memberId, at)
    .run();
  return { remindAt: at };
}

/**
 * Užduotys: sukūrimas, keitimas, atlikimas su atšaukimu ir šiukšliadėžė.
 *
 * Pasikartojanti užduotis užbaigus nekuriama iš naujo — pasislenka jos terminas, o
 * atlikimas įrašomas į task_completions kartu su tuo, kaip buvo prieš (terminas,
 * použduočių varnelės, atsakingas), kad „Atšaukti“ grąžintų viską tiksliai atgal.
 *
 * Ruoša (6 etapas) — ta pati pasikartojanti užduotis su žyme `chore`; ji gali eiti
 * „pakaitomis“ (rotation_members) ir kartotis „po atlikimo“ (repeat_after_done).
 */
import { id, KlaidaVartotojui, text, todayVilnius } from "./bendra";
import { formatRule, isDate, nextDue, parseRule } from "./pakartojimai";
import { reminderSpecs, remindersByTask, rescheduleReminders, setReminders, settleReminders } from "./priminimai";

export type Priority = "svarbu" | "iprasta" | "kada_nors";
export type Status = "atvira" | "atlikta";

export interface TaskRow {
  id: number;
  title: string;
  notes: string | null;
  parent_id: number | null;
  area_id: number | null;
  assignee_id: number | null;
  priority: Priority;
  status: Status;
  due_date: string | null;
  due_time: string | null;
  recurrence: string | null;
  amount_cents: number | null;
  completed_at: string | null;
  completed_by: number | null;
  created_at: string;
  created_by: number | null;
  source: string;
  deleted_at: string | null;
  /** Projektas ir jo etapas (žr. projektai.ts); použduotys jų neturi. */
  project_id: number | null;
  section_id: number | null;
  /** 1 — namų ruoša (rodoma „Ruošoje“, ne bendrame sąraše). */
  chore: number;
  /** „Pakaitomis“: narių id eilė JSON ('[1,2]'); null — fiksuotas žmogus arba bet kas. */
  rotation_members: string | null;
  /** 1 — kitas terminas skaičiuojamas nuo atlikimo dienos („kas 90 d. nuo paskutinio karto“). */
  repeat_after_done: number;
}

/** Užduotis, kokią grąžina API: su priminimais ('60m', '1d@18:00', žr. priminimai.ts). */
export type Task = TaskRow & { reminders: string[] };

/** Ką galima siųsti kuriant ar keičiant; nenurodytas laukas keičiant lieka koks buvo. */
export interface TaskInput {
  title?: unknown;
  notes?: unknown;
  parentId?: unknown;
  areaId?: unknown;
  assigneeId?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  dueTime?: unknown;
  recurrence?: unknown;
  amountCents?: unknown;
  status?: unknown;
  /** Priminimų sąrašas; nenurodytas — lieka koks buvo. */
  reminders?: unknown;
  projectId?: unknown;
  sectionId?: unknown;
  /** Ruoša (true/false). */
  chore?: unknown;
  /** „Pakaitomis“ — narių id eilė; tuščia ar null — ne pakaitomis. */
  rotationMembers?: unknown;
  /** Kartoti „po atlikimo“ (true/false). */
  repeatAfterDone?: unknown;
}

const COLUMNS = `id, title, notes, parent_id, area_id, assignee_id, priority, status, due_date,
  due_time, recurrence, amount_cents, completed_at, completed_by, created_at, created_by, source, deleted_at,
  project_id, section_id, chore, rotation_members, repeat_after_done`;

const PRIORITIES: Priority[] = ["svarbu", "iprasta", "kada_nors"];

/** Kiek laiko atliktos užduotys dar grąžinamos sąraše (atšaukimui ir „Atlikta“ skilčiai). */
const RECENT_DAYS = 3;

/** Kiek laiko ištrintos laikomos šiukšliadėžėje. */
export const TRASH_DAYS = 30;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

type Values = Omit<TaskRow, "id" | "status" | "completed_at" | "completed_by" | "created_at" | "created_by" | "source" | "deleted_at">;

/**
 * Patikrina ir sutvarko laukus. `base` — esama užduotis (keičiant): ko nesiunčia,
 * paimama iš jos, todėl ir patikrinimai daromi su galutinėmis reikšmėmis.
 */
export function taskValues(input: TaskInput, base: Values | null): Values {
  const has = (key: keyof TaskInput) => input[key] !== undefined;

  const title = has("title") ? text(input.title, "pavadinimas", 300) : (base?.title ?? null);
  const projectId = has("projectId") ? id(input.projectId, "projektas") : (base?.project_id ?? null);
  if (!title) throw new KlaidaVartotojui("Užduočiai reikia pavadinimo.");

  const priority = has("priority") ? input.priority : (base?.priority ?? "iprasta");
  if (!PRIORITIES.includes(priority as Priority)) throw new KlaidaVartotojui("Netinkamas prioritetas.");

  const dueDate = has("dueDate") ? text(input.dueDate, "terminas", 10) : (base?.due_date ?? null);
  if (dueDate !== null && !isDate(dueDate)) throw new KlaidaVartotojui("Netinkama termino data.");

  let dueTime = has("dueTime") ? text(input.dueTime, "laikas", 5) : (base?.due_time ?? null);
  if (dueTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
    throw new KlaidaVartotojui("Netinkamas laikas — rašyk, pvz., 15:00.");
  }
  if (dueDate === null) dueTime = null;

  let recurrence = has("recurrence") ? text(input.recurrence, "pakartojimas", 100) : (base?.recurrence ?? null);
  if (recurrence !== null) {
    const rule = parseRule(recurrence);
    if (!rule) throw new KlaidaVartotojui("Netinkamas pakartojimas.");
    if (dueDate === null) throw new KlaidaVartotojui("Pasikartojančiai užduočiai reikia termino — nuo jo skaičiuojami kiti.");
    recurrence = formatRule(rule);
  }

  const chore = has("chore") ? (input.chore ? 1 : 0) : (base?.chore ?? 0);
  const repeatAfterDone = has("repeatAfterDone") ? (input.repeatAfterDone ? 1 : 0) : (base?.repeat_after_done ?? 0);
  if (chore && recurrence === null) throw new KlaidaVartotojui("Ruošai reikia nurodyti, kaip dažnai ji kartojasi.");
  if (repeatAfterDone && recurrence === null) throw new KlaidaVartotojui("„Po atlikimo“ reikia nurodyti, kas kiek laiko kartoti.");

  let rotation = has("rotationMembers") ? rotationValue(input.rotationMembers) : base?.rotation_members ? (JSON.parse(base.rotation_members) as number[]) : null;
  let assigneeId = has("assigneeId") ? id(input.assigneeId, "atsakingas") : (base?.assignee_id ?? null);
  if (rotation && rotation.length === 1) {
    // Vienas žmogus „pakaitomis“ — tiesiog jo darbas.
    assigneeId = rotation[0];
    rotation = null;
  }
  if (rotation && recurrence === null) throw new KlaidaVartotojui("„Pakaitomis“ tinka tik pasikartojančiam darbui.");
  if (rotation && (assigneeId === null || !rotation.includes(assigneeId))) assigneeId = rotation[0];

  let amountCents = has("amountCents") ? input.amountCents : (base?.amount_cents ?? null);
  if (amountCents === "" || amountCents === undefined) amountCents = null;
  if (amountCents !== null && (!Number.isInteger(amountCents) || (amountCents as number) < 0 || (amountCents as number) > 1e10)) {
    throw new KlaidaVartotojui("Netinkama suma.");
  }

  return {
    title,
    notes: has("notes") ? text(input.notes, "pastabos", 5000) : (base?.notes ?? null),
    parent_id: base ? base.parent_id : id(input.parentId, "tėvinė užduotis"),
    area_id: has("areaId") ? id(input.areaId, "sritis") : (base?.area_id ?? null),
    assignee_id: assigneeId,
    priority: priority as Priority,
    due_date: dueDate,
    due_time: dueTime,
    recurrence,
    amount_cents: amountCents as number | null,
    project_id: projectId,
    // Pakeitus projektą senas etapas nebetinka.
    section_id: has("sectionId") ? id(input.sectionId, "etapas") : projectId === (base?.project_id ?? null) ? (base?.section_id ?? null) : null,
    chore,
    rotation_members: rotation ? JSON.stringify(rotation) : null,
    repeat_after_done: recurrence === null ? 0 : repeatAfterDone,
  };
}

/** „Pakaitomis“ eilė: skirtingi narių id; tuščia ar null — ne pakaitomis. */
function rotationValue(value: unknown): number[] | null {
  if (value === null || value === undefined || value === "") return null;
  if (!Array.isArray(value)) throw new KlaidaVartotojui("Netinkama eilė „pakaitomis“.");
  const ids = value.map((v) => id(v, "narys"));
  if (ids.some((v) => v === null)) throw new KlaidaVartotojui("Netinkama eilė „pakaitomis“.");
  const unique = [...new Set(ids as number[])];
  return unique.length === 0 ? null : unique;
}

/** Kitas eilėje po to, kas atliko (jei jis ne eilėje — po buvusio atsakingo). */
export function nextInRotation(rotation: number[], doneBy: number | null, assignee: number | null): number {
  const from = doneBy !== null && rotation.includes(doneBy) ? doneBy : assignee;
  const i = from === null ? -1 : rotation.indexOf(from);
  return rotation[(i + 1) % rotation.length];
}

/** Projektas turi egzistuoti, o etapas — priklausyti tam projektui; eilės nariai — būti šeimoje. */
async function checkProject(db: D1Database, v: Values): Promise<void> {
  if (v.rotation_members !== null) {
    const ids = JSON.parse(v.rotation_members) as number[];
    const { results } = await db
      .prepare("SELECT id FROM members WHERE is_active = 1 AND id IN (SELECT value FROM json_each(?))")
      .bind(v.rotation_members)
      .all<{ id: number }>();
    if (results.length !== ids.length) throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
  }
  if (v.project_id !== null) {
    const project = await db.prepare("SELECT deleted_at FROM projects WHERE id = ?").bind(v.project_id).first<{ deleted_at: string | null }>();
    if (!project || project.deleted_at) throw new KlaidaVartotojui("Tokio projekto nėra.");
  }
  if (v.section_id !== null) {
    const section = await db.prepare("SELECT project_id FROM project_sections WHERE id = ?").bind(v.section_id).first<{ project_id: number }>();
    if (!section || section.project_id !== v.project_id) throw new KlaidaVartotojui("Šis etapas ne to projekto.");
  }
}

async function withReminders(db: D1Database, rows: TaskRow[]): Promise<Task[]> {
  const byTask = await remindersByTask(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, reminders: byTask.get(r.id) ?? [] }));
}

export const rawTask = (db: D1Database, taskId: number) =>
  db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`).bind(taskId).first<TaskRow>();

export async function getTask(db: D1Database, taskId: number): Promise<Task | null> {
  const row = await rawTask(db, taskId);
  return row ? (await withReminders(db, [row]))[0] : null;
}

async function liveTask(db: D1Database, taskId: number): Promise<TaskRow> {
  const task = await rawTask(db, taskId);
  if (!task || task.deleted_at) throw new KlaidaVartotojui("Tokios užduoties nėra — gal ją kas tik ką ištrynė.");
  return task;
}

/** Atviros, neseniai atliktos ir jų použduotys. */
export async function listTasks(db: D1Database, now = new Date()): Promise<Task[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM tasks
       WHERE deleted_at IS NULL AND (
         status = 'atvira' OR completed_at >= ?1
         OR parent_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL AND (status = 'atvira' OR completed_at >= ?1))
       )
       ORDER BY due_date IS NULL, due_date, due_time IS NULL, due_time, id`
    )
    .bind(daysAgo(now, RECENT_DAYS))
    .all<TaskRow>();
  return withReminders(db, results);
}

/** Projekto darbai — ir atlikti (projekte matosi progresas), su použduotimis. */
export async function listProjectTasks(db: D1Database, projectId: number): Promise<Task[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM tasks WHERE deleted_at IS NULL AND (
         project_id = ?1 OR parent_id IN (SELECT id FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL))
       ORDER BY due_date IS NULL, due_date, due_time IS NULL, due_time, id`
    )
    .bind(projectId)
    .all<TaskRow>();
  return withReminders(db, results);
}

export async function createTask(
  db: D1Database,
  input: TaskInput,
  memberId: number | null,
  now = new Date(),
  source: "rankinis" | "ai" | "claude" | "automatinis" = "rankinis"
): Promise<Task> {
  const v = taskValues(input, null);
  const reminders = input.reminders === undefined ? [] : reminderSpecs(input.reminders);

  if (v.parent_id !== null) {
    const parent = await liveTask(db, v.parent_id);
    if (parent.parent_id !== null) throw new KlaidaVartotojui("Použduotis negali turėti savo použduočių.");
    // Kontrolinio sąrašo punktas — tik pavadinimas, be terminų ir pakartojimų.
    Object.assign(v, {
      due_date: null, due_time: null, recurrence: null, area_id: null, assignee_id: null, project_id: null, section_id: null,
      chore: 0, rotation_members: null, repeat_after_done: 0,
    });
    reminders.length = 0;
  }
  await checkProject(db, v);

  const row = await db
    .prepare(
      `INSERT INTO tasks (title, notes, parent_id, area_id, assignee_id, priority, due_date, due_time,
         recurrence, amount_cents, created_at, created_by, source, project_id, section_id, chore, rotation_members,
         repeat_after_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`
    )
    .bind(
      v.title, v.notes, v.parent_id, v.area_id, v.assignee_id, v.priority, v.due_date, v.due_time,
      v.recurrence, v.amount_cents, now.toISOString(), memberId, source, v.project_id, v.section_id, v.chore,
      v.rotation_members, v.repeat_after_done
    )
    .first<TaskRow>();
  if (reminders.length > 0) await setReminders(db, row!.id, reminders, now);
  return (await getTask(db, row!.id))!;
}

/** Keičia laukus. Būseną čia keisti galima tik použduočiai — užduotis užbaigiama completeTask. */
export async function updateTask(
  db: D1Database,
  taskId: number,
  input: TaskInput,
  memberId: number | null,
  now = new Date()
): Promise<Task> {
  const task = await liveTask(db, taskId);
  const v = taskValues(input, task);
  if (task.parent_id !== null) Object.assign(v, { project_id: null, section_id: null, chore: 0, rotation_members: null, repeat_after_done: 0 });
  await checkProject(db, v);
  const reminders = input.reminders === undefined || task.parent_id !== null ? null : reminderSpecs(input.reminders);

  let status = task.status;
  let completedAt = task.completed_at;
  let completedBy = task.completed_by;
  if (input.status !== undefined && input.status !== task.status) {
    if (task.parent_id === null) throw new KlaidaVartotojui("Užduotį pažymėk atlikta mygtuku, ne keisdamas būseną.");
    if (input.status !== "atvira" && input.status !== "atlikta") throw new KlaidaVartotojui("Netinkama būsena.");
    status = input.status;
    completedAt = status === "atlikta" ? now.toISOString() : null;
    completedBy = status === "atlikta" ? memberId : null;
  }

  const row = await db
    .prepare(
      `UPDATE tasks SET title = ?, notes = ?, area_id = ?, assignee_id = ?, priority = ?, due_date = ?,
         due_time = ?, recurrence = ?, amount_cents = ?, status = ?, completed_at = ?, completed_by = ?,
         project_id = ?, section_id = ?, chore = ?, rotation_members = ?, repeat_after_done = ?
       WHERE id = ? RETURNING ${COLUMNS}`
    )
    .bind(
      v.title, v.notes, v.area_id, v.assignee_id, v.priority, v.due_date, v.due_time, v.recurrence,
      v.amount_cents, status, completedAt, completedBy, v.project_id, v.section_id, v.chore, v.rotation_members,
      v.repeat_after_done, taskId
    )
    .first<TaskRow>();
  if (reminders) await setReminders(db, taskId, reminders, now);
  else if (row!.due_date !== task.due_date || row!.due_time !== task.due_time) await rescheduleReminders(db, taskId, now);
  return (await getTask(db, taskId))!;
}

interface SubtaskState {
  id: number;
  status: Status;
  completed_at: string | null;
  completed_by: number | null;
}

/**
 * Pažymi atlikta. Pasikartojanti — terminas pasislenka į kitą po vėlesnės iš termino
 * ir šiandienos (pavėlavus kitas nebūna praeityje), o použduočių varnelės nuimamos.
 * „Po atlikimo“ — kitas skaičiuojamas nuo šiandienos; „pakaitomis“ — darbas atitenka kitam eilėje.
 */
export async function completeTask(
  db: D1Database,
  taskId: number,
  memberId: number | null,
  now = new Date()
): Promise<{ task: Task; nextDue: string | null }> {
  const task = await liveTask(db, taskId);
  if (task.parent_id !== null) throw new KlaidaVartotojui("Použduotis pažymima varnele užduoties lange.");
  if (task.status === "atlikta") return { task: (await getTask(db, taskId))!, nextDue: null };

  const at = now.toISOString();
  const { results: subtasks } = await db
    .prepare("SELECT id, status, completed_at, completed_by FROM tasks WHERE parent_id = ? AND deleted_at IS NULL")
    .bind(taskId)
    .all<SubtaskState>();

  const statements = [
    db
      .prepare(
        `INSERT INTO task_completions (task_id, member_id, completed_at, due_date_before, subtasks_before, assignee_before)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(taskId, memberId, at, task.due_date, JSON.stringify(subtasks), task.assignee_id),
    settleReminders(db, taskId, now),
  ];

  const rule = task.recurrence && task.due_date ? parseRule(task.recurrence) : null;
  let next: string | null = null;
  if (rule && task.due_date) {
    const today = todayVilnius(now);
    next = task.repeat_after_done ? nextDue(rule, today, today) : nextDue(rule, task.due_date, task.due_date > today ? task.due_date : today);
    const rotation = task.rotation_members ? (JSON.parse(task.rotation_members) as number[]) : null;
    const assignee = rotation ? nextInRotation(rotation, memberId, task.assignee_id) : task.assignee_id;
    statements.push(
      db
        .prepare("UPDATE tasks SET due_date = ?, completed_at = ?, completed_by = ?, assignee_id = ? WHERE id = ?")
        .bind(next, at, memberId, assignee, taskId),
      db
        .prepare("UPDATE tasks SET status = 'atvira', completed_at = NULL, completed_by = NULL WHERE parent_id = ? AND deleted_at IS NULL")
        .bind(taskId)
    );
  } else {
    statements.push(
      db.prepare("UPDATE tasks SET status = 'atlikta', completed_at = ?, completed_by = ? WHERE id = ?").bind(at, memberId, taskId)
    );
  }

  await db.batch(statements);
  // Pasikartojančios kito karto priminimai — nuo naujo termino.
  if (next) await rescheduleReminders(db, taskId, now);
  return { task: (await getTask(db, taskId))!, nextDue: next };
}

/** Atšaukia paskutinį atlikimą: grąžina būseną, terminą ir použduočių varneles. */
export async function undoComplete(db: D1Database, taskId: number, now = new Date()): Promise<Task> {
  const task = await liveTask(db, taskId);
  const completions = await db
    .prepare(
      `SELECT id, member_id, completed_at, due_date_before, subtasks_before, assignee_before FROM task_completions
       WHERE task_id = ? ORDER BY completed_at DESC, id DESC LIMIT 2`
    )
    .bind(taskId)
    .all<{
      id: number;
      member_id: number | null;
      completed_at: string;
      due_date_before: string | null;
      subtasks_before: string | null;
      assignee_before: number | null;
    }>();
  const [last, previous] = completions.results;
  if (!last) throw new KlaidaVartotojui("Nėra ką atšaukti.");

  const statements = [db.prepare("DELETE FROM task_completions WHERE id = ?").bind(last.id)];
  if (task.recurrence) {
    statements.push(
      db
        .prepare("UPDATE tasks SET due_date = ?, completed_at = ?, completed_by = ? WHERE id = ?")
        .bind(last.due_date_before, previous?.completed_at ?? null, previous?.member_id ?? null, taskId)
    );
    // „Pakaitomis“ — eilė grįžta tam, kieno ji buvo.
    if (task.rotation_members && last.assignee_before !== null) {
      statements.push(db.prepare("UPDATE tasks SET assignee_id = ? WHERE id = ?").bind(last.assignee_before, taskId));
    }
    for (const s of JSON.parse(last.subtasks_before ?? "[]") as SubtaskState[]) {
      statements.push(
        db
          .prepare("UPDATE tasks SET status = ?, completed_at = ?, completed_by = ? WHERE id = ? AND parent_id = ?")
          .bind(s.status, s.completed_at, s.completed_by, s.id, taskId)
      );
    }
  } else {
    statements.push(
      db.prepare("UPDATE tasks SET status = 'atvira', completed_at = NULL, completed_by = NULL WHERE id = ?").bind(taskId)
    );
  }

  await db.batch(statements);
  await rescheduleReminders(db, taskId, now);
  return (await getTask(db, taskId))!;
}

/** Į šiukšliadėžę — kartu su použduotimis (jos grąžinamos kartu). */
export async function deleteTask(db: D1Database, taskId: number, now = new Date()): Promise<void> {
  await liveTask(db, taskId);
  await db.batch([
    db
      .prepare("UPDATE tasks SET deleted_at = ?1 WHERE (id = ?2 OR parent_id = ?2) AND deleted_at IS NULL")
      .bind(now.toISOString(), taskId),
    settleReminders(db, taskId, now),
  ]);
}

export async function restoreTask(db: D1Database, taskId: number, now = new Date()): Promise<Task> {
  const task = await rawTask(db, taskId);
  if (!task || !task.deleted_at) throw new KlaidaVartotojui("Šiukšliadėžėje tokios užduoties nėra.");
  if (task.parent_id !== null) {
    const parent = await rawTask(db, task.parent_id);
    if (parent?.deleted_at) throw new KlaidaVartotojui("Pirma atkurk užduotį, kuriai ši použduotis priklauso.");
  }
  // Použduotys, ištrintos kartu su užduotimi (tuo pačiu momentu), grįžta kartu.
  await db
    .prepare("UPDATE tasks SET deleted_at = NULL WHERE id = ?1 OR (parent_id = ?1 AND deleted_at = ?2)")
    .bind(taskId, task.deleted_at)
    .run();
  await rescheduleReminders(db, taskId, now);
  return (await getTask(db, taskId))!;
}

/** Šiukšliadėžė: ištrintos užduotys; senesnės nei TRASH_DAYS ištrinamos visam laikui. */
export async function listTrash(db: D1Database, now = new Date()): Promise<Task[]> {
  await db.prepare("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(daysAgo(now, TRASH_DAYS)).run();
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM tasks t WHERE deleted_at IS NOT NULL
         AND (parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id AND p.deleted_at = t.deleted_at))
       ORDER BY deleted_at DESC, id`
    )
    .all<TaskRow>();
  return withReminders(db, results);
}

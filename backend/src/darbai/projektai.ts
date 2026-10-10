/**
 * Projektai: užduočių rinkinys su tikslu, data, etapais ir biudžetu (planas, faktas,
 * „įvertis“). Projekto darbai — įprastos užduotys (tasks.project_id / section_id), todėl jos
 * matomos ir „Užduotyse“, „Šiandien“, joms veikia priminimai.
 *
 * Projektas sukuriamas vienu ypu su etapais, darbais ir biudžeto eilutėmis (rankomis, iš
 * šablono ar asistento). Ištrintas — keliauja į šiukšliadėžę kartu su savo darbais.
 */
import { id, KlaidaVartotojui, text, todayVilnius } from "./bendra";
import { isDate } from "./pakartojimai";
import { rescheduleReminders } from "./priminimai";
import { planFromTemplate, TEMPLATES } from "./sablonai";
import { createTask, listProjectTasks, TRASH_DAYS, type Task } from "./uzduotys";

export type ProjectStatus = "aktyvus" | "baigtas" | "atidetas";
const STATUSES: ProjectStatus[] = ["aktyvus", "baigtas", "atidetas"];

export interface ProjectRow {
  id: number;
  title: string;
  goal: string | null;
  area_id: number | null;
  owner_id: number | null;
  target_date: string | null;
  budget_cents: number | null;
  status: ProjectStatus;
  notes: string | null;
  source: string;
  created_at: string;
  created_by: number | null;
  finished_at: string | null;
  deleted_at: string | null;
  /** Susietas taupymo katiliukas (7 etapas). */
  savings_goal_id: number | null;
}

/** Projektas su suvestine: kiek darbų atlikta, kiek suplanuota ir išleista. */
export interface ProjectSummary extends ProjectRow {
  tasks_total: number;
  tasks_done: number;
  planned_cents: number;
  actual_cents: number;
  /** Artimiausias neatlikto darbo terminas. */
  next_due: string | null;
}

export interface Section {
  id: number;
  project_id: number;
  name: string;
  sort_order: number;
}

export interface Cost {
  id: number;
  project_id: number;
  name: string;
  task_id: number | null;
  planned_cents: number | null;
  actual_cents: number | null;
  is_estimate: number;
  sort_order: number;
  /** Ranka įvestas faktas, kol eilutei susietos banko operacijos (grįžta jas atsiejus). */
  manual_actual_cents: number | null;
  /** Kiek banko operacijų susieta (tada faktas — jų suma, žr. bankas.ts). */
  bank_links?: number;
}

export interface ProjectInput {
  title?: unknown;
  goal?: unknown;
  areaId?: unknown;
  ownerId?: unknown;
  targetDate?: unknown;
  budgetCents?: unknown;
  notes?: unknown;
  status?: unknown;
  savingsGoalId?: unknown;
}

export interface PlanTask {
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  assigneeId?: number | null;
  notes?: string | null;
  reminders?: string[];
  /** Darbo kaina — sukuriama su juo susieta biudžeto eilutė. */
  amountCents?: number | null;
  subtasks?: string[];
}

export interface PlanCost {
  name: string;
  plannedCents?: number | null;
  actualCents?: number | null;
  isEstimate?: boolean;
  /** Susieto darbo pavadinimas (iš to paties plano). */
  taskTitle?: string;
}

/** Viso projekto planas — taip jį kuria forma, šablonas ir asistentas. */
export interface NewProjectPlan extends ProjectInput {
  sections?: { name: string; tasks?: PlanTask[] }[];
  /** Darbai be etapo. */
  tasks?: PlanTask[];
  costs?: PlanCost[];
}

const SUMMARY = `p.*,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.deleted_at IS NULL) AS tasks_total,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.deleted_at IS NULL
     AND t.status = 'atlikta') AS tasks_done,
  (SELECT COALESCE(SUM(c.planned_cents), 0) FROM project_costs c WHERE c.project_id = p.id) AS planned_cents,
  (SELECT COALESCE(SUM(c.actual_cents), 0) FROM project_costs c WHERE c.project_id = p.id) AS actual_cents,
  (SELECT MIN(t.due_date) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'atvira'
     AND t.due_date IS NOT NULL) AS next_due`;

const cents = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1e10) throw new KlaidaVartotojui(`Netinkama suma (${field}).`);
  return value as number;
};

type Values = Pick<ProjectRow, "title" | "goal" | "area_id" | "owner_id" | "target_date" | "budget_cents" | "notes" | "status" | "savings_goal_id">;

export function projectValues(input: ProjectInput, base: Values | null): Values {
  const has = (key: keyof ProjectInput) => input[key] !== undefined;
  const title = has("title") ? text(input.title, "pavadinimas", 120) : (base?.title ?? null);
  if (!title) throw new KlaidaVartotojui("Projektui reikia pavadinimo.");
  const targetDate = has("targetDate") ? text(input.targetDate, "data", 10) : (base?.target_date ?? null);
  if (targetDate !== null && !isDate(targetDate)) throw new KlaidaVartotojui("Netinkama projekto data.");
  const status = has("status") ? (input.status as ProjectStatus) : (base?.status ?? "aktyvus");
  if (!STATUSES.includes(status)) throw new KlaidaVartotojui("Netinkama projekto būsena.");
  return {
    title,
    goal: has("goal") ? text(input.goal, "tikslas", 1000) : (base?.goal ?? null),
    area_id: has("areaId") ? id(input.areaId, "sritis") : (base?.area_id ?? null),
    owner_id: has("ownerId") ? id(input.ownerId, "atsakingas") : (base?.owner_id ?? null),
    target_date: targetDate,
    budget_cents: has("budgetCents") ? cents(input.budgetCents, "biudžetas") : (base?.budget_cents ?? null),
    notes: has("notes") ? text(input.notes, "pastabos", 5000) : (base?.notes ?? null),
    status,
    savings_goal_id: has("savingsGoalId") ? id(input.savingsGoalId, "katiliukas") : (base?.savings_goal_id ?? null),
  };
}

async function rawProject(db: D1Database, projectId: number): Promise<ProjectRow | null> {
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
}

async function liveProject(db: D1Database, projectId: number): Promise<ProjectRow> {
  const p = await rawProject(db, projectId);
  if (!p || p.deleted_at) throw new KlaidaVartotojui("Tokio projekto nėra — gal jį kas tik ką ištrynė.");
  return p;
}

export async function listProjects(db: D1Database): Promise<ProjectSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY} FROM projects p WHERE p.deleted_at IS NULL
       ORDER BY p.status = 'aktyvus' DESC, p.target_date IS NULL, p.target_date, p.id`
    )
    .all<ProjectSummary>();
  return results;
}

export async function getProject(
  db: D1Database,
  projectId: number
): Promise<{ project: ProjectSummary; sections: Section[]; costs: Cost[]; tasks: Task[] }> {
  const project = await db.prepare(`SELECT ${SUMMARY} FROM projects p WHERE p.id = ?`).bind(projectId).first<ProjectSummary>();
  if (!project || project.deleted_at) throw new KlaidaVartotojui("Tokio projekto nėra — gal jį kas tik ką ištrynė.");
  const [sections, costs] = await db.batch([
    db.prepare("SELECT * FROM project_sections WHERE project_id = ? ORDER BY sort_order, id").bind(projectId),
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM project_cost_links l WHERE l.cost_id = c.id) AS bank_links
         FROM project_costs c WHERE c.project_id = ? ORDER BY c.sort_order, c.id`
      )
      .bind(projectId),
  ]);
  return {
    project,
    sections: sections.results as unknown as Section[],
    costs: costs.results as unknown as Cost[],
    tasks: await listProjectTasks(db, projectId),
  };
}

/** Sukuria projektą su etapais, darbais ir biudžeto eilutėmis. */
export async function createProject(
  db: D1Database,
  plan: NewProjectPlan,
  memberId: number | null,
  now = new Date(),
  source: "rankinis" | "ai" | "claude" | "sablonas" = "rankinis"
): Promise<number> {
  const v = projectValues(plan, null);
  const row = await db
    .prepare(
      `INSERT INTO projects (title, goal, area_id, owner_id, target_date, budget_cents, status, notes, source, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'aktyvus', ?, ?, ?, ?) RETURNING id`
    )
    .bind(v.title, v.goal, v.area_id, v.owner_id, v.target_date, v.budget_cents, v.notes, source, now.toISOString(), memberId)
    .first<{ id: number }>();
  const projectId = row!.id;
  // Šablono darbai užduotyse žymimi „automatinis“ (tokia žyma ten jau numatyta).
  const taskSource = source === "sablonas" ? "automatinis" : source;
  const byTitle = new Map<string, number>();
  const linked: PlanCost[] = [];

  const addTasks = async (tasks: PlanTask[] | undefined, sectionId: number | null) => {
    for (const t of tasks ?? []) {
      const task = await createTask(
        db,
        {
          title: t.title,
          dueDate: t.dueDate ?? null,
          dueTime: t.dueTime ?? null,
          assigneeId: t.assigneeId ?? null,
          notes: t.notes ?? null,
          reminders: t.reminders,
          areaId: v.area_id,
          projectId,
          sectionId,
        },
        memberId,
        now,
        taskSource
      );
      for (const s of t.subtasks ?? []) await createTask(db, { title: s, parentId: task.id }, memberId, now, taskSource);
      byTitle.set(t.title.toLocaleLowerCase("lt"), task.id);
      if (t.amountCents != null) linked.push({ name: t.title, plannedCents: t.amountCents, isEstimate: true, taskTitle: t.title });
    }
  };

  let order = 0;
  for (const s of plan.sections ?? []) {
    const section = await createSection(db, projectId, s.name, ++order);
    await addTasks(s.tasks, section.id);
  }
  await addTasks(plan.tasks, null);

  let costOrder = 0;
  for (const c of [...(plan.costs ?? []), ...linked.filter((l) => !(plan.costs ?? []).some((c) => c.taskTitle === l.taskTitle))]) {
    await createCost(db, projectId, {
      name: c.name,
      plannedCents: c.plannedCents ?? null,
      actualCents: c.actualCents ?? null,
      isEstimate: c.isEstimate ?? false,
      taskId: c.taskTitle ? (byTitle.get(c.taskTitle.toLocaleLowerCase("lt")) ?? null) : null,
      sortOrder: ++costOrder,
    });
  }
  return projectId;
}

/** Iš šablono: etapai, darbai su terminais atgal nuo datos, biudžetas — įverčiai. */
export async function createFromTemplate(
  db: D1Database,
  code: string,
  input: ProjectInput,
  memberId: number | null,
  now = new Date()
): Promise<number> {
  const template = TEMPLATES.find((t) => t.code === code);
  if (!template) throw new KlaidaVartotojui("Tokio šablono nėra.");
  const v = projectValues({ ...input, title: input.title ?? template.name }, null);
  const area =
    v.area_id ??
    (await db.prepare("SELECT id FROM task_areas WHERE name = ?").bind(template.area).first<{ id: number }>())?.id ??
    null;
  const plan = planFromTemplate(
    template,
    { title: v.title, targetDate: v.target_date, budgetCents: v.budget_cents, areaId: area, ownerId: v.owner_id },
    todayVilnius(now)
  );
  return createProject(db, { ...plan, goal: v.goal, notes: v.notes }, memberId, now, "sablonas");
}

export async function updateProject(db: D1Database, projectId: number, input: ProjectInput, now = new Date()): Promise<ProjectRow> {
  const p = await liveProject(db, projectId);
  const v = projectValues(input, p);
  const finishedAt = v.status === "baigtas" ? (p.status === "baigtas" ? p.finished_at : now.toISOString()) : null;
  const row = await db
    .prepare(
      `UPDATE projects SET title = ?, goal = ?, area_id = ?, owner_id = ?, target_date = ?, budget_cents = ?, status = ?,
         notes = ?, finished_at = ?, savings_goal_id = ? WHERE id = ? RETURNING *`
    )
    .bind(v.title, v.goal, v.area_id, v.owner_id, v.target_date, v.budget_cents, v.status, v.notes, finishedAt, v.savings_goal_id, projectId)
    .first<ProjectRow>();
  return row!;
}

/** Į šiukšliadėžę — kartu su darbais (jie grąžinami kartu); neišsiųsti priminimai nebesiunčiami. */
export async function deleteProject(db: D1Database, projectId: number, now = new Date()): Promise<void> {
  await liveProject(db, projectId);
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").bind(at, projectId),
    db
      .prepare(
        `UPDATE task_reminders SET sent_at = ?1 WHERE sent_at IS NULL AND task_id IN (
           SELECT id FROM tasks WHERE project_id = ?2 AND deleted_at IS NULL)`
      )
      .bind(at, projectId),
    db
      .prepare(
        `UPDATE tasks SET deleted_at = ?1 WHERE deleted_at IS NULL AND (
           project_id = ?2 OR parent_id IN (SELECT id FROM tasks WHERE project_id = ?2 AND deleted_at IS NULL))`
      )
      .bind(at, projectId),
  ]);
}

export async function restoreProject(db: D1Database, projectId: number, now = new Date()): Promise<void> {
  const p = await rawProject(db, projectId);
  if (!p || !p.deleted_at) throw new KlaidaVartotojui("Šiukšliadėžėje tokio projekto nėra.");
  const { results } = await db
    .prepare("SELECT id FROM tasks WHERE project_id = ? AND deleted_at = ?")
    .bind(projectId, p.deleted_at)
    .all<{ id: number }>();
  await db.batch([
    db.prepare("UPDATE projects SET deleted_at = NULL WHERE id = ?").bind(projectId),
    db
      .prepare("UPDATE tasks SET deleted_at = NULL WHERE deleted_at = ?2 AND (project_id = ?1 OR parent_id IN (SELECT id FROM tasks WHERE project_id = ?1))")
      .bind(projectId, p.deleted_at),
  ]);
  for (const r of results) await rescheduleReminders(db, r.id, now);
}

/** Ištrinti projektai; senesni nei 30 d. ištrinami visam laikui. */
export async function listDeletedProjects(db: D1Database, now = new Date()): Promise<ProjectRow[]> {
  const before = new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString();
  await db.prepare("DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(before).run();
  const { results } = await db.prepare("SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all<ProjectRow>();
  return results;
}

// ---------- Etapai ----------

export async function createSection(db: D1Database, projectId: number, name: unknown, sortOrder?: number): Promise<Section> {
  await liveProject(db, projectId);
  const n = text(name, "etapas", 80);
  if (!n) throw new KlaidaVartotojui("Etapui reikia pavadinimo.");
  const row = await db
    .prepare(
      `INSERT INTO project_sections (project_id, name, sort_order)
       VALUES (?1, ?2, COALESCE(?3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM project_sections WHERE project_id = ?1)))
       RETURNING *`
    )
    .bind(projectId, n, sortOrder ?? null)
    .first<Section>();
  return row!;
}

export async function updateSection(db: D1Database, sectionId: number, input: { name?: unknown; sortOrder?: unknown }): Promise<Section> {
  const s = await db.prepare("SELECT * FROM project_sections WHERE id = ?").bind(sectionId).first<Section>();
  if (!s) throw new KlaidaVartotojui("Tokio etapo nėra.");
  const name = input.name === undefined ? s.name : text(input.name, "etapas", 80);
  if (!name) throw new KlaidaVartotojui("Etapui reikia pavadinimo.");
  const sortOrder = input.sortOrder === undefined ? s.sort_order : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new KlaidaVartotojui("Netinkama tvarka.");
  const row = await db
    .prepare("UPDATE project_sections SET name = ?, sort_order = ? WHERE id = ? RETURNING *")
    .bind(name, sortOrder, sectionId)
    .first<Section>();
  return row!;
}

/** Etapo darbai lieka projekte — tik be etapo. */
export async function deleteSection(db: D1Database, sectionId: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE tasks SET section_id = NULL WHERE section_id = ?").bind(sectionId),
    db.prepare("DELETE FROM project_sections WHERE id = ?").bind(sectionId),
  ]);
}

// ---------- Biudžeto eilutės ----------

export interface CostInput {
  name?: unknown;
  plannedCents?: unknown;
  actualCents?: unknown;
  isEstimate?: unknown;
  taskId?: unknown;
  sortOrder?: unknown;
}

async function checkCostTask(db: D1Database, projectId: number, taskId: number | null): Promise<void> {
  if (taskId === null) return;
  const t = await db.prepare("SELECT project_id FROM tasks WHERE id = ? AND deleted_at IS NULL").bind(taskId).first<{ project_id: number | null }>();
  if (!t || t.project_id !== projectId) throw new KlaidaVartotojui("Šis darbas ne šio projekto.");
}

export async function createCost(db: D1Database, projectId: number, input: CostInput): Promise<Cost> {
  await liveProject(db, projectId);
  const name = text(input.name, "eilutė", 100);
  if (!name) throw new KlaidaVartotojui("Biudžeto eilutei reikia pavadinimo.");
  const taskId = id(input.taskId, "darbas");
  await checkCostTask(db, projectId, taskId);
  const row = await db
    .prepare(
      `INSERT INTO project_costs (project_id, name, task_id, planned_cents, actual_cents, is_estimate, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6,
         COALESCE(?7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM project_costs WHERE project_id = ?1)))
       RETURNING *`
    )
    .bind(
      projectId,
      name,
      taskId,
      cents(input.plannedCents, "planas"),
      cents(input.actualCents, "faktas"),
      input.isEstimate ? 1 : 0,
      input.sortOrder === undefined ? null : Number(input.sortOrder)
    )
    .first<Cost>();
  return row!;
}

/** Pataisius plano sumą ranka, ji nebėra „įvertis“. */
export async function updateCost(db: D1Database, costId: number, input: CostInput): Promise<Cost> {
  const c = await db.prepare("SELECT * FROM project_costs WHERE id = ?").bind(costId).first<Cost>();
  if (!c) throw new KlaidaVartotojui("Tokios biudžeto eilutės nėra.");
  const name = input.name === undefined ? c.name : text(input.name, "eilutė", 100);
  if (!name) throw new KlaidaVartotojui("Biudžeto eilutei reikia pavadinimo.");
  const planned = input.plannedCents === undefined ? c.planned_cents : cents(input.plannedCents, "planas");
  const actual = input.actualCents === undefined ? c.actual_cents : cents(input.actualCents, "faktas");
  const taskId = input.taskId === undefined ? c.task_id : id(input.taskId, "darbas");
  await checkCostTask(db, c.project_id, taskId);
  const estimate =
    input.isEstimate !== undefined ? (input.isEstimate ? 1 : 0) : input.plannedCents !== undefined && planned !== c.planned_cents ? 0 : c.is_estimate;
  // Faktas iš banko — ranka įvesta suma tik pasilieka atsargai (grįš atsiejus operacijas).
  const fromBank = (await linkCount(db, costId)) > 0;
  const row = await db
    .prepare(
      `UPDATE project_costs SET name = ?, planned_cents = ?, actual_cents = ?, manual_actual_cents = ?, task_id = ?, is_estimate = ?
       WHERE id = ? RETURNING *`
    )
    .bind(
      name,
      planned,
      fromBank ? c.actual_cents : actual,
      fromBank ? (input.actualCents === undefined ? c.manual_actual_cents : actual) : null,
      taskId,
      estimate,
      costId
    )
    .first<Cost>();
  return row!;
}

export async function deleteCost(db: D1Database, costId: number): Promise<void> {
  await db.prepare("DELETE FROM project_costs WHERE id = ?").bind(costId).run();
}

/**
 * Darbo kaina į projekto biudžetą („tortą užsakiau už 65“): į susietos eilutės faktą, o jei
 * tokios nėra — nauja eilutė darbo vardu. Grąžina, kaip atšaukti.
 */
export async function recordTaskCost(
  db: D1Database,
  taskId: number,
  amountCents: number
): Promise<{ costId: number; created: boolean; previousActual: number | null } | null> {
  const task = await db.prepare("SELECT title, project_id FROM tasks WHERE id = ?").bind(taskId).first<{ title: string; project_id: number | null }>();
  if (!task?.project_id) return null;
  const linked = await db.prepare("SELECT * FROM project_costs WHERE task_id = ? ORDER BY id LIMIT 1").bind(taskId).first<Cost>();
  if (linked) {
    const previousActual = await readManualActual(db, linked.id);
    await setManualActual(db, linked.id, amountCents);
    return { costId: linked.id, created: false, previousActual };
  }
  const c = await createCost(db, task.project_id, { name: task.title, actualCents: amountCents, taskId });
  return { costId: c.id, created: true, previousActual: null };
}

// ---------- Faktas: ranka ar iš banko (žr. bankas.ts) ----------

export async function linkCount(db: D1Database, costId: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM project_cost_links WHERE cost_id = ?").bind(costId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Ranka įvedamas faktas: jei eilutė turi banko operacijų — pasilieka atsargai, faktas nesikeičia. */
export async function setManualActual(db: D1Database, costId: number, cents: number | null): Promise<void> {
  const column = (await linkCount(db, costId)) > 0 ? "manual_actual_cents" : "actual_cents";
  await db.prepare(`UPDATE project_costs SET ${column} = ? WHERE id = ?`).bind(cents, costId).run();
}

/** Ranka įvesta suma (ne banko) — atšaukimui. */
export async function readManualActual(db: D1Database, costId: number): Promise<number | null> {
  const c = await db
    .prepare("SELECT actual_cents, manual_actual_cents FROM project_costs WHERE id = ?")
    .bind(costId)
    .first<{ actual_cents: number | null; manual_actual_cents: number | null }>();
  if (!c) return null;
  return (await linkCount(db, costId)) > 0 ? c.manual_actual_cents : c.actual_cents;
}

export const templateList = () => TEMPLATES.map(({ code, name, icon, description }) => ({ code, name, icon, description }));

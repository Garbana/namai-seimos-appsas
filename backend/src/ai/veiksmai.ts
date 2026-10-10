/**
 * Asistento veiksmai: modelio pasiūlymas (įrankio kvietimas) → patikrintas veiksmas →
 * įvykdymas → atšaukimas.
 *
 * AI pats nieko nerašo: kiekvienas pasiūlymas patikrinamas tomis pačiomis taisyklėmis,
 * kaip ir rankinis įvedimas (taskValues, reminderSpecs…). Iš karto vykdomi tik paprasti
 * veiksmai (atlikta, pirkiniai, nupirkta); nauja užduotis, keitimas ir trynimas laukia
 * žmogaus patvirtinimo. Kiekvienam įvykdytam įsimenama, kaip buvo, — kad būtų galima atšaukti.
 */
import { KlaidaVartotojui, text } from "../darbai/bendra";
import type { Area, Member } from "../darbai/nariai";
import { addItem, deleteItem, updateItem } from "../darbai/pirkiniai";
import { isDate } from "../darbai/pakartojimai";
import { reminderSpecs } from "../darbai/priminimai";
import {
  createCost,
  createProject,
  createSection,
  deleteCost,
  deleteProject,
  projectValues,
  readManualActual,
  recordTaskCost,
  setManualActual,
  type PlanCost,
  type PlanTask,
} from "../darbai/projektai";
import {
  completeTask,
  createTask,
  deleteTask,
  rawTask,
  restoreTask,
  taskValues,
  undoComplete,
  updateTask,
  type Task,
  type TaskInput,
  type TaskRow,
} from "../darbai/uzduotys";
import { createFeedback, deleteFeedback, KINDS, type Kind } from "../pastabos";
import { createEvent, deleteEvent, eventValues, liveEvent, restoreEvent, updateEvent, type EventInput } from "../kalendorius/ivykiai";
import { queueAssignment, queueTurn } from "../pranesimai/pranesimai";

export type Tipas =
  | "sukurti"
  | "keisti"
  | "istrinti"
  | "atlikta"
  | "pirkiniai"
  | "nupirkta"
  | "pastaba"
  | "projektas"
  | "islaida"
  | "ivykis"
  | "ivykio_keitimas"
  | "ivykio_trynimas";
export type Busena = "laukia" | "ivykdyta" | "atmesta" | "pakeista" | "atsaukta" | "klaida";

/** Užduoties laukai tokie, kokius priima createTask/updateTask. */
export type Laukai = TaskInput & { reminders?: string[] };

export interface Veiksmas {
  /** Modelio įrankio kvietimo id. */
  id: string;
  tipas: Tipas;
  busena: Busena;
  klaida?: string;
  laukai?: Laukai;
  pouzduotys?: string[];
  uzduotisId?: number;
  pavadinimas?: string;
  /** Keičiant — kaip buvo keičiami laukai (kortelei „buvo → bus“). */
  pries?: Laukai;
  sarasasId?: number;
  prekes?: { id?: number; name: string; quantity: string | null }[];
  /** Atliekant paminėta suma (centais). */
  sumaCentais?: number | null;
  /** Pastaba apie appsą (save_feedback): rūšis ir tekstas; ekranas ir susijusi asistento žinutė. */
  pastaba?: { kind: Kind; text: string };
  ekranas?: string | null;
  irasasId?: number | null;
  /** Naujas projektas (create_project) — visas planas; sukūrus — jo id. */
  projektas?: ProjectPlan;
  projektasId?: number;
  /** Naujos užduoties projekto etapas (create_task su section). */
  etapas?: string | null;
  /** Projekto išlaida (record_project_cost). */
  islaida?: { projectId: number; projektas: string; costId: number | null; name: string; actualCents: number };
  /** Kalendoriaus įvykis: naujas — visi laukai, keičiamas — tik keičiami (pries — kaip buvo). */
  ivykis?: IvykioLaukai;
  ivykisPries?: IvykioLaukai;
  ivykisId?: number;
  /** Kaip atšaukti — tik serveriui. */
  atsaukimas?: Atsaukimas;
}

/** Įvykio laukai kortelei ir įrašymui (kaip EventInput). */
export interface IvykioLaukai {
  title?: string;
  startDate?: string;
  startTime?: string | null;
  endDate?: string;
  endTime?: string | null;
  memberIds?: number[];
  location?: string | null;
  notes?: string | null;
  recurrence?: string | null;
}

/** Projekto planas, kokį pasiūlė asistentas (sumos — centais). */
export interface ProjectPlan {
  title: string;
  goal: string | null;
  /** Ilgesnės pastabos (Claude programa čia perkelia, ką išsiaiškino: vietos, kontaktai…). */
  notes?: string | null;
  targetDate: string | null;
  budgetCents: number | null;
  areaId: number | null;
  ownerId: number | null;
  sections: { name: string; tasks: PlanTask[] }[];
  costs: PlanCost[];
}

type CostUndo = { costId: number; created: boolean; previousActual: number | null };

type Atsaukimas =
  | { tipas: "sukurti"; uzduotisId: number }
  | { tipas: "keisti"; laukai: Laukai }
  | { tipas: "istrinti" }
  | { tipas: "atlikta"; pouzduotis: boolean; sumaPries?: number | null; kaina?: CostUndo | null }
  | { tipas: "projektas"; projectId: number }
  | ({ tipas: "islaida" } & CostUndo)
  | { tipas: "pirkiniai"; prekes: ({ id: number; sukurta: true } | { id: number; sukurta: false; buvo: ItemState })[] }
  | { tipas: "nupirkta"; prekes: number[] }
  | { tipas: "pastaba"; pastabaId: number }
  | { tipas: "ivykis"; ivykisId: number }
  | { tipas: "ivykio_keitimas"; ivykisId: number; buvo: IvykioLaukai }
  | { tipas: "ivykio_trynimas"; ivykisId: number };

interface ItemState {
  checked_at: string | null;
  checked_by: number | null;
  quantity: string | null;
  added_by: number | null;
  added_at: string;
}

/** Veiksmai, kurie vykdomi iš karto, be patvirtinimo. */
export const IMMEDIATE: Tipas[] = ["atlikta", "pirkiniai", "nupirkta", "pastaba", "islaida"];

const TOOL_TYPES: Record<string, Tipas> = {
  create_task: "sukurti",
  update_task: "keisti",
  delete_task: "istrinti",
  complete_task: "atlikta",
  add_shopping_items: "pirkiniai",
  check_shopping_items: "nupirkta",
  save_feedback: "pastaba",
  create_project: "projektas",
  record_project_cost: "islaida",
  create_event: "ivykis",
  update_event: "ivykio_keitimas",
  delete_event: "ivykio_trynimas",
};

/** Modelio įvykio laukai → EventInput (tik atsiųsti). */
const EVENT_FIELDS: Record<string, keyof IvykioLaukai> = {
  title: "title",
  date: "startDate",
  start_time: "startTime",
  end_date: "endDate",
  end_time: "endTime",
  member_ids: "memberIds",
  location: "location",
  notes: "notes",
  recurrence: "recurrence",
};

function eventFieldsFrom(raw: Record<string, unknown>): IvykioLaukai {
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(EVENT_FIELDS)) if (raw[from] !== undefined) out[to] = raw[from];
  if (out.memberIds === null) out.memberIds = [];
  return out as IvykioLaukai;
}

/** Įvykio eilutė → laukai (kortelės „buvo“ ir atšaukimui). */
function eventSnapshot(e: { title: string; start_date: string; start_time: string | null; end_date: string; end_time: string | null; member_ids: string; location: string | null; notes: string | null; recurrence: string | null }): IvykioLaukai {
  return {
    title: e.title,
    startDate: e.start_date,
    startTime: e.start_time,
    endDate: e.end_date,
    endTime: e.end_time,
    memberIds: JSON.parse(e.member_ids) as number[],
    location: e.location,
    notes: e.notes,
    recurrence: e.recurrence,
  };
}

function checkEventMembers(l: IvykioLaukai, known: Known): void {
  if (Array.isArray(l.memberIds) && l.memberIds.some((m) => !known.members.some((x) => x.id === Number(m)))) {
    throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
  }
}

/** Modelio laukų vardai → TaskInput. */
const FIELD_MAP: Record<string, keyof Laukai> = {
  title: "title",
  due_date: "dueDate",
  due_time: "dueTime",
  assignee_id: "assigneeId",
  area_id: "areaId",
  priority: "priority",
  recurrence: "recurrence",
  notes: "notes",
  project_id: "projectId",
  chore: "chore",
  rotation_member_ids: "rotationMembers",
  repeat_after_done: "repeatAfterDone",
};

/** TaskInput laukas → užduoties stulpelis (kortelės „buvo“ reikšmei). */
const ROW_FIELD: Record<string, keyof TaskRow> = {
  title: "title",
  dueDate: "due_date",
  dueTime: "due_time",
  assigneeId: "assignee_id",
  areaId: "area_id",
  priority: "priority",
  recurrence: "recurrence",
  notes: "notes",
  amountCents: "amount_cents",
  chore: "chore",
  repeatAfterDone: "repeat_after_done",
};

const cents = (eur: unknown) => {
  if (eur === null || eur === undefined || eur === "") return null;
  const n = Number(eur);
  if (!Number.isFinite(n) || n < 0) throw new KlaidaVartotojui("Netinkama suma.");
  return Math.round(n * 100);
};

function fieldsFrom(raw: Record<string, unknown>): Laukai {
  const out: Laukai = {};
  for (const [from, to] of Object.entries(FIELD_MAP)) if (raw[from] !== undefined) (out as Record<string, unknown>)[to] = raw[from];
  if (raw.reminders !== undefined) out.reminders = raw.reminders === null ? [] : (raw.reminders as string[]);
  if (raw.amount_eur !== undefined) out.amountCents = cents(raw.amount_eur);
  return out;
}

interface Known {
  members: Member[];
  areas: Area[];
}

/** Atsakingas ir sritis turi egzistuoti; priminimai — tik tokie, kurie įmanomi. */
function checkFields(laukai: Laukai, known: Known, due: { date: string | null; time: string | null }): Laukai {
  if (laukai.assigneeId != null && !known.members.some((m) => m.id === laukai.assigneeId)) {
    throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
  }
  if (laukai.areaId != null && !known.areas.some((a) => a.id === laukai.areaId)) throw new KlaidaVartotojui("Tokios srities nėra.");
  if (Array.isArray(laukai.rotationMembers) && laukai.rotationMembers.some((m) => !known.members.some((x) => x.id === m))) {
    throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
  }
  if (laukai.reminders !== undefined) {
    const specs = reminderSpecs(laukai.reminders);
    laukai.reminders = !due.date ? [] : due.time ? specs : specs.filter((s) => !s.endsWith("m"));
  }
  return laukai;
}

async function liveProjectRow(db: D1Database, projectId: unknown): Promise<{ id: number; title: string; area_id: number | null }> {
  const p = Number.isInteger(projectId)
    ? await db.prepare("SELECT id, title, area_id, deleted_at FROM projects WHERE id = ?").bind(projectId).first<{ id: number; title: string; area_id: number | null; deleted_at: string | null }>()
    : null;
  if (!p || p.deleted_at) throw new KlaidaVartotojui("Tokio projekto neradau.");
  return p;
}

/** Projekto plano darbas: tos pačios patikros kaip užduočiai. */
function planTask(raw: Record<string, unknown>, known: Known): PlanTask {
  const laukai = fieldsFrom({ title: raw.title, due_date: raw.due_date, due_time: raw.due_time, assignee_id: raw.assignee_id, reminders: raw.reminders });
  const values = taskValues(laukai, null);
  checkFields(laukai, known, { date: values.due_date, time: values.due_time });
  return {
    title: values.title,
    dueDate: values.due_date,
    dueTime: values.due_time,
    assigneeId: values.assignee_id,
    reminders: laukai.reminders,
    amountCents: cents(raw.amount_eur),
  };
}

const list = (v: unknown, max: number) => (Array.isArray(v) ? (v as Record<string, unknown>[]).slice(0, max) : []);

async function liveTask(db: D1Database, taskId: unknown): Promise<TaskRow> {
  const task = Number.isInteger(taskId) ? await rawTask(db, taskId as number) : null;
  if (!task || task.deleted_at) throw new KlaidaVartotojui("Tokios užduoties neradau.");
  return task;
}

/** Iš modelio įrankio kvietimo — patikrintas veiksmas (arba veiksmas su klaida). */
export async function propose(
  db: D1Database,
  call: { id: string; name: string; input: Record<string, unknown> },
  known: Known
): Promise<Veiksmas> {
  const tipas = TOOL_TYPES[call.name];
  const v: Veiksmas = { id: call.id, tipas: tipas ?? "sukurti", busena: "laukia" };
  try {
    if (!tipas) throw new KlaidaVartotojui(`Nežinomas veiksmas „${call.name}“.`);
    const raw = call.input ?? {};

    if (tipas === "sukurti") {
      const laukai = fieldsFrom(raw);
      if (laukai.projectId != null) {
        const project = await liveProjectRow(db, laukai.projectId);
        if (laukai.areaId == null && project.area_id !== null) laukai.areaId = project.area_id;
        v.etapas = text(raw.section, "etapas", 80);
      } else {
        delete laukai.projectId;
      }
      const values = taskValues(laukai, null);
      v.laukai = checkFields(laukai, known, { date: values.due_date, time: values.due_time });
      v.pavadinimas = values.title;
      v.pouzduotys = Array.isArray(raw.subtasks)
        ? raw.subtasks.map((s) => text(s, "použduotis", 300)).filter((s): s is string => Boolean(s)).slice(0, 30)
        : [];
    } else if (tipas === "keisti") {
      const task = await liveTask(db, raw.task_id);
      const laukai = fieldsFrom(raw);
      if (Object.keys(laukai).length === 0) throw new KlaidaVartotojui("Nenurodyta, ką keisti.");
      const values = taskValues(laukai, task);
      v.laukai = checkFields(laukai, known, { date: values.due_date, time: values.due_time });
      v.uzduotisId = task.id;
      v.pavadinimas = task.title;
      v.pries = await snapshot(db, task, v.laukai);
    } else if (tipas === "istrinti") {
      const task = await liveTask(db, raw.task_id);
      v.uzduotisId = task.id;
      v.pavadinimas = task.title;
    } else if (tipas === "atlikta") {
      const task = await liveTask(db, raw.task_id);
      if (task.status === "atlikta") throw new KlaidaVartotojui(`„${task.title}“ jau pažymėta atlikta.`);
      v.uzduotisId = task.id;
      v.pavadinimas = task.title;
      v.sumaCentais = task.parent_id === null ? cents(raw.amount_eur) : null;
    } else if (tipas === "pirkiniai") {
      const list = await db
        .prepare("SELECT id, name FROM shopping_lists WHERE id = ?")
        .bind(Number(raw.list_id))
        .first<{ id: number; name: string }>();
      if (!list) throw new KlaidaVartotojui("Tokio pirkinių sąrašo nėra.");
      const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
      v.sarasasId = list.id;
      v.pavadinimas = list.name;
      v.prekes = items
        .map((i) => ({ name: text(i?.name, "prekė", 100) ?? "", quantity: text(i?.quantity, "kiekis", 30) }))
        .filter((i) => i.name);
      if (v.prekes.length === 0) throw new KlaidaVartotojui("Nenurodyta, ką nupirkti.");
    } else if (tipas === "projektas") {
      const values = projectValues(
        {
          title: raw.title,
          goal: raw.goal,
          areaId: raw.area_id,
          ownerId: raw.owner_id,
          targetDate: raw.target_date,
          budgetCents: cents(raw.budget_eur),
          notes: raw.notes,
        },
        null
      );
      if (values.target_date !== null && !isDate(values.target_date)) throw new KlaidaVartotojui("Netinkama projekto data.");
      if (values.owner_id !== null && !known.members.some((m) => m.id === values.owner_id)) throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
      if (values.area_id !== null && !known.areas.some((a) => a.id === values.area_id)) throw new KlaidaVartotojui("Tokios srities nėra.");
      v.projektas = {
        title: values.title,
        goal: values.goal,
        notes: values.notes,
        targetDate: values.target_date,
        budgetCents: values.budget_cents,
        areaId: values.area_id,
        ownerId: values.owner_id,
        sections: list(raw.sections, 10).map((s) => {
          const name = text(s?.name, "etapas", 80);
          if (!name) throw new KlaidaVartotojui("Etapui reikia pavadinimo.");
          return { name, tasks: list(s.tasks, 25).map((t) => planTask(t, known)) };
        }),
        costs: list(raw.costs, 25).map((c) => {
          const name = text(c?.name, "biudžeto eilutė", 100);
          if (!name) throw new KlaidaVartotojui("Biudžeto eilutei reikia pavadinimo.");
          return { name, plannedCents: cents(c.planned_eur), isEstimate: c.is_estimate !== false, taskTitle: text(c.task_title, "darbas", 300) ?? undefined };
        }),
      };
      v.pavadinimas = values.title;
    } else if (tipas === "islaida") {
      const project = await liveProjectRow(db, raw.project_id);
      const actualCents = cents(raw.actual_eur);
      if (actualCents === null) throw new KlaidaVartotojui("Nenurodyta suma.");
      let name = text(raw.name, "biudžeto eilutė", 100);
      let costId: number | null = null;
      if (raw.cost_id != null) {
        const c = await db
          .prepare("SELECT id, name FROM project_costs WHERE id = ? AND project_id = ?")
          .bind(Number(raw.cost_id), project.id)
          .first<{ id: number; name: string }>();
        if (!c) throw new KlaidaVartotojui("Tokios biudžeto eilutės šiame projekte nėra.");
        costId = c.id;
        name = c.name;
      }
      if (!name) throw new KlaidaVartotojui("Nenurodyta, kam išleista.");
      v.islaida = { projectId: project.id, projektas: project.title, costId, name, actualCents };
      v.pavadinimas = project.title;
    } else if (tipas === "ivykis") {
      const laukai = eventFieldsFrom(raw);
      checkEventMembers(laukai, known);
      v.ivykis = eventSnapshot(eventValues(laukai as EventInput, null));
      v.pavadinimas = v.ivykis.title;
    } else if (tipas === "ivykio_keitimas") {
      const e = await liveEvent(db, Number(raw.event_id));
      const laukai = eventFieldsFrom(raw);
      if (Object.keys(laukai).length === 0) throw new KlaidaVartotojui("Nenurodyta, ką keisti.");
      checkEventMembers(laukai, known);
      const naujas = eventSnapshot(eventValues(laukai as EventInput, e));
      const buvo = eventSnapshot(e);
      // Kortelei — tik tai, kas iš tikrųjų keičiasi (ir pabaiga, jei pasislinko kartu).
      const keys = (Object.keys(naujas) as (keyof IvykioLaukai)[]).filter((k) => JSON.stringify(naujas[k]) !== JSON.stringify(buvo[k]));
      if (keys.length === 0) throw new KlaidaVartotojui("Įvykis jau toks.");
      v.ivykis = Object.fromEntries(keys.map((k) => [k, naujas[k]])) as IvykioLaukai;
      v.ivykisPries = Object.fromEntries(keys.map((k) => [k, buvo[k]])) as IvykioLaukai;
      v.ivykisId = e.id;
      v.pavadinimas = e.title;
    } else if (tipas === "ivykio_trynimas") {
      const e = await liveEvent(db, Number(raw.event_id));
      v.ivykisId = e.id;
      v.pavadinimas = e.title;
      v.ivykis = eventSnapshot(e);
    } else if (tipas === "pastaba") {
      const kind = KINDS.includes(raw.kind as Kind) ? (raw.kind as Kind) : "klaida";
      const body = text(raw.text, "pastaba", 4000);
      if (!body) throw new KlaidaVartotojui("Nesupratau, ką užfiksuoti.");
      v.pastaba = { kind, text: body };
    } else {
      const ids = Array.isArray(raw.item_ids) ? raw.item_ids.map(Number).filter(Number.isInteger) : [];
      const { results } = await db
        .prepare("SELECT id, name, quantity, checked_at FROM shopping_items WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .all<{ id: number; name: string; quantity: string | null; checked_at: string | null }>();
      const open = results.filter((r) => !r.checked_at);
      if (open.length === 0) throw new KlaidaVartotojui("Tokių prekių sąraše neradau.");
      v.prekes = open.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity }));
    }
  } catch (error) {
    if (!(error instanceof KlaidaVartotojui)) throw error;
    v.busena = "klaida";
    v.klaida = error.message;
  }
  return v;
}

/** Kaip dabar atrodo laukai, kuriuos ketinama keisti. */
async function snapshot(db: D1Database, task: TaskRow, laukai: Laukai): Promise<Laukai> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(laukai)) {
    if (key === "reminders") {
      const { results } = await db
        .prepare("SELECT spec FROM task_reminders WHERE task_id = ? AND spec IS NOT NULL ORDER BY id")
        .bind(task.id)
        .all<{ spec: string }>();
      out.reminders = results.map((r) => r.spec);
    } else if (key === "rotationMembers") {
      out.rotationMembers = task.rotation_members ? JSON.parse(task.rotation_members) : null;
    } else if (ROW_FIELD[key]) {
      out[key] = task[ROW_FIELD[key]];
    }
  }
  return out as Laukai;
}

/** Įvykdo veiksmą (memberId — kas prašė; source — katinukas ar Claude programa) ir įsimena, kaip atšaukti. */
export async function execute(
  db: D1Database,
  v: Veiksmas,
  memberId: number | null,
  now = new Date(),
  source: "ai" | "claude" = "ai"
): Promise<void> {
  if (v.tipas === "sukurti") {
    const laukai = { ...(v.laukai ?? {}) };
    // Projekto etapas pagal pavadinimą: esamas arba naujas.
    if (laukai.projectId != null && v.etapas) {
      const found = await db
        .prepare("SELECT id FROM project_sections WHERE project_id = ? AND lower(name) = lower(?)")
        .bind(laukai.projectId, v.etapas)
        .first<{ id: number }>();
      laukai.sectionId = found?.id ?? (await createSection(db, laukai.projectId as number, v.etapas)).id;
    }
    const task = await createTask(db, laukai, memberId, now, source);
    for (const title of v.pouzduotys ?? []) await createTask(db, { title, parentId: task.id }, memberId, now, source);
    await queueAssignment(db, task, null, memberId, now);
    v.uzduotisId = task.id;
    v.atsaukimas = { tipas: "sukurti", uzduotisId: task.id };
  } else if (v.tipas === "keisti") {
    const before = await liveTask(db, v.uzduotisId);
    const buvo = await snapshot(db, before, v.laukai ?? {});
    const updated: Task = await updateTask(db, before.id, v.laukai ?? {}, memberId, now);
    await queueAssignment(db, updated, before.assignee_id, memberId, now);
    v.atsaukimas = { tipas: "keisti", laukai: buvo };
  } else if (v.tipas === "istrinti") {
    await deleteTask(db, (await liveTask(db, v.uzduotisId)).id, now);
    v.atsaukimas = { tipas: "istrinti" };
  } else if (v.tipas === "atlikta") {
    const task = await liveTask(db, v.uzduotisId);
    if (task.parent_id !== null) {
      await updateTask(db, task.id, { status: "atlikta" }, memberId, now);
      v.atsaukimas = { tipas: "atlikta", pouzduotis: true };
    } else {
      // Projekto darbo suma keliauja į projekto biudžeto faktą, kitaip — į užduoties sumą.
      const kaina = v.sumaCentais != null && task.project_id !== null ? await recordTaskCost(db, task.id, v.sumaCentais) : null;
      const sumaPries = v.sumaCentais != null && !kaina ? task.amount_cents : undefined;
      if (sumaPries !== undefined) await updateTask(db, task.id, { amountCents: v.sumaCentais }, memberId, now);
      const { task: after } = await completeTask(db, task.id, memberId, now);
      await queueTurn(db, after, task.assignee_id, memberId, now);
      v.atsaukimas = { tipas: "atlikta", pouzduotis: false, sumaPries, kaina };
    }
  } else if (v.tipas === "projektas") {
    v.projektasId = await createProject(db, v.projektas!, memberId, now, source);
    v.atsaukimas = { tipas: "projektas", projectId: v.projektasId };
  } else if (v.tipas === "islaida") {
    const i = v.islaida!;
    if (i.costId !== null) {
      const previousActual = await readManualActual(db, i.costId);
      await setManualActual(db, i.costId, i.actualCents);
      v.atsaukimas = { tipas: "islaida", costId: i.costId, created: false, previousActual };
    } else {
      const c = await createCost(db, i.projectId, { name: i.name, actualCents: i.actualCents });
      v.atsaukimas = { tipas: "islaida", costId: c.id, created: true, previousActual: null };
    }
  } else if (v.tipas === "ivykis") {
    const e = await createEvent(db, v.ivykis as EventInput, memberId, now, source);
    v.ivykisId = e.id;
    v.atsaukimas = { tipas: "ivykis", ivykisId: e.id };
  } else if (v.tipas === "ivykio_keitimas") {
    const before = await liveEvent(db, v.ivykisId!);
    await updateEvent(db, before.id, v.ivykis as EventInput, now);
    v.atsaukimas = { tipas: "ivykio_keitimas", ivykisId: before.id, buvo: eventSnapshot(before) };
  } else if (v.tipas === "ivykio_trynimas") {
    await deleteEvent(db, v.ivykisId!, now);
    v.atsaukimas = { tipas: "ivykio_trynimas", ivykisId: v.ivykisId! };
  } else if (v.tipas === "pastaba") {
    const f = await createFeedback(
      db,
      { kind: v.pastaba?.kind, text: v.pastaba?.text, screen: v.ekranas, aiRequestId: v.irasasId, memberId },
      now
    );
    v.atsaukimas = { tipas: "pastaba", pastabaId: f.id };
  } else if (v.tipas === "pirkiniai") {
    const records: Extract<Atsaukimas, { tipas: "pirkiniai" }>["prekes"] = [];
    for (const p of v.prekes ?? []) {
      const { results } = await db
        .prepare("SELECT id, name, checked_at, checked_by, quantity, added_by, added_at FROM shopping_items WHERE list_id = ?")
        .bind(v.sarasasId)
        .all<{ id: number; name: string } & ItemState>();
      const existing = results.find((r) => r.name.toLocaleLowerCase("lt") === p.name.toLocaleLowerCase("lt"));
      const item = await addItem(db, { listId: v.sarasasId, name: p.name, quantity: p.quantity }, memberId, now);
      p.id = item.id;
      records.push(
        existing
          ? {
              id: item.id,
              sukurta: false,
              buvo: {
                checked_at: existing.checked_at,
                checked_by: existing.checked_by,
                quantity: existing.quantity,
                added_by: existing.added_by,
                added_at: existing.added_at,
              },
            }
          : { id: item.id, sukurta: true }
      );
    }
    v.atsaukimas = { tipas: "pirkiniai", prekes: records };
  } else {
    const ids: number[] = [];
    for (const p of v.prekes ?? []) {
      await updateItem(db, p.id!, { checked: true }, memberId, now);
      ids.push(p.id!);
    }
    v.atsaukimas = { tipas: "nupirkta", prekes: ids };
  }
  v.busena = "ivykdyta";
}

async function undoCost(db: D1Database, c: CostUndo): Promise<void> {
  if (c.created) await deleteCost(db, c.costId);
  else await setManualActual(db, c.costId, c.previousActual);
}

/** Atšaukia įvykdytą veiksmą — grąžina, kaip buvo. */
export async function undo(db: D1Database, v: Veiksmas, memberId: number | null, now = new Date()): Promise<void> {
  const a = v.atsaukimas;
  if (v.busena !== "ivykdyta" || !a) throw new KlaidaVartotojui("Šio veiksmo atšaukti nebegalima.");

  if (a.tipas === "sukurti") {
    await deleteTask(db, a.uzduotisId, now);
  } else if (a.tipas === "keisti") {
    await updateTask(db, v.uzduotisId!, a.laukai, memberId, now);
  } else if (a.tipas === "istrinti") {
    await restoreTask(db, v.uzduotisId!, now);
  } else if (a.tipas === "atlikta") {
    if (a.pouzduotis) {
      await updateTask(db, v.uzduotisId!, { status: "atvira" }, memberId, now);
    } else {
      await undoComplete(db, v.uzduotisId!, now);
      if (a.sumaPries !== undefined) await updateTask(db, v.uzduotisId!, { amountCents: a.sumaPries }, memberId, now);
      if (a.kaina) await undoCost(db, a.kaina);
    }
  } else if (a.tipas === "projektas") {
    await deleteProject(db, a.projectId, now);
  } else if (a.tipas === "islaida") {
    await undoCost(db, a);
  } else if (a.tipas === "ivykis") {
    await deleteEvent(db, a.ivykisId, now);
  } else if (a.tipas === "ivykio_keitimas") {
    await updateEvent(db, a.ivykisId, a.buvo as EventInput, now);
  } else if (a.tipas === "ivykio_trynimas") {
    await restoreEvent(db, a.ivykisId, now);
  } else if (a.tipas === "pastaba") {
    await deleteFeedback(db, a.pastabaId);
  } else if (a.tipas === "pirkiniai") {
    for (const p of a.prekes) {
      if (p.sukurta) {
        await deleteItem(db, p.id);
      } else {
        await db
          .prepare("UPDATE shopping_items SET checked_at = ?, checked_by = ?, quantity = ?, added_by = ?, added_at = ? WHERE id = ?")
          .bind(p.buvo.checked_at, p.buvo.checked_by, p.buvo.quantity, p.buvo.added_by, p.buvo.added_at, p.id)
          .run();
      }
    }
  } else {
    for (const itemId of a.prekes) await updateItem(db, itemId, { checked: false }, memberId, now);
  }
  v.busena = "atsaukta";
}

/** Kaip veiksmo būsena perduodama modeliui kitoje pokalbio žinutėje. */
export function statusForModel(v: Veiksmas | undefined): string {
  if (!v) return "Neįvykdyta.";
  switch (v.busena) {
    case "laukia":
      return "Parodyta žmogui, laukia patvirtinimo.";
    case "ivykdyta":
      if (v.tipas === "projektas" && v.projektasId) return `Įvykdyta (projekto id ${v.projektasId}).`;
      if (v.tipas === "ivykis" && v.ivykisId) return `Įvykdyta (įvykio id e${v.ivykisId}).`;
      return v.uzduotisId && v.tipas === "sukurti" ? `Įvykdyta (užduoties id ${v.uzduotisId}).` : "Įvykdyta.";
    case "atmesta":
      return "Žmogus atmetė.";
    case "pakeista":
      return "Pakeista naujesniu pasiūlymu.";
    case "atsaukta":
      return "Žmogus atšaukė.";
    default:
      return `Nepavyko: ${v.klaida ?? "klaida"}.`;
  }
}

/** Į appsą — be vidinių atšaukimo duomenų. */
export function publicAction(v: Veiksmas): Omit<Veiksmas, "atsaukimas"> {
  const { atsaukimas: _, ...rest } = v;
  return rest;
}

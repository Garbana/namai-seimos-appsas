/**
 * Darbų skilties API: /api/nariai ir /api/darbai/*. Finansų maršrutai gyvena index.ts,
 * čia — tik darbai, kad skiltys liktų atskirtos.
 */
import { queueAssignment, queueTurn } from "../pranesimai/pranesimai";
import { dismissSuggestion, linkTransaction, projectBank, projectSavings, savingsGoalList, transactionProject, unlinkTransaction } from "./bankas";
import { KlaidaVartotojui, todayVilnius } from "./bendra";
import { actingMember, createArea, deleteArea, listAreas, listMembers, updateArea, type AreaInput } from "./nariai";
import { addItem, deleteItem, listShopping, updateItem, type ItemInput } from "./pirkiniai";
import { snoozeTask } from "./priminimai";
import {
  createCost,
  createFromTemplate,
  createProject,
  createSection,
  deleteCost,
  deleteProject,
  deleteSection,
  getProject,
  listDeletedProjects,
  listProjects,
  restoreProject,
  templateList,
  updateCost,
  updateProject,
  updateSection,
  type CostInput,
  type ProjectInput,
} from "./projektai";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  listTrash,
  restoreTask,
  undoComplete,
  updateTask,
  type TaskInput,
} from "./uzduotys";

/** Užklausos turinys; kas iš tikrųjų atsiųsta — tikrina kiekvienas modulis. */
type Body = TaskInput &
  AreaInput &
  ItemInput &
  ProjectInput &
  CostInput & {
    memberId?: unknown;
    minutes?: unknown;
    sablonas?: unknown;
    sortOrder?: unknown;
    transactionId?: unknown;
    costId?: unknown;
    costName?: unknown;
    projectId?: unknown;
  };

/** null — ne šios skilties adresas (tada sprendžia index.ts). */
export async function handleDarbai(url: URL, request: Request, db: D1Database): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/nariai" && !path.startsWith("/api/darbai/")) return null;

  try {
    return (await route(path, request, db)) ?? Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) {
      return Response.json({ klaida: "Nurodytas narys, sritis ar sąrašas neegzistuoja." }, { status: 400 });
    }
    throw error;
  }
}

async function route(path: string, request: Request, db: D1Database): Promise<Response | null> {
  const method = request.method;
  const body = async (): Promise<Body> => {
    try {
      return (await request.json()) as Body;
    } catch {
      throw new KlaidaVartotojui("Netinkamas užklausos turinys.");
    }
  };

  // Kas naudoja įrenginį, renkamasi pačiame įrenginyje (ne pagal prisijungimo paštą).
  if (path === "/api/nariai" && method === "GET") return Response.json({ nariai: await listMembers(db) });

  // ---------- Sritys ----------

  if (path === "/api/darbai/sritys") {
    if (method === "GET") return Response.json(await listAreas(db));
    if (method === "POST") return Response.json(await createArea(db, await body()));
  }

  const area = path.match(/^\/api\/darbai\/sritys\/(\d+)$/);
  if (area) {
    if (method === "PUT") return Response.json(await updateArea(db, Number(area[1]), await body()));
    if (method === "DELETE") {
      await deleteArea(db, Number(area[1]));
      return Response.json({ ok: true });
    }
  }

  // ---------- Užduotys ----------

  if (path === "/api/darbai/uzduotys") {
    if (method === "GET") return Response.json(await listTasks(db));
    if (method === "POST") {
      const b = await body();
      const actor = await actingMember(db, b.memberId);
      const task = await createTask(db, b, actor);
      await queueAssignment(db, task, null, actor);
      return Response.json(task);
    }
  }

  if (path === "/api/darbai/siuksliadeze" && method === "GET") {
    return Response.json(await listTrash(db));
  }

  const task = path.match(/^\/api\/darbai\/uzduotys\/(\d+)(?:\/(atlikta|atsaukti|atkurti|atideti))?$/);
  if (task) {
    const taskId = Number(task[1]);
    const action = task[2];
    if (!action && method === "PATCH") {
      const b = await body();
      const actor = await actingMember(db, b.memberId);
      const before = await getTask(db, taskId);
      const updated = await updateTask(db, taskId, b, actor);
      await queueAssignment(db, updated, before?.assignee_id ?? null, actor);
      return Response.json(updated);
    }
    if (!action && method === "DELETE") {
      await deleteTask(db, taskId);
      return Response.json({ ok: true });
    }
    if (method === "POST" && action === "atlikta") {
      const b = await body();
      const actor = await actingMember(db, b.memberId);
      const before = await getTask(db, taskId);
      const done = await completeTask(db, taskId, actor);
      await queueTurn(db, done.task, before?.assignee_id ?? null, actor);
      return Response.json(done);
    }
    if (method === "POST" && action === "atsaukti") return Response.json(await undoComplete(db, taskId));
    if (method === "POST" && action === "atkurti") return Response.json(await restoreTask(db, taskId));
    if (method === "POST" && action === "atideti") {
      const b = await body();
      return Response.json(await snoozeTask(db, taskId, await actingMember(db, b.memberId), b.minutes));
    }
  }

  // ---------- Projektai ----------

  if (path === "/api/darbai/sablonai" && method === "GET") return Response.json(templateList());

  if (path === "/api/darbai/projektai") {
    if (method === "GET") {
      const deleted = new URL(request.url).searchParams.get("siuksliadeze") === "1";
      return Response.json(deleted ? await listDeletedProjects(db) : await listProjects(db));
    }
    if (method === "POST") {
      const b = await body();
      const actor = await actingMember(db, b.memberId);
      const projectId =
        typeof b.sablonas === "string" && b.sablonas
          ? await createFromTemplate(db, b.sablonas, b, actor)
          : await createProject(db, { title: b.title, goal: b.goal, areaId: b.areaId, ownerId: b.ownerId, targetDate: b.targetDate, budgetCents: b.budgetCents, notes: b.notes }, actor);
      return Response.json(await getProject(db, projectId));
    }
  }

  if (path === "/api/darbai/katiliukai" && method === "GET") return Response.json(await savingsGoalList(db));

  // ---------- Projektas ↔ bankas (7 etapas) ----------

  const bank = path.match(/^\/api\/darbai\/projektai\/(\d+)\/bankas(\/atmesti)?$/);
  if (bank) {
    const projectId = Number(bank[1]);
    if (!bank[2] && method === "GET") return Response.json(await projectBank(db, projectId, todayVilnius()));
    if (!bank[2] && method === "POST") {
      const b = await body();
      await linkTransaction(db, projectId, b, await actingMember(db, b.memberId));
      return Response.json(await projectBank(db, projectId, todayVilnius()));
    }
    if (bank[2] && method === "POST") {
      await dismissSuggestion(db, projectId, (await body()).transactionId);
      return Response.json(await projectBank(db, projectId, todayVilnius()));
    }
  }

  const txBank = path.match(/^\/api\/darbai\/bankas\/(\d+)$/);
  if (txBank) {
    const txId = Number(txBank[1]);
    if (method === "GET") return Response.json(await transactionProject(db, txId));
    if (method === "POST") {
      const b = await body();
      await linkTransaction(db, Number(b.projectId), { transactionId: txId, costId: b.costId, costName: b.costName }, await actingMember(db, b.memberId));
      return Response.json(await transactionProject(db, txId));
    }
    if (method === "DELETE") {
      await unlinkTransaction(db, txId);
      return Response.json(await transactionProject(db, txId));
    }
  }

  const project = path.match(/^\/api\/darbai\/projektai\/(\d+)(?:\/(atkurti|etapai|islaidos))?$/);
  if (project) {
    const projectId = Number(project[1]);
    const action = project[2];
    if (!action && method === "GET") {
      const data = await getProject(db, projectId);
      return Response.json({ ...data, savings: await projectSavings(db, data.project.savings_goal_id, todayVilnius()) });
    }
    if (!action && method === "PATCH") {
      await updateProject(db, projectId, await body());
      return Response.json(await getProject(db, projectId));
    }
    if (!action && method === "DELETE") {
      await deleteProject(db, projectId);
      return Response.json({ ok: true });
    }
    if (action === "atkurti" && method === "POST") {
      await restoreProject(db, projectId);
      return Response.json(await getProject(db, projectId));
    }
    if (action === "etapai" && method === "POST") return Response.json(await createSection(db, projectId, (await body()).name));
    if (action === "islaidos" && method === "POST") return Response.json(await createCost(db, projectId, await body()));
  }

  const section = path.match(/^\/api\/darbai\/etapai\/(\d+)$/);
  if (section) {
    if (method === "PATCH") return Response.json(await updateSection(db, Number(section[1]), await body()));
    if (method === "DELETE") {
      await deleteSection(db, Number(section[1]));
      return Response.json({ ok: true });
    }
  }

  const cost = path.match(/^\/api\/darbai\/islaidos\/(\d+)$/);
  if (cost) {
    if (method === "PATCH") return Response.json(await updateCost(db, Number(cost[1]), await body()));
    if (method === "DELETE") {
      await deleteCost(db, Number(cost[1]));
      return Response.json({ ok: true });
    }
  }

  // ---------- Pirkiniai ----------

  if (path === "/api/darbai/pirkiniai") {
    if (method === "GET") return Response.json(await listShopping(db));
    if (method === "POST") {
      const b = await body();
      return Response.json(await addItem(db, b, await actingMember(db, b.memberId)));
    }
  }

  const item = path.match(/^\/api\/darbai\/pirkiniai\/(\d+)$/);
  if (item) {
    if (method === "PATCH") {
      const b = await body();
      return Response.json(await updateItem(db, Number(item[1]), b, await actingMember(db, b.memberId)));
    }
    if (method === "DELETE") {
      await deleteItem(db, Number(item[1]));
      return Response.json({ ok: true });
    }
  }

  return null;
}

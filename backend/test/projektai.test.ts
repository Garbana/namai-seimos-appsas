import { describe, expect, it } from "vitest";
import { ask, confirm, undoAction } from "../src/ai/asistentas";
import type { ContentBlock, ModelCaller } from "../src/ai/modelis";
import {
  createCost,
  createFromTemplate,
  createProject,
  createSection,
  deleteProject,
  getProject,
  listDeletedProjects,
  listProjects,
  recordTaskCost,
  restoreProject,
  updateCost,
  updateProject,
} from "../src/darbai/projektai";
import { splitBudget } from "../src/darbai/sablonai";
import { completeTask, createTask, listTasks, updateTask } from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const SVENTES = 7;
/** 2026-10-10, šeštadienis. */
const NOW = new Date("2026-10-10T06:00:00Z");

const db = () => visaBaze();

function model(...responses: ContentBlock[][]): ModelCaller {
  return async () => ({ content: responses.shift() ?? [], usage: { input_tokens: 10, output_tokens: 1 }, model: "m" });
}

const tool = (id: string, name: string, input: Record<string, unknown>): ContentBlock => ({ type: "tool_use", id, name, input });

describe("projektai", () => {
  it("sukuriamas su etapais, darbais ir biudžetu; darbo kaina — susieta eilutė", async () => {
    const d = db();
    const id = await createProject(
      d,
      {
        title: "Emos gimtadienis",
        targetDate: "2026-11-07",
        budgetCents: 50000,
        areaId: SVENTES,
        ownerId: RŪTA,
        sections: [
          { name: "Vieta", tasks: [{ title: "Rezervuoti žaidimų kambarį", dueDate: "2026-10-17" }] },
          { name: "Maistas", tasks: [{ title: "Užsakyti tortą", dueDate: "2026-11-03", amountCents: 6000 }] },
        ],
        tasks: [{ title: "Nupirkti dovaną", subtasks: ["Paklausti, ko nori"] }],
        costs: [{ name: "Žaidimų kambarys", plannedCents: 20000, isEstimate: true, taskTitle: "Rezervuoti žaidimų kambarį" }],
      },
      JONAS,
      NOW
    );
    const p = await getProject(d, id);
    expect(p.project).toMatchObject({ title: "Emos gimtadienis", tasks_total: 3, tasks_done: 0, planned_cents: 26000, actual_cents: 0, next_due: "2026-10-17" });
    expect(p.sections.map((s) => s.name)).toEqual(["Vieta", "Maistas"]);
    const tortas = p.tasks.find((t) => t.title === "Užsakyti tortą")!;
    expect(tortas).toMatchObject({ project_id: id, section_id: p.sections[1].id, area_id: SVENTES });
    expect(p.costs.map((c) => [c.name, c.planned_cents, c.is_estimate, c.task_id])).toEqual([
      ["Žaidimų kambarys", 20000, 1, p.tasks.find((t) => t.title === "Rezervuoti žaidimų kambarį")!.id],
      ["Užsakyti tortą", 6000, 1, tortas.id],
    ]);
    expect(p.tasks.some((t) => t.title === "Paklausti, ko nori")).toBe(true);
    // Projekto darbai — ir bendrame užduočių sąraše.
    expect((await listTasks(d, NOW)).filter((t) => t.project_id === id)).toHaveLength(3);
  });

  it("iš šablono: terminai atgal nuo datos, biudžetas — įverčiai, sritis pagal šabloną", async () => {
    const d = db();
    const id = await createFromTemplate(d, "gimtadienis", { title: "Emos gimtadienis", targetDate: "2026-11-07", budgetCents: 50000 }, JONAS, NOW);
    const p = await getProject(d, id);
    expect(p.project).toMatchObject({ area_id: SVENTES, source: "sablonas", planned_cents: 50000, tasks_total: 9 });
    expect(p.tasks.find((t) => t.title === "Išsiųsti pakvietimus")!.due_date).toBe("2026-10-17");
    expect(p.tasks.find((t) => t.title === "Užsakyti tortą")!.due_date).toBe("2026-11-02");
    expect(p.costs.every((c) => c.is_estimate === 1)).toBe(true);
    expect(p.costs.find((c) => c.name === "Tortas")!.task_id).toBe(p.tasks.find((t) => t.title === "Užsakyti tortą")!.id);
  });

  it("šablonas artėjančiai datai — praėję terminai tampa šiandiena", async () => {
    const d = db();
    const id = await createFromTemplate(d, "gimtadienis", { targetDate: "2026-10-15" }, JONAS, NOW);
    const p = await getProject(d, id);
    expect(p.project.title).toBe("Vaiko gimtadienis");
    expect(p.tasks.find((t) => t.title === "Išsiųsti pakvietimus")!.due_date).toBe("2026-10-10");
    expect(p.costs.every((c) => c.planned_cents === null)).toBe(true);
  });

  it("biudžeto padalijimas — sveikais eurais, suma tiksli", () => {
    const parts = splitBudget(33333, [40, 12, 20, 8, 10, 10]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(33333);
    expect(parts.slice(0, -1).every((x) => x % 100 === 0)).toBe(true);
  });

  it("biudžeto eilutė: pataisytas planas nebe įvertis; darbo kaina — į faktą", async () => {
    const d = db();
    const id = await createProject(d, { title: "Remontas" }, JONAS, NOW);
    const c = await createCost(d, id, { name: "Dažai", plannedCents: 8000, isEstimate: true });
    expect(await updateCost(d, c.id, { plannedCents: 9500 })).toMatchObject({ planned_cents: 9500, is_estimate: 0 });

    const t = await createTask(d, { title: "Nupirkti grindis", projectId: id }, JONAS, NOW);
    expect(await recordTaskCost(d, t.id, 120000)).toMatchObject({ created: true, previousActual: null });
    const again = await recordTaskCost(d, t.id, 125000);
    expect(again).toMatchObject({ created: false, previousActual: 120000 });
    expect((await getProject(d, id)).project.actual_cents).toBe(125000);
    expect(await recordTaskCost(d, (await createTask(d, { title: "Be projekto" }, JONAS, NOW)).id, 100)).toBeNull();
  });

  it("darbas kitame projekte — etapas atsistato; svetimas etapas — klaida", async () => {
    const d = db();
    const a = await createProject(d, { title: "A" }, JONAS, NOW);
    const b = await createProject(d, { title: "B" }, JONAS, NOW);
    const sa = await createSection(d, a, "Etapas A");
    const t = await createTask(d, { title: "Darbas", projectId: a, sectionId: sa.id }, JONAS, NOW);
    await expect(createTask(d, { title: "x", projectId: b, sectionId: sa.id }, JONAS, NOW)).rejects.toThrow("ne to projekto");
    expect(await updateTask(d, t.id, { projectId: b }, JONAS, NOW)).toMatchObject({ project_id: b, section_id: null });
  });

  it("ištrintas — į šiukšliadėžę su darbais; atkuriamas kartu", async () => {
    const d = db();
    const id = await createProject(d, { title: "Atostogos", sections: [{ name: "Planas", tasks: [{ title: "Bilietai" }] }] }, JONAS, NOW);
    await deleteProject(d, id, NOW);
    expect(await listProjects(d)).toEqual([]);
    expect((await listTasks(d, NOW)).filter((t) => t.project_id === id)).toEqual([]);
    expect((await listDeletedProjects(d, NOW)).map((p) => p.id)).toEqual([id]);
    await restoreProject(d, id, NOW);
    expect((await listTasks(d, NOW)).filter((t) => t.project_id === id).map((t) => t.title)).toEqual(["Bilietai"]);
  });

  it("suvestinė: atlikti darbai, baigtas projektas", async () => {
    const d = db();
    const id = await createProject(d, { title: "P", tasks: [{ title: "1" }, { title: "2" }] }, JONAS, NOW);
    const [first] = (await getProject(d, id)).tasks;
    await completeTask(d, first.id, JONAS, NOW);
    expect((await listProjects(d))[0]).toMatchObject({ tasks_total: 2, tasks_done: 1 });
    expect(await updateProject(d, id, { status: "baigtas" }, NOW)).toMatchObject({ status: "baigtas", finished_at: NOW.toISOString() });
  });
});

describe("projektai per asistentą", () => {
  it("pasiūlo projektą; patvirtinus sukuriamas, atšaukus — į šiukšliadėžę", async () => {
    const d = db();
    const m = model([
      tool("p1", "create_project", {
        title: "Emos gimtadienis",
        target_date: "2026-11-07",
        budget_eur: 500,
        area_id: SVENTES,
        owner_id: RŪTA,
        sections: [
          { name: "Vieta", tasks: [{ title: "Rezervuoti žaidimų kambarį", due_date: "2026-10-17", amount_eur: 200 }] },
          { name: "Maistas", tasks: [{ title: "Užsakyti tortą", due_date: "2026-11-03" }] },
        ],
        costs: [
          { name: "Tortas", planned_eur: 60, is_estimate: true, task_title: "Užsakyti tortą" },
          { name: "Rezervas", planned_eur: 50 },
        ],
      }),
    ]);
    const r = await ask(d, m, { tekstas: "Emos gimtadienis lapkričio 7, 500 €", memberId: JONAS }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ tipas: "projektas", busena: "laukia", pavadinimas: "Emos gimtadienis" });
    expect(await listProjects(d)).toEqual([]);

    const c = await confirm(d, r.id, { memberId: JONAS }, NOW);
    const projectId = c.veiksmai[0].projektasId!;
    const p = await getProject(d, projectId);
    expect(p.project).toMatchObject({ source: "ai", budget_cents: 50000, owner_id: RŪTA, tasks_total: 2, planned_cents: 31000 });
    expect(p.costs.find((x) => x.name === "Tortas")!.task_id).toBe(p.tasks.find((t) => t.title === "Užsakyti tortą")!.id);

    await undoAction(d, r.id, "p1", JONAS, NOW);
    expect(await listProjects(d)).toEqual([]);
  });

  it("netinkamas projekto planas — klaida kortelėje", async () => {
    const d = db();
    const r = await ask(d, model([tool("p2", "create_project", { title: "X", target_date: "2026-13-40" })]), { tekstas: "…", memberId: JONAS }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ busena: "klaida", klaida: "Netinkama projekto data." });
  });

  it("darbas į esamą projektą — etapas pagal pavadinimą (naujas sukuriamas)", async () => {
    const d = db();
    const id = await createProject(d, { title: "Gimtadienis", areaId: SVENTES, sections: [{ name: "Dekoracijos" }] }, JONAS, NOW);
    const r = await ask(
      d,
      model([tool("t1", "create_task", { title: "Nupirkti balionų", project_id: id, section: "dekoracijos" }), tool("t2", "create_task", { title: "Pasirūpinti muzika", project_id: id, section: "Pramogos" })]),
      { tekstas: "…", memberId: JONAS },
      NOW
    );
    await confirm(d, r.id, { memberId: JONAS }, NOW);
    const p = await getProject(d, id);
    expect(p.sections.map((s) => s.name)).toEqual(["Dekoracijos", "Pramogos"]);
    expect(p.tasks.find((t) => t.title === "Nupirkti balionų")).toMatchObject({ section_id: p.sections[0].id, area_id: SVENTES });
  });

  it("„tortą užsakiau už 65“ — darbas atliktas, suma į projekto biudžeto faktą; atšaukus grįžta", async () => {
    const d = db();
    const id = await createFromTemplate(d, "gimtadienis", { targetDate: "2026-11-07", budgetCents: 50000 }, JONAS, NOW);
    const tortas = (await getProject(d, id)).tasks.find((t) => t.title === "Užsakyti tortą")!;
    const r = await ask(d, model([tool("a1", "complete_task", { task_id: tortas.id, amount_eur: 65 })]), { tekstas: "Tortą užsakiau už 65", memberId: RŪTA }, NOW);
    expect(r.veiksmai[0].busena).toBe("ivykdyta");
    let p = await getProject(d, id);
    expect(p.costs.find((c) => c.name === "Tortas")!.actual_cents).toBe(6500);
    expect(p.tasks.find((t) => t.id === tortas.id)).toMatchObject({ status: "atlikta", amount_cents: null });

    await undoAction(d, r.id, "a1", RŪTA, NOW);
    p = await getProject(d, id);
    expect(p.costs.find((c) => c.name === "Tortas")!.actual_cents).toBeNull();
    expect(p.tasks.find((t) => t.id === tortas.id)!.status).toBe("atvira");
  });

  it("išlaida be darbo — į esamą eilutę ar naują; atšaukiama", async () => {
    const d = db();
    const id = await createProject(d, { title: "Jubiliejus", costs: [{ name: "Salė", plannedCents: 30000 }] }, JONAS, NOW);
    const sale = (await getProject(d, id)).costs[0];
    const r = await ask(
      d,
      model([tool("c1", "record_project_cost", { project_id: id, cost_id: sale.id, actual_eur: 200 }), tool("c2", "record_project_cost", { project_id: id, name: "Muzikantai", actual_eur: 150 })]),
      { tekstas: "Už salę sumokėjom 200, muzikantams 150", memberId: JONAS },
      NOW
    );
    expect(r.veiksmai.map((v) => [v.tipas, v.busena])).toEqual([
      ["islaida", "ivykdyta"],
      ["islaida", "ivykdyta"],
    ]);
    expect((await getProject(d, id)).project.actual_cents).toBe(35000);
    await undoAction(d, r.id, "c1", JONAS, NOW);
    await undoAction(d, r.id, "c2", JONAS, NOW);
    const p = await getProject(d, id);
    expect(p.project.actual_cents).toBe(0);
    expect(p.costs.map((c) => c.name)).toEqual(["Salė"]);
  });
});

import { describe, expect, it } from "vitest";
import { todayVilnius } from "../src/darbai/bendra";
import { addItem, listShopping, updateItem } from "../src/darbai/pirkiniai";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  listTrash,
  restoreTask,
  taskValues,
  undoComplete,
  updateTask,
} from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
/** 2026-10-09, penktadienis, vakaras Vilniuje. */
const NOW = new Date("2026-10-09T18:00:00Z");

const db = () => visaBaze();

describe("užduoties laukai", () => {
  it("reikalauja pavadinimo ir tvarko laukus", () => {
    expect(() => taskValues({ title: "   " }, null)).toThrow("pavadinimo");
    const v = taskValues({ title: " Dantistė ", dueDate: "2026-10-16", dueTime: "15:00", priority: "svarbu" }, null);
    expect(v).toMatchObject({ title: "Dantistė", due_date: "2026-10-16", due_time: "15:00", priority: "svarbu" });
  });

  it("laikas be datos neišsaugomas, pakartojimui reikia termino", () => {
    expect(taskValues({ title: "x", dueTime: "15:00" }, null).due_time).toBeNull();
    expect(() => taskValues({ title: "x", recurrence: "FREQ=WEEKLY" }, null)).toThrow("termino");
    expect(() => taskValues({ title: "x", dueDate: "2026-02-31" }, null)).toThrow("data");
    expect(() => taskValues({ title: "x", dueDate: "2026-10-16", dueTime: "25:00" }, null)).toThrow("laikas");
    expect(taskValues({ title: "x", dueDate: "2026-10-10", recurrence: "freq=weekly;byday=sa" }, null).recurrence).toBe(
      "FREQ=WEEKLY;BYDAY=SA"
    );
  });

  it("keičiant nenurodyti laukai lieka", async () => {
    const d = db();
    const t = await createTask(d, { title: "Batai", dueDate: "2026-10-11", amountCents: 5000, assigneeId: RŪTA }, JONAS, NOW);
    const u = await updateTask(d, t.id, { title: "Batai Emai" }, JONAS, NOW);
    expect(u).toMatchObject({ title: "Batai Emai", due_date: "2026-10-11", amount_cents: 5000, assignee_id: RŪTA });
  });
});

describe("atlikimas ir atšaukimas", () => {
  it("paprasta užduotis: atlikta, atšaukus — vėl atvira", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16" }, JONAS, NOW);

    const done = await completeTask(d, t.id, RŪTA, NOW);
    expect(done.task).toMatchObject({ status: "atlikta", completed_by: RŪTA });
    expect(done.nextDue).toBeNull();

    const back = await undoComplete(d, t.id);
    expect(back).toMatchObject({ status: "atvira", completed_at: null, completed_by: null });
    await expect(undoComplete(d, t.id)).rejects.toThrow("Nėra ką atšaukti");
  });

  it("kas šeštadienį: terminas pasislenka, použduotys nuimamos, atšaukus viskas grįžta", async () => {
    const d = db();
    const t = await createTask(d, { title: "Siurbti", dueDate: "2026-10-10", recurrence: "FREQ=WEEKLY;BYDAY=SA" }, JONAS, NOW);
    const sub = await createTask(d, { title: "Svetainė", parentId: t.id }, JONAS, NOW);
    await updateTask(d, sub.id, { status: "atlikta" }, JONAS, NOW);

    const done = await completeTask(d, t.id, JONAS, NOW);
    expect(done.nextDue).toBe("2026-10-17");
    expect(done.task).toMatchObject({ status: "atvira", due_date: "2026-10-17", completed_by: JONAS });
    expect((await getTask(d, sub.id))!.status).toBe("atvira");

    await undoComplete(d, t.id);
    expect((await getTask(d, t.id))!).toMatchObject({ due_date: "2026-10-10", completed_at: null });
    expect((await getTask(d, sub.id))!).toMatchObject({ status: "atlikta", completed_by: JONAS });
  });

  it("pavėluota pasikartojanti — kitas terminas po šiandienos", async () => {
    const d = db();
    const t = await createTask(d, { title: "Kraikas", dueDate: "2026-09-01", recurrence: "FREQ=DAILY;INTERVAL=2" }, JONAS, NOW);
    const done = await completeTask(d, t.id, JONAS, NOW);
    expect(done.nextDue! > todayVilnius(NOW)).toBe(true);
    expect(done.nextDue).toBe("2026-10-11");
  });

  it("použduotis užbaigiama tik varnele", async () => {
    const d = db();
    const t = await createTask(d, { title: "Gimtadienis" }, JONAS, NOW);
    const sub = await createTask(d, { title: "Pakvietimai", parentId: t.id, dueDate: "2026-10-17" }, JONAS, NOW);
    expect(sub.due_date).toBeNull();
    await expect(completeTask(d, sub.id, JONAS, NOW)).rejects.toThrow("varnele");
    await expect(createTask(d, { title: "Gilyn", parentId: sub.id }, JONAS, NOW)).rejects.toThrow("Použduotis negali");
    await expect(updateTask(d, t.id, { status: "atlikta" }, JONAS, NOW)).rejects.toThrow("mygtuku");
  });
});

describe("sąrašas ir šiukšliadėžė", () => {
  it("sąraše — atviros ir neseniai atliktos, senai atliktų nėra", async () => {
    const d = db();
    const a = await createTask(d, { title: "Atvira" }, JONAS, NOW);
    const b = await createTask(d, { title: "Ką tik atlikta" }, JONAS, NOW);
    const c = await createTask(d, { title: "Seniai atlikta" }, JONAS, NOW);
    await completeTask(d, b.id, JONAS, NOW);
    await completeTask(d, c.id, JONAS, new Date("2026-09-01T10:00:00Z"));

    const ids = (await listTasks(d, NOW)).map((t) => t.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id);
  });

  it("ištrinta — su použduotimis į šiukšliadėžę, atkuriama kartu; po 30 d. dingsta", async () => {
    const d = db();
    const t = await createTask(d, { title: "Remontas" }, JONAS, NOW);
    const sub = await createTask(d, { title: "Dažai", parentId: t.id }, JONAS, NOW);

    await deleteTask(d, t.id, NOW);
    expect((await listTasks(d, NOW)).map((x) => x.id)).not.toContain(t.id);
    expect((await listTrash(d, NOW)).map((x) => x.id)).toEqual([t.id]);

    await restoreTask(d, t.id);
    expect((await getTask(d, sub.id))!.deleted_at).toBeNull();

    await deleteTask(d, t.id, NOW);
    expect(await listTrash(d, new Date("2026-11-20T00:00:00Z"))).toEqual([]);
    expect(await getTask(d, t.id)).toBeNull();
    expect(await getTask(d, sub.id)).toBeNull();
  });
});

describe("pirkiniai", () => {
  it("ta pati prekė nesidubliuoja, nupirkta grįžta į sąrašą", async () => {
    const d = db();
    const pienas = await addItem(d, { listId: 1, name: "Pienas", quantity: "2 l" }, JONAS, NOW);
    await updateItem(d, pienas.id, { checked: true }, RŪTA, NOW);

    const vel = await addItem(d, { listId: 1, name: " pienas " }, RŪTA, NOW);
    expect(vel.id).toBe(pienas.id);
    expect(vel).toMatchObject({ checked_at: null, added_by: RŪTA, quantity: null });

    const šokoladas = await addItem(d, { listId: 1, name: "Šokoladas" }, JONAS, NOW);
    expect((await addItem(d, { listId: 1, name: "šokoladas" }, JONAS, NOW)).id).toBe(šokoladas.id);
    expect((await listShopping(d, NOW)).items).toHaveLength(2);
  });

  it("nupirktos rodomos 30 d.", async () => {
    const d = db();
    const sena = await addItem(d, { listId: 2, name: "Indų tabletės" }, JONAS, NOW);
    await updateItem(d, sena.id, { checked: true }, JONAS, new Date("2026-08-01T10:00:00Z"));
    expect((await listShopping(d, NOW)).items).toEqual([]);
  });
});


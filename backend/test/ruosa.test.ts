import { describe, expect, it } from "vitest";
import { ask } from "../src/ai/asistentas";
import type { ContentBlock, ModelCaller } from "../src/ai/modelis";
import { queueTurn } from "../src/pranesimai/pranesimai";
import { completeTask, createTask, getTask, nextInRotation, undoComplete, updateTask } from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const EMA = 3;
/** 2026-10-10, šeštadienis, 9:00 Vilniuje. */
const NOW = new Date("2026-10-10T06:00:00Z");

const db = () =>
  visaBaze();

function model(...responses: ContentBlock[][]): ModelCaller {
  return async () => ({ content: responses.shift() ?? [], usage: { input_tokens: 10, output_tokens: 1 }, model: "m" });
}

describe("ruoša", () => {
  it("ruošai būtinas pakartojimas; „pakaitomis“ — atsakingas pirmas eilėje", async () => {
    const d = db();
    await expect(createTask(d, { title: "Vonia", chore: true }, JONAS, NOW)).rejects.toThrow("kaip dažnai");
    const t = await createTask(
      d,
      { title: "Vonia", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=WEEKLY;INTERVAL=2", rotationMembers: [RŪTA, JONAS] },
      JONAS,
      NOW
    );
    expect(t).toMatchObject({ chore: 1, assignee_id: RŪTA, rotation_members: "[2,1]", repeat_after_done: 0 });
    // Vienas žmogus eilėje — tiesiog jo darbas.
    const one = await createTask(d, { title: "Gėlės", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=WEEKLY", rotationMembers: [JONAS] }, JONAS, NOW);
    expect(one).toMatchObject({ assignee_id: JONAS, rotation_members: null });
    await expect(createTask(d, { title: "X", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=DAILY", rotationMembers: [1, 99] }, JONAS, NOW)).rejects.toThrow(
      "šeimos nario"
    );
  });

  it("atlikus — kitam eilėje ir kitas terminas; „Atšaukti“ grąžina ir eilę", async () => {
    const d = db();
    const t = await createTask(
      d,
      { title: "Kačių kraikas", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=DAILY;INTERVAL=2", rotationMembers: [JONAS, RŪTA] },
      JONAS,
      NOW
    );
    const done = await completeTask(d, t.id, JONAS, NOW);
    expect(done.task).toMatchObject({ assignee_id: RŪTA, due_date: "2026-10-12", status: "atvira", completed_by: JONAS });
    await undoComplete(d, t.id, NOW);
    expect(await getTask(d, t.id)).toMatchObject({ assignee_id: JONAS, due_date: "2026-10-10" });

    // Rūta padarė už Joną — kitas kartas vėl Jono.
    expect((await completeTask(d, t.id, RŪTA, NOW)).task.assignee_id).toBe(JONAS);
  });

  it("eilė: po to, kas atliko; jei atliko ne iš eilės — po buvusio atsakingo", () => {
    expect(nextInRotation([1, 2, 3], 2, 1)).toBe(3);
    expect(nextInRotation([1, 2, 3], 3, 3)).toBe(1);
    expect(nextInRotation([1, 2], null, 2)).toBe(1);
    expect(nextInRotation([1, 2], 9, 1)).toBe(2);
  });

  it("„po atlikimo“ — kitas terminas nuo atlikimo dienos, ne nuo grafiko", async () => {
    const d = db();
    const filtras = await createTask(
      d,
      { title: "Pakeisti vandens filtrą", chore: true, dueDate: "2026-10-01", recurrence: "FREQ=DAILY;INTERVAL=90", repeatAfterDone: true },
      JONAS,
      NOW
    );
    expect((await completeTask(d, filtras.id, JONAS, NOW)).nextDue).toBe("2027-01-08");
    // Be „po atlikimo“ — nuo grafiko (pavėlavus — pirmas po šiandienos).
    const kitas = await createTask(d, { title: "Šaldytuvas", chore: true, dueDate: "2026-10-01", recurrence: "FREQ=DAILY;INTERVAL=30" }, JONAS, NOW);
    expect((await completeTask(d, kitas.id, JONAS, NOW)).nextDue).toBe("2026-10-31");
    await expect(updateTask(d, kitas.id, { recurrence: null, repeatAfterDone: true }, JONAS, NOW)).rejects.toThrow();
  });

  it("„Tavo eilė“ — pranešimas kitam eilėje, bet ne sau", async () => {
    const d = db();
    const t = await createTask(
      d,
      { title: "Vonia", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=WEEKLY", rotationMembers: [JONAS, RŪTA] },
      JONAS,
      NOW
    );
    const { task } = await completeTask(d, t.id, JONAS, NOW);
    await queueTurn(d, task, JONAS, JONAS, NOW);
    const { results } = await d.prepare("SELECT member_id, title, body, url FROM push_outbox").all();
    expect(results).toEqual([{ member_id: RŪTA, title: "Tavo eilė: Vonia", body: "Kitą kartą — spalio 17 d.", url: "/?skiltis=ruosa" }]);

    // Ema appsu nesinaudoja — jai pranešimo nėra.
    const a = await createTask(d, { title: "Žaislai", chore: true, dueDate: "2026-10-10", recurrence: "FREQ=DAILY", rotationMembers: [RŪTA, EMA] }, JONAS, NOW);
    const after = (await completeTask(d, a.id, RŪTA, NOW)).task;
    await queueTurn(d, after, RŪTA, RŪTA, NOW);
    expect((await d.prepare("SELECT COUNT(*) AS n FROM push_outbox").first<{ n: number }>())!.n).toBe(1);
  });

  it("katinukas: „vonią valom pakaitomis kas dvi savaites“ — ruoša su eile", async () => {
    const d = db();
    const r = await ask(
      d,
      model([
        {
          type: "tool_use",
          id: "r1",
          name: "create_task",
          input: { title: "Išvalyti vonią", chore: true, due_date: "2026-10-10", recurrence: "FREQ=WEEKLY;INTERVAL=2", rotation_member_ids: [JONAS, RŪTA] },
        },
      ]),
      { tekstas: "Vonią valom pakaitomis kas dvi savaites", memberId: JONAS },
      NOW
    );
    expect(r.veiksmai[0]).toMatchObject({ tipas: "sukurti", busena: "laukia", laukai: { chore: true, rotationMembers: [JONAS, RŪTA] } });
  });
});

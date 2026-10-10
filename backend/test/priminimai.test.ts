import { describe, expect, it } from "vitest";
import { vilniusNow, vilniusToUtc } from "../src/darbai/bendra";
import { reminderSpecs, remindAt, snoozeTask } from "../src/darbai/priminimai";
import { completeTask, createTask, deleteTask, getTask, restoreTask, undoComplete, updateTask } from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
/** 2026-10-09, penktadienis, 21:00 Vilniuje. */
const NOW = new Date("2026-10-09T18:00:00Z");

const db = () => visaBaze();

const rows = async (d: D1Database, taskId: number) =>
  (
    await d
      .prepare("SELECT spec, member_id, remind_at, sent_at FROM task_reminders WHERE task_id = ? ORDER BY id")
      .bind(taskId)
      .all()
  ).results;

describe("Vilniaus laikas", () => {
  it("vietinis ↔ UTC, ir per laiko pakeitimą", () => {
    expect(vilniusNow(NOW)).toEqual({ date: "2026-10-09", time: "21:00" });
    expect(vilniusNow(new Date("2026-12-31T22:30:00Z"))).toEqual({ date: "2027-01-01", time: "00:30" });
    expect(vilniusToUtc("2026-10-16", "15:00").toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(vilniusToUtc("2026-12-01", "07:30").toISOString()).toBe("2026-12-01T05:30:00.000Z");
    // 2026-10-25 4:00 laikrodžiai atsukami į 3:00: 3:30 būna dukart — imamas antrasis.
    expect(vilniusToUtc("2026-10-25", "03:30").toISOString()).toBe("2026-10-25T01:30:00.000Z");
    // 2027-03-28 3:00 → 4:00: 3:30 nėra — pasislenka į 4:30.
    expect(vilniusToUtc("2027-03-28", "03:30").toISOString()).toBe("2027-03-28T01:30:00.000Z");
  });
});

describe("priminimo momentas", () => {
  it("prieš terminą minutėmis ar dienomis nurodytą valandą", () => {
    expect(remindAt("60m", "2026-10-16", "15:00")).toBe("2026-10-16T11:00:00.000Z");
    expect(remindAt("0m", "2026-10-16", "15:00")).toBe("2026-10-16T12:00:00.000Z");
    expect(remindAt("1d@18:00", "2026-10-16", "15:00")).toBe("2026-10-15T15:00:00.000Z");
    expect(remindAt("0d@09:00", "2026-10-16", null)).toBe("2026-10-16T06:00:00.000Z");
    expect(remindAt("1d@18:00", "2026-11-01", null)).toBe("2026-10-31T16:00:00.000Z");
  });

  it("per laiko pakeitimą kiekvienas momentas — su savo laiku", () => {
    // Terminas po pakeitimo (žiemos laikas), priminimas savaitę prieš — dar vasaros.
    expect(remindAt("7d@18:00", "2026-10-30", null)).toBe("2026-10-23T15:00:00.000Z");
    expect(remindAt("1d@18:00", "2026-10-26", "09:00")).toBe("2026-10-25T16:00:00.000Z");
  });

  it("be laiko ar termino — neįmanomas", () => {
    expect(remindAt("60m", "2026-10-16", null)).toBeNull();
    expect(remindAt("1d@18:00", null, null)).toBeNull();
    expect(remindAt("blogas", "2026-10-16", "15:00")).toBeNull();
  });

  it("tikrina iš appso atsiųstą sąrašą", () => {
    expect(reminderSpecs(["60m", " 1d@18:00", "060m"])).toEqual(["60m", "1d@18:00"]);
    expect(() => reminderSpecs(["1d@25:00"])).toThrow("Netinkamas priminimas");
    expect(() => reminderSpecs(["99d@09:00"])).toThrow("Netinkamas priminimas");
    expect(() => reminderSpecs("60m")).toThrow("Netinkami");
    expect(() => reminderSpecs(["0m", "5m", "10m", "15m", "30m", "60m"])).toThrow("Daugiausia");
  });
});

describe("priminimai užduotyse", () => {
  it("sukuriant apskaičiuojami; jau praėjęs nebesiunčiamas", async () => {
    const d = db();
    // Penktadienio 21:00; terminas šeštadienį 10:00.
    const t = await createTask(
      d,
      { title: "Kirpykla", dueDate: "2026-10-10", dueTime: "10:00", reminders: ["60m", "1d@18:00"] },
      JONAS,
      NOW
    );
    expect(t.reminders).toEqual(["60m", "1d@18:00"]);
    expect(await rows(d, t.id)).toEqual([
      { spec: "60m", member_id: null, remind_at: "2026-10-10T06:00:00.000Z", sent_at: null },
      { spec: "1d@18:00", member_id: null, remind_at: "2026-10-09T15:00:00.000Z", sent_at: NOW.toISOString() },
    ]);
  });

  it("použduotis priminimų neturi", async () => {
    const d = db();
    const t = await createTask(d, { title: "Gimtadienis", dueDate: "2026-11-10" }, JONAS, NOW);
    const p = await createTask(d, { title: "Tortas", parentId: t.id, reminders: ["1d@18:00"] }, JONAS, NOW);
    expect(p.reminders).toEqual([]);
  });

  it("pakeitus terminą pasislenka; pakeitus kitką — suėjęs, dar neišsiųstas neprarandamas", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] }, JONAS, NOW);

    // 14:01 — priminimas (14:00) suėjo, bet laikmatis jo dar neišsiuntė.
    const at = new Date("2026-10-16T11:01:00Z");
    await updateTask(d, t.id, { title: "Dantistė (Rūta)" }, JONAS, at);
    expect((await rows(d, t.id))[0]).toMatchObject({ remind_at: "2026-10-16T11:00:00.000Z", sent_at: null });

    await updateTask(d, t.id, { dueDate: "2026-10-23" }, JONAS, at);
    expect((await rows(d, t.id))[0]).toMatchObject({ remind_at: "2026-10-23T11:00:00.000Z", sent_at: null });

    // Nuėmus laiką „prieš 1 val.“ nebeįmanomas, bet lieka — grąžinus laiką vėl veiks.
    await updateTask(d, t.id, { dueTime: null }, JONAS, at);
    expect((await rows(d, t.id))[0]).toMatchObject({ remind_at: null, sent_at: null });

    const u = await updateTask(d, t.id, { reminders: [] }, JONAS, at);
    expect(u.reminders).toEqual([]);
    expect(await rows(d, t.id)).toEqual([]);
  });

  it("pasikartojanti: užbaigus — kito karto priminimas, atšaukus — grįžta, bet iš naujo nesiunčiamas", async () => {
    const d = db();
    const t = await createTask(
      d,
      { title: "Šiukšlės", dueDate: "2026-10-10", dueTime: "09:00", recurrence: "FREQ=WEEKLY;BYDAY=SA", reminders: ["60m"] },
      JONAS,
      NOW
    );
    // Šeštadienio 8:00 priminimas išsiųstas.
    await d.prepare("UPDATE task_reminders SET sent_at = ? WHERE task_id = ?").bind("2026-10-10T05:00:00.000Z", t.id).run();

    const at = new Date("2026-10-10T08:00:00Z");
    await completeTask(d, t.id, JONAS, at);
    expect((await rows(d, t.id))[0]).toMatchObject({ remind_at: "2026-10-17T05:00:00.000Z", sent_at: null });

    await undoComplete(d, t.id, at);
    expect((await rows(d, t.id))[0]).toMatchObject({ remind_at: "2026-10-10T05:00:00.000Z", sent_at: at.toISOString() });
  });

  it("paprasta: atlikta — nebesiunčiamas; atšaukus iki laiko — vėl laukia, po laiko — ne", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] }, JONAS, NOW);

    await completeTask(d, t.id, RŪTA, NOW);
    expect((await rows(d, t.id))[0].sent_at).toBe(NOW.toISOString());
    await undoComplete(d, t.id, NOW);
    expect((await rows(d, t.id))[0].sent_at).toBeNull();

    await completeTask(d, t.id, RŪTA, NOW);
    await undoComplete(d, t.id, new Date("2026-10-16T13:00:00Z"));
    expect((await rows(d, t.id))[0].sent_at).toBe(NOW.toISOString());
  });

  it("ištrinta — nebesiunčiamas; atkūrus iki laiko — vėl laukia", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] }, JONAS, NOW);
    await deleteTask(d, t.id, NOW);
    expect((await rows(d, t.id))[0].sent_at).toBe(NOW.toISOString());
    await restoreTask(d, t.id, NOW);
    expect((await rows(d, t.id))[0].sent_at).toBeNull();
  });

  it("atidėti: vienkartinis, tik atidėjusiam, nerodomas tarp nustatytų", async () => {
    const d = db();
    const t = await createTask(d, { title: "Paskambinti draudikui" }, JONAS, NOW);
    expect(await snoozeTask(d, t.id, RŪTA, 60, NOW)).toEqual({ remindAt: "2026-10-09T19:00:00.000Z" });
    expect(await rows(d, t.id)).toEqual([{ spec: null, member_id: RŪTA, remind_at: "2026-10-09T19:00:00.000Z", sent_at: null }]);
    expect((await getTask(d, t.id))!.reminders).toEqual([]);

    await expect(snoozeTask(d, t.id, RŪTA, 2, NOW)).rejects.toThrow("atidėjimo");
    await completeTask(d, t.id, RŪTA, NOW);
    expect((await rows(d, t.id))[0].sent_at).toBe(NOW.toISOString());
    await expect(snoozeTask(d, t.id, RŪTA, 60, NOW)).rejects.toThrow("jau atlikta");
  });
});

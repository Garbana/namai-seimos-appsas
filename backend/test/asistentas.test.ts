import { describe, expect, it } from "vitest";
import { ask, confirm, DAILY_LIMIT, history, reject, undoAction } from "../src/ai/asistentas";
import { buildContext, calendar } from "../src/ai/kontekstas";
import { ModelioKlaida, type ContentBlock, type ModelCaller, type ModelRequest } from "../src/ai/modelis";
import { addItem } from "../src/darbai/pirkiniai";
import { createTask, getTask, listTasks } from "../src/darbai/uzduotys";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const SVEIKATA = 3;
const MAISTAS = 1;
/** 2026-10-10, šeštadienis, 9:00 Vilniuje. */
const NOW = new Date("2026-10-10T06:00:00Z");

const db = () => visaBaze();

let toolId = 0;
const tool = (name: string, input: Record<string, unknown>): ContentBlock => ({ type: "tool_use", id: `t${++toolId}`, name, input });
const say = (text: string): ContentBlock => ({ type: "text", text });

/** Modelis testams: atsako iš eilės nurodytais atsakymais ir įsimena užklausas. */
function fakeModel(...responses: (ContentBlock[] | Error)[]) {
  const requests: ModelRequest[] = [];
  const call: ModelCaller = async (request) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("Daugiau atsakymų nėra");
    if (next instanceof Error) throw next;
    return { content: next, usage: { input_tokens: 4000, output_tokens: 300 }, model: "claude-haiku-5-5" };
  };
  return { call, requests };
}

describe("kontekstas", () => {
  it("kalendorius pažymi savaites — „kitą penktadienį“ randama lentelėje", () => {
    const lines = calendar("2026-10-10").split("\n");
    expect(lines[0]).toBe("2026-10-10 šeštadienis (ši savaitė, šiandien)");
    expect(lines[1]).toBe("2026-10-11 sekmadienis (ši savaitė, rytoj)");
    expect(lines[2]).toBe("2026-10-12 pirmadienis (kita savaitė, poryt)");
    expect(lines).toContain("2026-10-16 penktadienis (kita savaitė)");
    expect(lines).toContain("2026-10-23 penktadienis (po dviejų savaičių)");
    expect(lines).toHaveLength(21);
  });

  it("mato kalbantįjį, sritis, užduotis ir pirkinius su id", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", assigneeId: RŪTA, reminders: ["60m"] }, JONAS, NOW);
    await addItem(d, { listId: MAISTAS, name: "pienas", quantity: "2 l" }, JONAS, NOW);
    const context = await buildContext(d, JONAS, NOW);
    expect(context).toContain("Dabar: 2026-10-10, šeštadienis, 09:00");
    expect(context).toContain("Kalba: Jonas (id 1)");
    expect(context).toContain("2 Vaikai — Rūta");
    expect(context).toContain(`#${t.id} Dantistė | terminas 2026-10-16 penktadienis 15:00 | atsakingas Rūta | priminimai 60m`);
    expect(context).toMatch(/sąrašas 1 Maistas: #\d+ pienas \(2 l\)/);
  });
});

describe("asistentas", () => {
  it("nauja užduotis — tik pasiūlymas; patvirtinus įrašoma (su priminimais, použduotimis ir pranešimu Rūtai)", async () => {
    const d = db();
    const m = fakeModel([
      say("Paruošiau."),
      tool("create_task", {
        title: "Dantistė",
        due_date: "2026-10-16",
        due_time: "15:00",
        assignee_id: RŪTA,
        area_id: SVEIKATA,
        reminders: ["1d@18:00", "60m"],
        subtasks: ["Paimti siuntimą"],
      }),
    ]);
    const r = await ask(d, m.call, { tekstas: "Kitą penktadienį Rūtai pas dantistę 15 val.", memberId: JONAS }, NOW);

    expect(r.atsakymas).toBe("Paruošiau.");
    expect(r.veiksmai).toHaveLength(1);
    expect(r.veiksmai[0]).toMatchObject({
      tipas: "sukurti",
      busena: "laukia",
      pavadinimas: "Dantistė",
      laukai: { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", assigneeId: RŪTA, reminders: ["1d@18:00", "60m"] },
      pouzduotys: ["Paimti siuntimą"],
    });
    expect(r.veiksmai[0]).not.toHaveProperty("atsaukimas");
    expect(await listTasks(d, NOW)).toEqual([]);

    const c = await confirm(d, r.id, { memberId: JONAS }, NOW);
    expect(c.veiksmai[0].busena).toBe("ivykdyta");
    const task = (await getTask(d, c.veiksmai[0].uzduotisId!))!;
    expect(task).toMatchObject({ title: "Dantistė", source: "ai", created_by: JONAS, reminders: ["1d@18:00", "60m"] });
    expect((await listTasks(d, NOW)).filter((t) => t.parent_id === task.id).map((t) => t.title)).toEqual(["Paimti siuntimą"]);
    const outbox = await d.prepare("SELECT member_id, title FROM push_outbox").all();
    expect(outbox.results).toEqual([{ member_id: RŪTA, title: "Jonas priskyrė tau darbą" }]);

    // Atšaukus — į šiukšliadėžę.
    const u = await undoAction(d, r.id, c.veiksmai[0].id, JONAS, NOW);
    expect(u.veiksmai[0].busena).toBe("atsaukta");
    expect((await getTask(d, task.id))!.deleted_at).not.toBeNull();
  });

  it("„Taisyti“: patvirtinama su žmogaus pataisytais laukais", async () => {
    const d = db();
    const m = fakeModel([tool("create_task", { title: "Batai", due_date: "2026-10-17" })]);
    const r = await ask(d, m.call, { tekstas: "Emai batų", memberId: JONAS }, NOW);
    const c = await confirm(
      d,
      r.id,
      { memberId: JONAS, pataisyta: { [r.veiksmai[0].id]: { laukai: { title: "Nupirkti Emai batus", dueDate: "2026-10-16", amountCents: 5000 } } } },
      NOW
    );
    expect(await getTask(d, c.veiksmai[0].uzduotisId!)).toMatchObject({ title: "Nupirkti Emai batus", due_date: "2026-10-16", amount_cents: 5000 });
  });

  it("atlikta — iš karto, su suma; atšaukus grįžta ir suma", async () => {
    const d = db();
    const t = await createTask(d, { title: "Užsakyti tortą", dueDate: "2026-10-12" }, JONAS, NOW);
    const m = fakeModel([tool("complete_task", { task_id: t.id, amount_eur: 65 })]);
    const r = await ask(d, m.call, { tekstas: "Tortą užsakiau už 65", memberId: RŪTA }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ tipas: "atlikta", busena: "ivykdyta", pavadinimas: "Užsakyti tortą", sumaCentais: 6500 });
    expect(await getTask(d, t.id)).toMatchObject({ status: "atlikta", completed_by: RŪTA, amount_cents: 6500 });

    await undoAction(d, r.id, r.veiksmai[0].id, RŪTA, NOW);
    expect(await getTask(d, t.id)).toMatchObject({ status: "atvira", amount_cents: null });
  });

  it("použduotis pažymima varnele; jau atlikta ar neegzistuojanti — klaida", async () => {
    const d = db();
    const t = await createTask(d, { title: "Gimtadienis", dueDate: "2026-11-10" }, JONAS, NOW);
    const p = await createTask(d, { title: "Pakvietimai", parentId: t.id }, JONAS, NOW);
    const m = fakeModel(
      [tool("complete_task", { task_id: p.id })],
      [tool("complete_task", { task_id: p.id }), tool("complete_task", { task_id: 999 })]
    );
    await ask(d, m.call, { tekstas: "Pakvietimus išsiunčiau", memberId: JONAS }, NOW);
    expect((await getTask(d, p.id))!.status).toBe("atlikta");

    const r = await ask(d, m.call, { tekstas: "Pakvietimus išsiunčiau", memberId: JONAS }, NOW);
    expect(r.veiksmai.map((v) => [v.busena, v.klaida])).toEqual([
      ["klaida", "„Pakvietimai“ jau pažymėta atlikta."],
      ["klaida", "Tokios užduoties neradau."],
    ]);
  });

  it("pirkiniai — iš karto; atšaukus nauja prekė dingsta, buvusi grįžta į „nupirkta“", async () => {
    const d = db();
    const duona = await addItem(d, { listId: MAISTAS, name: "Duona" }, JONAS, new Date("2026-10-08T10:00:00Z"));
    await d.prepare("UPDATE shopping_items SET checked_at = ? WHERE id = ?").bind("2026-10-09T10:00:00.000Z", duona.id).run();

    const m = fakeModel([tool("add_shopping_items", { list_id: MAISTAS, items: [{ name: "pienas", quantity: "2 l" }, { name: "duona" }] })]);
    const r = await ask(d, m.call, { tekstas: "Nupirkt pieno ir duonos", memberId: RŪTA }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ tipas: "pirkiniai", busena: "ivykdyta", pavadinimas: "Maistas" });
    const open = await d.prepare("SELECT name FROM shopping_items WHERE checked_at IS NULL ORDER BY name").all<{ name: string }>();
    expect(open.results.map((x) => x.name)).toEqual(["Duona", "pienas"]);

    await undoAction(d, r.id, r.veiksmai[0].id, RŪTA, NOW);
    const after = await d.prepare("SELECT name, checked_at FROM shopping_items").all();
    expect(after.results).toEqual([{ name: "Duona", checked_at: "2026-10-09T10:00:00.000Z" }]);
  });

  it("nupirkta — iš karto; atšaukus vėl reikia", async () => {
    const d = db();
    const pienas = await addItem(d, { listId: MAISTAS, name: "pienas" }, JONAS, NOW);
    const m = fakeModel([tool("check_shopping_items", { item_ids: [pienas.id] })]);
    const r = await ask(d, m.call, { tekstas: "Pieną nupirkau", memberId: JONAS }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ tipas: "nupirkta", busena: "ivykdyta", prekes: [{ id: pienas.id, name: "pienas" }] });
    await undoAction(d, r.id, r.veiksmai[0].id, JONAS, NOW);
    expect((await d.prepare("SELECT checked_at FROM shopping_items").first<{ checked_at: string | null }>())!.checked_at).toBeNull();
  });

  it("keitimas: kortelėje „buvo → bus“, patvirtinus pakeičiama, atšaukus grįžta", async () => {
    const d = db();
    const t = await createTask(d, { title: "Dantistė", dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] }, JONAS, NOW);
    const m = fakeModel([tool("update_task", { task_id: t.id, due_date: "2026-10-23" })]);
    const r = await ask(d, m.call, { tekstas: "Dantistę perkelk į kitą savaitę", memberId: JONAS }, NOW);
    expect(r.veiksmai[0]).toMatchObject({ tipas: "keisti", busena: "laukia", laukai: { dueDate: "2026-10-23" }, pries: { dueDate: "2026-10-16" } });

    await confirm(d, r.id, { memberId: JONAS }, NOW);
    expect(await getTask(d, t.id)).toMatchObject({ due_date: "2026-10-23", due_time: "15:00", reminders: ["60m"] });
    await undoAction(d, r.id, r.veiksmai[0].id, JONAS, NOW);
    expect((await getTask(d, t.id))!.due_date).toBe("2026-10-16");
  });

  it("trynimas — patvirtinus į šiukšliadėžę; atmestas nebevykdomas", async () => {
    const d = db();
    const a = await createTask(d, { title: "A" }, JONAS, NOW);
    const b = await createTask(d, { title: "B" }, JONAS, NOW);
    const m = fakeModel([tool("delete_task", { task_id: a.id }), tool("delete_task", { task_id: b.id })]);
    const r = await ask(d, m.call, { tekstas: "Ištrink A ir B", memberId: JONAS }, NOW);
    await reject(d, r.id, r.veiksmai[1].id);
    const c = await confirm(d, r.id, { memberId: JONAS }, NOW);
    expect(c.veiksmai.map((v) => v.busena)).toEqual(["ivykdyta", "atmesta"]);
    expect((await getTask(d, a.id))!.deleted_at).not.toBeNull();
    expect((await getTask(d, b.id))!.deleted_at).toBeNull();
  });

  it("netinkamas pasiūlymas — klaida kortelėje, niekas neįrašoma", async () => {
    const d = db();
    const m = fakeModel([
      tool("create_task", { title: "X", due_date: "2026-02-31" }),
      tool("create_task", { title: "Y", assignee_id: 42 }),
      tool("create_task", { title: "Z", due_date: "2026-10-12", reminders: ["60m", "1d@18:00"] }),
    ]);
    const r = await ask(d, m.call, { tekstas: "…", memberId: JONAS }, NOW);
    expect(r.veiksmai.map((v) => v.klaida ?? v.busena)).toEqual(["Netinkama termino data.", "Tokio šeimos nario nėra.", "laukia"]);
    // Be laiko „prieš 60 min.“ neįmanomas — paliekamas tik „dieną prieš“.
    expect(r.veiksmai[2].laukai!.reminders).toEqual(["1d@18:00"]);
  });

  it("pokalbis: modelis mato ankstesnius pasiūlymus; pataisytas pakeičia seną, „taip“ — patvirtina", async () => {
    const d = db();
    const m = fakeModel(
      [say("Kada?"), tool("create_task", { title: "Dantistė", due_date: "2026-10-16", due_time: "15:00" })],
      [tool("create_task", { title: "Dantistė", due_date: "2026-10-16", due_time: "16:00" })],
      [say("Įrašiau."), tool("confirm_proposals", {})]
    );
    const r1 = await ask(d, m.call, { tekstas: "Dantistė penktadienį 15", memberId: JONAS }, NOW);
    const r2 = await ask(d, m.call, { tekstas: "ne, 16 val.", memberId: JONAS, pokalbisId: r1.pokalbisId }, NOW);
    expect(r2.pokalbisId).toBe(r1.id);

    // Antroje užklausoje — pirmoji žinutė, modelio atsakymas ir jo pasiūlymo būsena.
    const second = m.requests[1].messages;
    expect(second.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2].content[0]).toEqual({ type: "tool_result", tool_use_id: r1.veiksmai[0].id, content: "Parodyta žmogui, laukia patvirtinimo." });
    expect(second[2].content[1]).toEqual({ type: "text", text: "ne, 16 val." });

    const r3 = await ask(d, m.call, { tekstas: "taip", memberId: JONAS, pokalbisId: r1.pokalbisId }, NOW);
    expect(r3.veiksmai).toEqual([]);
    const third = m.requests[2].messages;
    expect(third[2].content[0]).toMatchObject({ content: "Pakeista naujesniu pasiūlymu." });

    const all = (await history(d, NOW)).irasai;
    expect(all.find((x) => x.id === r1.id)!.veiksmai[0].busena).toBe("pakeista");
    expect(all.find((x) => x.id === r2.id)!.veiksmai[0].busena).toBe("ivykdyta");
    const tasks = await listTasks(d, NOW);
    expect(tasks.map((t) => [t.title, t.due_time])).toEqual([["Dantistė", "16:00"]]);
  });

  it("senas pokalbis (po valandos) — pradedamas naujas", async () => {
    const d = db();
    const m = fakeModel([say("Labas")], [say("Vėl labas")]);
    const r1 = await ask(d, m.call, { tekstas: "Labas", memberId: JONAS }, NOW);
    const r2 = await ask(d, m.call, { tekstas: "Labas", memberId: JONAS, pokalbisId: r1.id }, new Date(NOW.getTime() + 2 * 3600_000));
    expect(r2.pokalbisId).toBe(r2.id);
    expect(m.requests[1].messages).toHaveLength(1);
  });

  it("modelio klaida — matoma, įrašoma; be rakto — aiški žinutė; dienos riba", async () => {
    const d = db();
    const r = await ask(d, fakeModel(new ModelioKlaida("Asistentas šiuo metu perkrautas.")).call, { tekstas: "Labas", memberId: JONAS }, NOW);
    expect(r).toMatchObject({ klaida: "Asistentas šiuo metu perkrautas.", veiksmai: [] });

    await expect(ask(d, null, { tekstas: "Labas", memberId: JONAS }, NOW)).rejects.toThrow("ANTHROPIC_API_KEY");
    await expect(ask(d, fakeModel().call, { tekstas: "  ", memberId: JONAS }, NOW)).rejects.toThrow("Parašyk");

    for (let i = 0; i < DAILY_LIMIT; i++) {
      await d.prepare("INSERT INTO ai_requests (text, created_at) VALUES ('x', ?)").bind(NOW.toISOString()).run();
    }
    await expect(ask(d, fakeModel([say("x")]).call, { tekstas: "Labas", memberId: JONAS }, NOW)).rejects.toThrow("apsauginė riba");
  });

  it("istorija skaičiuoja mėnesio kainą", async () => {
    const d = db();
    const m = fakeModel([say("a")], [say("b")]);
    await ask(d, m.call, { tekstas: "a", memberId: JONAS }, NOW);
    await ask(d, m.call, { tekstas: "b", memberId: RŪTA }, NOW);
    const h = await history(d, NOW);
    expect(h.irasai.map((x) => x.tekstas)).toEqual(["b", "a"]);
    // 4000 × 0,10 $ + 300 × 0,50 $ už milijoną = 0,00055 $ už žinutę.
    expect(h.islaidos.menuoKainaUsd).toBeCloseTo(0.0011, 6);
    expect(h.islaidos).toMatchObject({ menuoUzklausu: 2, siandienUzklausu: 2, dienosRiba: DAILY_LIMIT });
  });

  it("modeliui siunčiamos instrukcijos, įrankiai ir kontekstas", async () => {
    const d = db();
    const m = fakeModel([say("Labas")]);
    await ask(d, m.call, { tekstas: "Kas mums šiandien?", memberId: RŪTA }, NOW);
    const req = m.requests[0];
    expect(req.instructions).toContain("„Kitą penktadienį“");
    const tools = req.tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        "create_task", "create_project", "record_project_cost", "update_task", "delete_task", "complete_task",
        "add_shopping_items", "check_shopping_items", "save_feedback", "finance_months", "search_transactions", "confirm_proposals",
      ])
    );
    expect(new Set(tools).size).toBe(tools.length);
    expect(req.context).toContain("Kalba: Rūta (id 2)");
    expect(req.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Kas mums šiandien?" }] }]);
  });
});

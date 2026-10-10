import { describe, expect, it } from "vitest";
import { ask, undoAction } from "../src/ai/asistentas";
import type { ContentBlock, ModelCaller } from "../src/ai/modelis";
import { createFeedback, deleteFeedback, listFeedback, updateFeedback } from "../src/pastabos";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const NOW = new Date("2026-10-10T06:00:00Z");

const db = () => visaBaze();

/** Modelis, atsakantis nurodytais blokais iš eilės. */
function model(...responses: ContentBlock[][]): ModelCaller {
  return async () => ({ content: responses.shift() ?? [], usage: { input_tokens: 10, output_tokens: 1 }, model: "m" });
}

describe("pastabos", () => {
  it("įrašomos su rūšimi, ekranu ir autoriumi; tuščia — klaida", async () => {
    const d = db();
    const f = await createFeedback(d, { kind: "klaida", text: " Biudžete neteisinga suma ", screen: "Biudžetas", memberId: RŪTA }, NOW);
    expect(f).toMatchObject({ kind: "klaida", text: "Biudžete neteisinga suma", screen: "Biudžetas", member_id: RŪTA, status: "nauja" });
    await expect(createFeedback(d, { kind: "klaida", text: "  " }, NOW)).rejects.toThrow("Parašyk");
    await expect(createFeedback(d, { kind: "kita", text: "x" }, NOW)).rejects.toThrow("rūšis");
  });

  it("prie asistento atsakymo — išsaugoma pokalbio ištrauka", async () => {
    const d = db();
    const r = await ask(d, model([{ type: "text", text: "Negaliu pasakyti." }]), { tekstas: "Kiek išleidom?", memberId: JONAS }, NOW);
    const f = await createFeedback(d, { kind: "asistentas", aiRequestId: r.id, memberId: JONAS }, NOW);
    expect(f.details).toBe("Žmogus: Kiek išleidom?\nAsistentas: Negaliu pasakyti.");
    expect(f.ai_request_id).toBe(r.id);
  });

  it("sutvarkyta — su laiku ir sprendimu; grąžinus — vėl nauja; naujos sąraše pirmos", async () => {
    const d = db();
    const a = await createFeedback(d, { kind: "ideja", text: "Tamsesnė tema" }, NOW);
    const b = await createFeedback(d, { kind: "nepatogu", text: "Mažas mygtukas" }, new Date("2026-10-10T07:00:00Z"));
    const done = await updateFeedback(d, a.id, { status: "sutvarkyta", resolution: "Pakeista spalva" }, NOW);
    expect(done).toMatchObject({ status: "sutvarkyta", resolution: "Pakeista spalva", resolved_at: NOW.toISOString() });
    expect((await listFeedback(d)).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(await updateFeedback(d, a.id, { status: "nauja" }, NOW)).toMatchObject({ status: "nauja", resolved_at: null });
    await deleteFeedback(d, b.id);
    expect((await listFeedback(d)).map((x) => x.id)).toEqual([a.id]);
  });
});

describe("pastabos per asistentą", () => {
  it("„užfiksuok klaidą“ — įrašoma iš karto su ekranu; atšaukus — dingsta", async () => {
    const d = db();
    const r = await ask(
      d,
      model([{ type: "tool_use", id: "f1", name: "save_feedback", input: { kind: "klaida", text: "Biudžete rodo neteisingą sumą" } }]),
      { tekstas: "Užfiksuok klaidą: biudžete rodo neteisingą sumą", memberId: RŪTA, ekranas: "Biudžetas" },
      NOW
    );
    expect(r.veiksmai[0]).toMatchObject({ tipas: "pastaba", busena: "ivykdyta", pastaba: { kind: "klaida" } });
    expect(await listFeedback(d)).toMatchObject([{ kind: "klaida", text: "Biudžete rodo neteisingą sumą", screen: "Biudžetas", member_id: RŪTA }]);

    await undoAction(d, r.id, "f1", RŪTA, NOW);
    expect(await listFeedback(d)).toEqual([]);
  });

  it("„blogai atsakei“ — pastaba apie asistentą su ankstesne pokalbio žinute", async () => {
    const d = db();
    const m = model(
      [{ type: "text", text: "Išleidote 5 €." }],
      [{ type: "text", text: "Atsiprašau." }, { type: "tool_use", id: "f2", name: "save_feedback", input: { kind: "asistentas", text: "Neteisinga suma" } }]
    );
    const r1 = await ask(d, m, { tekstas: "Kiek išleidom?", memberId: JONAS }, NOW);
    await ask(d, m, { tekstas: "Blogai paskaičiavai", memberId: JONAS, pokalbisId: r1.pokalbisId }, NOW);
    const [f] = await listFeedback(d);
    expect(f).toMatchObject({ kind: "asistentas", text: "Neteisinga suma", ai_request_id: r1.id });
    expect(f.details).toContain("Asistentas: Išleidote 5 €.");
  });
});

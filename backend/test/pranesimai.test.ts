import { describe, expect, it } from "vitest";
import { markDownloaded } from "../src/backups";
import { snoozeTask } from "../src/darbai/priminimai";
import { createEvent } from "../src/kalendorius/ivykiai";
import { createTask, updateTask } from "../src/darbai/uzduotys";
import {
  digestPayload,
  queueAssignment,
  runNotifications,
  saveSubscription,
  sendTest,
  taskCount,
  when,
  type Payload,
} from "../src/pranesimai/pranesimai";
import { b64urlEncode, type PushResult, type Sender, type Vapid } from "../src/pranesimai/webpush";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const EMA = 3;
const SVEIKATA = 3;

/** Siuntėjas testams: įsimena, ką kam siuntė, atsako nurodytu kodu. */
function fakeSender(status = (_endpoint: string) => 201) {
  const sent: { endpoint: string; payload: Payload }[] = [];
  const send: Sender = async (sub, payload): Promise<PushResult> => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Payload });
    const code = status(sub.endpoint);
    return { status: code, text: code >= 300 ? "klaida" : "" };
  };
  return { sent, send };
}

const VAPID = { publicKey: "x", privateKey: {} as CryptoKey, subject: "https://namai.example" } satisfies Vapid;

async function phoneKeys() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    p256dh: b64urlEncode((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** Bazė su Jono ir Rūtos telefonais. */
async function setup() {
  const d = visaBaze();
  for (const [memberId, endpoint] of [
    [JONAS, "https://fcm.example/jonas"],
    [RŪTA, "https://fcm.example/ruta"],
  ] as const) {
    await saveSubscription(d, { memberId, subscription: { endpoint, keys: await phoneKeys() }, device: "Android telefonas" });
  }
  return d;
}

const to = (sent: { endpoint: string }[]) => sent.map((s) => s.endpoint.split("/").pop()).sort();

/** Vilniaus laikas → Date (spalį Vilnius = UTC+3). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);

describe("tekstai", () => {
  it("kada — žmonių kalba", () => {
    const today = "2026-10-09";
    expect(when("2026-10-09", "15:00", today)).toBe("šiandien 15:00");
    expect(when("2026-10-10", null, today)).toBe("rytoj");
    expect(when("2026-10-13", null, today)).toBe("antradienį");
    expect(when("2026-10-23", "09:00", today)).toBe("spalio 23 d. 09:00");
    expect(when("2026-10-08", "09:00", today)).toBe("vakar 09:00");
    expect(when("2026-10-06", "09:00", today)).toBe("vėluoja 3 d.");
  });

  it("darbų skaičius", () => {
    expect([1, 2, 9, 10, 11, 12, 20, 21, 22, 25, 111].map(taskCount)).toEqual([
      "1 darbas", "2 darbai", "9 darbai", "10 darbų", "11 darbų", "12 darbų",
      "20 darbų", "21 darbas", "22 darbai", "25 darbai", "111 darbų",
    ]);
  });
});

describe("prenumeratos", () => {
  it("tikrina narį ir raktus; tas pats įrenginys — perrašomas kitam žmogui", async () => {
    const d = await setup();
    const keys = await phoneKeys();
    await expect(saveSubscription(d, { memberId: null, subscription: { endpoint: "https://fcm.example/x", keys } })).rejects.toThrow("Pirma pasirink");
    await expect(saveSubscription(d, { memberId: EMA, subscription: { endpoint: "https://fcm.example/x", keys } })).rejects.toThrow("negauna");
    await expect(
      saveSubscription(d, { memberId: JONAS, subscription: { endpoint: "http://fcm.example/x", keys } })
    ).rejects.toThrow("netinkamą");
    await expect(
      saveSubscription(d, { memberId: JONAS, subscription: { endpoint: "https://fcm.example/x", keys: { ...keys, auth: "AAAA" } } })
    ).rejects.toThrow("netinkamą");

    const moved = await saveSubscription(d, { memberId: RŪTA, subscription: { endpoint: "https://fcm.example/jonas", keys } });
    expect(moved.member_id).toBe(RŪTA);
    const { results } = await d.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").all<{ n: number }>();
    expect(results[0].n).toBe(2);
  });
});

describe("priminimai", () => {
  it("atsakingam; be atsakingo ar Emai — abiem; atidėtas — tik atidėjusiam", async () => {
    const d = await setup();
    const created = at("2026-10-09", "21:00");
    const remind = { dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] };
    const rūtos = await createTask(d, { title: "Dantistė", assigneeId: RŪTA, areaId: SVEIKATA, ...remind }, JONAS, created);
    await createTask(d, { title: "Bendras", ...remind }, JONAS, created);
    await createTask(d, { title: "Emos", assigneeId: EMA, ...remind }, JONAS, created);
    const atidetas = await createTask(d, { title: "Atidėtas" }, JONAS, created);
    await snoozeTask(d, atidetas.id, JONAS, 60, created);

    // Atidėtas suėjo 22:00 — tylos valandos, laukia ryto.
    const night = fakeSender();
    expect(await runNotifications(d, VAPID, at("2026-10-09", "22:30"), night.send)).toMatchObject({ quiet: true });
    expect(night.sent).toEqual([]);

    const morning = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-10", "07:00"), morning.send);
    expect(morning.sent.map((s) => [s.payload.title, s.endpoint.split("/").pop()])).toEqual([["Atidėtas", "jonas"]]);

    const reminders = fakeSender();
    const result = await runNotifications(d, VAPID, at("2026-10-16", "14:00"), reminders.send);
    expect(result).toEqual({ quiet: false, sent: 5, failed: 0 });
    const byTitle = (title: string) => to(reminders.sent.filter((s) => s.payload.title === title));
    expect(byTitle("Dantistė")).toEqual(["ruta"]);
    expect(byTitle("Bendras")).toEqual(["jonas", "ruta"]);
    expect(byTitle("Emos")).toEqual(["jonas", "ruta"]);

    expect(reminders.sent.find((s) => s.payload.title === "Dantistė")!.payload).toEqual({
      title: "Dantistė",
      body: "Šiandien 15:00 · Sveikata",
      url: `/?uzduotis=${rūtos.id}`,
      tag: `uzd-${rūtos.id}`,
      taskId: rūtos.id,
      veiksmai: true,
      memberId: RŪTA,
    });

    // Išsiųsti antrą kartą nebesiunčiami.
    const again = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-16", "14:01"), again.send);
    expect(again.sent).toEqual([]);
  });

  it("nebegaliojantis įrenginys ištrinamas, kita klaida — įrašoma ir matoma", async () => {
    const d = await setup();
    await createTask(d, { title: "Bendras", dueDate: "2026-10-16", dueTime: "15:00", reminders: ["60m"] }, JONAS, at("2026-10-09", "21:00"));
    const s = fakeSender((endpoint) => (endpoint.endsWith("jonas") ? 410 : 500));
    expect(await runNotifications(d, VAPID, at("2026-10-16", "14:00"), s.send)).toMatchObject({ sent: 0, failed: 2 });

    const { results } = await d.prepare("SELECT endpoint, failed_count, last_error FROM push_subscriptions").all<{
      endpoint: string;
      failed_count: number;
      last_error: string;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ endpoint: "https://fcm.example/ruta", failed_count: 1 });
    expect(results[0].last_error).toContain("500 klaida");
  });
});

describe("rytinė suvestinė", () => {
  it("7:30 — ir šiandienos įvykiai: dalyvaujančiam, o Emos ar visos šeimos — abiem", async () => {
    const d = await setup();
    const created = at("2026-10-08", "12:00");
    await createEvent(d, { title: "Šokiai", startDate: "2026-10-09", startTime: "17:00", memberIds: [EMA] }, JONAS, created);
    await createEvent(d, { title: "Kirpykla", startDate: "2026-10-09", startTime: "10:00", memberIds: [RŪTA] }, JONAS, created);
    await createTask(d, { title: "Išnešti šiukšles", dueDate: "2026-10-09" }, JONAS, created);
    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "07:30"), s.send);
    const of = (who: string) => s.sent.find((x) => x.endpoint.endsWith(who))!.payload;
    expect(of("jonas")).toMatchObject({ title: "Šiandien 1 darbas", body: "📅 17:00 Šokiai\nIšnešti šiukšles" });
    expect(of("ruta")).toMatchObject({ body: "📅 10:00 Kirpykla\n📅 17:00 Šokiai\nIšnešti šiukšles" });
  });

  it("7:30 kiekvienam jo, bendri ir Emos darbai; kartą per dieną", async () => {
    const d = await setup();
    const created = at("2026-10-08", "12:00");
    await createTask(d, { title: "Dantistė", dueDate: "2026-10-09", dueTime: "15:00", assigneeId: RŪTA }, JONAS, created);
    await createTask(d, { title: "Išnešti šiukšles", dueDate: "2026-10-09" }, JONAS, created);
    await createTask(d, { title: "Lemputė", dueDate: "2026-10-06", assigneeId: JONAS }, JONAS, created);
    await createTask(d, { title: "Būrelis", dueDate: "2026-10-09", dueTime: "17:00", assigneeId: EMA }, JONAS, created);
    await createTask(d, { title: "Rytoj", dueDate: "2026-10-10" }, JONAS, created);

    const early = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "07:29"), early.send);
    expect(early.sent).toEqual([]);

    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "07:30"), s.send);
    const of = (who: string) => s.sent.find((x) => x.endpoint.endsWith(who))!.payload;
    expect(of("jonas")).toEqual({
      title: "Šiandien 2 darbai, vėluoja 1",
      body: "17:00 Būrelis\nIšnešti šiukšles\nLemputė (vėluoja 3 d.)",
      url: "/",
      tag: "suvestine",
      memberId: JONAS,
    });
    expect(of("ruta")).toMatchObject({ title: "Šiandien 3 darbai", body: "15:00 Dantistė\n17:00 Būrelis\nIšnešti šiukšles" });

    const later = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "07:31"), later.send);
    expect(later.sent).toEqual([]);
  });

  it("be darbų nesiunčiama; per daug — sutraukiama", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: i, title: `D${i}`, due_date: "2026-10-09", due_time: null, assignee_id: null }));
    expect(digestPayload(many, "2026-10-09").body!.split("\n")).toEqual(["D0", "D1", "D2", "D3", "D4", "D5", "ir dar 3"]);
  });

  it("po 10 val. (jei laikmatis ryte nesuveikė) nebesiunčiama", async () => {
    const d = await setup();
    await createTask(d, { title: "Šiandien", dueDate: "2026-10-09" }, JONAS, at("2026-10-08", "12:00"));
    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "10:00"), s.send);
    expect(s.sent).toEqual([]);
  });
});

describe("priskyrimas", () => {
  it("kai kitas priskiria — pranešimas; sau, Emai ar nepasikeitus — ne", async () => {
    const d = await setup();
    const now = at("2026-10-09", "21:00");
    const tortas = await createTask(d, { title: "Užsakyti tortą", dueDate: "2026-10-10", assigneeId: RŪTA }, JONAS, now);
    await queueAssignment(d, tortas, null, JONAS, now);
    await queueAssignment(d, tortas, RŪTA, JONAS, now);
    const sau = await createTask(d, { title: "Sau", assigneeId: JONAS }, JONAS, now);
    await queueAssignment(d, sau, null, JONAS, now);
    const emai = await createTask(d, { title: "Emai", assigneeId: EMA }, JONAS, now);
    await queueAssignment(d, emai, null, JONAS, now);
    const perduota = await updateTask(d, sau.id, { assigneeId: RŪTA }, JONAS, now);
    await queueAssignment(d, perduota, JONAS, null, now);

    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "21:01"), s.send);
    expect(s.sent.map((x) => [x.endpoint.split("/").pop(), x.payload.title, x.payload.body])).toEqual([
      ["ruta", "Jonas priskyrė tau darbą", "Užsakyti tortą · rytoj"],
      ["ruta", "Tau priskirtas darbas", "Sau"],
    ]);
    expect(s.sent[0].payload).toMatchObject({ url: `/?uzduotis=${tortas.id}`, tag: `priskirta-${tortas.id}` });
    expect(s.sent[0].payload.veiksmai).toBeUndefined();
  });

  it("tylos valandomis palaukia ryto", async () => {
    const d = await setup();
    const now = at("2026-10-09", "23:00");
    const t = await createTask(d, { title: "Naktinis", assigneeId: RŪTA }, JONAS, now);
    await queueAssignment(d, t, null, JONAS, now);
    const night = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "23:01"), night.send);
    expect(night.sent).toEqual([]);
    const morning = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-10", "07:00"), morning.send);
    expect(morning.sent.map((x) => x.payload.title)).toEqual(["Jonas priskyrė tau darbą"]);
  });
});

describe("atsarginės kopijos priminimas", () => {
  it("vakare Jonui, jei 30 d. neparsisiųsta; kartą per mėnesį", async () => {
    const d = await setup();
    await markDownloaded(d, new Date("2026-09-01T10:00:00Z"));

    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "19:00"), s.send);
    expect(s.sent.map((x) => [x.endpoint.split("/").pop(), x.payload.title, x.payload.body])).toEqual([
      ["jonas", "Laikas parsisiųsti atsarginę kopiją", "Paskutinį kartą — prieš 38 d. Atsidaryk „Atsarginės kopijos“."],
    ]);

    const again = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-10", "19:00"), again.send);
    expect(again.sent).toEqual([]);
  });

  it("neseniai parsisiųsta — nesiunčiama", async () => {
    const d = await setup();
    await markDownloaded(d, new Date("2026-10-01T10:00:00Z"));
    const s = fakeSender();
    await runNotifications(d, VAPID, at("2026-10-09", "19:30"), s.send);
    expect(s.sent).toEqual([]);
  });
});

describe("bandomasis pranešimas", () => {
  it("tik į šį įrenginį; rezultatas įrašomas", async () => {
    const d = await setup();
    const s = fakeSender();
    expect(await sendTest(d, VAPID, "https://fcm.example/ruta", new Date(), s.send)).toEqual({ ok: true, klaida: null });
    expect(to(s.sent)).toEqual(["ruta"]);
    const row = await d.prepare("SELECT last_success_at FROM push_subscriptions WHERE member_id = ?").bind(RŪTA).first<{ last_success_at: string }>();
    expect(row!.last_success_at).not.toBeNull();

    await expect(sendTest(d, VAPID, "https://fcm.example/nera", new Date(), s.send)).rejects.toThrow("neužregistruotas");
    const bad = fakeSender(() => 403);
    expect(await sendTest(d, VAPID, "https://fcm.example/jonas", new Date(), bad.send)).toEqual({
      ok: false,
      klaida: "Pranešimų tarnyba atsakė: 403 klaida",
    });
  });
});

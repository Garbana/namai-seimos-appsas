import { describe, expect, it } from "vitest";
import { ask, confirm, undoAction } from "../src/ai/asistentas";
import { buildContext } from "../src/ai/kontekstas";
import type { ContentBlock, ModelCaller } from "../src/ai/modelis";
import { connectCalendar, GoogleCalendar, googleColor, patchGoogleSeries, readState, syncGoogle, type GoogleEvent } from "../src/kalendorius/google";
import { createEvent, deleteEvent, eventValues, listEvents, rawEvent, updateEvent } from "../src/kalendorius/ivykiai";
import { vilniusNow, vilniusToUtc } from "../src/darbai/bendra";
import { addDays } from "../src/darbai/pakartojimai";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const EMA = 3;
/** 2026-10-10, šeštadienis, 9:00 Vilniuje. */
const NOW = new Date("2026-10-10T06:00:00Z");
const CAL = "seima@gmail.com";

describe("įvykio laukai", () => {
  it("be pabaigos — valanda; visos dienos — be laiko; netinkami — klaida", () => {
    expect(eventValues({ title: "Dantistė", startDate: "2026-10-16", startTime: "15:00" }, null)).toMatchObject({
      start_date: "2026-10-16",
      start_time: "15:00",
      end_date: "2026-10-16",
      end_time: "16:00",
      member_ids: "[]",
    });
    expect(eventValues({ title: "Vakarėlis", startDate: "2026-10-16", startTime: "23:30" }, null)).toMatchObject({ end_date: "2026-10-17", end_time: "00:30" });
    expect(eventValues({ title: "Atostogos", startDate: "2026-10-16", endDate: "2026-10-20" }, null)).toMatchObject({ start_time: null, end_time: null, end_date: "2026-10-20" });
    expect(() => eventValues({ title: "X", startDate: "2026-10-16", startTime: "15:00", endTime: "14:00" }, null)).toThrow("vėliau");
    expect(() => eventValues({ title: "", startDate: "2026-10-16" }, null)).toThrow("pavadinimo");
    expect(() => eventValues({ title: "X", startDate: "2026-13-01" }, null)).toThrow("data");
  });

  it("perkėlus pradžią trukmė išlieka", () => {
    const base = eventValues({ title: "Repeticija", startDate: "2026-10-16", startTime: "17:00", endTime: "18:30" }, null);
    expect(eventValues({ startDate: "2026-10-17", startTime: "10:00" }, base)).toMatchObject({ start_date: "2026-10-17", end_date: "2026-10-17", end_time: "11:30" });
  });
});

describe("kalendorius appse", () => {
  it("pasikartojantis (dar ne Google) — kartai skaičiuojami; dalyviai tikrinami", async () => {
    const d = visaBaze();
    await createEvent(d, { title: "Šokiai", startDate: "2026-10-13", startTime: "17:00", recurrence: "FREQ=WEEKLY", memberIds: [EMA] }, JONAS, NOW);
    await createEvent(d, { title: "Dantistė", startDate: "2026-10-16", startTime: "15:00", memberIds: [RŪTA] }, JONAS, NOW);
    const list = await listEvents(d, "2026-10-10", "2026-10-27");
    expect(list.map((e) => [e.start_date, e.start_time, e.title])).toEqual([
      ["2026-10-13", "17:00", "Šokiai"],
      ["2026-10-16", "15:00", "Dantistė"],
      ["2026-10-20", "17:00", "Šokiai"],
      ["2026-10-27", "17:00", "Šokiai"],
    ]);
    expect(list[0]).toMatchObject({ series: true, members: [EMA], google: false });
    await expect(createEvent(d, { title: "X", startDate: "2026-10-16", memberIds: [99] }, JONAS, NOW)).rejects.toThrow("šeimos nario");
  });
});

// ---------- Netikras Google kalendorius ----------

async function serviceAccount(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ client_email: "namai@projektas.iam.gserviceaccount.com", private_key: pem });
}

/** Google kalendoriaus API tiek, kiek naudoja appsas: įvykiai, savaitiniai pasikartojimai, išimtys. */
class FakeGoogle {
  events = new Map<string, GoogleEvent>();
  overrides = new Map<string, GoogleEvent>();
  clock = NOW.getTime();
  seq = 0;
  calls: string[] = [];
  denied = false;

  private stamp() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  add(e: Omit<GoogleEvent, "id" | "updated"> & { id?: string }): GoogleEvent {
    const ev = { ...e, id: e.id ?? `g${++this.seq}`, updated: this.stamp(), status: e.status ?? "confirmed" } as GoogleEvent;
    this.events.set(ev.id, ev);
    return ev;
  }

  /** Savaitinės serijos kartai (iki 8). */
  instancesOf(master: GoogleEvent): GoogleEvent[] {
    const out: GoogleEvent[] = [];
    const startDt = master.start!.dateTime!;
    const endDt = master.end!.dateTime!;
    // Kaip tikras Google: vietinis laikas (Vilniuje) išlieka ir pasikeitus vasaros laikui.
    const local = (s: string) => (s.length === 19 ? { date: s.slice(0, 10), time: s.slice(11, 16) } : vilniusNow(new Date(s)));
    for (let i = 0; i < 8; i++) {
      const shift = (s: string) => {
        const l = local(s);
        return vilniusToUtc(addDays(l.date, i * 7), l.time).toISOString();
      };
      const id = `${master.id}_${shift(startDt).slice(0, 10).replace(/-/g, "")}`;
      const base: GoogleEvent = {
        ...master,
        id,
        recurrence: undefined,
        recurringEventId: master.id,
        start: { dateTime: shift(startDt) },
        end: { dateTime: shift(endDt) },
      };
      out.push({ ...base, ...(this.overrides.get(id) ?? {}), status: master.status === "cancelled" ? "cancelled" : (this.overrides.get(id)?.status ?? "confirmed") });
    }
    return out;
  }

  expanded(): GoogleEvent[] {
    return [...this.events.values()].flatMap((e) => (e.recurrence ? this.instancesOf(e) : [e]));
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname.replace(/^\/calendar\/v3\/calendars\/[^/]+/, "")}`);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "tok", expires_in: 3600 });
    if (this.denied) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
    const path = url.pathname.replace(/^\/calendar\/v3\/calendars\/[^/]+\/events/, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as GoogleEvent) : null;

    if (path === "" && method === "GET") {
      const since = url.searchParams.get("updatedMin");
      const items = this.expanded().filter((e) => !since || (e.updated ?? "") >= since);
      return Response.json({ items });
    }
    if (path === "" && method === "POST") return Response.json(this.add(body!));
    const [, id, sub] = path.match(/^\/([^/]+)(\/instances)?$/) ?? [];
    const key = decodeURIComponent(id ?? "");
    if (sub) {
      const master = this.events.get(key);
      return master ? Response.json({ items: this.instancesOf(master) }) : new Response(null, { status: 404 });
    }
    if (key.includes("_")) {
      // Serijos karto išimtis.
      const cur = this.overrides.get(key) ?? {};
      this.overrides.set(key, { ...cur, ...(body ?? {}), ...(method === "DELETE" ? { status: "cancelled" } : {}), updated: this.stamp() } as GoogleEvent);
      const master = this.events.get(key.split("_")[0])!;
      master.updated = this.stamp();
      return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(this.instancesOf(master).find((i) => i.id === key));
    }
    const ev = this.events.get(key);
    if (!ev || ev.status === "cancelled") return new Response(null, { status: method === "DELETE" ? 410 : 404 });
    if (method === "GET") return Response.json(ev);
    if (method === "DELETE") {
      Object.assign(ev, { status: "cancelled", updated: this.stamp() });
      return new Response(null, { status: 204 });
    }
    Object.assign(ev, body, { updated: this.stamp() });
    return Response.json(ev);
  };
}

async function connected() {
  const d = visaBaze();
  const g = new FakeGoogle();
  const key = await serviceAccount();
  return { d, g, key };
}

describe("Google sinchronizavimas", () => {
  it("prijungus: patikra (bandomasis įvykis ištrinamas), appso įvykiai išsiunčiami, Google įvykiai atsiranda appse", async () => {
    const { d, g, key } = await connected();
    const mine = await createEvent(d, { title: "Dantistė", startDate: "2026-10-16", startTime: "15:00", memberIds: [RŪTA], location: "Klinika" }, JONAS, NOW);
    g.add({ summary: "Repeticija", start: { dateTime: "2026-10-14T18:00:00+03:00" }, end: { dateTime: "2026-10-14T19:30:00+03:00" }, colorId: "5" });
    g.add({ summary: "Atostogos", start: { date: "2026-10-20" }, end: { date: "2026-10-23" } });

    await connectCalendar(d, key, CAL, g.fetch, NOW);
    expect(g.calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1); // patikros įvykis
    const sent = [...g.events.values()].find((e) => e.summary === "Dantistė")!;
    expect(sent).toMatchObject({
      start: { dateTime: "2026-10-16T15:00:00", timeZone: "Europe/Vilnius" },
      location: "Klinika",
      colorId: googleColor("#1baf7a"),
      extendedProperties: { private: { namai_id: String(mine.id), namai_nariai: "2" } },
    });
    expect(await rawEvent(d, mine.id)).toMatchObject({ google_id: sent.id, sync_state: "sinchronizuota" });

    const list = await listEvents(d, "2026-10-10", "2026-10-31");
    expect(list.map((e) => [e.title, e.start_date, e.start_time, e.end_date, e.end_time, e.members])).toEqual([
      ["Repeticija", "2026-10-14", "18:00", "2026-10-14", "19:30", [EMA]],
      ["Dantistė", "2026-10-16", "15:00", "2026-10-16", "16:00", [RŪTA]],
      ["Atostogos", "2026-10-20", null, "2026-10-22", null, []],
    ]);
    expect((await readState(d)).lastFull).toBe("2026-10-10");
  });

  it("pakeitimai abiem kryptimis; neišsiųstas pakeitimas appse laimi prieš Google", async () => {
    const { d, g, key } = await connected();
    const r = g.add({ summary: "Repeticija", start: { dateTime: "2026-10-14T18:00:00+03:00" }, end: { dateTime: "2026-10-14T19:00:00+03:00" } });
    await connectCalendar(d, key, CAL, g.fetch, NOW);
    const local = (await d.prepare("SELECT id FROM events WHERE google_id = ?").bind(r.id).first<{ id: number }>())!.id;

    // Google'e pakeista — po sinchronizavimo appse.
    Object.assign(r, { summary: "Generalinė repeticija", updated: new Date(NOW.getTime() + 60_000).toISOString() });
    const later = new Date(NOW.getTime() + 120_000);
    await syncGoogle(d, key, g.fetch, later);
    expect((await rawEvent(d, local))!.title).toBe("Generalinė repeticija");

    // Appse pakeista — į Google (PATCH).
    await updateEvent(d, local, { location: "Kultūros centras" }, later);
    await syncGoogle(d, key, g.fetch, later);
    expect(r.location).toBe("Kultūros centras");

    // Abiejose pusėse — appso neišsiųstas pakeitimas laimi.
    await updateEvent(d, local, { title: "Appso pavadinimas" }, later);
    Object.assign(r, { summary: "Google pavadinimas", updated: new Date(later.getTime() + 1000).toISOString() });
    await syncGoogle(d, key, g.fetch, new Date(later.getTime() + 120_000));
    expect(r.summary).toBe("Appso pavadinimas");
    expect((await rawEvent(d, local))!.title).toBe("Appso pavadinimas");

    // Ištrinta appse — ištrinama Google'e; ištrinta Google'e — dingsta appse.
    const other = g.add({ summary: "Susitikimas", start: { date: "2026-10-18" }, end: { date: "2026-10-19" } });
    await syncGoogle(d, key, g.fetch, new Date(later.getTime() + 240_000));
    await deleteEvent(d, local);
    Object.assign(other, { status: "cancelled", updated: new Date(later.getTime() + 241_000).toISOString() });
    await syncGoogle(d, key, g.fetch, new Date(later.getTime() + 360_000));
    expect(r.status).toBe("cancelled");
    expect((await listEvents(d, "2026-10-10", "2026-10-31")).map((e) => e.title)).toEqual([]);
  });

  it("pasikartojantis iš appso: į Google — serija, atgal — kartai; serijos eilutė kalendoriuje nerodoma", async () => {
    const { d, g, key } = await connected();
    await connectCalendar(d, key, CAL, g.fetch, NOW);
    const s = await createEvent(d, { title: "Šokiai", startDate: "2026-10-13", startTime: "17:00", recurrence: "FREQ=WEEKLY", memberIds: [EMA] }, JONAS, NOW);
    await syncGoogle(d, key, g.fetch, new Date(NOW.getTime() + 120_000));
    const master = [...g.events.values()].find((e) => e.summary === "Šokiai")!;
    expect(master.recurrence).toEqual(["RRULE:FREQ=WEEKLY"]);
    const list = await listEvents(d, "2026-10-10", "2026-10-31");
    expect(list.map((e) => [e.title, e.start_date, e.start_time, e.series, e.google])).toEqual([
      ["Šokiai", "2026-10-13", "17:00", true, true],
      ["Šokiai", "2026-10-20", "17:00", true, true],
      ["Šokiai", "2026-10-27", "17:00", true, true],
    ]);
    expect(list.every((e) => e.id !== s.id)).toBe(true);

    // Vieną kartą ištrinus — tik jis.
    await deleteEvent(d, list[1].id);
    await syncGoogle(d, key, g.fetch, new Date(NOW.getTime() + 240_000));
    expect((await listEvents(d, "2026-10-10", "2026-10-31")).map((e) => e.start_date)).toEqual(["2026-10-13", "2026-10-27"]);
  });

  it("serija iš Google: „visi kartai“ keičiami Google'e, appse atsinaujina", async () => {
    const { d, g, key } = await connected();
    const m = g.add({ summary: "Baseinas", start: { dateTime: "2026-10-12T16:00:00+03:00" }, end: { dateTime: "2026-10-12T17:00:00+03:00" }, recurrence: ["RRULE:FREQ=WEEKLY"] });
    await connectCalendar(d, key, CAL, g.fetch, NOW);
    const first = (await listEvents(d, "2026-10-10", "2026-10-20"))[0];
    expect(first).toMatchObject({ title: "Baseinas", start_date: "2026-10-12", series: true });

    const row = (await rawEvent(d, first.id))!;
    const cal = new GoogleCalendar(d, JSON.parse(key), CAL, g.fetch, () => NOW);
    await patchGoogleSeries(d, cal, m.id, { ...row, title: "Plaukimas", start_time: "16:30", end_time: "17:30" }, false, NOW);
    expect(m).toMatchObject({ summary: "Plaukimas", start: { dateTime: "2026-10-12T16:30:00" } });
    expect((await listEvents(d, "2026-10-10", "2026-10-20")).map((e) => [e.title, e.start_date, e.start_time])).toEqual([
      ["Plaukimas", "2026-10-12", "16:30"],
      ["Plaukimas", "2026-10-19", "16:30"],
    ]);
  });

  it("be leidimo — klaida įrašoma prie įvykio ir būsenoje, įvykis appse lieka", async () => {
    const { d, g, key } = await connected();
    await connectCalendar(d, key, CAL, g.fetch, NOW);
    g.denied = true;
    const e = await createEvent(d, { title: "Kirpykla", startDate: "2026-10-17", startTime: "10:00" }, JONAS, NOW);
    const state = await syncGoogle(d, key, g.fetch, new Date(NOW.getTime() + 120_000));
    expect(await rawEvent(d, e.id)).toMatchObject({ sync_state: "klaida", sync_error: expect.stringContaining("pasidalintas su namai@projektas") });
    expect(state?.error).toContain("pasidalintas");
    expect((await listEvents(d, "2026-10-17", "2026-10-17")).map((x) => x.title)).toEqual(["Kirpykla"]);

    g.denied = false;
    await syncGoogle(d, key, g.fetch, new Date(NOW.getTime() + 240_000));
    expect(await rawEvent(d, e.id)).toMatchObject({ sync_state: "sinchronizuota", sync_error: null });
  });

  it("prijungiant: netinkamas adresas ar be rakto — aiški klaida", async () => {
    const { d, g, key } = await connected();
    await expect(connectCalendar(d, undefined, CAL, g.fetch, NOW)).rejects.toThrow("raktas");
    await expect(connectCalendar(d, key, "ne adresas", g.fetch, NOW)).rejects.toThrow("el. paštą");
    g.denied = true;
    await expect(connectCalendar(d, key, CAL, g.fetch, NOW)).rejects.toThrow("pasidalintas");
  });
});

describe("katinukas ir kalendorius", () => {
  const model =
    (...responses: ContentBlock[][]): ModelCaller =>
    async () => ({ content: responses.shift() ?? [], usage: { input_tokens: 10, output_tokens: 1 }, model: "m" });

  it("„penktadienį Rūtai pas kirpėją 15 val.“ — pasiūlomas įvykis; patvirtinus — kalendoriuje; atšaukus — dingsta", async () => {
    const d = visaBaze();
    const r = await ask(
      d,
      model([{ type: "tool_use", id: "e1", name: "create_event", input: { title: "Kirpykla", date: "2026-10-16", start_time: "15:00", member_ids: [RŪTA] } }]),
      { tekstas: "Penktadienį Rūtai pas kirpėją 15 val.", memberId: JONAS },
      NOW
    );
    expect(r.veiksmai[0]).toMatchObject({
      tipas: "ivykis",
      busena: "laukia",
      ivykis: { title: "Kirpykla", startDate: "2026-10-16", startTime: "15:00", endTime: "16:00", memberIds: [RŪTA] },
    });
    await confirm(d, r.id, { memberId: JONAS }, NOW);
    const [e] = await listEvents(d, "2026-10-16", "2026-10-16");
    expect(e).toMatchObject({ title: "Kirpykla", source: "ai", members: [RŪTA] });

    // Perkelti — tik kas keičiasi (pabaiga pasislenka kartu).
    const r2 = await ask(
      d,
      model([{ type: "tool_use", id: "e2", name: "update_event", input: { event_id: e.id, start_time: "16:00" } }]),
      { tekstas: "Kirpyklą perkelk į 16 val.", memberId: JONAS },
      NOW
    );
    expect(r2.veiksmai[0]).toMatchObject({ tipas: "ivykio_keitimas", ivykis: { startTime: "16:00", endTime: "17:00" }, ivykisPries: { startTime: "15:00", endTime: "16:00" } });

    await undoAction(d, r.id, "e1", JONAS, NOW);
    expect(await listEvents(d, "2026-10-16", "2026-10-16")).toEqual([]);
  });

  it("kontekste — artimiausi įvykiai su id", async () => {
    const d = visaBaze();
    const e = await createEvent(d, { title: "Šokiai", startDate: "2026-10-13", startTime: "17:00", memberIds: [EMA], location: "Studija" }, JONAS, NOW);
    expect(await buildContext(d, JONAS, NOW)).toContain(`e${e.id} 2026-10-13 antradienis 17:00–18:00 | Šokiai | dalyvauja Ema | vieta Studija`);
  });
});

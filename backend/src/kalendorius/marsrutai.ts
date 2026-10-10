/** Kalendoriaus API: /api/kalendorius/*. */
import { actingMember } from "../darbai/nariai";
import { KlaidaVartotojui } from "../darbai/bendra";
import { isDate } from "../darbai/pakartojimai";
import { calendarFor, connectCalendar, disconnectCalendar, parseServiceAccount, patchGoogleSeries, pushEvent, readState, syncGoogle } from "./google";
import {
  createEvent,
  deleteEvent,
  eventValues,
  EVENT_COLUMNS,
  liveEvent,
  listEvents,
  rawEvent,
  restoreEvent,
  toIvykis,
  updateEvent,
  type EventInput,
  type EventRow,
} from "./ivykiai";

type Env = { DB: D1Database; GOOGLE_SERVICE_ACCOUNT?: string };
type Body = EventInput & { memberId?: unknown; visiems?: unknown; calendarId?: unknown };

/** Užduotys su terminu kalendoriuje (atviros, be použduočių). */
async function tasksBetween(db: D1Database, from: string, to: string) {
  const { results } = await db
    .prepare(
      `SELECT id, title, due_date, due_time, assignee_id, chore, project_id, status FROM tasks
       WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 'atvira' AND due_date BETWEEN ? AND ?
       ORDER BY due_date, due_time IS NULL, due_time, id`
    )
    .bind(from, to)
    .all();
  return results;
}

/** Po pakeitimo appse — iškart į Google (jei prijungta). Nepavykus įvykis lieka su klaidos žyme ir kartojamas. */
async function pushNow(env: Env, eventId: number): Promise<void> {
  const cal = await calendarFor(env.DB, env.GOOGLE_SERVICE_ACCOUNT);
  const row = await rawEvent(env.DB, eventId);
  if (!cal || !row || row.sync_state === "sinchronizuota") return;
  await pushEvent(env.DB, cal, row).catch(() => {});
}

/** Serijos eilutė appse (iš jos serija sukurta), jei tokia yra. */
const seriesMaster = (db: D1Database, googleId: string) =>
  db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE google_id = ? AND deleted_at IS NULL`).bind(googleId).first<EventRow>();

/** null — ne šios skilties adresas. */
export async function handleKalendorius(url: URL, request: Request, env: Env): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/kalendorius" && !path.startsWith("/api/kalendorius/")) return null;
  const db = env.DB;
  const method = request.method;
  const body = async (): Promise<Body> => {
    try {
      return (await request.json()) as Body;
    } catch {
      throw new KlaidaVartotojui("Netinkamas užklausos turinys.");
    }
  };

  try {
    if (path === "/api/kalendorius" && method === "GET") {
      const from = url.searchParams.get("nuo") ?? "";
      const to = url.searchParams.get("iki") ?? "";
      if (!isDate(from) || !isDate(to) || to < from) throw new KlaidaVartotojui("Netinkamas laikotarpis.");
      const [ivykiai, uzduotys, state, klaidos] = await Promise.all([
        listEvents(db, from, to),
        tasksBetween(db, from, to),
        readState(db),
        db.prepare("SELECT COUNT(*) AS n FROM events WHERE sync_state = 'klaida'").first<{ n: number }>(),
      ]);
      return Response.json({
        ivykiai,
        uzduotys,
        google: {
          prijungta: Boolean(state.calendarId && parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT)),
          kalendorius: state.calendarId ?? null,
          klaida: state.error ?? null,
          nesinchronizuota: klaidos?.n ?? 0,
        },
      });
    }

    if (path === "/api/kalendorius" && method === "POST") {
      const b = await body();
      const e = await createEvent(db, b, await actingMember(db, b.memberId));
      await pushNow(env, e.id);
      return Response.json(toIvykis((await rawEvent(db, e.id))!));
    }

    // ---------- Google ----------

    if (path === "/api/kalendorius/google") {
      if (method === "GET") {
        const [state, pending] = await Promise.all([
          readState(db),
          db.prepare("SELECT SUM(sync_state = 'laukia') AS laukia, SUM(sync_state = 'klaida') AS klaidos FROM events").first<{ laukia: number | null; klaidos: number | null }>(),
        ]);
        return Response.json({
          paskyra: parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT)?.client_email ?? null,
          kalendorius: state.calendarId ?? null,
          paskutinis: state.lastSync ?? null,
          klaida: state.error ?? null,
          importuojama: Boolean(state.full),
          laukia: pending?.laukia ?? 0,
          klaidos: pending?.klaidos ?? 0,
        });
      }
      if (method === "POST") {
        const state = await connectCalendar(db, env.GOOGLE_SERVICE_ACCOUNT, (await body()).calendarId);
        return Response.json({ ok: true, klaida: state.error ?? null });
      }
      if (method === "DELETE") {
        await disconnectCalendar(db);
        return Response.json({ ok: true });
      }
    }

    if (path === "/api/kalendorius/google/sinchronizuoti" && method === "POST") {
      const state = await syncGoogle(db, env.GOOGLE_SERVICE_ACCOUNT);
      if (!state) throw new KlaidaVartotojui("Google kalendorius neprijungtas.");
      return Response.json({ ok: !state.error, klaida: state.error ?? null });
    }

    // ---------- Vienas įvykis ----------

    const m = path.match(/^\/api\/kalendorius\/(\d+)(\/atkurti)?$/);
    if (m) {
      const eventId = Number(m[1]);
      if (m[2] && method === "POST") {
        await restoreEvent(db, eventId);
        await pushNow(env, eventId);
        return Response.json(toIvykis((await rawEvent(db, eventId))!));
      }
      if (method === "GET") return Response.json(toIvykis(await liveEvent(db, eventId)));

      if (method === "PATCH" || method === "DELETE") {
        const b = method === "PATCH" ? await body() : ({ visiems: url.searchParams.get("visiems") === "1" } as Body);
        const e = await liveEvent(db, eventId);
        const remove = method === "DELETE";

        // Pasikartojančio įvykio iš Google — visi kartai.
        if (b.visiems === true && e.series_google_id) {
          const master = await seriesMaster(db, e.series_google_id);
          if (master) {
            // Serija sukurta appse — keičiama jos eilutė (data — serijos pradžios), Google atnaujins kartus.
            if (remove) await deleteEvent(db, master.id);
            else await updateEvent(db, master.id, { ...b, startDate: undefined, endDate: undefined });
            await pushNow(env, master.id);
          } else {
            const cal = await calendarFor(db, env.GOOGLE_SERVICE_ACCOUNT);
            if (!cal) throw new KlaidaVartotojui("Google kalendorius neprijungtas — visų kartų pakeisti negalima.");
            const updated: EventRow = remove ? e : { ...e, ...eventValues({ ...b, recurrence: undefined }, e) };
            await patchGoogleSeries(db, cal, e.series_google_id, updated, remove);
          }
          return Response.json({ ok: true });
        }

        if (remove) await deleteEvent(db, eventId);
        else await updateEvent(db, eventId, b);
        await pushNow(env, eventId);
        return Response.json(remove ? { ok: true } : toIvykis((await rawEvent(db, eventId))!));
      }
    }

    return Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    throw error;
  }
}

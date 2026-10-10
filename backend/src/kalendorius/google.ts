/**
 * Abipusis sinchronizavimas su šeimos Google kalendoriumi.
 *
 * Prisijungimas — Google Cloud paslaugos paskyra (service account): šeima savo kalendorių
 * pasidalina su jos el. pašto adresu („Atlikti įvykių pakeitimus“), o appsas jungiasi jos raktu
 * (Worker'io paslaptis GOOGLE_SERVICE_ACCOUNT, JSON). Jokių naudotojo slaptažodžių ar
 * nuolat besibaigiančių leidimų — raktas galioja, kol jo neištrinsi.
 *
 * - Į Google: appse sukurti, pakeisti ir ištrinti įvykiai (`sync_state = 'laukia'`) siunčiami
 *   iškart po pakeitimo, o nepavykę — kartojami laikmačiu.
 * - Iš Google: kas 2 min. — kas pasikeitė nuo paskutinio karto (`updatedMin`), kartą per dieną —
 *   visas langas (−60 d. … +400 d.), kad nieko nepraleistume. Pasikartojančius įvykius Google
 *   atsiunčia kartais (`singleEvents`), kiekvieną — atskira eilute.
 * - Kas dalyvauja — įvykio spalva Google'e (artimiausia nario spalvai appse) ir tikslus sąrašas
 *   `extendedProperties`.
 *
 * Nemokamame Cloudflare plane vienam paleidimui leidžiama nedaug D1 užklausų, todėl įrašoma
 * paketais (`db.batch`), o didelis importas tęsiamas kitais paleidimais (puslapio žymė).
 */
import { KlaidaVartotojui, todayVilnius, vilniusNow } from "../darbai/bendra";
import { addDays } from "../darbai/pakartojimai";
import { EVENT_COLUMNS, type EventRow } from "./ivykiai";

const API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const TZ = "Europe/Vilnius";
const STATE_KEY = "google-kalendorius";
const TOKEN_KEY = "google-zetonas";

/** Kalendoriaus langas, kurį laikome appse. */
const WINDOW_BACK = 60;
const WINDOW_AHEAD = 400;
/** Kiek puslapių (po 250 įvykių) per vieną paleidimą. */
const PAGES_PER_RUN = 2;
/** Kiek laukiančių pakeitimų išsiųsti per vieną paleidimą. */
const PUSH_PER_RUN = 10;

/** Google kalendoriaus įvykių spalvos (colorId → RGB). */
const GOOGLE_COLORS: Record<string, [number, number, number]> = {
  "1": [121, 134, 203],
  "2": [51, 182, 121],
  "3": [142, 36, 170],
  "4": [230, 124, 115],
  "5": [246, 191, 38],
  "6": [244, 81, 30],
  "7": [3, 155, 229],
  "8": [97, 97, 97],
  "9": [63, 81, 181],
  "10": [11, 128, 67],
  "11": [213, 0, 0],
};

/** Artimiausia Google spalva nario spalvai („#2a78d6“). */
export function googleColor(hex: string): string | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const rgb = [1, 2, 3].map((i) => parseInt(m[i], 16));
  let best: string | null = null;
  let dist = Infinity;
  for (const [id, c] of Object.entries(GOOGLE_COLORS)) {
    const d = c.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (d < dist) [best, dist] = [id, d];
  }
  return best;
}

/** Narių spalvos Google'e: nario id → colorId. */
export type MemberColors = Record<number, string>;

export async function memberColors(db: D1Database): Promise<MemberColors> {
  const { results } = await db.prepare("SELECT id, color FROM members WHERE is_active = 1").all<{ id: number; color: string }>();
  return Object.fromEntries(results.map((m) => [m.id, googleColor(m.color)]).filter(([, c]) => c !== null));
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface GoogleState {
  calendarId?: string;
  /** Paskutinis sėkmingas pakeitimų paėmimas (ISO). */
  lastPull?: string;
  /** Paskutinio pilno lango patikrinimo diena. */
  lastFull?: string;
  /** Nebaigtas pilnas patikrinimas: puslapio žymė ir žyma, kuria pažymimi matyti įvykiai. */
  full?: { run: string; pageToken: string | null; timeMin: string; timeMax: string };
  lastSync?: string;
  error?: string | null;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  recurringEventId?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// ---------- Būsena ----------

export async function readState(db: D1Database): Promise<GoogleState> {
  const row = await db.prepare("SELECT value FROM app_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as GoogleState) : {};
}

const saveState = (db: D1Database, state: GoogleState) =>
  db.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(STATE_KEY, JSON.stringify(state));

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const a = JSON.parse(json) as ServiceAccount;
    return a.client_email && a.private_key ? a : null;
  } catch {
    return null;
  }
}

// ---------- Prisijungimas (JWT, RS256) ----------

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signJwt(account: ServiceAccount, now: Date): Promise<string> {
  const pem = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })
  )}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

/** Google API klientas vienam kalendoriui. Prieigos raktas laikomas app_state iki ~55 min. */
export class GoogleCalendar {
  constructor(
    private db: D1Database,
    private account: ServiceAccount,
    readonly calendarId: string,
    private fetchFn: Fetch = (input, init) => fetch(input, init),
    private now: () => Date = () => new Date()
  ) {}

  private async token(): Promise<string> {
    const cached = await this.db.prepare("SELECT value FROM app_state WHERE key = ?").bind(TOKEN_KEY).first<{ value: string }>();
    if (cached) {
      const t = JSON.parse(cached.value) as { token: string; exp: number; email: string };
      if (t.email === this.account.client_email && t.exp > this.now().getTime() + 60_000) return t.token;
    }
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signJwt(this.account, this.now()) }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) throw new KlaidaVartotojui(`Google neprileido: ${body.error_description ?? body.error ?? res.status}. Patikrink paslaugos paskyros raktą.`);
    await this.db
      .prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .bind(TOKEN_KEY, JSON.stringify({ token: body.access_token, exp: this.now().getTime() + (body.expires_in ?? 3600) * 1000 - 5 * 60_000, email: this.account.client_email }))
      .run();
    return body.access_token;
  }

  /** Užklausa Google kalendoriui; 404/410 grąžinama kaip null (įvykio jau nėra). */
  async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T | null> {
    const url = `${API}/calendars/${encodeURIComponent(this.calendarId)}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const res = await this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status === 204) return {} as T;
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        throw new KlaidaVartotojui(`Google neleidžia keisti šio kalendoriaus — ar jis pasidalintas su ${this.account.client_email} („Atlikti įvykių pakeitimus“)?`);
      }
      throw new KlaidaVartotojui(`Google kalendorius atsakė ${res.status}: ${data.error?.message ?? "klaida"}`);
    }
    return data;
  }

  list(query: Record<string, string>) {
    return this.call<{ items?: GoogleEvent[]; nextPageToken?: string }>("GET", "/events", undefined, query);
  }
  insert(body: unknown) {
    return this.call<GoogleEvent>("POST", "/events", body);
  }
  patch(id: string, body: unknown) {
    return this.call<GoogleEvent>("PATCH", `/events/${encodeURIComponent(id)}`, body);
  }
  remove(id: string) {
    return this.call<object>("DELETE", `/events/${encodeURIComponent(id)}`);
  }
  get(id: string) {
    return this.call<GoogleEvent>("GET", `/events/${encodeURIComponent(id)}`);
  }
  instances(id: string, timeMin: string, timeMax: string) {
    return this.call<{ items?: GoogleEvent[] }>("GET", `/events/${encodeURIComponent(id)}/instances`, undefined, {
      timeMin,
      timeMax,
      maxResults: "250",
      showDeleted: "true",
    });
  }
}

/** Klientas iš Worker'io paslapties ir išsaugoto kalendoriaus; null — neprijungta. */
export async function calendarFor(db: D1Database, serviceAccountJson: string | undefined, fetchFn?: Fetch, now?: () => Date): Promise<GoogleCalendar | null> {
  const account = parseServiceAccount(serviceAccountJson);
  if (!account) return null;
  const state = await readState(db);
  if (!state.calendarId) return null;
  return new GoogleCalendar(db, account, state.calendarId, fetchFn, now);
}

// ---------- Vertimas appsas ↔ Google ----------

const windowDates = (now: Date) => {
  const today = todayVilnius(now);
  return { from: addDays(today, -WINDOW_BACK), to: addDays(today, WINDOW_AHEAD) };
};
/** Vilniaus vietinė data → RFC 3339 laiko žyma lango riboms (pakanka paros tikslumo). */
const rfc = (date: string) => `${date}T00:00:00Z`;

export function toGoogle(e: EventRow, colors: MemberColors = {}): Record<string, unknown> {
  const members = JSON.parse(e.member_ids) as number[];
  const timed = e.start_time !== null;
  return {
    // Atkurtas (atšauktas trynimas) — vėl patvirtintas ir Google'e.
    status: "confirmed",
    summary: e.title,
    description: e.notes ?? "",
    location: e.location ?? "",
    start: timed ? { dateTime: `${e.start_date}T${e.start_time}:00`, timeZone: TZ } : { date: e.start_date },
    end: timed ? { dateTime: `${e.end_date}T${e.end_time}:00`, timeZone: TZ } : { date: addDays(e.end_date, 1) },
    ...(e.recurrence && !e.series_google_id ? { recurrence: [`RRULE:${e.recurrence}`] } : {}),
    // Vienas dalyvis — jo spalva; keli ar visa šeima — kalendoriaus spalva.
    colorId: members.length === 1 ? (colors[members[0]] ?? null) : null,
    extendedProperties: { private: { namai_id: String(e.id), namai_nariai: members.join(",") } },
  };
}

function localDateTime(g: { date?: string; dateTime?: string } | undefined, end: boolean): { date: string; time: string | null } | null {
  if (!g) return null;
  if (g.date) return { date: end ? addDays(g.date, -1) : g.date, time: null };
  if (g.dateTime) return vilniusNow(new Date(g.dateTime));
  return null;
}

/** Google įvykio laukai appso eilutei (null — netinkamas). */
export function fromGoogle(g: GoogleEvent, colors: MemberColors = {}): Omit<EventRow, "id" | "source" | "created_at" | "created_by" | "updated_at" | "deleted_at" | "sync_state" | "sync_error"> | null {
  const start = localDateTime(g.start, false);
  const end = localDateTime(g.end, true);
  if (!start || !end) return null;
  const priv = g.extendedProperties?.private ?? {};
  // Spalva → narys, tik jei ta spalva vienam nariui.
  const byColor = Object.entries(colors).filter(([, c]) => c === g.colorId);
  const color = byColor.length === 1 ? byColor[0][0] : undefined;
  const members =
    priv.namai_nariai !== undefined ? priv.namai_nariai.split(",").filter(Boolean).map(Number) : color ? [Number(color)] : [];
  const rrule = g.recurrence?.find((r) => r.startsWith("RRULE:"));
  return {
    title: (g.summary ?? "").trim() || "(be pavadinimo)",
    notes: g.description?.trim() || null,
    location: g.location?.trim() || null,
    start_date: start.date,
    start_time: start.time,
    // Visos dienos įvykis Google'e baigiasi kitą dieną (neimtinai).
    end_date: end.date < start.date ? start.date : end.date,
    end_time: end.time,
    member_ids: JSON.stringify(members),
    recurrence: rrule ? rrule.slice(6) : null,
    series_google_id: g.recurringEventId ?? null,
    google_id: g.id,
  };
}

// ---------- Į Google ----------

/** Pasikartojančio įvykio kartai iš Google — atskiromis eilutėmis. */
async function refreshInstances(db: D1Database, cal: GoogleCalendar, seriesId: string, now: Date): Promise<void> {
  const { from, to } = windowDates(now);
  const data = await cal.instances(seriesId, rfc(from), rfc(to));
  await upsert(db, data?.items ?? [], now, null);
}

/** Išsiunčia vieną laukiantį pakeitimą. Klaida įrašoma prie įvykio (matoma appse) ir metama toliau. */
export async function pushEvent(db: D1Database, cal: GoogleCalendar, e: EventRow, now = new Date()): Promise<void> {
  try {
    if (e.deleted_at) {
      if (e.google_id) await cal.remove(e.google_id);
      // Ištrinta serija — ir jos kartai.
      if (e.google_id && e.recurrence) {
        await db.prepare("UPDATE events SET deleted_at = ?, sync_state = 'sinchronizuota' WHERE series_google_id = ? AND deleted_at IS NULL").bind(now.toISOString(), e.google_id).run();
      }
    } else {
      const colors = await memberColors(db);
      let saved = e.google_id ? await cal.patch(e.google_id, toGoogle(e, colors)) : null;
      // Nauja arba Google'e jau ištrinta (atkurta appse) — sukuriama iš naujo.
      if (!saved) saved = await cal.insert(toGoogle({ ...e, series_google_id: null }, colors));
      if (!saved?.id) throw new KlaidaVartotojui("Google negrąžino įvykio.");
      if (saved.id !== e.google_id) await db.prepare("UPDATE events SET google_id = ? WHERE id = ?").bind(saved.id, e.id).run();
      if (e.recurrence) await refreshInstances(db, cal, saved.id, now);
    }
    await db.prepare("UPDATE events SET sync_state = 'sinchronizuota', sync_error = NULL WHERE id = ? AND updated_at = ?").bind(e.id, e.updated_at).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare("UPDATE events SET sync_state = 'klaida', sync_error = ? WHERE id = ? AND updated_at = ?").bind(message.slice(0, 300), e.id, e.updated_at).run();
    throw error;
  }
}

/** Visi laukiantys (ir nepavykę) pakeitimai — po PUSH_PER_RUN. */
export async function pushPending(db: D1Database, cal: GoogleCalendar, now = new Date()): Promise<number> {
  const { results } = await db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE sync_state IN ('laukia', 'klaida') ORDER BY updated_at LIMIT ?`)
    .bind(PUSH_PER_RUN)
    .all<EventRow>();
  let pushed = 0;
  for (const e of results) {
    try {
      await pushEvent(db, cal, e, now);
      pushed++;
    } catch (error) {
      console.error("Google: nepavyko išsiųsti įvykio", e.id, error);
    }
  }
  return pushed;
}

/**
 * Serijos (visų kartų) pakeitimas ar trynimas Google'e, kai serija atėjo iš Google (appse jos
 * eilutės nėra — tik kartai). Laukai — kaip toGoogle (laikas — šio karto, data — serijos pradžios).
 */
export async function patchGoogleSeries(
  db: D1Database,
  cal: GoogleCalendar,
  seriesId: string,
  occurrence: EventRow,
  remove: boolean,
  now = new Date()
): Promise<void> {
  if (remove) {
    await cal.remove(seriesId);
    await db.prepare("UPDATE events SET deleted_at = ?, sync_state = 'sinchronizuota' WHERE series_google_id = ?").bind(now.toISOString(), seriesId).run();
    return;
  }
  const master = await cal.get(seriesId);
  if (!master) throw new KlaidaVartotojui("Šios serijos Google kalendoriuje nebėra.");
  const colors = await memberColors(db);
  const body = toGoogle(occurrence, colors);
  // Serijos pradžia lieka sava — keičiamas tik laikas (ir trukmė).
  const masterStart = localDateTime(master.start, false);
  if (masterStart) {
    const shift = Math.round((Date.parse(occurrence.end_date) - Date.parse(occurrence.start_date)) / 86_400_000);
    const seriesEvent = { ...occurrence, start_date: masterStart.date, end_date: addDays(masterStart.date, shift) };
    Object.assign(body, { start: toGoogle(seriesEvent, colors).start, end: toGoogle(seriesEvent, colors).end });
  }
  delete (body as { recurrence?: unknown }).recurrence;
  await cal.patch(seriesId, body);
  await refreshInstances(db, cal, seriesId, now);
}

// ---------- Iš Google ----------

/**
 * Įrašo Google įvykius paketu: nauji — įterpiami, esami — atnaujinami (išskyrus tuos, kurių
 * pakeitimas appse dar neišsiųstas — tie laimi), atšaukti — pažymimi ištrintais.
 */
async function upsert(db: D1Database, items: GoogleEvent[], now: Date, seenRun: string | null): Promise<void> {
  if (items.length === 0) return;
  const at = now.toISOString();
  const colors = await memberColors(db);
  const statements: D1PreparedStatement[] = [];
  for (const g of items) {
    if (g.recurrence && !g.recurringEventId && g.status !== "cancelled") {
      // Serijos įrašas (ne kartas) — appse jį turi tik ta eilutė, iš kurios serija sukurta.
      continue;
    }
    if (g.status === "cancelled") {
      statements.push(
        db
          .prepare("UPDATE events SET deleted_at = COALESCE(deleted_at, ?), sync_state = 'sinchronizuota' WHERE google_id = ? AND sync_state != 'laukia'")
          .bind(at, g.id)
      );
      continue;
    }
    const v = fromGoogle(g, colors);
    if (!v) continue;
    // Ką tik sukurtas appse, bet id dar neįrašytas (nutrūko) — pririšam prie tos eilutės.
    const namaiId = Number(g.extendedProperties?.private?.namai_id);
    if (Number.isInteger(namaiId) && namaiId > 0 && !g.recurringEventId) {
      statements.push(db.prepare("UPDATE events SET google_id = ? WHERE id = ? AND google_id IS NULL").bind(g.id, namaiId));
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO events (title, notes, location, start_date, start_time, end_date, end_time, member_ids, recurrence, series_google_id,
             source, created_at, updated_at, google_id, sync_state, seen_run)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'google', ?11, ?11, ?12, 'sinchronizuota', ?13)
           ON CONFLICT(google_id) DO UPDATE SET title = ?1, notes = ?2, location = ?3, start_date = ?4, start_time = ?5, end_date = ?6,
             end_time = ?7, member_ids = ?8, recurrence = COALESCE(events.recurrence, ?9), series_google_id = ?10, deleted_at = NULL,
             seen_run = ?13
           WHERE events.sync_state != 'laukia'`
        )
        .bind(v.title, v.notes, v.location, v.start_date, v.start_time, v.end_date, v.end_time, v.member_ids, v.recurrence, v.series_google_id, at, v.google_id, seenRun)
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/** Pakeitimai iš Google: kas pasikeitė nuo paskutinio karto, arba (kartą per dieną) visas langas. */
export async function pull(db: D1Database, cal: GoogleCalendar, state: GoogleState, now = new Date()): Promise<GoogleState> {
  const today = todayVilnius(now);
  const next: GoogleState = { ...state };

  if (!state.full && state.lastFull !== today) {
    const { from, to } = windowDates(now);
    next.full = { run: now.toISOString(), pageToken: null, timeMin: rfc(from), timeMax: rfc(to) };
  }

  if (next.full) {
    // Pilnas langas — tęsiamas tiek paleidimų, kiek reikia.
    const f = next.full;
    let pageToken = f.pageToken;
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const data = await cal.list({
        singleEvents: "true",
        showDeleted: "true",
        timeMin: f.timeMin,
        timeMax: f.timeMax,
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      });
      await upsert(db, data?.items ?? [], now, f.run);
      pageToken = data?.nextPageToken ?? null;
      if (!pageToken) break;
    }
    if (pageToken) {
      next.full = { ...f, pageToken };
    } else {
      // Ko Google'e lange nebėra — ištrinta (ir mes praleidome). Appso serijų eilutės (recurrence) Google
      // kartais nesiunčia, laukiantys — dar neišsiųsti, todėl jų neliečiam.
      await db
        .prepare(
          `UPDATE events SET deleted_at = ?, sync_state = 'sinchronizuota'
           WHERE google_id IS NOT NULL AND recurrence IS NULL AND deleted_at IS NULL AND sync_state = 'sinchronizuota'
             AND start_date BETWEEN ? AND ? AND (seen_run IS NULL OR seen_run != ?)`
        )
        .bind(now.toISOString(), f.timeMin.slice(0, 10), addDays(f.timeMax.slice(0, 10), -1), f.run)
        .run();
      next.full = undefined;
      next.lastFull = today;
      next.lastPull = f.run;
    }
    return next;
  }

  // Kas pasikeitė nuo paskutinio karto (su atsarga dėl laikrodžių skirtumo).
  const since = new Date(Date.parse(state.lastPull ?? now.toISOString()) - 2 * 60_000).toISOString();
  const { from, to } = windowDates(now);
  let pageToken: string | null = null;
  for (let page = 0; page < PAGES_PER_RUN; page++) {
    const data: { items?: GoogleEvent[]; nextPageToken?: string } | null = await cal.list({
      singleEvents: "true",
      showDeleted: "true",
      updatedMin: since,
      timeMin: rfc(from),
      timeMax: rfc(to),
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    await upsert(db, data?.items ?? [], now, null);
    pageToken = data?.nextPageToken ?? null;
    if (!pageToken) break;
  }
  next.lastPull = now.toISOString();
  return next;
}

/** Vienas sinchronizavimo ratas: išsiųsti laukiančius, paimti pakeitimus. Klaida įrašoma į būseną. */
export async function syncGoogle(db: D1Database, serviceAccountJson: string | undefined, fetchFn?: Fetch, now = new Date()): Promise<GoogleState | null> {
  const cal = await calendarFor(db, serviceAccountJson, fetchFn, () => now);
  if (!cal) return null;
  let state = await readState(db);
  try {
    await pushPending(db, cal, now);
    state = await pull(db, cal, state, now);
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    console.error("Google sinchronizavimas", error);
  }
  state.lastSync = now.toISOString();
  await saveState(db, state).run();
  return state;
}

/** Laikmačiui: kas 2 minutes. */
export async function scheduledGoogleSync(db: D1Database, serviceAccountJson: string | undefined, now = new Date()): Promise<void> {
  if (now.getUTCMinutes() % 2 !== 0) return;
  await syncGoogle(db, serviceAccountJson, undefined, now);
}

/** Prijungia kalendorių: patikrina prieigą ir išsaugo; pirmas sinchronizavimas — iškart. */
export async function connectCalendar(
  db: D1Database,
  serviceAccountJson: string | undefined,
  calendarId: unknown,
  fetchFn?: Fetch,
  now = new Date()
): Promise<GoogleState> {
  const account = parseServiceAccount(serviceAccountJson);
  if (!account) throw new KlaidaVartotojui("Google paslaugos paskyros raktas dar neįkeltas.");
  const id = typeof calendarId === "string" ? calendarId.trim() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(id)) throw new KlaidaVartotojui("Įrašyk kalendoriaus adresą — šeimos Google paskyros el. paštą.");
  const cal = new GoogleCalendar(db, account, id, fetchFn, () => now);
  // Prieigos patikra: skaitymas ir įrašymas (bandomasis įvykis iškart ištrinamas).
  await cal.list({ maxResults: "1" });
  const probe = await cal.insert({ summary: "Namai — jungties patikra", start: { date: todayVilnius(now) }, end: { date: addDays(todayVilnius(now), 1) } });
  if (probe?.id) await cal.remove(probe.id);
  await saveState(db, { calendarId: id }).run();
  return (await syncGoogle(db, serviceAccountJson, fetchFn, now)) ?? { calendarId: id };
}

export async function disconnectCalendar(db: D1Database): Promise<void> {
  await db.batch([saveState(db, {}), db.prepare("DELETE FROM app_state WHERE key = ?").bind(TOKEN_KEY)]);
}

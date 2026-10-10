/**
 * Šeimos kalendoriaus įvykiai: vizitai, repeticijos, būreliai, renginiai. Laikas — Vilniaus
 * vietinis. Kiekvienas pakeitimas pažymimas `sync_state = 'laukia'` — google.ts jį nusiunčia į
 * Google kalendorių (jei prijungtas), o iš Google ateinantys įvykiai įrašomi čia pat.
 *
 * Pasikartojantis įvykis: kol neišsiųstas į Google — kartai skaičiuojami čia (`occurrences`);
 * kai Google jį turi — kiekvieną kartą Google atsiunčia atskira eilute (`series_google_id`),
 * o pati serijos eilutė kalendoriuje nerodoma.
 */
import { KlaidaVartotojui, text } from "../darbai/bendra";
import { addDays, formatRule, isDate, nextDue, parseRule } from "../darbai/pakartojimai";

export type Source = "rankinis" | "ai" | "claude" | "google";

export interface EventRow {
  id: number;
  title: string;
  notes: string | null;
  location: string | null;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
  member_ids: string;
  recurrence: string | null;
  series_google_id: string | null;
  source: Source;
  created_at: string;
  created_by: number | null;
  updated_at: string;
  deleted_at: string | null;
  google_id: string | null;
  sync_state: "laukia" | "sinchronizuota" | "klaida";
  sync_error: string | null;
}

/** Įvykis kalendoriuje (vienas kartas). */
export interface Ivykis {
  id: number;
  title: string;
  notes: string | null;
  location: string | null;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
  members: number[];
  recurrence: string | null;
  /** Pasikartojančio įvykio kartas (keičiant — „tik šį“ ar „visus“). */
  series: boolean;
  source: Source;
  google: boolean;
  /** Google įvykio id — nuorodai „Atidaryti Google kalendoriuje“. */
  google_id: string | null;
  sync_state: EventRow["sync_state"];
  sync_error: string | null;
}

export interface EventInput {
  title?: unknown;
  notes?: unknown;
  location?: unknown;
  startDate?: unknown;
  startTime?: unknown;
  endDate?: unknown;
  endTime?: unknown;
  memberIds?: unknown;
  recurrence?: unknown;
}

export const EVENT_COLUMNS = `id, title, notes, location, start_date, start_time, end_date, end_time, member_ids, recurrence,
  series_google_id, source, created_at, created_by, updated_at, deleted_at, google_id, sync_state, sync_error`;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Values = Pick<EventRow, "title" | "notes" | "location" | "start_date" | "start_time" | "end_date" | "end_time" | "member_ids" | "recurrence">;

/** Patikrina ir sutvarko laukus; `base` — esamas įvykis (ko nesiunčia — lieka). */
export function eventValues(input: EventInput, base: Values | null): Values {
  const has = (k: keyof EventInput) => input[k] !== undefined;
  const title = has("title") ? text(input.title, "pavadinimas", 200) : (base?.title ?? null);
  if (!title) throw new KlaidaVartotojui("Įvykiui reikia pavadinimo.");

  const startDate = has("startDate") ? text(input.startDate, "data", 10) : (base?.start_date ?? null);
  if (!startDate || !isDate(startDate)) throw new KlaidaVartotojui("Netinkama įvykio data.");
  const startTime = has("startTime") ? text(input.startTime, "pradžia", 5) : (base?.start_time ?? null);
  if (startTime !== null && !TIME.test(startTime)) throw new KlaidaVartotojui("Netinkamas laikas — rašyk, pvz., 15:00.");

  // Pakeitus pradžios datą, pabaiga pasislenka kartu (trukmė išlieka), jei jos nesiunčia.
  let endDate = has("endDate") ? text(input.endDate, "pabaigos data", 10) : base ? addDays(startDate, daysBetween(base.start_date, base.end_date)) : null;
  endDate = endDate ?? startDate;
  if (!isDate(endDate)) throw new KlaidaVartotojui("Netinkama pabaigos data.");
  if (endDate < startDate) throw new KlaidaVartotojui("Pabaiga negali būti anksčiau už pradžią.");

  let endTime: string | null = null;
  if (startTime !== null) {
    const abs = (d: string, t: string) => daysBetween("2000-01-01", d) * 1440 + minutes(t);
    const fromAbs = (m: number) => ({ date: addDays("2000-01-01", Math.floor(m / 1440)), time: hhmm(((m % 1440) + 1440) % 1440) });
    if (has("endTime")) {
      endTime = text(input.endTime, "pabaiga", 5);
      if (endTime !== null && !TIME.test(endTime)) throw new KlaidaVartotojui("Netinkamas pabaigos laikas.");
    } else if (base?.start_time && base.end_time && !has("endDate")) {
      // Perkėlus pradžią, trukmė išlieka.
      const end = fromAbs(abs(startDate, startTime) + abs(base.end_date, base.end_time) - abs(base.start_date, base.start_time));
      endDate = end.date;
      endTime = end.time;
    }
    if (endTime === null) {
      // Be pabaigos — valanda.
      const end = fromAbs(abs(startDate, startTime) + 60);
      if (!has("endDate") || end.date > endDate) endDate = end.date;
      endTime = end.time;
    }
    if (endDate === startDate && minutes(endTime) <= minutes(startTime)) throw new KlaidaVartotojui("Pabaiga turi būti vėliau už pradžią.");
    if (endDate < startDate) throw new KlaidaVartotojui("Pabaiga negali būti anksčiau už pradžią.");
  }

  let recurrence = has("recurrence") ? text(input.recurrence, "pakartojimas", 100) : (base?.recurrence ?? null);
  if (recurrence !== null) {
    const rule = parseRule(recurrence);
    if (!rule) throw new KlaidaVartotojui("Netinkamas pakartojimas.");
    recurrence = formatRule(rule);
  }

  return {
    title,
    notes: has("notes") ? text(input.notes, "pastabos", 5000) : (base?.notes ?? null),
    location: has("location") ? text(input.location, "vieta", 300) : (base?.location ?? null),
    start_date: startDate,
    start_time: startTime,
    end_date: endDate,
    end_time: endTime,
    member_ids: has("memberIds") ? JSON.stringify(memberList(input.memberIds)) : (base?.member_ids ?? "[]"),
    recurrence,
  };
}

function memberList(value: unknown): number[] {
  if (value === null || value === undefined || value === "") return [];
  if (!Array.isArray(value)) throw new KlaidaVartotojui("Netinkamas dalyvių sąrašas.");
  const ids = value.map(Number);
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) throw new KlaidaVartotojui("Netinkamas dalyvių sąrašas.");
  return [...new Set(ids)].sort((a, b) => a - b);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

async function checkMembers(db: D1Database, memberIds: string): Promise<void> {
  const ids = JSON.parse(memberIds) as number[];
  if (ids.length === 0) return;
  const { results } = await db
    .prepare("SELECT id FROM members WHERE is_active = 1 AND id IN (SELECT value FROM json_each(?))")
    .bind(memberIds)
    .all<{ id: number }>();
  if (results.length !== ids.length) throw new KlaidaVartotojui("Tokio šeimos nario nėra.");
}

export const rawEvent = (db: D1Database, eventId: number) =>
  db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(eventId).first<EventRow>();

export async function liveEvent(db: D1Database, eventId: number): Promise<EventRow> {
  const e = Number.isInteger(eventId) ? await rawEvent(db, eventId) : null;
  if (!e || e.deleted_at) throw new KlaidaVartotojui("Tokio įvykio nėra — gal jį kas tik ką ištrynė.");
  return e;
}

export function toIvykis(e: EventRow, date?: string): Ivykis {
  const shift = date ? daysBetween(e.start_date, date) : 0;
  return {
    id: e.id,
    title: e.title,
    notes: e.notes,
    location: e.location,
    start_date: shift ? addDays(e.start_date, shift) : e.start_date,
    start_time: e.start_time,
    end_date: shift ? addDays(e.end_date, shift) : e.end_date,
    end_time: e.end_time,
    members: JSON.parse(e.member_ids) as number[],
    recurrence: e.recurrence,
    series: e.recurrence !== null || e.series_google_id !== null,
    source: e.source,
    google: e.google_id !== null,
    google_id: e.google_id,
    sync_state: e.sync_state,
    sync_error: e.sync_error,
  };
}

export async function createEvent(db: D1Database, input: EventInput, memberId: number | null, now = new Date(), source: Exclude<Source, "google"> = "rankinis"): Promise<EventRow> {
  const v = eventValues(input, null);
  await checkMembers(db, v.member_ids);
  const at = now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO events (title, notes, location, start_date, start_time, end_date, end_time, member_ids, recurrence, source,
         created_at, created_by, updated_at, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'laukia') RETURNING ${EVENT_COLUMNS}`
    )
    .bind(v.title, v.notes, v.location, v.start_date, v.start_time, v.end_date, v.end_time, v.member_ids, v.recurrence, source, at, memberId, at)
    .first<EventRow>();
  return row!;
}

/** Keičia vieną įvykį (ar vieną pasikartojančio įvykio kartą iš Google). */
export async function updateEvent(db: D1Database, eventId: number, input: EventInput, now = new Date()): Promise<EventRow> {
  const e = await liveEvent(db, eventId);
  // Google serijos kartas — pakartojimo neturi ir jo čia nekeičia.
  const v = eventValues(e.series_google_id ? { ...input, recurrence: undefined } : input, e);
  await checkMembers(db, v.member_ids);
  const row = await db
    .prepare(
      `UPDATE events SET title = ?, notes = ?, location = ?, start_date = ?, start_time = ?, end_date = ?, end_time = ?,
         member_ids = ?, recurrence = ?, updated_at = ?, sync_state = 'laukia', sync_error = NULL
       WHERE id = ? RETURNING ${EVENT_COLUMNS}`
    )
    .bind(v.title, v.notes, v.location, v.start_date, v.start_time, v.end_date, v.end_time, v.member_ids, v.recurrence, now.toISOString(), eventId)
    .first<EventRow>();
  return row!;
}

/** Ištrina (žyma `deleted_at`; Google'e ištrinama sinchronizuojant). */
export async function deleteEvent(db: D1Database, eventId: number, now = new Date()): Promise<void> {
  const e = await liveEvent(db, eventId);
  await db
    .prepare("UPDATE events SET deleted_at = ?, updated_at = ?, sync_state = ? WHERE id = ?")
    .bind(now.toISOString(), now.toISOString(), e.google_id ? "laukia" : "sinchronizuota", eventId)
    .run();
}

/** Atšaukimui: grąžina ištrintą (Google'e bus sukurtas iš naujo, jei ten jau ištrintas). */
export async function restoreEvent(db: D1Database, eventId: number, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE events SET deleted_at = NULL, updated_at = ?, sync_state = 'laukia' WHERE id = ?")
    .bind(now.toISOString(), eventId)
    .run();
}

/** Pasikartojančio įvykio, dar nežinomo Google, kartai intervale. */
export function occurrences(e: EventRow, from: string, to: string): string[] {
  const rule = e.recurrence ? parseRule(e.recurrence) : null;
  if (!rule) return [];
  const length = daysBetween(e.start_date, e.end_date);
  const out: string[] = [];
  let d = e.start_date;
  for (let i = 0; i < 2000 && d <= to; i++) {
    if (addDays(d, length) >= from) out.push(d);
    d = nextDue(rule, e.start_date, d);
  }
  return out;
}

/** Kalendorius intervale [from, to]: kiekvienas įvykio kartas, surikiuota pagal pradžią. */
export async function listEvents(db: D1Database, from: string, to: string): Promise<Ivykis[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE deleted_at IS NULL AND (
         (recurrence IS NULL AND start_date <= ?2 AND end_date >= ?1)
         OR (recurrence IS NOT NULL AND google_id IS NULL AND start_date <= ?2))`
    )
    .bind(from, to)
    .all<EventRow>();
  const out: Ivykis[] = [];
  for (const e of results) {
    if (e.recurrence) for (const d of occurrences(e, from, to)) out.push(toIvykis(e, d));
    else out.push(toIvykis(e));
  }
  return out.sort(
    (a, b) =>
      a.start_date.localeCompare(b.start_date) ||
      (a.start_time === null ? -1 : b.start_time === null ? 1 : a.start_time.localeCompare(b.start_time)) ||
      a.id - b.id
  );
}

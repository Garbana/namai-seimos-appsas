/**
 * Claude jungtys (lentelė claude_jungtys) — bendra Claude jungties Worker'iui (src/mcp/index.ts)
 * ir appsui (src/claude.ts).
 *
 * Kelias: Claude → /authorize (jungties Worker'is įrašo prašymą, būsena „laukia“) → appsas
 * (žmogus už Access pasirenka, kas jungiasi, ir paspaudžia „Leisti“ arba „Neleisti“) →
 * /callback (jungties Worker'is atiduoda Claude raktą, būsena „prijungta“). Kiekviena Claude
 * užklausa tikrina, ar jungtis vis dar prijungta (appse ją galima atjungti).
 */
import { KlaidaVartotojui } from "../darbai/bendra";

/** Kiek laiko galioja prašymas (tiek pat, kiek bibliotekos naršyklės susiejimas). */
export const PRASYMO_MINUTES = 10;

export type Busena = "laukia" | "leista" | "atmesta" | "prijungta" | "atjungta";

export interface Jungtis {
  id: number;
  client_id: string;
  client_name: string;
  redirect_host: string;
  local_app: number;
  status: Busena;
  member_id: number | null;
  created_at: string;
  decided_at: string | null;
  connected_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

const COLUMNS = `id, client_id, client_name, redirect_host, local_app, status, member_id, created_at, decided_at,
  connected_at, last_used_at, revoked_at`;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const expired = (j: Pick<Jungtis, "created_at">, now: Date) => now.getTime() - Date.parse(j.created_at) > PRASYMO_MINUTES * 60_000;

/** Naujas prašymas (/authorize). */
export async function recordRequest(
  db: D1Database,
  state: string,
  client: { clientId: string; clientName: string; redirectHost: string; localApp: boolean },
  now = new Date()
): Promise<void> {
  await db
    .prepare("INSERT INTO claude_jungtys (state_hash, client_id, client_name, redirect_host, local_app, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(state), client.clientId, client.clientName.slice(0, 200), client.redirectHost.slice(0, 200), client.localApp ? 1 : 0, now.toISOString())
    .run();
}

export async function requestByState(db: D1Database, state: string | null): Promise<Jungtis | null> {
  if (!state) return null;
  return db.prepare(`SELECT ${COLUMNS} FROM claude_jungtys WHERE state_hash = ?`).bind(await sha256Hex(state)).first<Jungtis>();
}

/** Žmogus appse: leisti (kieno vardu) ar neleisti. */
export async function decide(db: D1Database, state: string | null, memberId: number | null, allow: boolean, now = new Date()): Promise<Jungtis> {
  const j = await requestByState(db, state);
  if (!j) throw new KlaidaVartotojui("Tokio prašymo nėra — pradėk jungti iš naujo Claude programoje.");
  if (j.status !== "laukia") throw new KlaidaVartotojui("Šis prašymas jau išspręstas.");
  if (expired(j, now)) throw new KlaidaVartotojui(`Prašymas pasibaigė (galioja ${PRASYMO_MINUTES} min.) — pradėk jungti iš naujo Claude programoje.`);
  if (allow && memberId === null) throw new KlaidaVartotojui("Pasirink, kas jungiasi.");
  const row = await db
    .prepare(`UPDATE claude_jungtys SET status = ?, member_id = ?, decided_at = ? WHERE id = ? AND status = 'laukia' RETURNING ${COLUMNS}`)
    .bind(allow ? "leista" : "atmesta", allow ? memberId : null, now.toISOString(), j.id)
    .first<Jungtis>();
  if (!row) throw new KlaidaVartotojui("Šis prašymas jau išspręstas.");
  return row;
}

/**
 * Claude gavo raktą. Ankstesnės to paties nario jungtys iš tos pačios programos atjungiamos —
 * jų raktus biblioteka jau atšaukė (naujas leidimas pakeičia seną).
 */
export async function markConnected(db: D1Database, j: Jungtis, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db
      .prepare("UPDATE claude_jungtys SET status = 'atjungta', revoked_at = ? WHERE status = 'prijungta' AND member_id IS ? AND client_id = ? AND id <> ?")
      .bind(at, j.member_id, j.client_id, j.id),
    db.prepare("UPDATE claude_jungtys SET status = 'prijungta', connected_at = ? WHERE id = ?").bind(at, j.id),
  ]);
}

/** Ar jungtis dar prijungta; jei taip — pažymi, kada naudota (ne dažniau nei kas 5 min.). */
export async function stillConnected(db: D1Database, id: number, now = new Date()): Promise<boolean> {
  const j = await db.prepare("SELECT status, last_used_at FROM claude_jungtys WHERE id = ?").bind(id).first<Pick<Jungtis, "status" | "last_used_at">>();
  if (j?.status !== "prijungta") return false;
  if (!j.last_used_at || now.getTime() - Date.parse(j.last_used_at) > 5 * 60_000) {
    await db.prepare("UPDATE claude_jungtys SET last_used_at = ? WHERE id = ?").bind(now.toISOString(), id).run();
  }
  return true;
}

export async function listConnected(db: D1Database): Promise<(Jungtis & { member_name: string | null })[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS.replace(/(\w+)/g, "j.$1")}, m.name AS member_name FROM claude_jungtys j
       LEFT JOIN members m ON m.id = j.member_id WHERE j.status = 'prijungta' ORDER BY j.connected_at DESC`
    )
    .all<Jungtis & { member_name: string | null }>();
  return results;
}

export async function disconnect(db: D1Database, id: number, now = new Date()): Promise<void> {
  const r = await db
    .prepare("UPDATE claude_jungtys SET status = 'atjungta', revoked_at = ? WHERE id = ? AND status = 'prijungta'")
    .bind(now.toISOString(), id)
    .run();
  if (!r.meta.changes) throw new KlaidaVartotojui("Tokios prijungtos jungties nėra.");
}

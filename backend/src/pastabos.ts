/**
 * Pastabos apie patį appsą (klaidos, nepatogumai, idėjos, netikę asistento atsakymai).
 * Įrašomos iš skilties „Pastabos“, iš asistento (įrankis save_feedback) ir mygtuku „👎“
 * prie asistento atsakymo. Peržiūri ir tvarko Claude; API — /api/pastabos.
 */
import { actingMember } from "./darbai/nariai";
import { id, KlaidaVartotojui, text } from "./darbai/bendra";

export type Kind = "klaida" | "nepatogu" | "ideja" | "asistentas";
export type Status = "nauja" | "sutvarkyta" | "atmesta";

export const KINDS: Kind[] = ["klaida", "nepatogu", "ideja", "asistentas"];
const STATUSES: Status[] = ["nauja", "sutvarkyta", "atmesta"];

export interface Feedback {
  id: number;
  kind: Kind;
  text: string;
  screen: string | null;
  details: string | null;
  ai_request_id: number | null;
  member_id: number | null;
  status: Status;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FeedbackInput {
  kind?: unknown;
  text?: unknown;
  screen?: unknown;
  aiRequestId?: unknown;
  memberId?: unknown;
}

/** Asistento pokalbio ištrauka pastabai: ką žmogus parašė, ką atsakė, ką pasiūlė. */
async function exchangeSnapshot(db: D1Database, requestId: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT text, reply, actions_json, error FROM ai_requests WHERE id = ?")
    .bind(requestId)
    .first<{ text: string; reply: string | null; actions_json: string; error: string | null }>();
  if (!row) return null;
  const actions = (JSON.parse(row.actions_json) as { tipas: string; busena: string; pavadinimas?: string; klaida?: string; laukai?: unknown }[])
    .map((a) => `${a.tipas} (${a.busena})${a.pavadinimas ? ` „${a.pavadinimas}“` : ""}${a.klaida ? `: ${a.klaida}` : ""}${a.laukai ? ` ${JSON.stringify(a.laukai)}` : ""}`)
    .join("; ");
  return [
    `Žmogus: ${row.text}`,
    `Asistentas: ${row.reply ?? "—"}`,
    actions ? `Veiksmai: ${actions}` : null,
    row.error ? `Klaida: ${row.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createFeedback(db: D1Database, input: FeedbackInput, now = new Date()): Promise<Feedback> {
  const kind = input.kind as Kind;
  if (!KINDS.includes(kind)) throw new KlaidaVartotojui("Netinkama pastabos rūšis.");
  const body = text(input.text, "pastaba", 4000) ?? "";
  const aiRequestId = id(input.aiRequestId, "asistento žinutė");
  if (!body && !aiRequestId) throw new KlaidaVartotojui("Parašyk ar pasakyk, kas negerai ar ką norėtum.");
  const memberId = await actingMember(db, input.memberId);
  const details = aiRequestId ? await exchangeSnapshot(db, aiRequestId) : null;

  const row = await db
    .prepare(
      `INSERT INTO feedback (kind, text, screen, details, ai_request_id, member_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(kind, body, text(input.screen, "ekranas", 100), details, details ? aiRequestId : null, memberId, now.toISOString())
    .first<Feedback>();
  return row!;
}

export async function listFeedback(db: D1Database): Promise<Feedback[]> {
  const { results } = await db
    .prepare("SELECT * FROM feedback ORDER BY status = 'nauja' DESC, created_at DESC LIMIT 300")
    .all<Feedback>();
  return results;
}

/** Būsena (nauja / sutvarkyta / atmesta) ir, jei reikia, tekstas ar sprendimo aprašas. */
export async function updateFeedback(
  db: D1Database,
  feedbackId: number,
  input: { status?: unknown; text?: unknown; resolution?: unknown; kind?: unknown },
  now = new Date()
): Promise<Feedback> {
  const current = await db.prepare("SELECT * FROM feedback WHERE id = ?").bind(feedbackId).first<Feedback>();
  if (!current) throw new KlaidaVartotojui("Tokios pastabos nėra.");
  const status = input.status === undefined ? current.status : (input.status as Status);
  if (!STATUSES.includes(status)) throw new KlaidaVartotojui("Netinkama būsena.");
  const kind = input.kind === undefined ? current.kind : (input.kind as Kind);
  if (!KINDS.includes(kind)) throw new KlaidaVartotojui("Netinkama pastabos rūšis.");
  const body = input.text === undefined ? current.text : (text(input.text, "pastaba", 4000) ?? "");
  const resolution = input.resolution === undefined ? current.resolution : text(input.resolution, "sprendimas", 2000);
  const resolvedAt = status === "nauja" ? null : status === current.status ? current.resolved_at : now.toISOString();

  const row = await db
    .prepare("UPDATE feedback SET kind = ?, text = ?, status = ?, resolution = ?, resolved_at = ? WHERE id = ? RETURNING *")
    .bind(kind, body, status, resolution, resolvedAt, feedbackId)
    .first<Feedback>();
  return row!;
}

export async function deleteFeedback(db: D1Database, feedbackId: number): Promise<void> {
  await db.prepare("DELETE FROM feedback WHERE id = ?").bind(feedbackId).run();
}

/** null — ne šios skilties adresas. */
export async function handlePastabos(url: URL, request: Request, db: D1Database): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/pastabos" && !path.startsWith("/api/pastabos/")) return null;
  const body = async () => {
    try {
      return (await request.json()) as Record<string, unknown>;
    } catch {
      throw new KlaidaVartotojui("Netinkamas užklausos turinys.");
    }
  };
  try {
    if (path === "/api/pastabos" && request.method === "GET") return Response.json(await listFeedback(db));
    if (path === "/api/pastabos" && request.method === "POST") return Response.json(await createFeedback(db, await body()));
    const m = path.match(/^\/api\/pastabos\/(\d+)$/);
    if (m && request.method === "PATCH") return Response.json(await updateFeedback(db, Number(m[1]), await body()));
    if (m && request.method === "DELETE") {
      await deleteFeedback(db, Number(m[1]));
      return Response.json({ ok: true });
    }
    return Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    throw error;
  }
}

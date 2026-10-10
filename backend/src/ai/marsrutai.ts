/** Asistento API: /api/asistentas/*. */
import { KlaidaVartotojui } from "../darbai/bendra";
import { ask, confirm, conversation, history, reject, undoAction } from "./asistentas";
import { calendarFor, pushPending } from "../kalendorius/google";
import { ijungta } from "../nustatymai";
import { anthropicCaller } from "./modelis";

type AsistentoEnv = { DB: D1Database; ANTHROPIC_API_KEY?: string; GOOGLE_SERVICE_ACCOUNT?: string; MODULIAI?: string; SEIMA?: string };

/** Jei yra neišsiųstų kalendoriaus pakeitimų ir Google prijungtas — išsiunčia (klaida nesustabdo atsakymo). */
async function pushPendingNow(env: { DB: D1Database; GOOGLE_SERVICE_ACCOUNT?: string }): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT) return;
  try {
    const pending = await env.DB.prepare("SELECT 1 FROM events WHERE sync_state = 'laukia' LIMIT 1").first();
    if (!pending) return;
    const cal = await calendarFor(env.DB, env.GOOGLE_SERVICE_ACCOUNT);
    if (cal) await pushPending(env.DB, cal);
  } catch (error) {
    console.error("Google: katinuko įvykių siuntimas", error);
  }
}

type Body = {
  tekstas?: unknown;
  memberId?: unknown;
  pokalbisId?: unknown;
  veiksmai?: unknown;
  veiksmas?: unknown;
  pataisyta?: unknown;
  ekranas?: unknown;
};

/** null — ne šios skilties adresas. */
export async function handleAsistentas(
  url: URL,
  request: Request,
  env: AsistentoEnv
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/asistentas" && !path.startsWith("/api/asistentas/")) return null;

  try {
    const response = (await route(path, request, env)) ?? Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
    // Katinuko sukurti, pakeisti ar ištrinti įvykiai — į Google iškart, ne po laikmačio.
    if (request.method === "POST") await pushPendingNow(env);
    return response;
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) {
      return Response.json({ klaida: "Nurodytas narys, sritis ar sąrašas neegzistuoja." }, { status: 400 });
    }
    throw error;
  }
}

async function route(path: string, request: Request, env: AsistentoEnv) {
  const db = env.DB;
  const method = request.method;
  const body = async (): Promise<Body> => {
    try {
      return (await request.json()) as Body;
    } catch {
      throw new KlaidaVartotojui("Netinkamas užklausos turinys.");
    }
  };

  if (path === "/api/asistentas" && method === "POST") {
    const model = env.ANTHROPIC_API_KEY ? anthropicCaller(env.ANTHROPIC_API_KEY) : null;
    const irasas = await ask(db, model, await body(), undefined, { finansai: ijungta(env, "finansai") });
    return Response.json({ ...irasas, pokalbis: await conversation(db, irasas.pokalbisId) });
  }

  if (path === "/api/asistentas/istorija" && method === "GET") {
    return Response.json({ ...(await history(db)), ijungtas: Boolean(env.ANTHROPIC_API_KEY) });
  }

  const m = path.match(/^\/api\/asistentas\/(\d+)\/(patvirtinti|atmesti|atsaukti)$/);
  if (m && method === "POST") {
    const id = Number(m[1]);
    const b = await body();
    if (m[2] === "patvirtinti") return Response.json(await confirm(db, id, b));
    if (m[2] === "atmesti") return Response.json(await reject(db, id, b.veiksmas));
    return Response.json(await undoAction(db, id, b.veiksmas, b.memberId));
  }

  return null;
}

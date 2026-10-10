/**
 * Claude jungtis appso pusėje (/api/claude/*): leidimo ekranas (kai Claude programa jungiasi)
 * ir „Daugiau → Claude jungtis“ — adresas ir prijungtų programų sąrašas su „Atjungti“.
 * Pati jungtis — atskirame Worker'yje (src/mcp/), jungčių įrašai — src/mcp/jungtys.ts.
 */
import { KlaidaVartotojui } from "./darbai/bendra";
import { actingMember } from "./darbai/nariai";
import { decide, disconnect, expired, listConnected, requestByState } from "./mcp/jungtys";


/** null — ne šios skilties adresas. */
export async function handleClaude(url: URL, request: Request, env: { DB: D1Database; MCP_URL?: string }): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/claude/")) return null;
  const db = env.DB;
  // Claude jungties Worker'io adresas (wrangler.toml [vars] MCP_URL).
  const mcpUrl = env.MCP_URL && !env.MCP_URL.includes("<<") ? env.MCP_URL : "http://localhost:8788";
  // Grįžimas į jungties Worker'į — tik į sukonfigūruotą adresą (ne iš užklausos).
  const toliau = (state: string) => `${mcpUrl}/callback?state=${encodeURIComponent(state)}`;

  try {
    if (path === "/api/claude/prasymas" && request.method === "GET") {
      const state = url.searchParams.get("state");
      const j = await requestByState(db, state);
      if (!j) throw new KlaidaVartotojui("Tokio prašymo nėra — pradėk jungti iš naujo Claude programoje.");
      return Response.json({
        programa: j.client_name,
        adresas: j.redirect_host,
        vietine: j.local_app === 1,
        busena: j.status,
        pasibaige: j.status === "laukia" && expired(j, new Date()),
        toliau: toliau(state!),
      });
    }

    if (path === "/api/claude/prasymas" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { state?: unknown; narys?: unknown; leisti?: unknown };
      const state = typeof body.state === "string" ? body.state : null;
      const leisti = body.leisti === true;
      await decide(db, state, leisti ? await actingMember(db, body.narys) : null, leisti);
      return Response.json({ toliau: toliau(state!) });
    }

    if (path === "/api/claude/jungtys" && request.method === "GET") {
      const jungtys = await listConnected(db);
      return Response.json({
        adresas: `${mcpUrl}/mcp`,
        jungtys: jungtys.map((j) => ({
          id: j.id,
          programa: j.client_name,
          narys: j.member_name,
          prijungta: j.connected_at,
          naudota: j.last_used_at,
        })),
      });
    }

    const m = path.match(/^\/api\/claude\/jungtys\/(\d+)\/atjungti$/);
    if (m && request.method === "POST") {
      await disconnect(db, Number(m[1]));
      return Response.json({ ok: true });
    }

    return Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    throw error;
  }
}

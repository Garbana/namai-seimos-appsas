/** Pranešimų API: /api/pranesimai/* — įrenginių prenumeratos ir bandomasis pranešimas. */
import { id, KlaidaVartotojui } from "../darbai/bendra";
import {
  DIGEST_AT,
  listDevices,
  QUIET_FROM,
  QUIET_TO,
  removeDevice,
  removeSubscription,
  saveSubscription,
  sendTest,
  vapidSubject,
  type SubscriptionInput,
} from "./pranesimai";
import { loadVapid } from "./webpush";

type Body = SubscriptionInput & { endpoint?: unknown };

/** null — ne šios skilties adresas. */
export async function handlePranesimai(
  url: URL,
  request: Request,
  env: { DB: D1Database; VAPID_JWK?: string; APP_URL?: string }
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/pranesimai" && !path.startsWith("/api/pranesimai/")) return null;

  try {
    return (await route(path, request, env)) ?? Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
  } catch (error) {
    if (error instanceof KlaidaVartotojui) return Response.json({ klaida: error.message }, { status: 400 });
    throw error;
  }
}

async function route(path: string, request: Request, env: { DB: D1Database; VAPID_JWK?: string; APP_URL?: string }): Promise<Response | null> {
  const db = env.DB;
  const method = request.method;
  const body = async (): Promise<Body> => {
    try {
      return (await request.json()) as Body;
    } catch {
      throw new KlaidaVartotojui("Netinkamas užklausos turinys.");
    }
  };

  if (path === "/api/pranesimai" && method === "GET") {
    const vapid = await loadVapid(env.VAPID_JWK, vapidSubject(env.APP_URL));
    return Response.json({
      raktas: vapid?.publicKey ?? null,
      irenginiai: await listDevices(db),
      tvarka: { suvestine: DIGEST_AT, tylaNuo: QUIET_FROM, tylaIki: QUIET_TO },
    });
  }

  if (path === "/api/pranesimai/prenumerata" && method === "POST") {
    return Response.json(await saveSubscription(db, await body()));
  }

  if (path === "/api/pranesimai/isjungti" && method === "POST") {
    await removeSubscription(db, (await body()).endpoint);
    return Response.json({ ok: true });
  }

  if (path === "/api/pranesimai/bandymas" && method === "POST") {
    const vapid = await loadVapid(env.VAPID_JWK, vapidSubject(env.APP_URL));
    return Response.json(await sendTest(db, vapid, (await body()).endpoint));
  }

  const device = path.match(/^\/api\/pranesimai\/irenginiai\/(\d+)$/);
  if (device && method === "DELETE") {
    await removeDevice(db, id(device[1], "įrenginys")!);
    return Response.json({ ok: true });
  }

  return null;
}

/**
 * Claude jungties Worker'is „namai-claude“ (wrangler.mcp.toml) — atskiras nuo appso, nes
 * appsas visas už Cloudflare Access, o Claude serveriai pro jį neprieina.
 *
 * - /mcp — MCP serveris (serveris.ts), tik su Claude gautu raktu (OAuth);
 * - /authorize — Claude čia atsiunčia žmogų; nusiunčiam jį į appsą duoti leidimo;
 * - /callback — iš appso grįžus su leidimu, Claude gauna raktą;
 * - /.well-known/*, /oauth/token, /register — OAuth (biblioteka @cloudflare/workers-oauth-provider;
 *   raktai — KV OAUTH_KV, tik maišos).
 */
import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  OAuthProvider,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { markConnected, recordRequest, requestByState, stillConnected } from "./jungtys";
import { ijungta } from "../nustatymai";
import { handleMcp, type McpProps } from "./serveris";

export interface McpEnv {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  /** Šio Worker'io adresas be „/“ gale (pvz., https://namai-claude….workers.dev). */
  MCP_URL: string;
  /** Appso adresas — ten žmogus duoda leidimą. */
  APP_URL: string;
  /** Įjungti moduliai (kaip appso wrangler.toml). */
  MODULIAI?: string;
  /** Įdeda biblioteka. */
  OAUTH_PROVIDER: OAuthHelpers;
}

const DAY = 86_400;

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Paprastas puslapis naršyklei (klaidoms ir šakniniam adresui). */
function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="lt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.3rem">${escape(title)}</h1>${body}</body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
    }
  );
}

async function authorize(request: Request, env: McpEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  let authRequest;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const why = error instanceof AuthorizationError ? error.description : "Nepavyko patikrinti programos.";
      return page("Nepavyko prisijungti", `<p>${escape(why)}</p><p>Pabandyk jungti iš naujo Claude programoje.</p>`, 400);
    }
    throw error;
  }
  const details = await oauth.describeConsent(authRequest);
  const { state, headers } = await oauth.beginUpstream(authRequest);
  await recordRequest(env.DB, state, {
    clientId: authRequest.clientId,
    clientName: details.clientDomain ? `${details.clientName} (${details.clientDomain})` : details.clientName,
    redirectHost: details.redirectHost,
    localApp: details.redirectIsLoopback,
  });
  headers.set("Location", `${env.APP_URL}/?claude=${encodeURIComponent(state)}`);
  return new Response(null, { status: 302, headers });
}

async function callback(request: Request, env: McpEnv): Promise<Response> {
  const state = new URL(request.url).searchParams.get("state");
  const j = await requestByState(env.DB, state);
  if (!j) return page("Prašymas nerastas", "<p>Pradėk jungti iš naujo Claude programoje.</p>", 404);
  if (j.status === "laukia") {
    return page(
      "Pirmiausia leisk appse",
      `<p><a href="${escape(`${env.APP_URL}/?claude=${encodeURIComponent(state!)}`)}">Atidaryk appsą</a> ir paspausk „Leisti“.</p>`,
      409
    );
  }
  if (j.status !== "leista" && j.status !== "atmesta") return page("Jau panaudota", "<p>Šis prašymas jau panaudotas. Jei reikia — junk iš naujo Claude programoje.</p>", 409);

  let resumed;
  try {
    resumed = await env.OAUTH_PROVIDER.finishUpstream(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return page(
        "Nepavyko prisijungti",
        "<p>Jungimas pradėtas kitoje naršyklėje arba pasibaigė (galioja 10 min.). Pradėk iš naujo Claude programoje ir leidimą duok toje pačioje naršyklėje.</p>",
        400
      );
    }
    throw error;
  }
  const { request: authRequest, headers } = resumed;

  if (j.status === "atmesta") {
    headers.set("Location", authorizationErrorRedirect(authRequest, "access_denied", "Neleista appse"));
    return new Response(null, { status: 302, headers });
  }

  const props: McpProps = { jungtisId: j.id, memberId: j.member_id };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: `narys-${j.member_id ?? "nezinomas"}`,
    metadata: { jungtisId: j.id },
    scope: ["namai"],
    props,
  });
  await markConnected(env.DB, j);
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

const defaultHandler = {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/authorize") return authorize(request, env);
    if (path === "/callback") return callback(request, env);
    if (path === "/") {
      return page("Namai — Claude jungtis", `<p>Šį adresą įrašyk Claude programoje (Connectors → Add custom connector):</p><p><b>${escape(env.MCP_URL)}/mcp</b></p>`);
    }
    return new Response("Not found", { status: 404 });
  },
};

const apiHandler = {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props: McpProps }).props;
    if (!(await stillConnected(env.DB, props.jungtisId))) {
      // Atjungta appse — Claude paprašys prisijungti iš naujo.
      return Response.json(
        { error: "invalid_token", error_description: "Jungtis atjungta appse" },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer error="invalid_token", error_description="Jungtis atjungta appse", resource_metadata="${env.MCP_URL}/.well-known/oauth-protected-resource/mcp"`,
          },
        }
      );
    }
    return handleMcp(request, env.DB, props, new Date(), { finansai: ijungta(env, "finansai") });
  },
};

/** Tiekėjas priklauso nuo adreso (vietinis ar tikras), todėl kuriamas pagal env ir įsimenamas. */
let cached: { url: string; provider: OAuthProvider<McpEnv> } | null = null;

function provider(env: McpEnv): OAuthProvider<McpEnv> {
  if (cached?.url === env.MCP_URL) return cached.provider;
  const p = new OAuthProvider<McpEnv>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ["namai"],
    resourceMetadata: { resource: `${env.MCP_URL}/mcp`, resource_name: "Namai" },
    // Prisijungimas laikosi, kol Claude jį naudoja bent kartą per 90 d.
    refreshTokenTTL: 90 * DAY,
    refreshTokenIdleTTL: 90 * DAY,
  });
  cached = { url: env.MCP_URL, provider: p };
  return p;
}

export default {
  fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    return provider(env).fetch(request, env, ctx);
  },
};

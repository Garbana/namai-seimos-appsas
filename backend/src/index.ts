import {
  backupOverview,
  createDump,
  fileName,
  fileResponse,
  isBackupKey,
  markDownloaded,
  saveBackup,
  type BackupMeta,
} from "./backups";
import { handleAsistentas } from "./ai/marsrutai";
import { handleClaude } from "./claude";
import { scheduledGoogleSync } from "./kalendorius/google";
import { handleKalendorius } from "./kalendorius/marsrutai";
import { handleDarbai } from "./darbai/marsrutai";
import { handlePastabos } from "./pastabos";
import { handlePranesimai } from "./pranesimai/marsrutai";
import { runNotifications, vapidSubject } from "./pranesimai/pranesimai";
import { ijungta, nustatymai } from "./nustatymai";
import { dailyFinanceDeadlines } from "./darbai/terminai";
import { loadVapid } from "./pranesimai/webpush";
import { buildPreview, saveRows, type PreviewRow } from "./import";
import { createCategory, type NewCategory } from "./categories";
import { buildCredits } from "./credits";
import { buildInsurance } from "./insurance";
import { linkOffsets, unlinkOffset } from "./offsets";
import {
  addManualValuation,
  buildPensions,
  deleteManualValuation,
  refreshFundPrices,
  fundPricesStale,
  updateHoldingUnits,
} from "./pensions";
import { buildBudgets, saveBudget } from "./budgets";
import { buildGroupOverview, buildOverview } from "./overview";
import { buildReminders, saveReminderSetting } from "./reminders";
import { etfPricesStale, lastEtfRefresh, refreshEtfPrices } from "./etf";
import {
  addFund,
  addPurchase,
  addSavingsEntry,
  addSavingsValuation,
  buildSavings,
  createGoal,
  deletePurchase,
  deleteSavingsEntry,
  deleteSavingsValuation,
  updateGoal,
} from "./savings";
import { decodeCsv } from "./parsers/csv";
import { ParseError } from "./parsers/types";
import {
  applyRuleToExisting,
  createRule,
  deleteRule,
  listRules,
  setRuleActive,
  type NewRule,
} from "./rules-store";
import {
  listTransactions,
  readFilters,
  splitTransaction,
  unsplitTransaction,
  updateTransactions,
  type SplitPart,
} from "./transactions";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Atsarginės kopijos (žr. backups.ts). */
  BACKUPS: KVNamespace;
  /** Pranešimų (Web Push) privatus raktas JWK pavidalu — Worker'io paslaptis. */
  VAPID_JWK?: string;
  /** Asistento (Anthropic API) raktas — Worker'io paslaptis. */
  ANTHROPIC_API_KEY?: string;
  /** Claude jungties Worker'io adresas (žr. src/claude.ts). */
  MCP_URL?: string;
  /** Google paslaugos paskyros raktas (JSON) kalendoriui — Worker'io paslaptis (src/kalendorius/google.ts). */
  GOOGLE_SERVICE_ACCOUNT?: string;
  /** Šeimos pavadinimas ir įjungti moduliai (src/nustatymai.ts), šio appso adresas. */
  SEIMA?: string;
  MODULIAI?: string;
  APP_URL?: string;
}

/** Savaitinės atsarginės kopijos laikmatis; kitas (kas minutę) — pranešimai. */
const BACKUP_CRON = "0 2 * * SUN";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/assets/")) {
      return serveHashedAsset(request, env);
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      return await handleApi(url, request, env, ctx);
    } catch (error) {
      // Parserio klaidos yra suprantamos vartotojui, kitos — ne.
      if (error instanceof ParseError) {
        return Response.json({ klaida: error.message }, { status: 400 });
      }
      console.error(error);
      return Response.json(
        { klaida: "Netikėta serverio klaida. Pabandyk dar kartą." },
        { status: 500 }
      );
    }
  },

  /**
   * Laikmačiai (wrangler.toml [triggers]): sekmadienio naktį — atsarginė kopija (klaida
   * įrašoma į app_state ir išmetama toliau, kad matytųsi ir Cloudflare žurnale), kas
   * minutę — pranešimai (src/pranesimai/pranesimai.ts).
   */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === BACKUP_CRON) {
      await saveBackup(env, "auto");
      return;
    }
    await runNotifications(env.DB, await loadVapid(env.VAPID_JWK, vapidSubject(env.APP_URL)));
    // Kartą per dieną — artėjantys finansų terminai virsta darbais (src/darbai/terminai.ts).
    if (ijungta(env, "finansai")) await dailyFinanceDeadlines(env.DB).catch((error) => console.error("Finansų terminai", error));
    // Kas 2 min. — šeimos Google kalendorius (src/kalendorius/google.ts).
    if (ijungta(env, "google")) await scheduledGoogleSync(env.DB, env.GOOGLE_SERVICE_ACCOUNT).catch((error) => console.error("Google kalendorius", error));
  },
};

/**
 * Failai po /assets/ turi turinio maišą varde, tad kešuojami metams. Būtent
 * todėl jų nerasti negalima atsakyti index.html'u (SPA atsarginis kelias):
 * toks atsakymas įstrigtų keše ir appsas liktų sugedęs, kol vartotojas pats
 * išvalytų naršyklę. Geriau sąžiningas 404, kurio niekas nekešuoja.
 */
async function serveHashedAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);

  if (response.headers.get("content-type")?.includes("text/html")) {
    return new Response("Toks failas neegzistuoja", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return response;
}

const today = () => new Date().toISOString().slice(0, 10);

async function handleApi(url: URL, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Darbų skiltis (nariai, užduotys, pirkiniai) — atskirame modulyje.
  const darbai = await handleDarbai(url, request, env.DB);
  if (darbai) return darbai;
  const pranesimai = await handlePranesimai(url, request, env);
  if (pranesimai) return pranesimai;
  const asistentas = await handleAsistentas(url, request, env);
  if (asistentas) return asistentas;
  const pastabos = await handlePastabos(url, request, env.DB);
  if (pastabos) return pastabos;
  const claude = await handleClaude(url, request, env);
  if (claude) return claude;
  // Šeimos pavadinimas ir įjungti moduliai — appsas pagal juos rodo skiltis.
  if (url.pathname === "/api/nustatymai" && request.method === "GET") return Response.json(nustatymai(env));

  const kalendorius = await handleKalendorius(url, request, env);
  if (kalendorius) return kalendorius;

  if (url.pathname === "/api/pensions" && request.method === "GET") {
    // Kainos atnaujinamos fone, kad puslapis nelauktų SEB atsakymo.
    const stale = await fundPricesStale(env.DB);
    if (stale) ctx.waitUntil(refreshFundPrices(env.DB).catch((error) => console.error(error)));
    return Response.json({ ...(await buildPensions(env.DB, today())), refreshingPrices: stale });
  }

  if (url.pathname === "/api/pensions/kainos" && request.method === "POST") {
    return Response.json(await refreshFundPrices(env.DB));
  }

  const pensionMatch = url.pathname.match(/^\/api\/pensions\/([a-z0-9-]+)\/(vertes|vienetai)$/);
  if (pensionMatch) {
    try {
      if (pensionMatch[2] === "vertes" && request.method === "POST") {
        await addManualValuation(env.DB, pensionMatch[1], await request.json(), today());
        return Response.json({ ok: true });
      }
      if (pensionMatch[2] === "vienetai" && request.method === "PUT") {
        await updateHoldingUnits(env.DB, pensionMatch[1], await request.json(), today());
        return Response.json({ ok: true });
      }
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko išsaugoti." },
        { status: 400 }
      );
    }
  }

  const valuationDelete = url.pathname.match(/^\/api\/pensions\/vertes\/(\d+)$/);
  if (valuationDelete && request.method === "DELETE") {
    try {
      await deleteManualValuation(env.DB, Number(valuationDelete[1]));
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko ištrinti." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/health") {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return Response.json({ status: "labas", db: row });
  }

  if (url.pathname === "/api/backups" && request.method === "GET") {
    return Response.json(await backupOverview(env));
  }

  if (url.pathname === "/api/backups" && request.method === "POST") {
    try {
      return Response.json(await saveBackup(env, "rankine"));
    } catch (error) {
      console.error(error);
      return Response.json(
        { klaida: `Nepavyko padaryti kopijos: ${error instanceof Error ? error.message : error}` },
        { status: 500 }
      );
    }
  }

  // Dabartinė kopija tiesiai į kompiuterį — sugeneruojama čia pat, KV nesaugoma.
  // Nepavykusi „parsisiųsta“ žyma parsisiuntimo nesustabdo.
  if (url.pathname === "/api/backups/current" && request.method === "GET") {
    try {
      const dump = await createDump(env.DB, "parsisiusta");
      await markDownloaded(env.DB).catch((error) => console.error(error));
      return fileResponse(dump.bytes, fileName(dump.createdAt, "parsisiusta"));
    } catch (error) {
      console.error(error);
      return Response.json(
        { klaida: `Nepavyko paruošti kopijos: ${error instanceof Error ? error.message : error}` },
        { status: 500 }
      );
    }
  }

  if (url.pathname === "/api/backups/file" && request.method === "GET") {
    const key = url.searchParams.get("key") ?? "";
    if (!isBackupKey(key)) {
      return Response.json({ klaida: "Netinkamas kopijos pavadinimas." }, { status: 400 });
    }
    const { value, metadata } = await env.BACKUPS.getWithMetadata<BackupMeta>(key, "arrayBuffer");
    if (!value || !metadata) {
      return Response.json({ klaida: "Tokios kopijos nebėra — gal jau ištrinta kaip sena." }, { status: 404 });
    }
    await markDownloaded(env.DB).catch((error) => console.error(error));
    return fileResponse(value, fileName(metadata.createdAt, metadata.kind));
  }

  if (url.pathname === "/api/categories" && request.method === "POST") {
    const body = (await request.json()) as NewCategory;
    try {
      return Response.json(await createCategory(env.DB, body));
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko sukurti kategorijos." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/categories" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, name, parent_id, type, necessity, sort_order, subgroup
       FROM categories ORDER BY sort_order`
    ).all();
    return Response.json(results);
  }

  if (url.pathname === "/api/import/preview" && request.method === "POST") {
    const { text, owner } = await readUpload(request);
    return Response.json(await buildPreview(env.DB, text, owner));
  }

  if (url.pathname === "/api/import/confirm" && request.method === "POST") {
    const body = (await request.json()) as { rows: PreviewRow[]; owner: string };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return Response.json({ klaida: "Nėra ką importuoti." }, { status: 400 });
    }
    return Response.json(await saveRows(env.DB, body.rows, body.owner));
  }

  if (url.pathname === "/api/credits" && request.method === "GET") {
    return Response.json(await buildCredits(env.DB, new Date().toISOString().slice(0, 10)));
  }

  if (url.pathname === "/api/insurance" && request.method === "GET") {
    return Response.json(await buildInsurance(env.DB, today()));
  }

  if (url.pathname === "/api/savings" && request.method === "GET") {
    // ETF kainos atnaujinamos fone, kad puslapis nelauktų Yahoo atsakymo.
    const stale = await etfPricesStale(env.DB);
    if (stale) ctx.waitUntil(refreshEtfPrices(env.DB).catch((error) => console.error(error)));
    return Response.json({
      ...(await buildSavings(env.DB, today())),
      refreshingPrices: stale,
      priceUpdate: await lastEtfRefresh(env.DB),
    });
  }

  if (url.pathname === "/api/savings/kainos" && request.method === "POST") {
    return Response.json(await refreshEtfPrices(env.DB));
  }

  if (url.pathname === "/api/savings/goals" && request.method === "POST") {
    try {
      return Response.json(await createGoal(env.DB, await request.json()));
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko sukurti tikslo." },
        { status: 400 }
      );
    }
  }

  const savingsDelete = url.pathname.match(/^\/api\/savings\/(irasai|vertes|pirkimai)\/(\d+)$/);
  if (savingsDelete && request.method === "DELETE") {
    try {
      if (savingsDelete[1] === "irasai") await deleteSavingsEntry(env.DB, Number(savingsDelete[2]));
      else if (savingsDelete[1] === "pirkimai") await deletePurchase(env.DB, Number(savingsDelete[2]));
      else await deleteSavingsValuation(env.DB, Number(savingsDelete[2]));
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko ištrinti." },
        { status: 400 }
      );
    }
  }

  const savingsChild = url.pathname.match(/^\/api\/savings\/([a-z0-9-]+)\/(irasai|vertes|fondai|pirkimai)$/);
  if (savingsChild && request.method === "POST") {
    try {
      if (savingsChild[2] === "irasai") await addSavingsEntry(env.DB, savingsChild[1], await request.json());
      else if (savingsChild[2] === "fondai") await addFund(env.DB, savingsChild[1], await request.json());
      else if (savingsChild[2] === "pirkimai") await addPurchase(env.DB, savingsChild[1], await request.json());
      else await addSavingsValuation(env.DB, savingsChild[1], await request.json(), today());
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko išsaugoti." },
        { status: 400 }
      );
    }
  }

  const savingsGoal = url.pathname.match(/^\/api\/savings\/([a-z0-9-]+)$/);
  if (savingsGoal && request.method === "PUT") {
    try {
      await updateGoal(env.DB, savingsGoal[1], await request.json());
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko išsaugoti." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/reminders" && request.method === "GET") {
    return Response.json(await buildReminders(env.DB, today()));
  }

  const reminderMatch = url.pathname.match(/^\/api\/reminders\/([a-z]+)\/([\w-]+)$/);
  if (reminderMatch && request.method === "PUT") {
    try {
      await saveReminderSetting(env.DB, reminderMatch[1], reminderMatch[2], await request.json());
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko išsaugoti." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/budgets" && request.method === "GET") {
    const menuo = url.searchParams.get("menuo") ?? today().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(menuo)) {
      return Response.json({ klaida: "Netinkamas mėnuo." }, { status: 400 });
    }
    return Response.json(await buildBudgets(env.DB, menuo, today()));
  }

  if (url.pathname === "/api/budgets" && request.method === "PUT") {
    try {
      await saveBudget(env.DB, await request.json());
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko išsaugoti." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/overview" && request.method === "GET") {
    return Response.json(await buildOverview(env.DB));
  }

  const grupesMatch = url.pathname.match(/^\/api\/overview\/group\/(\d+)$/);
  if (grupesMatch && request.method === "GET") {
    return Response.json(await buildGroupOverview(env.DB, Number(grupesMatch[1])));
  }

  if (url.pathname === "/api/transactions" && request.method === "GET") {
    return Response.json(await listTransactions(env.DB, readFilters(url)));
  }

  if (url.pathname === "/api/transactions" && request.method === "PATCH") {
    const body = (await request.json()) as {
      ids: number[];
      categoryId?: number | null;
      isTransfer?: boolean;
    };

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return Response.json({ klaida: "Nepasirinkta nė viena operacija." }, { status: 400 });
    }

    try {
      const changed = await updateTransactions(env.DB, body.ids, {
        categoryId: body.categoryId,
        isTransfer: body.isTransfer,
      });
      return Response.json({ changed });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko pakeisti operacijų." },
        { status: 400 }
      );
    }
  }

  const offsetsMatch = url.pathname.match(/^\/api\/transactions\/(\d+)\/offsets$/);
  if (offsetsMatch && request.method === "POST") {
    const body = (await request.json()) as { incomeIds: number[] };
    try {
      return Response.json(await linkOffsets(env.DB, Number(offsetsMatch[1]), body.incomeIds));
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko sudengti." },
        { status: 400 }
      );
    }
  }

  const offsetMatch = url.pathname.match(/^\/api\/transactions\/(\d+)\/offset$/);
  if (offsetMatch && request.method === "DELETE") {
    try {
      await unlinkOffset(env.DB, Number(offsetMatch[1]));
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko atsieti sudengimo." },
        { status: 400 }
      );
    }
  }

  if (url.pathname === "/api/rules" && request.method === "GET") {
    return Response.json(await listRules(env.DB));
  }

  if (url.pathname === "/api/rules" && request.method === "POST") {
    const body = (await request.json()) as NewRule & { applyToExisting?: boolean };
    const id = await createRule(env.DB, body);
    const applied = body.applyToExisting ? await applyRuleToExisting(env.DB, id) : 0;
    return Response.json({ id, applied });
  }

  const ruleMatch = url.pathname.match(/^\/api\/rules\/(\d+)(\/apply)?$/);

  if (ruleMatch && request.method === "PATCH") {
    const body = (await request.json()) as { isActive: boolean };
    await setRuleActive(env.DB, Number(ruleMatch[1]), body.isActive);
    return Response.json({ ok: true });
  }

  if (ruleMatch?.[2] && request.method === "POST") {
    const applied = await applyRuleToExisting(env.DB, Number(ruleMatch[1]));
    return Response.json({ applied });
  }

  const splitMatch = url.pathname.match(/^\/api\/transactions\/(\d+)\/split$/);
  if (splitMatch && request.method === "POST") {
    const body = (await request.json()) as { parts: SplitPart[] };
    try {
      return Response.json(await splitTransaction(env.DB, Number(splitMatch[1]), body.parts));
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko suskaidyti." },
        { status: 400 }
      );
    }
  }

  if (splitMatch && request.method === "DELETE") {
    try {
      await unsplitTransaction(env.DB, Number(splitMatch[1]));
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { klaida: error instanceof Error ? error.message : "Nepavyko atšaukti skaidymo." },
        { status: 400 }
      );
    }
  }

  if (url.pathname.startsWith("/api/rules/") && request.method === "DELETE") {
    const id = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(id)) {
      return Response.json({ klaida: "Netinkamas taisyklės numeris." }, { status: 400 });
    }
    await deleteRule(env.DB, id);
    return Response.json({ ok: true });
  }

  return Response.json({ klaida: "Toks API adresas neegzistuoja" }, { status: 404 });
}

async function readUpload(request: Request): Promise<{ text: string; owner: string }> {
  const form = await request.formData();
  const file = form.get("file");
  const owner = String(form.get("owner") ?? "").trim();

  if (!(file instanceof File)) {
    throw new ParseError("Failas neatsiųstas.");
  }
  if (!owner) {
    throw new ParseError("Nenurodyta, kieno tai išrašas.");
  }

  return { text: decodeCsv(await file.arrayBuffer()), owner };
}

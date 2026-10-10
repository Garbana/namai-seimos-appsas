/**
 * Asistentas: žinutė → kontekstas → modelis → patikrinti veiksmai → atsakymas.
 *
 * Kiekviena žinutė įrašoma į ai_requests (tekstas, atsakymas, veiksmai su atšaukimo
 * duomenimis, žetonai ir kaina). Pokalbis tęsiamas iš tų pačių įrašų: modelis kitoje
 * žinutėje mato savo ankstesnius pasiūlymus ir jų būseną (patvirtinta, atmesta…).
 */
import { actingMember, listAreas, listMembers } from "../darbai/nariai";
import { KlaidaVartotojui, text, vilniusNow, vilniusToUtc } from "../darbai/bendra";
import { FINANCE_TOOL_NAMES, FINANCE_TOOLS, runFinanceTool } from "./finansai";
import { buildContext, instructions, TOOLS } from "./kontekstas";
import { costUsd, ModelioKlaida, type ContentBlock, type Message, type ModelCaller, type Usage } from "./modelis";
import {
  execute,
  IMMEDIATE,
  propose,
  publicAction,
  statusForModel,
  undo,
  type Laukai,
  type Veiksmas,
} from "./veiksmai";
import { reminderSpecs } from "../darbai/priminimai";
import { taskValues } from "../darbai/uzduotys";

/** Visai šeimai per dieną — apsauga nuo netikėtų sąskaitų (pvz., klaidos cikle). */
export const DAILY_LIMIT = 200;
/** Pokalbis tęsiamas, jei ankstesnė žinutė ne senesnė nei tiek. */
const CONVERSATION_MINUTES = 60;
/** Kiek ankstesnių žinučių modelis mato. */
const HISTORY_TURNS = 6;
const KEEP_DAYS = 90;
/** Kiek kartų vienai žinutei modelis gali paprašyti duomenų (finansų įrankiai) prieš atsakydamas. */
const MAX_ROUNDS = 4;
/** Ankstesnių žinučių duomenų rezultatai pokalbio istorijoje sutrumpinami iki tiek simbolių. */
const HISTORY_RESULT_CHARS = 1500;

/** Įrankis, kuriuo žmogus žodžiu patvirtina ankstesnius pasiūlymus („taip“, „gerai“). */
const CONFIRM_TOOL = {
  name: "confirm_proposals",
  description:
    "Žmogus žodžiu patvirtino tavo ankstesnius dar laukiančius pasiūlymus („taip“, „gerai“, „tinka“, „patvirtinu“). Įrašo juos visus.",
  input_schema: { type: "object", properties: {} },
};

export type VeiksmasViesas = ReturnType<typeof publicAction>;

export interface Irasas {
  id: number;
  pokalbisId: number;
  memberId: number | null;
  tekstas: string;
  atsakymas: string | null;
  veiksmai: VeiksmasViesas[];
  klaida: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  conversation_id: number | null;
  member_id: number | null;
  text: string;
  reply: string | null;
  content_json: string | null;
  actions_json: string;
  error: string | null;
  created_at: string;
  cost_usd: number;
}

const actionsOf = (row: Row) => JSON.parse(row.actions_json) as Veiksmas[];

const toIrasas = (row: Row): Irasas => ({
  id: row.id,
  pokalbisId: row.conversation_id ?? row.id,
  memberId: row.member_id,
  tekstas: row.text,
  atsakymas: row.reply,
  veiksmai: actionsOf(row).map(publicAction),
  klaida: row.error,
  createdAt: row.created_at,
});

async function getRow(db: D1Database, id: number): Promise<Row> {
  const row = await db.prepare("SELECT * FROM ai_requests WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new KlaidaVartotojui("Tokios asistento žinutės nėra.");
  return row;
}

const saveActions = (db: D1Database, id: number, actions: Veiksmas[]) =>
  db.prepare("UPDATE ai_requests SET actions_json = ? WHERE id = ?").bind(JSON.stringify(actions), id);

/** Šiandienos (Vilniaus) pradžia UTC — dienos ribai skaičiuoti. */
const dayStart = (now: Date) => vilniusToUtc(vilniusNow(now).date, "00:00").toISOString();

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
const toolUses = (content: ContentBlock[]) => content.filter((b): b is ToolUse => b.type === "tool_use");

/** Ilgi duomenų rezultatai ankstesnėse žinutėse — sutrumpinti (kad pokalbis nebrangtų). */
const shorten = (m: Message): Message => ({
  ...m,
  content: m.content.map((b) =>
    b.type === "tool_result" && b.content.length > HISTORY_RESULT_CHARS
      ? { ...b, content: `${b.content.slice(0, HISTORY_RESULT_CHARS)}… (sutrumpinta)` }
      : b
  ),
});

/**
 * Ankstesnės pokalbio žinutės → modelio žinutės. Įraše saugomi visi tos žinutės ėjimai
 * (modelio atsakymai ir duomenų rezultatai); senesni įrašai — tik modelio atsakymo blokai.
 * Paskutinio atsakymo veiksmų būsenos (patvirtinta, atmesta…) perduodamos kitoje žinutėje.
 */
function historyMessages(rows: Row[]): { messages: Message[]; pendingResults: ContentBlock[] } {
  const messages: Message[] = [];
  let pendingResults: ContentBlock[] = [];
  for (const row of rows) {
    if (!row.content_json) continue;
    const parsed = JSON.parse(row.content_json) as (Message | ContentBlock)[];
    const turns: Message[] =
      parsed.length > 0 && "role" in parsed[0] ? (parsed as Message[]) : [{ role: "assistant", content: parsed as ContentBlock[] }];
    messages.push({ role: "user", content: [...pendingResults, { type: "text", text: row.text }] });
    messages.push(...turns.map(shorten));
    const actions = actionsOf(row);
    pendingResults = toolUses(turns[turns.length - 1].content).map((b) => ({
      type: "tool_result",
      tool_use_id: b.id,
      content:
        b.name === CONFIRM_TOOL.name
          ? "Patvirtinta."
          : FINANCE_TOOL_NAMES.has(b.name)
            ? "Duomenys nepateikti."
            : statusForModel(actions.find((a) => a.id === b.id)),
    }));
  }
  return { messages, pendingResults };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
});

const textOf = (content: ContentBlock[]) =>
  content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text.trim())
    .join("\n")
    .trim();

/** Patvirtina laukiančius veiksmus; `override` — žmogaus pataisyti laukai („Taisyti“). */
async function confirmActions(
  db: D1Database,
  actions: Veiksmas[],
  ids: string[] | null,
  memberId: number | null,
  now: Date,
  override: Record<string, { laukai?: Laukai; pouzduotys?: string[] }> = {}
): Promise<void> {
  for (const v of actions) {
    if (v.busena !== "laukia" || (ids && !ids.includes(v.id))) continue;
    try {
      const o = override[v.id];
      if (o?.laukai && (v.tipas === "sukurti" || v.tipas === "keisti")) {
        const laukai = { ...o.laukai };
        if (laukai.reminders !== undefined) laukai.reminders = reminderSpecs(laukai.reminders);
        if (v.tipas === "sukurti") taskValues(laukai, null);
        v.laukai = laukai;
        if (o.pouzduotys) v.pouzduotys = o.pouzduotys.map((s) => text(s, "použduotis", 300)).filter((s): s is string => Boolean(s));
      }
      await execute(db, v, memberId, now);
    } catch (error) {
      if (!(error instanceof KlaidaVartotojui)) throw error;
      v.busena = "klaida";
      v.klaida = error.message;
    }
  }
}

export interface AskInput {
  tekstas?: unknown;
  memberId?: unknown;
  pokalbisId?: unknown;
  /** Kuriame appso ekrane atidarytas asistentas — pastaboms. */
  ekranas?: unknown;
}

/** Nauja žinutė asistentui. */
/** finansai — ar įjungtas finansų modulis (įrankiai ir kontekstas). */
export async function ask(
  db: D1Database,
  model: ModelCaller | null,
  input: AskInput,
  now = new Date(),
  opts: { finansai?: boolean } = {}
): Promise<Irasas> {
  const finansai = opts.finansai ?? true;
  const tekstas = text(input.tekstas, "žinutė", 2000);
  if (!tekstas) throw new KlaidaVartotojui("Parašyk ar pasakyk, ką reikia padaryti.");
  const memberId = await actingMember(db, input.memberId);
  if (!model) throw new KlaidaVartotojui("Asistentas dar neįjungtas — serveryje nėra Anthropic rakto (ANTHROPIC_API_KEY).");

  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM ai_requests WHERE created_at >= ?")
    .bind(dayStart(now))
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= DAILY_LIMIT) {
    throw new KlaidaVartotojui(`Šiandien asistentui jau parašyta ${DAILY_LIMIT} kartų — tai apsauginė riba. Rytoj vėl veiks.`);
  }

  // Ankstesnės to paties pokalbio žinutės (jei pokalbis dar „gyvas“).
  const conversationId = Number(input.pokalbisId) || null;
  let history: Row[] = [];
  if (conversationId) {
    const since = new Date(now.getTime() - CONVERSATION_MINUTES * 60_000).toISOString();
    history = (
      await db
        .prepare(
          `SELECT * FROM ai_requests WHERE (id = ?1 OR conversation_id = ?1) AND created_at >= ?2
           ORDER BY id DESC LIMIT ${HISTORY_TURNS}`
        )
        .bind(conversationId, since)
        .all<Row>()
    ).results.reverse();
  }
  const { messages, pendingResults } = historyMessages(history);
  messages.push({ role: "user", content: [...pendingResults, { type: "text", text: tekstas }] });

  const ekranas = text(input.ekranas, "ekranas", 100);
  const [context, members, areas] = await Promise.all([buildContext(db, memberId, now, ekranas, finansai), listMembers(db), listAreas(db)]);

  let reply: string | null = null;
  const turns: Message[] = [];
  let error: string | null = null;
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let modelName: string | null = null;
  const actions: Veiksmas[] = [];
  const earlierUpdates: D1PreparedStatement[] = [];

  try {
    // Modelis gali kelis kartus paprašyti duomenų (finansų įrankiai) — jie vykdomi iš karto ir
    // grąžinami; veiksmų pasiūlymai renkami. Baigiama, kai duomenų nebeprašo.
    const known = { members, areas };
    let confirmed = false;
    for (let round = 0; ; round++) {
      const response = await model({
        instructions: instructions(finansai),
        context,
        tools: [...TOOLS, ...(finansai ? FINANCE_TOOLS : []), CONFIRM_TOOL],
        messages: [...messages, ...turns],
      });
      usage = addUsage(usage, response.usage);
      modelName = response.model;
      turns.push({ role: "assistant", content: response.content });

      const calls = toolUses(response.content);
      for (const call of calls) {
        if (call.name === CONFIRM_TOOL.name) confirmed = true;
        else if (!FINANCE_TOOL_NAMES.has(call.name)) {
          const v = await propose(db, call, known);
          if (v.tipas === "pastaba") {
            v.ekranas = ekranas;
            // Pastaba apie asistentą — prie jos pridedama ankstesnė pokalbio žinutė.
            if (v.pastaba?.kind === "asistentas") v.irasasId = history[history.length - 1]?.id ?? null;
          }
          actions.push(v);
        }
      }
      const reads = calls.filter((c) => FINANCE_TOOL_NAMES.has(c.name));
      if (reads.length === 0 || round >= MAX_ROUNDS - 1) break;

      const results = new Map<string, string>();
      for (const c of reads) results.set(c.id, await runFinanceTool(db, c.name, c.input ?? {}, now));
      turns.push({
        role: "user",
        content: calls.map((c) => ({
          type: "tool_result",
          tool_use_id: c.id,
          content: results.get(c.id) ?? (c.name === CONFIRM_TOOL.name ? "Patvirtinta." : "Užregistruota — bus parodyta žmogui."),
        })),
      });
    }
    const assistantTurns = turns.filter((m) => m.role === "assistant");
    reply = textOf(assistantTurns[assistantTurns.length - 1].content) || textOf(assistantTurns.flatMap((m) => m.content)) || null;

    // Ankstesni dar laukiantys pasiūlymai: žodžiu patvirtinti — įrašom; pakeisti nauju — pažymim.
    const replaced = actions.some((a) => !IMMEDIATE.includes(a.tipas));
    for (const row of history) {
      const earlier = actionsOf(row);
      if (!earlier.some((a) => a.busena === "laukia") || !(confirmed || replaced)) continue;
      if (confirmed) {
        await confirmActions(db, earlier, null, memberId, now);
      } else {
        for (const a of earlier) if (a.busena === "laukia") a.busena = "pakeista";
      }
      earlierUpdates.push(saveActions(db, row.id, earlier));
    }

    for (const v of actions) {
      if (v.busena === "laukia" && IMMEDIATE.includes(v.tipas)) await confirmActions(db, [v], null, memberId, now);
    }
  } catch (e) {
    if (!(e instanceof ModelioKlaida)) throw e;
    error = e.message;
  }

  const row = await db
    .prepare(
      `INSERT INTO ai_requests (conversation_id, member_id, text, reply, content_json, actions_json, model,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      history.length > 0 ? conversationId : null,
      memberId,
      tekstas,
      reply,
      turns.length > 0 ? JSON.stringify(turns) : null,
      JSON.stringify(actions),
      modelName,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_input_tokens ?? 0,
      usage.cache_creation_input_tokens ?? 0,
      costUsd(usage),
      error,
      now.toISOString()
    )
    .first<Row>();
  await db.batch([
    ...earlierUpdates,
    db.prepare("DELETE FROM ai_requests WHERE created_at < ?").bind(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()),
  ]);
  return toIrasas(row!);
}

/** Visos pokalbio žinutės — kad appsas matytų ir ankstesnių pasiūlymų būsenos pasikeitimus. */
export async function conversation(db: D1Database, conversationId: number): Promise<Irasas[]> {
  const { results } = await db
    .prepare("SELECT * FROM ai_requests WHERE id = ?1 OR conversation_id = ?1 ORDER BY id")
    .bind(conversationId)
    .all<Row>();
  return results.map(toIrasas);
}

/** „Patvirtinti“ (vieną ar visus laukiančius); `pataisyta` — laukai iš „Taisyti“ lango. */
export async function confirm(
  db: D1Database,
  requestId: number,
  input: { veiksmai?: unknown; pataisyta?: unknown; memberId?: unknown },
  now = new Date()
): Promise<Irasas> {
  const row = await getRow(db, requestId);
  const memberId = await actingMember(db, input.memberId);
  const actions = actionsOf(row);
  const ids = Array.isArray(input.veiksmai) ? input.veiksmai.map(String) : null;
  const override = (input.pataisyta && typeof input.pataisyta === "object" ? input.pataisyta : {}) as Record<
    string,
    { laukai?: Laukai; pouzduotys?: string[] }
  >;
  await confirmActions(db, actions, ids, memberId, now, override);
  await saveActions(db, row.id, actions).run();
  return toIrasas({ ...row, actions_json: JSON.stringify(actions) });
}

async function changeOne(
  db: D1Database,
  requestId: number,
  actionId: unknown,
  change: (v: Veiksmas) => Promise<void>
): Promise<Irasas> {
  const row = await getRow(db, requestId);
  const actions = actionsOf(row);
  const v = actions.find((a) => a.id === actionId);
  if (!v) throw new KlaidaVartotojui("Tokio veiksmo nėra.");
  await change(v);
  await saveActions(db, row.id, actions).run();
  return toIrasas({ ...row, actions_json: JSON.stringify(actions) });
}

export const reject = (db: D1Database, requestId: number, actionId: unknown) =>
  changeOne(db, requestId, actionId, async (v) => {
    if (v.busena !== "laukia") throw new KlaidaVartotojui("Šis veiksmas jau nebelaukia patvirtinimo.");
    v.busena = "atmesta";
  });

export const undoAction = async (db: D1Database, requestId: number, actionId: unknown, memberId: unknown, now = new Date()) => {
  const member = await actingMember(db, memberId);
  return changeOne(db, requestId, actionId, (v) => undo(db, v, member, now));
};

/** Istorija ir išlaidos: paskutinės žinutės, šio mėnesio ir šiandienos skaičiai. */
export async function history(db: D1Database, now = new Date()) {
  const month = vilniusToUtc(`${vilniusNow(now).date.slice(0, 8)}01`, "00:00").toISOString();
  const [rows, stats] = await db.batch([
    db.prepare("SELECT * FROM ai_requests ORDER BY id DESC LIMIT 50"),
    db
      .prepare(
        `SELECT COUNT(*) AS menuo, COALESCE(SUM(cost_usd), 0) AS kaina,
           SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS siandien
         FROM ai_requests WHERE created_at >= ?1`
      )
      .bind(month, dayStart(now)),
  ]);
  const s = stats.results[0] as { menuo: number; kaina: number; siandien: number | null };
  return {
    irasai: (rows.results as unknown as Row[]).map(toIrasas),
    islaidos: { menuoUzklausu: s.menuo, menuoKainaUsd: s.kaina, siandienUzklausu: s.siandien ?? 0, dienosRiba: DAILY_LIMIT },
  };
}

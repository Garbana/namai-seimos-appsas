/**
 * Claude jungties (MCP) serveris: Claude programa (claude.ai, telefonas) mato appsą ir
 * įrašo į jį tais pačiais įrankiais, kaip katinukas.
 *
 * Protokolas — MCP „Streamable HTTP“ be būsenos: kiekviena JSON-RPC žinutė — atskiras POST,
 * atsakymas — JSON (be SSE ir sesijų). Prisijungimą (OAuth) ir leidimo tikrinimą atlieka
 * index.ts; čia ateina jau patikrinta užklausa su nariu, kurio vardu Claude dirba.
 *
 * Rašymo įrankiai vykdomi iš karto: leidimą kiekvienam veiksmui klausia pati Claude programa.
 * Viskas tikrinama tomis pačiomis taisyklėmis, kaip katinuko pasiūlymai (propose/execute),
 * o įrašai pažymimi šaltiniu „claude“.
 */
import { KlaidaVartotojui, text, vilniusNow } from "../darbai/bendra";
import { listAreas, listMembers } from "../darbai/nariai";
import { isDate, weekday } from "../darbai/pakartojimai";
import { listEvents } from "../kalendorius/ivykiai";
import { projectSavings } from "../darbai/bankas";
import { createCost, getProject, updateCost, updateProject } from "../darbai/projektai";
import { FINANCE_TOOL_NAMES, FINANCE_TOOLS, runFinanceTool } from "../ai/finansai";
import { buildContext, TOOLS } from "../ai/kontekstas";
import type { Tool } from "../ai/modelis";
import { execute, propose, type Veiksmas } from "../ai/veiksmai";

/** Kas prisijungė: jungties įrašas (claude_jungtys) ir narys, kurio vardu dirbama. */
export interface McpProps {
  jungtisId: number;
  memberId: number | null;
}

/** Palaikomos MCP versijos, naujausia pirma. */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_INSTRUCTIONS = `Šeimos appsas „Namai“: šeimos (nariai — get_overview; vaikai appsu nesinaudoja) užduotys, projektai (gimtadieniai, kelionės, remontai), pirkinių sąrašai ir finansai (finansus — tik matyti).
- Pradėk nuo get_overview: data ir kalendorius, nariai ir sritys su id, užduotys, projektai, pirkinių sąrašai. Id imk tik iš get_overview ar get_project — neišsigalvok.
- „Aš“ — narys, kuris prijungė Claude (get_overview eilutė „Kalba“).
- Kas įrašyta, iš karto mato visa šeima; priskirtus darbus žmonės gauna pranešimais. Prieš įrašydamas didesnį planą (projektą ar kelis darbus) trumpai parodyk jį žmogui ir paklausk, ar įrašyti.
- Pavadinimai — lietuviškai, trumpi, iš didžiosios raidės, be datų ir vardų („Užsakyti tortą“). Datos YYYY-MM-DD, laikas HH:MM (Vilniaus laikas); datas tikrink pagal get_overview kalendorių.
- Projektas (create_project): 3–5 etapai, darbai su terminais atgal nuo projekto datos (ne ankstesniais nei šiandien), biudžeto eilutės (costs) su planu; is_estimate true, jei suma — įvertis. Ką išsiaiškinote (variantai, kainos, kontaktai, nuorodos) — glaustai į projekto notes.
- Esamas projektas: darbas — create_task su project_id ir section (etapo pavadinimas); biudžeto plano eilutė — set_project_budget_line; sumokėta — record_project_cost arba complete_task su amount_eur; data, biudžetas, tikslas, pastabos — update_project.
- Priminimai: '60m' — prieš 60 min. (tik su laiku), '0m' — laiku, '1d@18:00' — dieną prieš 18:00, '0d@09:00' — tą dieną 9:00. Vizitui ar renginiui su laiku — ['1d@18:00', '60m']; užduočiai be laiko — jokių (ryte visi gauna dienos suvestinę).
- Namų ruoša (siurbti, vonia, kraikas, šiukšlės, filtras…) — create_task su chore true ir recurrence; „pakaitomis“ — rotation_member_ids (narių id eilė), „kas N d. nuo paskutinio karto“ — repeat_after_done true. Ruoša rodoma „Darbai → Ruoša“.
- Kalendorius: kas vyksta konkrečiu laiku (vizitai, repeticijos, būreliai, renginiai, kelionės) — create_event (member_ids — kas dalyvauja); jie atsiranda ir šeimos Google kalendoriuje. Ilgesniam laikotarpiui — list_events. Užduotys — darbams.
- Pirkinių sąrašai — tik kasdieniams pirkiniams (Maistas, Buitis, Vaistinė). Dovanos, drabužiai, dekoracijos ir pan. — užduotis.
- Atsakingą nurodyk tik jei pasakyta; vaikui — tik jei tai aiškiai jo darbas.
- Finansai (jei įjungti) — tik skaitymas (finance_* ir kiti finansų įrankiai). Konkrečių investicinių produktų nepatarinėk.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

const empty = { type: "object", properties: {} };
const catTool = (name: string): Tool => TOOLS.find((t) => t.name === name)!;

/** Katinuko įrankis su Claude programai tinkamu aprašymu (vykdoma iš karto, ne pasiūlymas). */
function fromCat(name: string, title: string, description: string, extra: Record<string, unknown> = {}, destructive = false): McpTool {
  const schema = catTool(name).input_schema as { properties: Record<string, unknown> };
  return {
    name,
    title,
    description,
    inputSchema: { ...schema, properties: { ...schema.properties, ...extra } },
    annotations: { ...WRITE, destructiveHint: destructive },
  };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_overview",
    title: "Appso suvestinė",
    description:
      "Dabartinė appso būsena: data ir 3 savaičių kalendorius, šeimos nariai ir sritys (su id), atviros ir neseniai atliktos užduotys, projektai su etapais ir biudžeto eilutėmis, pirkinių sąrašai. Kviesk pirmiausia — iš čia imk id.",
    inputSchema: empty,
    annotations: READ_ONLY,
  },
  {
    name: "get_project",
    title: "Projektas",
    description: "Visas projektas: tikslas, pastabos, etapai su visais darbais (ir atliktais), biudžeto eilutės su planu ir faktu.",
    inputSchema: { type: "object", properties: { project_id: { type: "integer" } }, required: ["project_id"] },
    annotations: READ_ONLY,
  },
  {
    name: "list_events",
    title: "Kalendorius",
    description: "Šeimos kalendoriaus įvykiai laikotarpiu (get_overview rodo tik 3 savaites). Su id (e12).",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string", description: "Nuo YYYY-MM-DD" }, to: { type: "string", description: "Iki YYYY-MM-DD (iki 400 d.)" } },
      required: ["from", "to"],
    },
    annotations: READ_ONLY,
  },
  fromCat("create_event", "Naujas įvykis", "Sukurti kalendoriaus įvykį (vizitas, repeticija, būrelis, susitikimas, renginys, kelionė). Atsiranda ir šeimos Google kalendoriuje."),
  fromCat("update_event", "Keisti įvykį", "Pakeisti esamą kalendoriaus įvykį: siųsk tik keičiamus laukus."),
  fromCat("delete_event", "Ištrinti įvykį", "Ištrinti (atšaukti) kalendoriaus įvykį.", {}, true),
  fromCat("create_task", "Nauja užduotis", "Sukurti užduotį (ir esamo projekto darbą: project_id + section). Įrašoma iš karto."),
  fromCat(
    "create_project",
    "Naujas projektas",
    "Sukurti projektą su visu planu iš karto: etapai su darbais (terminai, atsakingi, kainos), biudžeto eilutės, pastabos.",
    { notes: { type: ["string", "null"], description: "Ką išsiaiškinote: variantai, kainos, kontaktai, nuorodos (iki 5000 simbolių)" } }
  ),
  {
    name: "update_project",
    title: "Keisti projektą",
    description: "Pakeisti projekto pavadinimą, tikslą, datą, biudžetą, pastabas ar būseną. Siųsk tik tai, kas keičiasi (null — išvalyti).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        title: { type: "string" },
        goal: { type: ["string", "null"] },
        target_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
        budget_eur: { type: ["number", "null"], description: "Viso projekto biudžetas" },
        notes: { type: ["string", "null"], description: "Pastabos (pakeičia visas ankstesnes — prireikus pirma perskaityk get_project)" },
        status: { type: "string", enum: ["aktyvus", "atidetas", "baigtas"] },
      },
      required: ["project_id"],
    },
    annotations: WRITE,
  },
  {
    name: "set_project_budget_line",
    title: "Biudžeto eilutė",
    description: "Projekto biudžeto plano eilutė: nauja (be cost_id) arba esamos plano sumos ar pavadinimo pakeitimas.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        cost_id: { type: ["integer", "null"], description: "Esamos eilutės id; nėra — nauja eilutė" },
        name: { type: "string", description: "Pvz., „Tortas“, „Salės nuoma“" },
        planned_eur: { type: ["number", "null"] },
        is_estimate: { type: "boolean", description: "true — įvertis, ne tikra kaina (numatytai true)" },
      },
      required: ["project_id"],
    },
    annotations: WRITE,
  },
  fromCat("record_project_cost", "Projekto išlaida", "Įrašyti, kiek sumokėta: į esamą biudžeto eilutę (cost_id) arba naują."),
  fromCat("update_task", "Keisti užduotį", "Pakeisti esamą užduotį: siųsk tik keičiamus laukus (null — išvalyti)."),
  fromCat("complete_task", "Atlikta", "Pažymėti užduotį ar použduotį atlikta (amount_eur — kiek išleista)."),
  fromCat("delete_task", "Ištrinti užduotį", "Ištrinti užduotį — 30 d. ją galima atkurti iš appso šiukšliadėžės.", {}, true),
  fromCat("add_shopping_items", "Į pirkinių sąrašą", "Pridėti prekes į pirkinių sąrašą (Maistas, Buitis, Vaistinė)."),
  fromCat("check_shopping_items", "Nupirkta", "Pažymėti sąrašo prekes nupirktomis."),
  fromCat("save_feedback", "Pastaba apie appsą", "Užfiksuoti pastabą apie patį appsą: klaidą, nepatogumą ar idėją (appse: Daugiau → Pastabos ir klaidos)."),
  ...FINANCE_TOOLS.map((t) => ({
    name: t.name,
    title: t.name,
    description: `${t.description} Tik skaitymas.`,
    inputSchema: t.input_schema,
    annotations: READ_ONLY,
  })),
];

const CAT_WRITE = new Set(["create_event", "update_event", "delete_event", "create_task", "create_project", "record_project_cost", "update_task", "complete_task", "delete_task", "add_shopping_items", "check_shopping_items", "save_feedback"]);

const eurText = (cents: number | null) => (cents === null ? "—" : `${cents / 100} €`);

const WEEKDAYS = ["pirmadienis", "antradienis", "trečiadienis", "ketvirtadienis", "penktadienis", "šeštadienis", "sekmadienis"];

/** Sumos eurais → centai (kaip katinuko įrankiuose). */
function cents(eur: unknown): number | null {
  if (eur === null || eur === undefined || eur === "") return null;
  const n = Number(eur);
  if (!Number.isFinite(n) || n < 0) throw new KlaidaVartotojui("Netinkama suma.");
  return Math.round(n * 100);
}

function projectId(raw: Record<string, unknown>): number {
  const n = Number(raw.project_id);
  if (!Number.isInteger(n)) throw new KlaidaVartotojui("Nenurodytas projektas (project_id).");
  return n;
}

/** Projekto taupymo katiliukas: kiek jame sukaupta. */
async function savingsLine(db: D1Database, goalId: number | null, today: string): Promise<string[]> {
  const s = await projectSavings(db, goalId, today).catch(() => null);
  return s ? [`Taupymo katiliukas „${s.name}“: sukaupta ${eurText(s.valueCents)}${s.targetCents !== null ? ` iš ${eurText(s.targetCents)}` : ""}`] : [];
}

/** Visas projektas tekstu — get_project. */
async function describeProject(db: D1Database, id: number, now: Date): Promise<string> {
  const { project: p, sections, costs, tasks } = await getProject(db, id);
  const [members, areas] = await Promise.all([listMembers(db), listAreas(db)]);
  const name = (memberId: number | null) => members.find((m) => m.id === memberId)?.name ?? String(memberId);
  const today = vilniusNow(now).date;
  const left = p.target_date ? Math.round((Date.parse(p.target_date) - Date.parse(today)) / 86_400_000) : null;

  const top = tasks.filter((t) => t.parent_id === null);
  const taskLines = (list: typeof top) =>
    list.flatMap((t) => [
      [
        `- #${t.id} ${t.title}`,
        t.status === "atlikta" ? "[atlikta]" : null,
        t.due_date ? `terminas ${t.due_date}${t.due_time ? ` ${t.due_time}` : ""}` : null,
        t.assignee_id ? `atsakingas ${name(t.assignee_id)}` : null,
        t.amount_cents !== null ? eurText(t.amount_cents) : null,
        t.reminders.length > 0 ? `priminimai ${t.reminders.join(", ")}` : null,
        t.notes ? `pastabos: ${t.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
      ...tasks.filter((s) => s.parent_id === t.id).map((s) => `  - použduotis #${s.id} ${s.title}${s.status === "atlikta" ? " [atlikta]" : ""}`),
    ]);

  const noSection = top.filter((t) => t.section_id === null || !sections.some((s) => s.id === t.section_id));
  return [
    [
      `Projektas #${p.id} „${p.title}“ (${p.status})`,
      p.target_date ? `data ${p.target_date} ${WEEKDAYS[weekday(p.target_date)]}${left !== null ? ` (liko ${left} d.)` : ""}` : "be datos",
      p.owner_id ? `atsakingas ${name(p.owner_id)}` : null,
      p.area_id ? `sritis ${areas.find((a) => a.id === p.area_id)?.name ?? p.area_id}` : null,
      `biudžetas ${eurText(p.budget_cents)}`,
      `suplanuota ${eurText(p.planned_cents)}, išleista ${eurText(p.actual_cents)}`,
      `darbai ${p.tasks_done}/${p.tasks_total} atlikti`,
    ]
      .filter(Boolean)
      .join(" | "),
    `Tikslas: ${p.goal ?? "—"}`,
    ...(await savingsLine(db, p.savings_goal_id, today)),
    `Pastabos: ${p.notes ?? "—"}`,
    "",
    "## Etapai ir darbai",
    ...sections.flatMap((s) => [`### [${s.id}] ${s.name}`, ...taskLines(top.filter((t) => t.section_id === s.id))]),
    ...(noSection.length > 0 ? ["### Be etapo", ...taskLines(noSection)] : []),
    ...(top.length === 0 ? ["(darbų nėra)"] : []),
    "",
    "## Biudžeto eilutės",
    ...(costs.length > 0
      ? costs.map(
          (c) =>
            `- [${c.id}] ${c.name}: planas ${eurText(c.planned_cents)}${c.is_estimate ? " (įvertis)" : ""}, faktas ${eurText(c.actual_cents)}${c.bank_links ? " (iš banko operacijų)" : ""}${c.task_id ? ` (darbas #${c.task_id})` : ""}`
        )
      : ["(nėra)"]),
  ].join("\n");
}

/** Įvykiai laikotarpiu tekstu — list_events. */
async function describeEvents(db: D1Database, raw: Record<string, unknown>): Promise<string> {
  const from = String(raw.from ?? "");
  const to = String(raw.to ?? "");
  if (!isDate(from) || !isDate(to) || to < from) throw new KlaidaVartotojui("Netinkamas laikotarpis (from, to — YYYY-MM-DD).");
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw new KlaidaVartotojui("Per ilgas laikotarpis — daugiausia 400 dienų.");
  const [events, members] = await Promise.all([listEvents(db, from, to), listMembers(db)]);
  if (events.length === 0) return `Laikotarpiu ${from}–${to} įvykių nėra.`;
  const name = (id: number) => members.find((m) => m.id === id)?.name ?? String(id);
  return events
    .map((e) =>
      [
        `e${e.id} ${e.start_date} ${WEEKDAYS[weekday(e.start_date)]}${e.start_time ? ` ${e.start_time}–${e.end_time}` : " visą dieną"}${e.end_date !== e.start_date ? ` iki ${e.end_date}` : ""}`,
        e.title,
        e.members.length > 0 ? `dalyvauja ${e.members.map(name).join(", ")}` : null,
        e.location ? `vieta ${e.location}` : null,
        e.series ? "kartojasi" : null,
      ]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");
}

/** Ką padarė katinuko įrankis — trumpai Claude programai. */
function done(v: Veiksmas): string {
  const prekes = (v.prekes ?? []).map((p) => (p.quantity ? `${p.name} (${p.quantity})` : p.name)).join(", ");
  switch (v.tipas) {
    case "sukurti":
      return `Sukurta užduotis #${v.uzduotisId} „${v.pavadinimas}“${v.etapas ? ` (etapas „${v.etapas}“)` : ""}${v.pouzduotys?.length ? `, použduočių: ${v.pouzduotys.length}` : ""}.`;
    case "keisti":
      return `Pakeista užduotis #${v.uzduotisId} „${v.pavadinimas}“.`;
    case "istrinti":
      return `Užduotis „${v.pavadinimas}“ ištrinta (30 d. galima atkurti appso šiukšliadėžėje).`;
    case "atlikta":
      return `Pažymėta atlikta: „${v.pavadinimas}“${v.sumaCentais != null ? ` (${eurText(v.sumaCentais)})` : ""}.`;
    case "pirkiniai":
      return `Į sąrašą „${v.pavadinimas}“ pridėta: ${prekes}.`;
    case "nupirkta":
      return `Pažymėta nupirkta: ${prekes}.`;
    case "pastaba":
      return "Pastaba užfiksuota (appse: Daugiau → Pastabos ir klaidos).";
    case "projektas": {
      const pr = v.projektas!;
      const darbai = pr.sections.reduce((n, s) => n + s.tasks.length, 0);
      return `Sukurtas projektas #${v.projektasId} „${pr.title}“: etapų ${pr.sections.length}, darbų ${darbai}, biudžeto eilučių ${pr.costs.length}. Appse: Darbai → Projektai.`;
    }
    case "islaida":
      return `Projekto „${v.islaida!.projektas}“ biudžete įrašyta: ${v.islaida!.name} — ${eurText(v.islaida!.actualCents)}.`;
    case "ivykis":
      return `Kalendoriuje sukurtas įvykis e${v.ivykisId} „${v.pavadinimas}“ (${v.ivykis?.startDate}${v.ivykis?.startTime ? ` ${v.ivykis.startTime}` : ""}). Per kelias minutes atsiras ir šeimos Google kalendoriuje.`;
    case "ivykio_keitimas":
      return `Įvykis e${v.ivykisId} „${v.pavadinimas}“ pakeistas.`;
    case "ivykio_trynimas":
      return `Įvykis „${v.pavadinimas}“ ištrintas iš kalendoriaus.`;
  }
}

/** Įvykdo įrankį. KlaidaVartotojui — žmogui suprantama klaida (grąžinama kaip įrankio klaida). */
/** Įjungti moduliai (iš Worker'io kintamųjų): be finansų — finansų įrankių nėra. */
export interface McpOptions {
  finansai: boolean;
}

const toolsFor = (o: McpOptions) => MCP_TOOLS.filter((t) => o.finansai || !FINANCE_TOOL_NAMES.has(t.name));

export async function callTool(
  db: D1Database,
  name: string,
  raw: Record<string, unknown>,
  props: McpProps,
  now = new Date(),
  o: McpOptions = { finansai: true }
): Promise<string> {
  if (name === "get_overview") return buildContext(db, props.memberId, now, null, o.finansai);
  if (name === "get_project") return describeProject(db, projectId(raw), now);
  if (FINANCE_TOOL_NAMES.has(name)) return runFinanceTool(db, name, raw, now);
  if (name === "list_events") return describeEvents(db, raw);

  if (name === "update_project") {
    const id = projectId(raw);
    const has = (key: string) => raw[key] !== undefined;
    const p = await updateProject(
      db,
      id,
      {
        ...(has("title") ? { title: raw.title } : {}),
        ...(has("goal") ? { goal: raw.goal } : {}),
        ...(has("target_date") ? { targetDate: raw.target_date } : {}),
        ...(has("budget_eur") ? { budgetCents: cents(raw.budget_eur) } : {}),
        ...(has("notes") ? { notes: raw.notes } : {}),
        ...(has("status") ? { status: raw.status } : {}),
      },
      now
    );
    return `Projektas #${p.id} „${p.title}“ pakeistas.`;
  }

  if (name === "set_project_budget_line") {
    const id = projectId(raw);
    const planned = cents(raw.planned_eur);
    const estimate = raw.is_estimate !== false;
    if (raw.cost_id != null) {
      const own = await db.prepare("SELECT id FROM project_costs WHERE id = ? AND project_id = ?").bind(Number(raw.cost_id), id).first();
      if (!own) throw new KlaidaVartotojui("Tokios biudžeto eilutės šiame projekte nėra.");
      const c = await updateCost(db, Number(raw.cost_id), {
        ...(raw.name !== undefined ? { name: raw.name } : {}),
        ...(raw.planned_eur !== undefined ? { plannedCents: planned } : {}),
        isEstimate: estimate,
      });
      return `Biudžeto eilutė [${c.id}] „${c.name}“: planas ${eurText(c.planned_cents)}.`;
    }
    const c = await createCost(db, id, { name: text(raw.name, "pavadinimas", 100), plannedCents: planned, isEstimate: estimate });
    return `Pridėta biudžeto eilutė [${c.id}] „${c.name}“: planas ${eurText(c.planned_cents)}.`;
  }

  if (!CAT_WRITE.has(name)) throw new KlaidaVartotojui(`Nežinomas įrankis „${name}“.`);
  const known = { members: await listMembers(db), areas: await listAreas(db) };
  const v = await propose(db, { id: crypto.randomUUID(), name, input: raw }, known);
  if (v.busena === "klaida") throw new KlaidaVartotojui(v.klaida ?? "Nepavyko.");
  if (v.tipas === "pastaba") v.ekranas = "Claude programa";
  await execute(db, v, props.memberId, now, "claude");
  return done(v);
}

// ---------- JSON-RPC ----------

type Id = string | number | null;
interface RpcRequest {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleMessage(db: D1Database, msg: RpcRequest, props: McpProps, now: Date, o: McpOptions): Promise<object | null> {
  if (!msg || typeof msg !== "object") return rpcError(null, -32600, "Invalid Request");
  // Pranešimai (be id) ir kliento atsakymai (be method) — atsakyti nereikia.
  if (typeof msg.method !== "string") return "result" in msg || "error" in msg ? null : rpcError(msg.id ?? null, -32600, "Invalid Request");
  if (msg.id === undefined || msg.id === null) return null;
  const params = msg.params ?? {};

  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return rpcResult(msg.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "namai", title: "Namai", version: "1.0.0" },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: toolsFor(o) });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      if (!toolsFor(o).some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const out = await callTool(db, name, args, props, now, o);
        return rpcResult(msg.id, { content: [{ type: "text", text: out }] });
      } catch (error) {
        if (error instanceof KlaidaVartotojui) return rpcResult(msg.id, { content: [{ type: "text", text: error.message }], isError: true });
        if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) {
          return rpcResult(msg.id, { content: [{ type: "text", text: "Nurodytas narys, sritis ar sąrašas neegzistuoja." }], isError: true });
        }
        console.error("MCP įrankis", name, error);
        return rpcResult(msg.id, { content: [{ type: "text", text: "Netikėta serverio klaida — pabandyk dar kartą." }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** /mcp: POST su JSON-RPC žinute (ar keliomis). GET (SSE srautas) nepalaikomas. */
export async function handleMcp(
  request: Request,
  db: D1Database,
  props: McpProps,
  now = new Date(),
  o: McpOptions = { finansai: true }
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(db, m as RpcRequest, props, now, o)))).filter(Boolean);
    return out.length > 0 ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handleMessage(db, body as RpcRequest, props, now, o);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}

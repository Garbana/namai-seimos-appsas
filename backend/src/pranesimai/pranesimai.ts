/**
 * Pranešimai į telefoną: prenumeratos, kam ką siųsti ir laikmatis.
 *
 * Laikmatis (cron) eina kas minutę ir išsiunčia:
 * - suėjusius užduočių priminimus — atsakingam; jei jo nėra arba jis appsu nesinaudoja
 *   (Ema) — abiem tėvams; atidėtą — tik atidėjusiam;
 * - vienkartinius pranešimus iš eilės (push_outbox), pvz., „Jonas priskyrė tau darbą“;
 * - rytinę suvestinę 7:30 — kiekvienam jo, bendri ir Emos šiandienos bei vėluojantys
 *   darbai (jei tokių nėra — nesiunčiama);
 * - kartą per mėnesį vakare pirmam nariui — „parsisiųsk atsarginę kopiją“, jei to nedaryta 30 d.
 * Tylos valandomis (22:00–7:00) niekas nesiunčiama — priminimai palaukia ryto.
 *
 * Kam siųsti, lemia įrenginyje pasirinktas žmogus (push_subscriptions.member_id).
 */
import { readState } from "../backups";
import { id, KlaidaVartotojui, text, vilniusNow } from "../darbai/bendra";
import { weekday } from "../darbai/pakartojimai";
import { listEvents, type Ivykis } from "../kalendorius/ivykiai";
import { sendWebPush, validKeys, type PushResult, type Sender, type Subscription, type Vapid } from "./webpush";

export const DIGEST_AT = "07:30";
/** Jei laikmatis ryte nesuveikė (sutrikimas), suvestinė po 10 val. nebesiunčiama. */
const DIGEST_UNTIL = "10:00";
export const QUIET_FROM = "22:00";
export const QUIET_TO = "07:00";

const BACKUP_FROM = "19:00";
const BACKUP_UNTIL = "21:00";
/** Atsarginės kopijos priminimas — nariui 1 (pirmas seima.json sąraše), jis tvarko appsą. */
const BACKUP_MEMBER = 1;
const BACKUP_DAYS = 30;

/** Kiek daugiausia pranešimų per vieną laikmačio kartą (Worker'io užklausų riba — 50). */
const MAX_SENDS = 40;
/** Kiek laikomi jau išsiųsti vienkartiniai pranešimai ir atidėti priminimai. */
const KEEP_DAYS = 30;

const STATE_KEY = "pranesimai";

/** VAPID kontaktas pranešimų tarnybai — appso adresas. */
/** VAPID „subject“ — appso adresas (wrangler.toml APP_URL). */
export const vapidSubject = (appUrl?: string) => (appUrl && !appUrl.includes("<<") ? appUrl : "https://example.com");

export interface Payload {
  title: string;
  body?: string;
  /** Kur nuveda paspaudus. */
  url: string;
  /** Tas pats tag'as pakeičia ankstesnį pranešimą, o ne prideda naują. */
  tag: string;
  taskId?: number;
  /** Rodyti mygtukus „Atlikta“ ir „Atidėti 1 val.“ */
  veiksmai?: boolean;
  /** Kam skirtas — kad „Atlikta“ iš pranešimo žinotų, kas atliko. */
  memberId?: number;
}

export const isQuiet = (time: string) => time >= QUIET_FROM || time < QUIET_TO;

// ---------- Tekstai ----------

const MONTHS = [
  "sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio",
  "liepos", "rugpjūčio", "rugsėjo", "spalio", "lapkričio", "gruodžio",
];
const WHEN_DAY = ["pirmadienį", "antradienį", "trečiadienį", "ketvirtadienį", "penktadienį", "šeštadienį", "sekmadienį"];

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** „šiandien 15:00“, „rytoj“, „penktadienį“, „spalio 23 d.“, „vėluoja 3 d.“ */
export function when(dueDate: string, dueTime: string | null, today: string): string {
  const diff = daysBetween(today, dueDate);
  const [, m, d] = dueDate.split("-").map(Number);
  const day =
    diff === 0 ? "šiandien"
    : diff === 1 ? "rytoj"
    : diff === -1 ? "vakar"
    : diff < -1 ? `vėluoja ${-diff} d.`
    : diff < 7 ? WHEN_DAY[weekday(dueDate)]
    : `${MONTHS[m - 1]} ${d} d.`;
  return dueTime && diff >= -1 ? `${day} ${dueTime}` : day;
}

/** „1 darbas“, „3 darbai“, „12 darbų“. */
export function taskCount(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  const word = d10 === 1 && d100 !== 11 ? "darbas" : d10 >= 2 && (d100 < 10 || d100 >= 20) ? "darbai" : "darbų";
  return `${n} ${word}`;
}

// ---------- Prenumeratos ----------

export interface Device {
  id: number;
  member_id: number;
  endpoint: string;
  device: string | null;
  created_at: string;
  last_success_at: string | null;
  last_error: string | null;
  failed_count: number;
}

type SubscriptionRow = Device & Subscription;

export async function listDevices(db: D1Database): Promise<Device[]> {
  const { results } = await db
    .prepare(
      `SELECT id, member_id, endpoint, device, created_at, last_success_at, last_error, failed_count
       FROM push_subscriptions ORDER BY member_id, created_at`
    )
    .all<Device>();
  return results;
}

export interface SubscriptionInput {
  memberId?: unknown;
  subscription?: unknown;
  device?: unknown;
}

/** Įrašo įrenginio prenumeratą arba atnaujina (pvz., pakeitus, kas naudoja įrenginį). */
export async function saveSubscription(db: D1Database, input: SubscriptionInput, now = new Date()): Promise<Device> {
  const memberId = id(input.memberId, "narys");
  if (memberId === null) throw new KlaidaVartotojui("Pirma pasirink, kas naudoja šį įrenginį.");
  const member = await db
    .prepare("SELECT id FROM members WHERE id = ? AND is_active = 1 AND uses_app = 1")
    .bind(memberId)
    .first();
  if (!member) throw new KlaidaVartotojui("Šis šeimos narys pranešimų negauna.");

  const s = (input.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 1000 || !validKeys(p256dh, auth)) {
    throw new KlaidaVartotojui("Naršyklė atsiuntė netinkamą prenumeratą — pabandyk įjungti iš naujo.");
  }

  const at = now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, device, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh,
         auth = excluded.auth, device = excluded.device, updated_at = excluded.updated_at
       RETURNING id, member_id, endpoint, device, created_at, last_success_at, last_error, failed_count`
    )
    .bind(memberId, endpoint, p256dh, auth, text(input.device, "įrenginys", 60), at, at)
    .first<Device>();
  return row!;
}

export async function removeSubscription(db: D1Database, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string") throw new KlaidaVartotojui("Netinkamas įrenginys.");
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}

export async function removeDevice(db: D1Database, deviceId: number): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(deviceId).run();
}

// ---------- Siuntimas ----------

/** Vienas darbas laikmačiui: pranešimai ir ką įrašyti, kai jie išsiųsti. */
interface Item {
  messages: { memberId: number; payload: Payload }[];
  done: D1PreparedStatement[];
}

const delivered = (status: number) => status >= 200 && status < 300;
/** Prenumerata nebegalioja (programėlė ištrinta, leidimas atšauktas) — trinam. */
const gone = (status: number) => status === 404 || status === 410;

/** Ką įrašyti apie įrenginį po siuntimo — kad klaidos matytųsi appse. */
function recordResult(db: D1Database, sub: SubscriptionRow, result: PushResult, now: Date): D1PreparedStatement {
  if (delivered(result.status)) {
    return db
      .prepare("UPDATE push_subscriptions SET last_success_at = ?, last_error = NULL, failed_count = 0 WHERE id = ?")
      .bind(now.toISOString(), sub.id);
  }
  if (gone(result.status)) return db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id);
  return db
    .prepare("UPDATE push_subscriptions SET last_error = ?, failed_count = failed_count + 1 WHERE id = ?")
    .bind(`${now.toISOString()} · ${result.status || "ryšio klaida"} ${result.text}`.trim().slice(0, 300), sub.id);
}

async function safeSend(send: Sender, sub: Subscription, payload: string, vapid: Vapid, now: Date): Promise<PushResult> {
  try {
    return await send(sub, payload, vapid, now);
  } catch (error) {
    return { status: 0, text: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Išsiunčia darbus į visus gavėjų įrenginius (iki MAX_SENDS) ir grąžina, ką įrašyti.
 * Netilpę darbai lieka neišsiųsti — juos paims kitas laikmačio kartas.
 */
async function deliver(
  db: D1Database,
  items: Item[],
  subs: SubscriptionRow[],
  vapid: Vapid,
  now: Date,
  send: Sender
): Promise<{ statements: D1PreparedStatement[]; sent: number; failed: number }> {
  const jobs: { sub: SubscriptionRow; payload: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const item of items) {
    const itemJobs = item.messages.flatMap((m) =>
      subs.filter((s) => s.member_id === m.memberId).map((sub) => ({ sub, payload: JSON.stringify({ ...m.payload, memberId: m.memberId }) }))
    );
    if (jobs.length > 0 && jobs.length + itemJobs.length > MAX_SENDS) break;
    jobs.push(...itemJobs);
    statements.push(...item.done);
  }

  const results = await Promise.all(jobs.map((j) => safeSend(send, j.sub, j.payload, vapid, now)));
  results.forEach((r, i) => statements.push(recordResult(db, jobs[i].sub, r, now)));
  const sent = results.filter((r) => delivered(r.status)).length;
  return { statements, sent, failed: results.length - sent };
}

interface AppMember {
  id: number;
  name: string;
}

const appMembers = async (db: D1Database) =>
  (await db.prepare("SELECT id, name FROM members WHERE is_active = 1 AND uses_app = 1 ORDER BY sort_order, id").all<AppMember>())
    .results;

/** Užduoties gavėjai: atsakingas, o jei jo nėra ar jis appsu nesinaudoja — visi. */
const recipients = (assigneeId: number | null, members: AppMember[]) =>
  members.some((m) => m.id === assigneeId) ? [assigneeId!] : members.map((m) => m.id);

interface DueReminder {
  id: number;
  task_id: number;
  member_id: number | null;
  title: string;
  due_date: string | null;
  due_time: string | null;
  assignee_id: number | null;
  area_name: string | null;
}

function reminderPayload(r: DueReminder, today: string): Payload {
  const parts = [r.due_date ? when(r.due_date, r.due_time, today) : null, r.area_name].filter(Boolean);
  return {
    title: r.title,
    body: parts.length > 0 ? capitalize(parts.join(" · ")) : "Atidėtas priminimas",
    url: `/?uzduotis=${r.task_id}`,
    tag: `uzd-${r.task_id}`,
    taskId: r.task_id,
    veiksmai: true,
  };
}

interface DigestTask {
  id: number;
  title: string;
  due_date: string;
  due_time: string | null;
  assignee_id: number | null;
}

/** Suvestinės tekstas: šiandienos darbai pagal laiką, tada vėluojantys. */
/** Šiandienos kalendoriaus įvykis suvestinei. */
export interface DigestEvent {
  title: string;
  start_time: string | null;
}

export function digestPayload(tasks: DigestTask[], today: string, events: DigestEvent[] = []): Payload {
  const todays = tasks.filter((t) => t.due_date === today);
  const late = tasks.filter((t) => t.due_date < today);
  const title =
    todays.length > 0
      ? `Šiandien ${taskCount(todays.length)}${late.length > 0 ? `, vėluoja ${late.length}` : ""}`
      : late.length > 0
        ? `Vėluoja ${taskCount(late.length)}`
        : `Šiandien kalendoriuje: ${events.length}`;
  const lines = [
    // Pirma — kas vyksta (įvykiai), tada — ką padaryti.
    ...events.map((e) => `📅 ${e.start_time ? `${e.start_time} ` : ""}${e.title}`),
    ...todays.map((t) => (t.due_time ? `${t.due_time} ${t.title}` : t.title)),
    ...late.map((t) => `${t.title} (${when(t.due_date, null, today)})`),
  ];
  const shown = lines.slice(0, 6);
  if (lines.length > shown.length) shown.push(`ir dar ${lines.length - shown.length}`);
  return { title, body: shown.join("\n"), url: "/", tag: "suvestine" };
}

interface State {
  digestDate?: string;
  backupMonth?: string;
}

async function readNotifyState(db: D1Database): Promise<State> {
  const row = await db.prepare("SELECT value FROM app_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as State) : {};
}

const saveNotifyState = (db: D1Database, state: State) =>
  db
    .prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(STATE_KEY, JSON.stringify(state));

export interface RunSummary {
  quiet: boolean;
  sent: number;
  failed: number;
}

/** Laikmačio darbas — žr. failo pradžią. `send` keičiamas tik testuose. */
export async function runNotifications(
  db: D1Database,
  vapid: Vapid | null,
  now = new Date(),
  send: Sender = sendWebPush
): Promise<RunSummary> {
  const summary: RunSummary = { quiet: false, sent: 0, failed: 0 };
  if (!vapid) {
    console.error("VAPID_JWK nenustatytas — pranešimai nesiunčiami.");
    return summary;
  }
  const { date, time } = vilniusNow(now);
  if (isQuiet(time)) return { ...summary, quiet: true };

  const at = now.toISOString();
  const digestTime = time >= DIGEST_AT && time < DIGEST_UNTIL;
  const backupTime = time >= BACKUP_FROM && time < BACKUP_UNTIL;

  const [dueResult, outboxResult] = await db.batch([
    db
      .prepare(
        `SELECT r.id, r.task_id, r.member_id, t.title, t.due_date, t.due_time, t.assignee_id, a.name AS area_name
         FROM task_reminders r
         JOIN tasks t ON t.id = r.task_id
         LEFT JOIN task_areas a ON a.id = t.area_id
         WHERE r.sent_at IS NULL AND r.remind_at <= ? AND t.deleted_at IS NULL AND t.status = 'atvira'
         ORDER BY r.remind_at, r.id LIMIT 20`
      )
      .bind(at),
    db.prepare("SELECT id, member_id, task_id, title, body, url FROM push_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20"),
  ]);
  const due = dueResult.results as DueReminder[];
  const outbox = outboxResult.results as { id: number; member_id: number; task_id: number | null; title: string; body: string | null; url: string }[];
  if (due.length === 0 && outbox.length === 0 && !digestTime && !backupTime) return summary;

  const members = await appMembers(db);
  const memberIds = new Set(members.map((m) => m.id));
  const items: Item[] = [];
  const always: D1PreparedStatement[] = [];

  for (const r of due) {
    const to = r.member_id !== null ? [r.member_id].filter((m) => memberIds.has(m)) : recipients(r.assignee_id, members);
    const payload = reminderPayload(r, date);
    items.push({
      messages: to.map((memberId) => ({ memberId, payload })),
      done: [db.prepare("UPDATE task_reminders SET sent_at = ? WHERE id = ?").bind(at, r.id)],
    });
  }

  for (const o of outbox) {
    const payload: Payload = { title: o.title, body: o.body ?? undefined, url: o.url, tag: o.task_id ? `priskirta-${o.task_id}` : `eile-${o.id}` };
    items.push({
      messages: memberIds.has(o.member_id) ? [{ memberId: o.member_id, payload }] : [],
      done: [db.prepare("UPDATE push_outbox SET sent_at = ? WHERE id = ?").bind(at, o.id)],
    });
  }

  if (digestTime || backupTime) {
    const state = await readNotifyState(db);

    if (digestTime && state.digestDate !== date) {
      const { results: tasks } = await db
        .prepare(
          `SELECT id, title, due_date, due_time, assignee_id FROM tasks
           WHERE deleted_at IS NULL AND status = 'atvira' AND parent_id IS NULL AND due_date <= ?
           ORDER BY due_date, due_time IS NULL, due_time, id`
        )
        .bind(date)
        .all<DigestTask>();
      const events: Ivykis[] = await listEvents(db, date, date).catch(() => []);
      for (const m of members) {
        const mine = tasks.filter((t) => t.assignee_id === m.id || !memberIds.has(t.assignee_id ?? 0));
        // Įvykiai — kuriuose dalyvauja, arba visos šeimos.
        const myEvents = events.filter((e) => e.members.length === 0 || e.members.includes(m.id) || e.members.every((x) => !memberIds.has(x)));
        if (mine.length > 0 || myEvents.length > 0) items.push({ messages: [{ memberId: m.id, payload: digestPayload(mine, date, myEvents) }], done: [] });
      }
      state.digestDate = date;
      always.push(
        saveNotifyState(db, state),
        // Kartą per dieną — išvalom senus išsiųstus.
        db.prepare("DELETE FROM push_outbox WHERE sent_at < ?").bind(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()),
        db
          .prepare("DELETE FROM task_reminders WHERE spec IS NULL AND sent_at < ?")
          .bind(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString())
      );
    }

    const month = date.slice(0, 7);
    if (backupTime && state.backupMonth !== month && memberIds.has(BACKUP_MEMBER)) {
      const { lastDownloadAt } = await readState(db);
      if (!lastDownloadAt || now.getTime() - Date.parse(lastDownloadAt) > BACKUP_DAYS * 86_400_000) {
        const last = lastDownloadAt ? vilniusNow(new Date(lastDownloadAt)).date : null;
        items.push({
          messages: [
            {
              memberId: BACKUP_MEMBER,
              payload: {
                title: "Laikas parsisiųsti atsarginę kopiją",
                body: last
                  ? `Paskutinį kartą — prieš ${daysBetween(last, date)} d. Atsidaryk „Atsarginės kopijos“.`
                  : "Į kompiuterį dar nė karto neparsisiųsta. Atsidaryk „Atsarginės kopijos“.",
                url: "/?skiltis=kopijos",
                tag: "kopijos",
              },
            },
          ],
          done: [],
        });
        state.backupMonth = month;
        always.push(saveNotifyState(db, state));
      }
    }
  }

  const subs = (await db.prepare("SELECT * FROM push_subscriptions").all<SubscriptionRow>()).results;
  const result = await deliver(db, items, subs, vapid, now, send);
  // Būsena įrašoma po siuntimo rezultatų, kad paskutinis saveNotifyState laimėtų.
  const statements = [...result.statements, ...always];
  if (statements.length > 0) await db.batch(statements);
  return { quiet: false, sent: result.sent, failed: result.failed };
}

/** „Išbandyti“: bandomasis pranešimas tik į šį įrenginį, iškart. */
export async function sendTest(
  db: D1Database,
  vapid: Vapid | null,
  endpoint: unknown,
  now = new Date(),
  send: Sender = sendWebPush
): Promise<{ ok: boolean; klaida: string | null }> {
  if (!vapid) throw new KlaidaVartotojui("Serveryje nenustatytas pranešimų raktas (VAPID_JWK).");
  const sub =
    typeof endpoint === "string"
      ? await db.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).first<SubscriptionRow>()
      : null;
  if (!sub) throw new KlaidaVartotojui("Šis įrenginys neužregistruotas — įjunk pranešimus iš naujo.");

  const payload: Payload = {
    title: "Namai",
    body: "Pranešimai veikia ✓ Taip atrodys priminimai.",
    url: "/?skiltis=pranesimai",
    tag: "bandymas",
    memberId: sub.member_id,
  };
  const result = await safeSend(send, sub, JSON.stringify(payload), vapid, now);
  await recordResult(db, sub, result, now).run();
  if (delivered(result.status)) return { ok: true, klaida: null };
  if (gone(result.status)) return { ok: false, klaida: "Prenumerata nebegalioja — įjunk pranešimus iš naujo." };
  return { ok: false, klaida: `Pranešimų tarnyba atsakė: ${result.status || "ryšio klaida"} ${result.text}`.trim() };
}

// ---------- Priskyrimas ----------

interface AssignedTask {
  id: number;
  title: string;
  parent_id: number | null;
  status: string;
  assignee_id: number | null;
  due_date: string | null;
  due_time: string | null;
}

/**
 * Kai kitas priskiria tau darbą — pranešimas („Jonas priskyrė tau darbą“). Sau
 * priskirtas, nepasikeitęs atsakingas ar Emai skirtas — be pranešimo.
 */
export async function queueAssignment(
  db: D1Database,
  task: AssignedTask,
  previousAssignee: number | null,
  actor: number | null,
  now = new Date()
): Promise<void> {
  if (!task.assignee_id || task.parent_id !== null || task.status !== "atvira") return;
  if (task.assignee_id === previousAssignee || task.assignee_id === actor) return;

  const members = await appMembers(db);
  if (!members.some((m) => m.id === task.assignee_id)) return;
  const actorName = (
    await db.prepare("SELECT name FROM members WHERE id = ?").bind(actor ?? 0).first<{ name: string }>()
  )?.name;

  const today = vilniusNow(now).date;
  await db
    .prepare("INSERT INTO push_outbox (member_id, task_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(
      task.assignee_id,
      task.id,
      actorName ? `${actorName} priskyrė tau darbą` : "Tau priskirtas darbas",
      task.due_date ? `${task.title} · ${when(task.due_date, task.due_time, today)}` : task.title,
      `/?uzduotis=${task.id}`,
      now.toISOString()
    )
    .run();
}


/**
 * Ruoša „pakaitomis“: atlikus darbas atitenka kitam eilėje — jam pranešimas „Tavo eilė“
 * (jei ne jis pats atliko ir jei jis naudojasi appsu).
 */
export async function queueTurn(
  db: D1Database,
  task: AssignedTask & { rotation_members: string | null },
  previousAssignee: number | null,
  actor: number | null,
  now = new Date()
): Promise<void> {
  if (!task.rotation_members || !task.assignee_id || task.assignee_id === previousAssignee || task.assignee_id === actor) return;
  const members = await appMembers(db);
  if (!members.some((m) => m.id === task.assignee_id)) return;
  const today = vilniusNow(now).date;
  await db
    .prepare("INSERT INTO push_outbox (member_id, task_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(
      task.assignee_id,
      task.id,
      `Tavo eilė: ${task.title}`,
      task.due_date ? `Kitą kartą — ${when(task.due_date, task.due_time, today)}` : "Kitą kartą — tu",
      "/?skiltis=ruosa",
      now.toISOString()
    )
    .run();
}

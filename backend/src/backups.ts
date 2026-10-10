/**
 * Atsarginės kopijos.
 *
 * Kopija — SQL failas, kurį `wrangler d1 execute --file` tiesiai atkuria į tos pačios
 * struktūros bazę (migracijos pritaikytos iki antraštėje įrašytos versijos). Failas
 * pirmiausia ištrina esamus duomenis, tada įrašo kopijos eilutes.
 *
 * Reikšmes užkoduoja pati SQLite (quote() teisingai sutvarko tekstą, skaičius, NULL ir
 * dvejetainius duomenis) ir ji pati sudeda eilutes į ~50 KB grupes — kiekviena grupė
 * tampa vienu kelių eilučių INSERT sakiniu. Worker'is gauna kelias dešimtis ilgų
 * eilučių, o ne tūkstančius mažų: būtent mažų objektų apdorojimas ėdė CPU (2026-10-09
 * tikroje aplinkoje po vieną INSERT eilutei — 31 ms, o nemokamas planas skiria 10 ms).
 *
 * Automatinės (kas sekmadienį) ir rankinės kopijos laikomos KV saugykloje. Paskutinio
 * bandymo rezultatas ir parsisiuntimo laikas rašomi į app_state, kad nepavykusi kopija
 * būtų matoma appse, o ne pradingtų tyliai.
 */

export type BackupKind = "auto" | "rankine";

export interface BackupMeta {
  createdAt: string;
  kind: BackupKind;
  bytes: number;
  rows: number;
  tables: number;
  /** Paskutinė pritaikyta migracija — iki jos reikia atkurti struktūrą prieš įkeliant kopiją. */
  schema: string | null;
}

export interface BackupInfo extends BackupMeta {
  key: string;
}

export interface BackupState {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastDownloadAt: string | null;
}

export interface BackupEnv {
  DB: D1Database;
  BACKUPS: KVNamespace;
}

/** Kiek kopijų laikyti: 12 savaitinių ≈ 3 mėnesiai istorijos. */
export const KEEP: Record<BackupKind, number> = { auto: 12, rankine: 5 };

const STATE_KEY = "atsargines_kopijos";

const EMPTY_STATE: BackupState = {
  lastAttemptAt: null,
  lastOkAt: null,
  lastError: null,
  lastDownloadAt: null,
};

/** Lentelės, kurių nekopijuojam: SQLite ir D1 vidaus bei migracijų sekimas. */
export function isDataTable(name: string): boolean {
  return !name.startsWith("sqlite_") && !name.startsWith("_cf_") && name !== "d1_migrations";
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const sqlText = (text: string) => `'${text.replace(/'/g, "''")}'`;

/**
 * Kiek baitų reikšmių daugiausia dedama į vieną INSERT sakinį. D1 leidžia iki 100 000
 * baitų sakiniui; grupė gali viršyti šią ribą tik paskutinės eilutės ilgiu.
 */
export const CHUNK_BYTES = 50_000;

/**
 * Stulpelio reikšmė kaip SQL tekstas vienoje eilutėje. quote() naujos eilutės simbolius
 * palieka kaip yra; juos keičiam į char(10) / char(13), kad kiekviena įrašo eilutė tilptų
 * vienoje failo eilutėje — tada failą saugiai skaito bet kuris įrankis, o dvi kopijas
 * galima palyginti eilutė po eilutės.
 */
function oneLineValue(column: string): string {
  return `replace(replace(quote(${ident(column)}), char(13), ''' || char(13) || '''), char(10), ''' || char(10) || ''')`;
}

/**
 * SELECT, kuris lentelės eilutes paverčia reikšmių grupėmis „(…),\n(…)“ (stulpelis `s`,
 * kiek eilučių — `n`). Grupė baigiasi, kai jos ilgis pasiekia `chunkBytes`; tvarka —
 * pagal rowid, tad tėvinės eilutės (skaidymas) eina pirma vaikinių.
 */
export function chunkSelectSql(table: string, columns: string[], chunkBytes = CHUNK_BYTES): string {
  const tuple = `'(' || ${columns.map(oneLineValue).join(" || ', ' || ")} || ')'`;
  return `SELECT COUNT(*) AS n, group_concat(v, ',' || char(10) ORDER BY r) AS s
    FROM (SELECT r, v, (SUM(b) OVER (ORDER BY r) - b) / ${chunkBytes} AS chunk
      FROM (SELECT r, v, length(CAST(v AS BLOB)) + 2 AS b
        FROM (SELECT rowid AS r, ${tuple} AS v FROM ${ident(table)})))
    GROUP BY chunk ORDER BY chunk`;
}

/**
 * Lentelių tvarka: tėvinės pirmiau vaikinių. Įrašoma šia tvarka, trinama atvirkštine,
 * kad nesuveiktų ON DELETE CASCADE / SET NULL. Nuorodų į save pačią (transactions →
 * transactions) ir ciklų tvarka neišsprendžia — juos dengia PRAGMA defer_foreign_keys.
 */
export function orderTables(tables: string[], links: { child: string; parent: string }[]): string[] {
  const known = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of links) {
    if (child !== parent && known.has(child) && known.has(parent)) parents.get(child)!.add(parent);
  }

  const remaining = [...tables].sort();
  const ordered: string[] = [];
  const placed = new Set<string>();
  while (remaining.length > 0) {
    const ready = remaining.findIndex((t) => [...parents.get(t)!].every((p) => placed.has(p)));
    const [next] = remaining.splice(ready === -1 ? 0 : ready, 1);
    ordered.push(next);
    placed.add(next);
  }
  return ordered;
}

export interface TableDump {
  name: string;
  columns: string[];
  /** Reikšmių grupės iš chunkSelectSql — kiekviena tampa vienu INSERT sakiniu. */
  chunks: string[];
  rows: number;
}

const KIND_LABEL = {
  auto: "automatinė",
  rankine: "rankinė",
  parsisiusta: "parsisiųsta į kompiuterį",
} as const;

/** Visas kopijos tekstas. `tables` — jau surikiuotos tėvinės pirmiau vaikinių. */
export function buildDumpText(
  meta: { createdAt: string; label: keyof typeof KIND_LABEL; schema: string | null },
  tables: TableDump[]
): string {
  const rows = tables.reduce((sum, t) => sum + t.rows, 0);
  return [
    "-- Šeimos finansų atsarginė kopija",
    `-- Sukurta: ${meta.createdAt} (${KIND_LABEL[meta.label]})`,
    `-- Duomenų bazės versija (paskutinė migracija): ${meta.schema ?? "nežinoma"}`,
    `-- Lentelių: ${tables.length}, eilučių: ${rows}`,
    ...tables.map((t) => `--   ${t.name}: ${t.rows}`),
    "--",
    "-- DĖMESIO: paleistas šis failas IŠTRINA visus esamus duomenis ir įrašo kopijos duomenis.",
    "-- Kaip atkurti — PROJEKTAS.md, skyrius „Atsarginės kopijos“.",
    "",
    "PRAGMA defer_foreign_keys = true;",
    ...[...tables].reverse().map((t) => `DELETE FROM ${ident(t.name)};`),
    ...tables.flatMap((t) => {
      const head = `INSERT INTO ${ident(t.name)} (${t.columns.map(ident).join(", ")}) VALUES`;
      return t.chunks.map((chunk) => `${head}\n${chunk};`);
    }),
    "",
  ].join("\n");
}

/** Sukuria kopiją iš gyvos bazės. */
export async function createDump(
  db: D1Database,
  label: keyof typeof KIND_LABEL,
  now = new Date()
): Promise<{ bytes: Uint8Array; rows: number; tables: number; schema: string | null; createdAt: string }> {
  const createdAt = now.toISOString();
  const dataTables = `m.type = 'table' AND substr(m.name, 1, 7) <> 'sqlite_'
    AND substr(m.name, 1, 4) <> '_cf_' AND m.name <> 'd1_migrations'`;

  const [columns, links] = await db.batch<Record<string, string>>([
    db.prepare(
      `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m
       JOIN pragma_table_info(m.name) p WHERE ${dataTables} ORDER BY m.name, p.cid`
    ),
    db.prepare(
      `SELECT m.name AS child, f."table" AS parent FROM sqlite_master m
       JOIN pragma_foreign_key_list(m.name) f WHERE ${dataTables}`
    ),
  ]);

  const columnsOf = new Map<string, string[]>();
  for (const { tbl, col } of columns.results) {
    if (!isDataTable(tbl)) continue;
    columnsOf.set(tbl, [...(columnsOf.get(tbl) ?? []), col]);
  }
  const ordered = orderTables(
    [...columnsOf.keys()],
    links.results.map((l) => ({ child: l.child, parent: l.parent }))
  );

  const results = await db.batch<{ n: number; s: string }>(
    ordered.map((t) => db.prepare(chunkSelectSql(t, columnsOf.get(t)!)))
  );
  const tables: TableDump[] = ordered.map((name, i) => ({
    name,
    columns: columnsOf.get(name)!,
    chunks: results[i].results.map((r) => r.s),
    rows: results[i].results.reduce((sum, r) => sum + r.n, 0),
  }));
  const schema = await latestMigration(db);

  const text = buildDumpText({ createdAt, label, schema }, tables);
  return {
    bytes: new TextEncoder().encode(text),
    rows: tables.reduce((sum, t) => sum + t.rows, 0),
    tables: tables.length,
    schema,
    createdAt,
  };
}

async function latestMigration(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
      .first<{ name: string }>();
    return row?.name ?? null;
  } catch {
    // Bazė, kuriai migracijos taikytos ne per wrangler, d1_migrations neturi — kopija vis tiek tinka.
    return null;
  }
}

// ---------- Saugojimas KV ----------

export const backupKey = (kind: BackupKind, createdAt: string) => `${kind}/${createdAt}`;

/** Ar raktas tikrai kopijos — kad per atsisiuntimo adresą nebūtų galima skaityti ko nors kito. */
export function isBackupKey(key: string): boolean {
  return /^(auto|rankine)\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(key);
}

/** Kurias kopijas ištrinti: lieka `keep` naujausių (raktuose ISO laikas, tad rikiuojasi chronologiškai). */
export function keysToPrune(keys: string[], keep: number): string[] {
  return [...keys].sort().reverse().slice(keep);
}

/** Padaro kopiją, išsaugo KV, išvalo senas ir įrašo rezultatą (ir nesėkmę) į app_state. */
export async function saveBackup(env: BackupEnv, kind: BackupKind, now = new Date()): Promise<BackupInfo> {
  const attemptAt = now.toISOString();
  try {
    const dump = await createDump(env.DB, kind, now);
    const key = backupKey(kind, dump.createdAt);
    const meta: BackupMeta = {
      createdAt: dump.createdAt,
      kind,
      bytes: dump.bytes.byteLength,
      rows: dump.rows,
      tables: dump.tables,
      schema: dump.schema,
    };
    await env.BACKUPS.put(key, dump.bytes, { metadata: meta });

    const { keys } = await env.BACKUPS.list({ prefix: `${kind}/` });
    await Promise.all(keysToPrune(keys.map((k) => k.name), KEEP[kind]).map((k) => env.BACKUPS.delete(k)));

    await updateState(env.DB, { lastAttemptAt: attemptAt, lastOkAt: attemptAt, lastError: null });
    return { key, ...meta };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateState(env.DB, { lastAttemptAt: attemptAt, lastError: message }).catch((e) => console.error(e));
    throw error;
  }
}

export async function listBackups(kv: KVNamespace): Promise<BackupInfo[]> {
  const lists = await Promise.all(
    (Object.keys(KEEP) as BackupKind[]).map((kind) => kv.list<BackupMeta>({ prefix: `${kind}/` }))
  );
  return lists
    .flatMap((list) => list.keys.filter((k) => k.metadata).map((k) => ({ key: k.name, ...k.metadata! })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function backupOverview(env: BackupEnv): Promise<{ items: BackupInfo[]; state: BackupState }> {
  const [items, state] = await Promise.all([listBackups(env.BACKUPS), readState(env.DB)]);
  return { items, state };
}

// ---------- Būsena ----------

export async function readState(db: D1Database): Promise<BackupState> {
  const row = await db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(STATE_KEY)
    .first<{ value: string }>();
  return row ? { ...EMPTY_STATE, ...(JSON.parse(row.value) as Partial<BackupState>) } : { ...EMPTY_STATE };
}

async function updateState(db: D1Database, change: Partial<BackupState>): Promise<void> {
  const state = { ...(await readState(db)), ...change };
  await db
    .prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(STATE_KEY, JSON.stringify(state))
    .run();
}

/** Pažymi, kad kopija parsisiųsta į kompiuterį — appsas primins, jei to seniai nedaryta. */
export const markDownloaded = (db: D1Database, now = new Date()) =>
  updateState(db, { lastDownloadAt: now.toISOString() });

// ---------- Failas parsisiuntimui ----------

export function fileName(createdAt: string, label: keyof typeof KIND_LABEL): string {
  const suffix = label === "auto" ? "-automatine" : label === "rankine" ? "-rankine" : "";
  return `namai-${createdAt.slice(0, 10)}${suffix}.sql`;
}

export function fileResponse(body: BodyInit, name: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

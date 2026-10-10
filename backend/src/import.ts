import { parseSeb } from "./parsers/seb";
import { parseSwedbank } from "./parsers/swedbank";
import { ParseError, type ParseResult, type ParsedTransaction } from "./parsers/types";
import { categorize, type CategoryRow, type Rule } from "./rules";

export type PreviewRow = ParsedTransaction & {
  fingerprint: string;
  categoryId: number | null;
  isTransfer: boolean;
  isDuplicate: boolean;
  /** Kuri taisyklė priskyrė; null, jei rankomis arba niekas. */
  ruleId: number | null;
};

export type Preview = {
  bank: string;
  owner: string;
  rows: PreviewRow[];
  skipped: { reason: string; count: number }[];
  summary: {
    total: number;
    duplicates: number;
    categorized: number;
    transfers: number;
    uncategorized: number;
  };
};

/** Atpažįsta banką pagal failo turinį, kad vartotojui nereikėtų rinktis. */
export function detectAndParse(text: string): ParseResult {
  const firstLine = text.slice(0, 500);

  if (firstLine.includes("DOK NR.") || firstLine.includes("IŠRAŠAS (UŽ LAIKOTARPĮ")) {
    return parseSeb(text);
  }
  if (firstLine.includes("Sąskaitos Nr.")) {
    return parseSwedbank(text);
  }

  throw new ParseError(
    "Nepavyko atpažinti, kurio banko išrašas tai yra. Tinka Swedbank ir SEB CSV failai."
  );
}

/**
 * Operacijos pirštų atspaudas. Būtinai su banko operacijos numeriu: tikruose
 * išrašuose pasitaiko dvi vienodos operacijos tą pačią dieną (pvz. du to paties
 * dydžio mokėjimai tam pačiam gavėjui), ir be jo antroji dingtų kaip dublikatas.
 */
export async function fingerprint(tx: ParsedTransaction): Promise<string> {
  const parts = [
    tx.bank,
    tx.accountIban,
    tx.bookingDate,
    String(tx.amountCents),
    tx.reference ?? "",
    tx.description ?? "",
  ];
  return sha256(parts.join("|"));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildPreview(
  db: D1Database,
  text: string,
  owner: string
): Promise<Preview> {
  const parsed = detectAndParse(text);

  const [categories, rules] = await Promise.all([
    db.prepare("SELECT id, name, parent_id FROM categories").all<CategoryRow>(),
    db.prepare("SELECT * FROM rules WHERE is_active = 1 ORDER BY priority").all<Rule>(),
  ]);

  const fingerprints = await Promise.all(parsed.transactions.map(fingerprint));
  const [existing, ourAccounts] = await Promise.all([
    findExistingFingerprints(db, fingerprints),
    knownAccountHashes(db),
  ]);

  const rows: PreviewRow[] = await Promise.all(
    parsed.transactions.map(async (tx, i) => {
      const verdict = categorize(tx, rules.results, categories.results, owner);

      // Patikimiausias vidinio pervedimo požymis — gavėjo sąskaita yra mūsų pačių.
      const savas = tx.counterpartyAccount
        ? ourAccounts.has(await sha256(tx.counterpartyAccount))
        : false;

      return {
        ...tx,
        fingerprint: fingerprints[i],
        categoryId: savas ? null : verdict.categoryId,
        isTransfer: savas || verdict.isTransfer,
        isDuplicate: existing.has(fingerprints[i]),
        ruleId: savas ? null : verdict.ruleId,
      };
    })
  );

  const fresh = rows.filter((r) => !r.isDuplicate);

  return {
    bank: parsed.bank,
    owner,
    rows,
    skipped: parsed.skipped,
    summary: {
      total: rows.length,
      duplicates: rows.length - fresh.length,
      categorized: fresh.filter((r) => r.categoryId !== null).length,
      transfers: fresh.filter((r) => r.isTransfer).length,
      uncategorized: fresh.filter((r) => r.categoryId === null && !r.isTransfer).length,
    },
  };
}

async function knownAccountHashes(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT iban_hash FROM accounts WHERE iban_hash IS NOT NULL")
    .all<{ iban_hash: string }>();
  return new Set(results.map((r) => r.iban_hash));
}

async function findExistingFingerprints(
  db: D1Database,
  fingerprints: string[]
): Promise<Set<string>> {
  const found = new Set<string>();

  // D1 riboja parametrų skaičių vienoje užklausoje, tad dalim.
  for (let i = 0; i < fingerprints.length; i += 100) {
    const chunk = fingerprints.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT fingerprint FROM transactions WHERE fingerprint IN (${placeholders})`)
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    for (const row of results) found.add(row.fingerprint);
  }

  return found;
}

/** Sąskaitas kuriam automatiškai — vartotojui jų valdyti nereikia. */
export async function resolveAccountId(
  db: D1Database,
  bank: string,
  iban: string,
  owner: string
): Promise<number> {
  const hash = await sha256(iban);

  const existing = await db
    .prepare("SELECT id FROM accounts WHERE iban_hash = ?")
    .bind(hash)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const last4 = iban.slice(-4);
  const created = await db
    .prepare(
      `INSERT INTO accounts (bank, name, iban_last4, currency, owner, iban_hash)
       VALUES (?, ?, ?, 'EUR', ?, ?) RETURNING id`
    )
    .bind(bank, `${owner} ${bank.toUpperCase()} ...${last4}`, last4, owner, hash)
    .first<{ id: number }>();

  return created!.id;
}

export async function saveRows(
  db: D1Database,
  rows: PreviewRow[],
  owner: string
): Promise<{ saved: number; skippedDuplicates: number }> {
  const fresh = rows.filter((row) => !row.isDuplicate);

  const accountIds = new Map<string, number>();
  for (const row of fresh) {
    if (!accountIds.has(row.accountIban)) {
      accountIds.set(row.accountIban, await resolveAccountId(db, row.bank, row.accountIban, owner));
    }
  }

  const statement = db.prepare(
    `INSERT OR IGNORE INTO transactions
       (account_id, booking_date, value_date, amount_cents, currency, counterparty_name,
        counterparty_account, description, reference, raw_type, category_id, is_transfer,
        fingerprint, country, rule_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv')`
  );

  const batch = fresh.map((row) =>
    statement.bind(
      accountIds.get(row.accountIban)!,
      row.bookingDate,
      row.valueDate,
      row.amountCents,
      row.currency,
      row.counterpartyName,
      row.counterpartyAccount,
      row.description,
      row.reference,
      row.rawType,
      row.categoryId,
      row.isTransfer ? 1 : 0,
      row.fingerprint,
      row.country ?? null,
      row.ruleId ?? null
    )
  );

  if (batch.length > 0) await db.batch(batch);

  return { saved: batch.length, skippedDuplicates: rows.length - fresh.length };
}

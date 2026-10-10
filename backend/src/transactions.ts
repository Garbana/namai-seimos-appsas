export type TransactionFilters = {
  from?: string;
  to?: string;
  categoryId?: number;
  uncategorized?: boolean;
  search?: string;
  includeTransfers?: boolean;
  /** Nerodyti įplaukų, kurios dengia išlaidas — jos jau matomos prie išlaidos. */
  hideOffsets?: boolean;
  direction?: "income" | "expense";
  /** Tik operacijos, kurių suma ne didesnė (pvz. išlaidos nuo −52,74 € ir daugiau). */
  maxCents?: number;
  /** Sąskaitos savininkas (Jonas / Rūta) — iš kieno sąskaitos operacija. */
  owner?: string;
  limit: number;
  offset: number;
};

export function readFilters(url: URL): TransactionFilters {
  const number = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw === null || raw === "" ? undefined : Number(raw);
  };

  return {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    categoryId: number("categoryId"),
    uncategorized: url.searchParams.get("uncategorized") === "1",
    search: url.searchParams.get("search")?.trim() || undefined,
    includeTransfers: url.searchParams.get("includeTransfers") === "1",
    hideOffsets: url.searchParams.get("hideOffsets") === "1",
    direction: (["income", "expense"] as const).find((d) => d === url.searchParams.get("direction")),
    maxCents: number("maxCents"),
    owner: url.searchParams.get("owner")?.trim() || undefined,
    limit: Math.min(number("limit") ?? 200, 500),
    offset: number("offset") ?? 0,
  };
}

/** Sąlygos su parametrais — reikšmės niekada nelipdomos į SQL tekstą. */
function buildWhere(filters: TransactionFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = ["t.is_split_parent = 0"];
  const params: unknown[] = [];

  if (filters.from) {
    conditions.push("t.booking_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("t.booking_date <= ?");
    params.push(filters.to);
  }
  if (filters.uncategorized) {
    conditions.push("t.category_id IS NULL AND t.is_transfer = 0 AND t.offset_of_id IS NULL");
  } else if (filters.categoryId !== undefined) {
    conditions.push("t.category_id = ?");
    params.push(filters.categoryId);
  }
  if (!filters.includeTransfers && !filters.uncategorized) {
    // Pervedimai tarp savų sąskaitų nėra nei pajamos, nei išlaidos —
    // sąraše jie tik trukdo, nebent specialiai paprašoma.
    conditions.push("t.is_transfer = 0");
  }
  if (filters.hideOffsets) {
    conditions.push("t.offset_of_id IS NULL");
  }
  if (filters.direction === "income") {
    conditions.push("t.amount_cents > 0");
  } else if (filters.direction === "expense") {
    conditions.push("t.amount_cents < 0");
  }
  if (filters.owner) {
    // Per subužklausą, o ne JOIN — tada ta pati sąlyga tinka ir sumų užklausai.
    conditions.push("t.account_id IN (SELECT id FROM accounts WHERE owner = ?)");
    params.push(filters.owner);
  }
  if (filters.maxCents !== undefined && Number.isFinite(filters.maxCents)) {
    conditions.push("t.amount_cents <= ?");
    params.push(filters.maxCents);
  }
  if (filters.search) {
    conditions.push("(t.counterparty_name LIKE ? OR t.description LIKE ?)");
    const pattern = `%${filters.search}%`;
    params.push(pattern, pattern);
  }

  return { sql: conditions.join(" AND "), params };
}

export async function listTransactions(db: D1Database, filters: TransactionFilters) {
  const where = buildWhere(filters);

  const rows = await db
    .prepare(
      `SELECT t.id, t.booking_date, t.amount_cents, t.counterparty_name, t.description,
              t.reference, t.raw_type, t.category_id, t.is_transfer, t.notes, t.country,
              t.value_date, t.counterparty_account, t.parent_id, t.rule_id, t.offset_of_id,
              c.name AS category_name, p.name AS group_name,
              a.owner AS account_owner, a.bank AS account_bank, a.iban_last4,
              e.booking_date AS offset_target_date,
              e.counterparty_name AS offset_target_name,
              e.amount_cents AS offset_target_amount,
              par.booking_date AS parent_booking_date,
              COALESCE((SELECT SUM(o.amount_cents) FROM transactions o
                        WHERE o.offset_of_id = t.id), 0) AS offset_cents,
              (SELECT json_group_array(json_object(
                        'id', o.id, 'booking_date', o.booking_date,
                        'counterparty_name', o.counterparty_name,
                        'amount_cents', o.amount_cents, 'account_owner', oa.owner))
               FROM transactions o JOIN accounts oa ON oa.id = o.account_id
               WHERE o.offset_of_id = t.id) AS offsets_json
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       LEFT JOIN transactions e ON e.id = t.offset_of_id
       LEFT JOIN transactions par ON par.id = t.parent_id
       JOIN accounts a ON a.id = t.account_id
       WHERE ${where.sql}
       ORDER BY t.booking_date DESC, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...where.params, filters.limit, filters.offset)
    .all<Record<string, unknown> & { offsets_json: string | null }>();

  // Sudengimo įplaukos pačios į sumas neįeina — jos jau įskaičiuotos kaip
  // mažinančios savo išlaidą, kitaip būtų skaičiuojamos du kartus.
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN t.offset_of_id IS NULL AND t.amount_cents > 0
                                THEN t.amount_cents END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.amount_cents < 0
                                THEN t.amount_cents + COALESCE((SELECT SUM(o.amount_cents)
                                     FROM transactions o WHERE o.offset_of_id = t.id), 0)
                           END), 0) AS expense
       FROM transactions t
       WHERE ${where.sql}`
    )
    .bind(...where.params)
    .first<{ count: number; income: number; expense: number }>();

  const parsed = rows.results.map(({ offsets_json, ...row }) => ({
    ...row,
    offsets: (JSON.parse(offsets_json ?? "[]") as { booking_date: string }[]).sort((a, b) =>
      a.booking_date.localeCompare(b.booking_date)
    ),
  }));

  return { rows: parsed, totals };
}

export async function updateTransactions(
  db: D1Database,
  ids: number[],
  changes: { categoryId?: number | null; isTransfer?: boolean }
): Promise<number> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  if (changes.categoryId !== undefined) {
    assignments.push("category_id = ?");
    params.push(changes.categoryId);
    // Rankinis pakeitimas nutraukia ryšį su taisykle — kitaip atrodytų,
    // kad kategoriją priskyrė taisyklė, nors ją pakeitė žmogus.
    assignments.push("rule_id = NULL");
    // Priskyrus kategoriją, operacija nebėra vidinis pervedimas.
    if (changes.categoryId !== null && changes.isTransfer === undefined) {
      assignments.push("is_transfer = 0");
    }
  }
  if (changes.isTransfer !== undefined) {
    assignments.push("is_transfer = ?");
    params.push(changes.isTransfer ? 1 : 0);
    if (changes.isTransfer) assignments.push("category_id = NULL");
  }

  if (assignments.length === 0) return 0;

  // Rankinis priskyrimas reiškia, kad įplauka nebėra sudengimas.
  assignments.push("offset_of_id = NULL");

  const placeholders = ids.map(() => "?").join(",");

  if (changes.isTransfer) {
    const susieta = await db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE offset_of_id IN (${placeholders})`)
      .bind(...ids)
      .first<{ n: number }>();
    if (susieta && susieta.n > 0) {
      throw new Error("Prie kai kurių operacijų yra sudengimų — pirma juos atsiek, tada žymėk pervedimu.");
    }
  }
  const result = await db
    .prepare(`UPDATE transactions SET ${assignments.join(", ")} WHERE id IN (${placeholders})`)
    .bind(...params, ...ids)
    .run();

  return result.meta.changes ?? 0;
}

export type SplitPart = {
  categoryId: number | null;
  amountCents: number;
  notes?: string | null;
  /** Kuriam laikotarpiui priskirti dalį (pvz. pavėluotai sumokėti komunaliniai). */
  bookingDate?: string;
};

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Padalija operaciją į kelias dalis skirtingoms kategorijoms.
 * Tėvinė eilutė lieka istorijai (matosi visa banko informacija), bet į sumas
 * nebeįskaičiuojama — ją pakeičia vaikinės eilutės.
 */
export async function splitTransaction(
  db: D1Database,
  id: number,
  parts: SplitPart[]
): Promise<{ created: number }> {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error("Nenurodyta nė viena dalis.");
  }

  const parent = await db
    .prepare(
      `SELECT id, account_id, booking_date, value_date, amount_cents, currency,
              counterparty_name, counterparty_account, description, reference, raw_type,
              country, is_split_parent, parent_id, offset_of_id
       FROM transactions WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      account_id: number;
      booking_date: string;
      value_date: string | null;
      amount_cents: number;
      currency: string;
      counterparty_name: string | null;
      counterparty_account: string | null;
      description: string | null;
      reference: string | null;
      raw_type: string | null;
      country: string | null;
      is_split_parent: number;
      parent_id: number | null;
      offset_of_id: number | null;
    }>();

  if (!parent) throw new Error("Tokios operacijos nėra.");
  if (parent.is_split_parent) throw new Error("Ši operacija jau suskaidyta.");
  if (parent.parent_id !== null) throw new Error("Skaidymo dalies skaidyti negalima.");
  if (parent.offset_of_id !== null) {
    throw new Error("Ši įplauka dengia išlaidą — pirma ją atsiek, tada skaidyk.");
  }

  const offsets = await db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE offset_of_id = ?")
    .bind(id)
    .first<{ n: number }>();
  if (offsets && offsets.n > 0) {
    throw new Error("Prie šios išlaidos yra sudengimų — pirma juos atsiek, tada skaidyk.");
  }

  const suma = parts.reduce((s, p) => s + p.amountCents, 0);
  if (suma !== parent.amount_cents) {
    throw new Error(
      `Dalių suma (${(suma / 100).toFixed(2)} EUR) nesutampa su operacijos suma ` +
        `(${(parent.amount_cents / 100).toFixed(2)} EUR).`
    );
  }

  for (const part of parts) {
    if (part.bookingDate !== undefined && !isValidDate(part.bookingDate)) {
      throw new Error(`Netinkama dalies data: „${part.bookingDate}".`);
    }
  }

  // Viena dalis prasminga tik tada, kai visa operacija perkeliama į kitą datą.
  const moved = parts.some((p) => p.bookingDate !== undefined && p.bookingDate !== parent.booking_date);
  if (parts.length < 2 && !moved) {
    throw new Error("Skaidant reikia bent dviejų dalių arba kitos datos.");
  }

  const insert = db.prepare(
    `INSERT INTO transactions
       (account_id, booking_date, value_date, amount_cents, currency, counterparty_name,
        counterparty_account, description, reference, raw_type, category_id, parent_id,
        country, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
  );

  await db.batch([
    ...parts.map((part) =>
      insert.bind(
        parent.account_id,
        part.bookingDate ?? parent.booking_date,
        parent.value_date,
        part.amountCents,
        parent.currency,
        parent.counterparty_name,
        parent.counterparty_account,
        parent.description,
        parent.reference,
        parent.raw_type,
        part.categoryId,
        parent.id,
        parent.country,
        part.notes ?? null
      )
    ),
    db
      .prepare("UPDATE transactions SET is_split_parent = 1, category_id = NULL WHERE id = ?")
      .bind(parent.id),
  ]);

  return { created: parts.length };
}

/**
 * Atšaukia skaidymą: dalys ištrinamos, o pradinė operacija vėl skaičiuojama
 * į sumas. Kategorija jai nepriskiriama iš naujo — dalys galėjo būti skirtingose
 * kategorijose, tad spėti, kurią grąžinti, būtų neteisinga.
 */
export async function unsplitTransaction(db: D1Database, id: number): Promise<void> {
  const parent = await db
    .prepare("SELECT is_split_parent FROM transactions WHERE id = ?")
    .bind(id)
    .first<{ is_split_parent: number }>();

  if (!parent) throw new Error("Tokios operacijos nėra.");
  if (!parent.is_split_parent) throw new Error("Ši operacija nesuskaidyta.");

  const susieta = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions d
       WHERE d.parent_id = ?
         AND (d.offset_of_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM transactions o WHERE o.offset_of_id = d.id))`
    )
    .bind(id)
    .first<{ n: number }>();
  if (susieta && susieta.n > 0) {
    throw new Error("Kai kurios dalys susietos su sudengimais — pirma juos atsiek.");
  }

  await db.batch([
    db.prepare("DELETE FROM transactions WHERE parent_id = ?").bind(id),
    db.prepare("UPDATE transactions SET is_split_parent = 0 WHERE id = ?").bind(id),
  ]);
}

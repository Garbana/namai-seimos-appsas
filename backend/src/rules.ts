/** Viskas, ko taisyklei reikia operacijai įvertinti — tinka ir ką tik
 *  nuskaitytai iš failo, ir jau išsaugotai duomenų bazėje. */
export type MatchableTransaction = {
  counterpartyName: string | null;
  description: string | null;
  amountCents: number;
  /** Trijų raidžių šalies kodas iš išrašo; null, jei bankas jo nepateikė. */
  country?: string | null;
};

export type Rule = {
  id: number;
  priority: number;
  field: "any" | "counterparty" | "description" | "amount";
  operator: "contains" | "equals" | "regex" | "range";
  value: string;
  category_id: number | null;
  owner_category_name: string | null;
  mark_transfer: number;
  direction: "D" | "C" | null;
  /** Papildomos sąlygos, tikrinamos KARTU su teksto atitikimu. */
  country_scope: "lt" | "foreign" | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
};

export type CategoryRow = {
  id: number;
  name: string;
  parent_id: number | null;
};

export type Categorization = {
  categoryId: number | null;
  isTransfer: boolean;
  ruleId: number | null;
};

const UNCATEGORIZED: Categorization = { categoryId: null, isTransfer: false, ruleId: null };

/**
 * Taisyklės taikomos pagal priority, pirma suveikusi laimi.
 * `owner` — sąskaitos savininkas (Jonas/Rūta); pagal jį išsprendžiamos
 * asmeninės kategorijos. Jei savininkas nežinomas, tokios taisyklės praleidžiamos.
 */
export function categorize(
  tx: MatchableTransaction,
  rules: Rule[],
  categories: CategoryRow[],
  owner: string | null
): Categorization {
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (!matchesDirection(rule, tx)) continue;
    if (!matchesCountry(rule, tx)) continue;
    if (!matchesAmountBounds(rule, tx)) continue;
    if (!matchesValue(rule, tx)) continue;

    if (rule.mark_transfer) {
      return { categoryId: null, isTransfer: true, ruleId: rule.id };
    }

    const categoryId = resolveCategory(rule, categories, owner);
    if (categoryId === null) continue;

    return { categoryId, isTransfer: false, ruleId: rule.id };
  }

  return UNCATEGORIZED;
}

function matchesDirection(rule: Rule, tx: MatchableTransaction): boolean {
  if (!rule.direction) return true;
  return rule.direction === "D" ? tx.amountCents < 0 : tx.amountCents > 0;
}

/**
 * Nežinoma šalis nelaikoma nei Lietuva, nei užsieniu — tokios taisyklės
 * tiesiog nesuveikia. Geriau palikti nepriskirtą, nei klaidingai nukelti
 * pirkinį į atostogas.
 */
function matchesCountry(rule: Rule, tx: MatchableTransaction): boolean {
  if (!rule.country_scope) return true;
  if (!tx.country) return false;
  return rule.country_scope === "lt" ? tx.country === "LTU" : tx.country !== "LTU";
}

function matchesAmountBounds(rule: Rule, tx: MatchableTransaction): boolean {
  const amount = Math.abs(tx.amountCents);
  if (rule.amount_min_cents !== null && amount < rule.amount_min_cents) return false;
  if (rule.amount_max_cents !== null && amount > rule.amount_max_cents) return false;
  return true;
}

function matchesValue(rule: Rule, tx: MatchableTransaction): boolean {
  if (rule.field === "amount") {
    const [min, max] = rule.value.split("..").map((part) => Number(part.trim()) * 100);
    const amount = Math.abs(tx.amountCents);
    return Number.isFinite(min) && Number.isFinite(max) && amount >= min && amount <= max;
  }

  const haystack = haystackFor(rule.field, tx).toUpperCase();
  if (!haystack) return false;

  const needle = rule.value.toUpperCase();

  switch (rule.operator) {
    case "contains":
      return haystack.includes(needle);
    case "equals":
      return haystack.trim() === needle.trim();
    case "regex":
      try {
        return new RegExp(rule.value, "iu").test(haystack);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function haystackFor(field: Rule["field"], tx: MatchableTransaction): string {
  switch (field) {
    case "counterparty":
      return tx.counterpartyName ?? "";
    case "description":
      return tx.description ?? "";
    default:
      return `${tx.counterpartyName ?? ""} ${tx.description ?? ""}`;
  }
}

function resolveCategory(
  rule: Rule,
  categories: CategoryRow[],
  owner: string | null
): number | null {
  if (rule.category_id !== null) return rule.category_id;
  if (!rule.owner_category_name || !owner) return null;

  // „{owner} DU" -> „Jonas DU": ieškom tokio tikslaus pavadinimo.
  if (rule.owner_category_name.includes("{owner}")) {
    const name = rule.owner_category_name.replace("{owner}", owner);
    return categories.find((c) => c.name === name)?.id ?? null;
  }

  // „Bolt" -> kategorija „Bolt" savininko grupėje.
  const ownerGroup = categories.find((c) => c.parent_id === null && c.name === owner);
  if (!ownerGroup) return null;

  return (
    categories.find(
      (c) => c.parent_id === ownerGroup.id && c.name === rule.owner_category_name
    )?.id ?? null
  );
}

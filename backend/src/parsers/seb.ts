import { assertColumns, extractCountry, normalizeDate, parseAmountToCents, parseRows } from "./csv";
import { ParseError, type ParseResult, type ParsedTransaction } from "./types";

/**
 * SEB (LT) CSV: kabliataškiu skirtas, suma su kableliu.
 * Viename faile gali būti kelios sąskaitos — kiekviena savo sekcijoje su
 * pavadinimo eilute ir antrašte. Sąskaitą imam iš pačios operacijos eilutės
 * (stulpelis „SĄSKAITOS NR"), tad sekcijų sekti nereikia.
 */
const COL = {
  docNumber: 0,
  date: 1,
  currency: 2,
  amount: 3,
  counterparty: 4,
  counterpartyCode: 5,
  counterpartyAccount: 6,
  purpose: 9,
  transactionCode: 10,
  documentDate: 11,
  transactionType: 12,
  debitCredit: 14,
  amountInAccountCurrency: 15,
  iban: 16,
} as const;

const HEADER_FIRST_CELL = "DOK NR.";

export function parseSeb(text: string): ParseResult {
  const rows = parseRows(text, ";");
  if (rows.length === 0) throw new ParseError("Failas tuščias.");

  const header = rows.find((row) => (row[0] ?? "").trim() === HEADER_FIRST_CELL);
  if (!header) {
    throw new ParseError(
      `Faile nerasta SEB išrašo antraštė (eilutė, prasidedanti „DOK NR."). Ar tikrai tai SEB išrašas?`
    );
  }

  assertColumns(
    header,
    [
      { index: COL.date, name: "DATA" },
      { index: COL.amount, name: "SUMA" },
      { index: COL.counterparty, name: "MOKĖTOJO ARBA GAVĖJO PAVADINIMAS" },
      { index: COL.purpose, name: "MOKĖJIMO PASKIRTIS" },
      { index: COL.debitCredit, name: "DEBETAS/KREDITAS" },
      { index: COL.iban, name: "SĄSKAITOS NR" },
    ],
    "SEB"
  );

  const transactions: ParsedTransaction[] = [];
  const ibans = new Set<string>();
  const skippedCounts = new Map<string, number>();
  const countSkipped = (reason: string) =>
    skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1);

  for (const row of rows) {
    const firstCell = (row[0] ?? "").trim();

    // Sekcijos pavadinimo eilutė: „SĄSKAITOS (LT..) IŠRAŠAS (UŽ LAIKOTARPĮ: ..)"
    if (row.length <= COL.iban) {
      countSkipped(firstCell.startsWith("SĄSKAITOS") ? "sąskaitos pavadinimo eilutė" : "trumpa eilutė");
      continue;
    }

    if (firstCell === HEADER_FIRST_CELL) {
      countSkipped("antraštės eilutė");
      continue;
    }

    const direction = (row[COL.debitCredit] ?? "").trim().toUpperCase();
    if (direction !== "D" && direction !== "C") {
      throw new ParseError(
        `Nesuprantamas debeto/kredito žymuo „${row[COL.debitCredit]}" ties ${row[COL.date]} operacija.`
      );
    }

    const rawAmount = row[COL.amountInAccountCurrency] || row[COL.amount];
    const magnitude = parseAmountToCents(rawAmount);
    const iban = (row[COL.iban] ?? "").trim();
    ibans.add(iban);

    transactions.push({
      bank: "seb",
      accountIban: iban,
      bookingDate: normalizeDate(row[COL.date]),
      valueDate: safeDate(row[COL.documentDate]),
      amountCents: direction === "D" ? -magnitude : magnitude,
      currency: clean(row[COL.currency]) ?? "EUR",
      counterpartyName: clean(row[COL.counterparty]),
      counterpartyAccount: clean(row[COL.counterpartyAccount]),
      description: clean(row[COL.purpose]),
      reference: clean(row[COL.transactionCode]) ?? clean(row[COL.docNumber]),
      rawType: clean(row[COL.transactionType]),
      country: extractCountry(row[COL.purpose] ?? null),
    });
  }

  return {
    bank: "seb",
    transactions,
    ibans: [...ibans],
    skipped: [...skippedCounts].map(([reason, count]) => ({ reason, count })),
  };
}

function safeDate(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return normalizeDate(value);
  } catch {
    return null;
  }
}

function clean(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

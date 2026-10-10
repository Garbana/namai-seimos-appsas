import { assertColumns, extractCountry, normalizeDate, parseAmountToCents, parseRows } from "./csv";
import { ParseError, type ParseResult, type ParsedTransaction } from "./types";

/**
 * Swedbank (LT) CSV: kableliu skirtas, laukai kabutėse, suma su tašku.
 * Antrą stulpelį banko dokumentacija vadina įrašo tipu, bet antraštėje jis
 * be pavadinimo, todėl kreipiamės pagal poziciją.
 */
const COL = {
  iban: 0,
  recordType: 1,
  date: 2,
  counterparty: 3,
  description: 4,
  amount: 5,
  currency: 6,
  debitCredit: 7,
  reference: 8,
  code: 9,
} as const;

/** Tik „20" yra tikra operacija. 10/86 — likučiai, 82 — apyvartos. */
const RECORD_TYPE_TRANSACTION = "20";

const SERVICE_ROW_LABELS: Record<string, string> = {
  "10": "likutis pradžiai",
  "82": "apyvartos eilutė",
  "86": "likutis pabaigai",
};

export function parseSwedbank(text: string): ParseResult {
  const rows = parseRows(text, ",");
  if (rows.length === 0) throw new ParseError("Failas tuščias.");

  assertColumns(
    rows[0],
    [
      { index: COL.iban, name: "Sąskaitos Nr." },
      { index: COL.date, name: "Data" },
      { index: COL.counterparty, name: "Gavėjas" },
      { index: COL.description, name: "Paaiškinimai" },
      { index: COL.amount, name: "Suma" },
      { index: COL.debitCredit, name: "D/K" },
    ],
    "Swedbank"
  );

  const transactions: ParsedTransaction[] = [];
  const ibans = new Set<string>();
  const skippedCounts = new Map<string, number>();

  for (const row of rows.slice(1)) {
    const recordType = (row[COL.recordType] ?? "").trim();

    if (recordType !== RECORD_TYPE_TRANSACTION) {
      const label = SERVICE_ROW_LABELS[recordType] ?? `nežinomas įrašo tipas „${recordType}"`;
      skippedCounts.set(label, (skippedCounts.get(label) ?? 0) + 1);
      continue;
    }

    const direction = (row[COL.debitCredit] ?? "").trim().toUpperCase();
    if (direction !== "D" && direction !== "K") {
      throw new ParseError(
        `Nesuprantamas debeto/kredito žymuo „${row[COL.debitCredit]}" ties ${row[COL.date]} operacija.`
      );
    }

    const magnitude = parseAmountToCents(row[COL.amount]);
    const iban = (row[COL.iban] ?? "").trim();
    ibans.add(iban);

    transactions.push({
      bank: "swedbank",
      accountIban: iban,
      bookingDate: normalizeDate(row[COL.date]),
      valueDate: null,
      amountCents: direction === "D" ? -magnitude : magnitude,
      currency: (row[COL.currency] ?? "EUR").trim() || "EUR",
      counterpartyName: clean(row[COL.counterparty]),
      counterpartyAccount: null,
      description: clean(row[COL.description]),
      reference: clean(row[COL.reference]),
      rawType: clean(row[COL.code]),
      country: extractCountry(row[COL.description] ?? null),
    });
  }

  return {
    bank: "swedbank",
    transactions,
    ibans: [...ibans],
    skipped: [...skippedCounts].map(([reason, count]) => ({ reason, count })),
  };
}

function clean(value: string | undefined): string | null {
  const text = (value ?? "").trim().replace(/^'/, "");
  return text === "" ? null : text;
}

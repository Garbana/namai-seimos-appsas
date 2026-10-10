export type Bank = "swedbank" | "seb";

export type ParsedTransaction = {
  bank: Bank;
  accountIban: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  description: string | null;
  /** Banko operacijos numeris. Būtinas dublikatų aptikimui: be jo dvi tikros
   *  vienodos operacijos tą pačią dieną atrodytų kaip viena. */
  reference: string | null;
  rawType: string | null;
  /** Trijų raidžių šalies kodas iš išrašo (LTU, FIN...). Swedbank jo nepateikia. */
  country: string | null;
};

export type ParseResult = {
  bank: Bank;
  transactions: ParsedTransaction[];
  ibans: string[];
  skipped: { reason: string; count: number }[];
};

/** Klaida, kurios žinutę galima rodyti vartotojui. */
export class ParseError extends Error {}

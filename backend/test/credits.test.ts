import { describe, expect, it } from "vitest";
import {
  annuityPaymentCents,
  monthsBetween,
  summarizeCredit,
  type CreditRecord,
  type ScheduleRow,
} from "../src/credits";

// Anoniminis pavyzdys: 400 EUR kreditas, keturios 101 EUR įmokos.
const schedule: ScheduleRow[] = [
  { seq: 1, due_date: "2024-01-31", principal_cents: 10000, interest_cents: 100, payment_cents: 10100, balance_after_cents: 30000 },
  { seq: 2, due_date: "2024-02-29", principal_cents: 10000, interest_cents: 100, payment_cents: 10100, balance_after_cents: 20000 },
  { seq: 3, due_date: "2024-03-31", principal_cents: 10000, interest_cents: 100, payment_cents: 10100, balance_after_cents: 10000 },
  { seq: 4, due_date: "2024-04-30", principal_cents: 10000, interest_cents: 100, payment_cents: 10100, balance_after_cents: 0 },
];

const leasing: CreditRecord = {
  id: 1,
  kind: "lizingas",
  name: "Lizingas",
  asset: null,
  lender: "Bankas",
  contract_no: "T-1",
  contract_date: "2024-01-01",
  end_date: "2024-04-30",
  original_cents: 40000,
  rate_type: "fiksuota",
  rate_pct: 2,
  base_rate_name: null,
  base_rate_pct: null,
  margin_pct: null,
  next_rate_change: null,
  monthly_payment_cents: 10100,
  residual_cents: 5000,
  // Banko duomenimis po pirmos įmokos
  balance_cents: 30000,
  balance_date: "2024-02-10",
  principal_category_id: null,
  interest_category_id: null,
  payment_category_id: 7,
  details: null,
  sort_order: 0,
};

const loan: CreditRecord = {
  ...leasing,
  kind: "busto_paskola",
  rate_type: "kintama",
  principal_category_id: 5,
  interest_category_id: 6,
  payment_category_id: null,
};

describe("summarizeCredit", () => {
  it("be naujų nurašymų rodo banko likutį ir kitą grafiko įmoką", () => {
    const s = summarizeCredit(leasing, schedule, [], "2024-02-10");
    expect(s.balanceCents).toBe(30000);
    expect(s.paidCents).toBe(10000);
    expect(s.nextPayment?.seq).toBe(2);
    expect(s.remaining.count).toBe(3);
    expect(s.remaining.interestCents).toBe(300);
  });

  it("bendrą įmoką nubraukia nuo grafiko, o nurašymų iki atskaitos datos neskaičiuoja", () => {
    const s = summarizeCredit(
      leasing,
      schedule,
      [
        { booking_date: "2024-01-20", amount_cents: -10100, category_id: 7 },
        { booking_date: "2024-02-25", amount_cents: -10100, category_id: 7 },
        { booking_date: "2024-02-26", amount_cents: -999, category_id: 99 },
      ],
      "2024-03-01"
    );
    expect(s.balanceCents).toBe(20000);
    expect(s.nextPayment?.seq).toBe(3);
    expect(s.historySource).toBe("grafikas");
    expect(s.history[0].principal).toBe(20000);
    expect(s.schedule.filter((r) => r.paid).map((r) => r.seq)).toEqual([1, 2]);
  });

  it("kai bankas atskiria dalis, likutį mažina tik faktiškai grąžintas kreditas", () => {
    const s = summarizeCredit(
      loan,
      schedule,
      [
        { booking_date: "2024-02-25", amount_cents: -9500, category_id: 5 },
        { booking_date: "2024-02-25", amount_cents: -600, category_id: 6 },
      ],
      "2024-03-01"
    );
    expect(s.balanceCents).toBe(20500);
    expect(s.anchor.principalAfterCents).toBe(9500);
    expect(s.interestPaid.cents).toBe(600);
    expect(s.nextPayment?.seq).toBe(3);
  });

  it("kintamoms palūkanoms skaičiuoja, kaip keistųsi įmoka", () => {
    const s = summarizeCredit(loan, schedule, [], "2024-02-10");
    const [minus, plus, plusOne] = s.sensitivity!.variants.map((v) => v.paymentCents);
    expect(minus).toBeLessThan(s.sensitivity!.basePaymentCents);
    expect(plus).toBeGreaterThan(s.sensitivity!.basePaymentCents);
    expect(plusOne).toBeGreaterThan(plus);
  });

  it("artėjantys įvykiai: paskutinė įmoka ir datuoti sutarties duomenys", () => {
    const s = summarizeCredit(
      { ...leasing, details: JSON.stringify([{ etikete: "Draudimas", reiksme: "iki", data: "2024-03-15", ivykis: "Baigiasi draudimas" }]) },
      schedule,
      [],
      "2024-02-10"
    );
    expect(s.events.map((e) => e.title)).toEqual(["Baigiasi draudimas", "Lizingas: paskutinė įmoka su likutine verte"]);
    expect(s.details).toEqual([{ etikete: "Draudimas", reiksme: "iki" }]);
  });
});

describe("annuityPaymentCents", () => {
  it("atkuria įprastą anuiteto įmoką", () => {
    // 100 000 EUR, 3,6 %, 30 metų -> apie 454,64 EUR
    expect(Math.abs(annuityPaymentCents(10_000_000, 3.6, 360) - 45464)).toBeLessThanOrEqual(1);
    expect(annuityPaymentCents(12000, 0, 12)).toBe(1000);
  });
});

describe("monthsBetween", () => {
  it("skaičiuoja pilnus mėnesius", () => {
    expect(monthsBetween("2026-09-13", "2049-09-10")).toBe(275);
    expect(monthsBetween("2026-09-13", "2026-10-13")).toBe(1);
    expect(monthsBetween("2026-09-13", "2026-01-01")).toBe(0);
  });
});

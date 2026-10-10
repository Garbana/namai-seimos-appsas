import { describe, expect, it } from "vitest";
import { addDays, formatRule, isDate, nextDue, parseRule, weekday, type Rule } from "../src/darbai/pakartojimai";

const rule = (text: string): Rule => {
  const r = parseRule(text);
  if (!r) throw new Error(`netinkama taisyklė ${text}`);
  return r;
};

/** Kaip užbaigiant: kitas po vėlesnės iš termino ir šiandienos. */
const kitas = (text: string, terminas: string, siandien: string) =>
  nextDue(rule(text), terminas, terminas > siandien ? terminas : siandien);

describe("pakartojimo taisyklė", () => {
  it("skaito ir rašo atgal", () => {
    expect(formatRule(rule("FREQ=WEEKLY;BYDAY=SA,TU"))).toBe("FREQ=WEEKLY;BYDAY=TU,SA");
    expect(formatRule(rule("freq=monthly;interval=2;bymonthday=15"))).toBe("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15");
    expect(formatRule(rule("FREQ=DAILY;INTERVAL=1"))).toBe("FREQ=DAILY");
  });

  it("atmeta netinkamas", () => {
    for (const blogas of ["", "FREQ=HOURLY", "FREQ=DAILY;INTERVAL=0", "FREQ=WEEKLY;BYDAY=XX", "FREQ=DAILY;BYDAY=MO", "FREQ=MONTHLY;BYMONTHDAY=32"]) {
      expect(parseRule(blogas), blogas).toBeNull();
    }
  });
});

describe("kitas terminas", () => {
  it("kas dieną ir kas 2 dienas", () => {
    expect(kitas("FREQ=DAILY", "2026-10-09", "2026-10-09")).toBe("2026-10-10");
    expect(kitas("FREQ=DAILY;INTERVAL=2", "2026-10-09", "2026-10-09")).toBe("2026-10-11");
    // Pavėluota 3 d.: kitas — ne praeityje, o pagal tą pačią seriją po šiandienos.
    expect(kitas("FREQ=DAILY;INTERVAL=2", "2026-10-09", "2026-10-12")).toBe("2026-10-13");
  });

  it("kas šeštadienį: atlikus vėliau — kitas šeštadienis po šiandienos", () => {
    // 2026-10-10 — šeštadienis.
    expect(weekday("2026-10-10")).toBe(5);
    expect(kitas("FREQ=WEEKLY;BYDAY=SA", "2026-10-10", "2026-10-10")).toBe("2026-10-17");
    expect(kitas("FREQ=WEEKLY;BYDAY=SA", "2026-10-10", "2026-10-14")).toBe("2026-10-17");
    // Atlikta anksčiau (ketvirtadienį) — kitas po termino.
    expect(kitas("FREQ=WEEKLY;BYDAY=SA", "2026-10-10", "2026-10-08")).toBe("2026-10-17");
  });

  it("antradieniais ir penktadieniais", () => {
    // 2026-10-13 — antradienis.
    expect(kitas("FREQ=WEEKLY;BYDAY=TU,FR", "2026-10-13", "2026-10-13")).toBe("2026-10-16");
    expect(kitas("FREQ=WEEKLY;BYDAY=TU,FR", "2026-10-16", "2026-10-16")).toBe("2026-10-20");
  });

  it("kas 2 savaites — laikomasi serijos savaičių", () => {
    // Serija nuo 2026-10-10 (šešt.): 10-10, 10-24, 11-07…
    expect(kitas("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", "2026-10-10", "2026-10-10")).toBe("2026-10-24");
    expect(kitas("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", "2026-10-10", "2026-10-25")).toBe("2026-11-07");
    // Be BYDAY — termino savaitės diena.
    expect(kitas("FREQ=WEEKLY;INTERVAL=2", "2026-10-10", "2026-10-10")).toBe("2026-10-24");
  });

  it("kiekvieno mėnesio 15 d. ir mėnesio galas", () => {
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=15", "2026-10-15", "2026-10-15")).toBe("2026-11-15");
    // Terminas ne ta diena — kitas tą patį mėnesį, jei dar ateityje.
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=15", "2026-10-10", "2026-10-10")).toBe("2026-10-15");
    // 31 d.: lapkritį ir vasarį — paskutinė mėnesio diena, gruodį vėl 31.
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=31", "2026-10-31", "2026-10-31")).toBe("2026-11-30");
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=31", "2026-11-30", "2026-11-30")).toBe("2026-12-31");
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=31", "2027-01-31", "2027-01-31")).toBe("2027-02-28");
    // Be BYMONTHDAY — termino diena; kas 3 mėn.
    expect(kitas("FREQ=MONTHLY;INTERVAL=3", "2026-10-09", "2026-10-09")).toBe("2027-01-09");
  });

  it("pavėlavus kelis mėnesius — kitas po šiandienos", () => {
    expect(kitas("FREQ=MONTHLY;BYMONTHDAY=5", "2026-01-05", "2026-10-09")).toBe("2026-11-05");
  });

  it("kasmet, vasario 29 d. — vasario 28 d. paprastais metais", () => {
    expect(kitas("FREQ=YEARLY", "2026-11-10", "2026-11-10")).toBe("2027-11-10");
    expect(kitas("FREQ=YEARLY", "2028-02-29", "2028-02-29")).toBe("2029-02-28");
    expect(kitas("FREQ=YEARLY", "2026-11-10", "2029-01-01")).toBe("2029-11-10");
  });

  it("vasaros laiko pakeitimas datų nepastumia", () => {
    // 2026-10-25 Lietuvoje laikrodis atsukamas; datos skaičiuojamos be laiko juostų.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(kitas("FREQ=DAILY", "2026-10-24", "2026-10-24")).toBe("2026-10-25");
  });

  it("datos tikrinimas", () => {
    expect(isDate("2026-10-16")).toBe(true);
    expect(isDate("2026-02-31")).toBe(false);
    expect(isDate("16.10.2026")).toBe(false);
  });
});

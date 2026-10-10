import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmountToCents, normalizeDate } from "../src/parsers/csv";
import { parseSeb } from "../src/parsers/seb";
import { parseSwedbank } from "../src/parsers/swedbank";
import { ParseError } from "../src/parsers/types";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf-8");

describe("sumų atpažinimas", () => {
  it("supranta abu dešimtainius skyriklius", () => {
    expect(parseAmountToCents("14.37")).toBe(1437);
    expect(parseAmountToCents("14,37")).toBe(1437);
  });

  it("supranta tūkstančių skyriklius ir tarpus", () => {
    expect(parseAmountToCents("1 234,56")).toBe(123456);
    expect(parseAmountToCents("1.234,56")).toBe(123456);
  });

  it("nemeta apvalinimo paklaidų", () => {
    expect(parseAmountToCents("0.10") + parseAmountToCents("0.20")).toBe(30);
  });

  it("praneša apie neatpažintą formatą", () => {
    expect(() => parseAmountToCents("abc")).toThrow(ParseError);
  });
});

describe("datų atpažinimas", () => {
  it("priima banko naudojamus formatus", () => {
    expect(normalizeDate("2026-07-01")).toBe("2026-07-01");
    expect(normalizeDate("2026.07.01")).toBe("2026-07-01");
    expect(normalizeDate("01/07/2026")).toBe("2026-07-01");
    expect(normalizeDate("'2026.07.01")).toBe("2026-07-01");
  });
});

describe("Swedbank parseris", () => {
  const result = parseSwedbank(fixture("swedbank.csv"));

  it("praleidžia likučių ir apyvartų eilutes", () => {
    expect(result.transactions).toHaveLength(4);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { reason: "likutis pradžiai", count: 1 },
        { reason: "apyvartos eilutė", count: 2 },
        { reason: "likutis pabaigai", count: 1 },
      ])
    );
  });

  it("D paverčia išlaida, K — pajamomis", () => {
    expect(result.transactions[0].amountCents).toBe(100000);
    expect(result.transactions[1].amountCents).toBe(-1437);
  });

  it("nesuplaka dviejų vienodų operacijų — skiriasi operacijos nr.", () => {
    const [a, b] = result.transactions.slice(2);
    expect(a.amountCents).toBe(b.amountCents);
    expect(a.bookingDate).toBe(b.bookingDate);
    expect(a.reference).not.toBe(b.reference);
  });

  it("neatpažinus stulpelių praneša klaidą, o ne importuoja šiukšles", () => {
    expect(() => parseSwedbank('"Kažkas","Kita"\n"a","b"')).toThrow(/stulpeliai neatpažinti/);
  });
});

describe("SEB parseris", () => {
  const result = parseSeb(fixture("seb.csv"));

  it("suranda visas sąskaitas viename faile", () => {
    expect(result.ibans).toEqual(["LT222222222222222222", "LT333333333333333333"]);
  });

  it("praleidžia sekcijų antraštes ir tuščias sekcijas", () => {
    expect(result.transactions).toHaveLength(4);
  });

  it("D paverčia išlaida, C — pajamomis", () => {
    expect(result.transactions[0].amountCents).toBe(-60000);
    expect(result.transactions[2].amountCents).toBe(123456);
  });

  it("pervedimą tarp savų sąskaitų mato abiejose pusėse", () => {
    const outgoing = result.transactions[0];
    const incoming = result.transactions[3];
    expect(outgoing.accountIban).toBe("LT222222222222222222");
    expect(incoming.accountIban).toBe("LT333333333333333333");
    expect(outgoing.amountCents).toBe(-incoming.amountCents);
  });

  it("atpažįsta ne SEB failą", () => {
    expect(() => parseSeb('"Visai";"kitas";"failas"')).toThrow(/nerasta SEB išrašo antraštė/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDate, parseStatement, prepareImport, cleanNote, extractPdfPages } from "./statementImport.js";

const TODAY = "2026-10-20";
async function parseFixture(name) {
  const data = new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
  const pdf = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  return parseStatement(await extractPdfPages(pdf), TODAY);
}

describe("parseDate", () => {
  it("reads the common statement formats", () => {
    expect(parseDate("19 Oct 2026 DUITNOW", TODAY)).toBe("2026-10-19");
    expect(parseDate("07-Oct-26", TODAY)).toBe("2026-10-07");
    expect(parseDate("19/10/2026 18:10", TODAY)).toBe("2026-10-19");
    expect(parseDate("2026-10-19", TODAY)).toBe("2026-10-19");
    expect(parseDate("3 Mac 2026", TODAY)).toBe("2026-03-03");
  });
  it("puts year-less dates in the past", () => {
    expect(parseDate("19 Oct, 18:10", TODAY)).toBe("2026-10-19");
    expect(parseDate("25 Dec", TODAY)).toBe("2025-12-25");
  });
  it("does not mistake amounts or words for dates", () => {
    expect(parseDate("1.10 RM 4.60", TODAY)).toBeNull();
    expect(parseDate("88.47 359.60", TODAY)).toBeNull();
    expect(parseDate("15 Success", TODAY)).toBeNull();
  });
});

describe.each(["pb.pdf", "pb-browser.pdf"])("parseStatement on a Public Bank style PDF (%s, centred rows)", (file) => {
  it("reads every transaction with the right sign and skips balance b/f", async () => {
    const rows = await parseFixture(file);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toMatchObject({ date: "2026-10-19", type: "income", amount: 88.47 });
    expect(rows.find((r) => r.amount === 31.35)).toMatchObject({ date: "2026-10-16", type: "expense" });
    expect(rows.at(-1)).toMatchObject({ date: "2026-10-07", type: "income", amount: 540 });
    expect(rows.filter((r) => r.type === "income").map((r) => r.amount)).toEqual([88.47, 230, 540]);
  });
});

describe.each(["tng.pdf", "tng-browser.pdf"])("parseStatement on a TNG style PDF (%s, unsigned amounts)", (file) => {
  it("infers direction from the running balance and drops failed rows", async () => {
    const rows = await parseFixture(file);
    expect(rows.map((r) => [r.type, r.amount])).toEqual([
      ["expense", 0.7], ["expense", 15], ["income", 30], ["expense", 7.9], ["expense", 8], ["income", 50],
    ]);
  });
});

describe("prepareImport", () => {
  const parsed = [
    { date: "2026-10-13", type: "expense", amount: 2.6, description: "KK MART TGB3" },
    { date: "2026-10-13", type: "expense", amount: 2.6, description: "KK MART TGB3" },
    { date: "2026-10-15", type: "expense", amount: 56.76, description: "GRAB-FOOD MYS" },
    { date: "2026-10-07", type: "income", amount: 540, description: "RIZURF REALTY Mohd Kaiser Allowance - September 2026" },
    { date: "2026-10-19", type: "income", amount: 88.47, description: "RIZURF REALTY Reimbursement" },
  ];
  it("skips only as many repeats as are already logged", () => {
    const logs = [{ date: "2026-10-13", type: "expense", amount: 2.6 }];
    const { rows, duplicates } = prepareImport(parsed, logs, {});
    expect(duplicates).toBe(1);
    expect(rows.filter((r) => r.amount === 2.6)).toHaveLength(1);
  });
  it("flags salary and guesses wants", () => {
    const { rows } = prepareImport(parsed, [], { allowance: 540 });
    expect(rows.find((r) => r.amount === 540).category).toBe("salary");
    expect(rows.find((r) => r.amount === 88.47).category).toBe("income");
    expect(rows.find((r) => r.amount === 56.76).category).toBe("wants");
    expect(rows.find((r) => r.amount === 2.6).category).toBe("needs");
  });
});

describe("cleanNote", () => {
  it("strips bank boilerplate and reference numbers", () => {
    expect(cleanNote("PB DEBIT CARD DR MASC5370850001443612 KK MART TGB3 MYS 161026 KUALA LUMPUR 0000004.60")).toBe("KK MART TGB3 KUALA LUMPUR");
    expect(cleanNote("DUITNOW QR DR NO: 000839454 RUANG BY COOKIEZ BAR 839454 QR REF NO: 34408016")).toBe("RUANG BY COOKIEZ BAR");
  });
});

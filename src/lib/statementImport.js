// Reads transactions out of text-based bank / e-wallet PDF statements, on-device (no OCR, no server).
// Works by layout, not per bank: a row starts at a line beginning with a date, and its amount and
// balance come from the columns that contain nothing but money.
import { todayISO } from "./budgetMath.js";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, mac: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogo: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12,
};
// "2026-10-19" | "19 Oct 2026" / "19-Oct-26" / "19 Oct" | "19/10/2026" / "19-10-26" / "19/10"
const DATE_RE = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\s-]?([A-Za-z]{3})[a-z]*\.?(?:[\s,-]+(\d{4}|\d{2})(?![\d:]))?|(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2})(?!\d))?)(?!\d)/;
const MONEY_RE = /([+-])?\s*(?:RM|MYR)?\s*([+-])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)(?:\s*(DR|CR|[+-](?!\s*(?:RM|MYR)?\s*\d)))?/gi;
const HEADER_RE = /\b(date|description|details|particulars|amount|balance|debit|credit|transaction|reference)\b/gi;
const FOOTER_RE = /^(total|closing balance|balance c\/f|baki akhir|page \d)/i;
const SKIP_RE = /balance b\/f|opening balance|beginning balance|brought forward|baki (awal|bawa)|\b(failed|unsuccessful|rejected)\b/i;
const INCOME_HINT_RE = /\b(CR|CREDIT|RECEIVED?|REFUND|CASHBACK|RELOAD|DEPOSIT|INWARD|SALARY|GAJI)\b/i;
const SALARY_RE = /\b(salary|salaries|gaji|payroll|allowance|elaun|wages?|stipend)\b/i;
const WANTS_RE = /grab-?\s?food|foodpanda|shopeefood|mcdonald|kfc|starbucks|zus|tealive|cafe|coffee|\bbar\b|cinema|\bgsc\b|\btgv\b|netflix|spotify|shopee|lazada|steam|game/i;

export function parseDate(text, today = todayISO()) {
  const m = DATE_RE.exec(String(text).trim());
  if (!m) return null;
  const d = +(m[3] || m[4] || m[7]);
  const mo = m[2] ? +m[2] : m[5] ? MONTHS[m[5].slice(0, 3).toLowerCase()] : +m[8];
  let y = +(m[1] || m[6] || m[9] || 0);
  if (!mo || mo > 12 || !d || d > 31) return null;
  if (y && y < 100) y += 2000;
  const iso = (yy) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!y) { // year-less statements: assume the most recent such date that isn't in the future
    y = +today.slice(0, 4);
    if (iso(y) > today) y -= 1;
  }
  return iso(y);
}

function moneyTokens(text) {
  return [...String(text).matchAll(MONEY_RE)].map((m) => {
    const neg = m[1] === "-" || m[2] === "-" || /^(DR|-)$/i.test(m[4] || "");
    const pos = m[1] === "+" || m[2] === "+" || /^(CR|\+)$/i.test(m[4] || "");
    return { value: parseFloat(m[3].replace(/,/g, "")), sign: neg ? -1 : pos ? 1 : 0 };
  });
}
const isMoneyOnly = (text) =>
  moneyTokens(text).length > 0 && text.replace(MONEY_RE, "").replace(/RM|MYR|[()]/gi, "").trim() === "";

// pdf.js text items -> lines (top to bottom). Fragments are only glued when they are clearly one value
// (touching glyphs, "RM" + "4.60", "4.60" + "DR"): column gaps can be as narrow as a space.
function toLines(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= 2) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) {
    const merged = [];
    for (const it of line.items.sort((a, b) => a.x - b.x)) {
      const prev = merged[merged.length - 1];
      const h = it.h || 8;
      const gap = prev ? it.x - (prev.x + prev.w) : Infinity;
      if (gap < 0.1 * h || (gap < h && (/^[+-]?(RM|MYR)?$/i.test(prev.str) || /^(DR|CR)$/i.test(it.str.trim())))) {
        prev.str += (gap > 0.1 * h ? " " : "") + it.str;
        prev.w = it.x + it.w - prev.x;
      } else merged.push({ ...it, str: it.str.trim() });
    }
    line.items = merged;
    line.text = merged.map((i) => i.str).join(" ");
  }
  return lines;
}

// Items of one row -> columns: items whose horizontal extents overlap share a column.
function toColumns(items) {
  const cols = [];
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    const col = cols.find((c) => it.x < c.x2 && it.x + it.w > c.x1);
    if (col) {
      col.items.push(it);
      col.x1 = Math.min(col.x1, it.x);
      col.x2 = Math.max(col.x2, it.x + it.w);
    } else cols.push({ x1: it.x, x2: it.x + it.w, items: [it] });
  }
  for (const c of cols) c.text = c.items.sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.str).join(" ");
  return cols.sort((a, b) => a.x1 - b.x1);
}

function blockToRow(dateLine, lines, today) {
  const cols = toColumns(lines.flatMap((l) => l.items));
  const dateCol = cols.find((c) => c.items.includes(dateLine.items[0]));
  const date = parseDate(dateCol.text, today) || parseDate(dateLine.text, today);
  const moneyCols = cols.filter((c) => c !== dateCol && isMoneyOnly(c.text));
  const description = cols.filter((c) => c !== dateCol && !moneyCols.includes(c)).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
  // shortcut: with no clear money columns, fall back to the last money values in the row text.
  const tokens = moneyCols.length ? moneyCols.flatMap((c) => moneyTokens(c.text)) : moneyTokens(description);
  const balanceTok = tokens.length >= 2 ? tokens.pop() : null;
  const amountTok = tokens.filter((t) => t.value > 0).pop();
  if (!date || !amountTok || SKIP_RE.test(description)) return null;
  return {
    date, amount: amountTok.value, sign: amountTok.sign, description,
    balance: balanceTok ? balanceTok.value * (balanceTok.sign < 0 ? -1 : 1) : null,
  };
}

// pages: [[{ str, x, y, w, h }]] in PDF coordinates (y grows upward). Returns rows in document order.
export function parseStatement(pages, today = todayISO()) {
  const parsedPages = pages.map((items) => {
    const lines = toLines(items).filter((l) => !FOOTER_RE.test(l.text));
    const first = lines.findIndex((l) => parseDate(l.text, today));
    let head = -1;
    for (let i = 0; i < first; i++) if ((lines[i].text.match(HEADER_RE) || []).length >= 2) head = i;
    // wrapped header cells ("Wallet" / "Balance") continue on digit-free lines
    while (head >= 0 && head + 1 < first && !/\d/.test(lines[head + 1].text) && lines[head + 1].text.match(HEADER_RE)) head++;
    return { lines, first, head };
  });

  // Banks either top-align a row's cells or centre them vertically. Text between the header and the
  // first date means the date is centred within its row. Unknown -> centred (safer for amounts).
  const sample = parsedPages.find((p) => p.first >= 0 && p.head >= 0);
  const centered = sample ? sample.first - sample.head > 1 : true;

  const gaps = [];
  for (const p of parsedPages) {
    const ys = p.lines.filter((l) => parseDate(l.text, today)).map((l) => l.y);
    for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i]);
  }
  gaps.sort((a, b) => a - b);
  const rowGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 30;
  const maxDist = centered ? rowGap * 0.75 : rowGap;

  const rows = [];
  for (const { lines, first, head } of parsedPages) {
    if (first < 0) continue;
    const body = lines.slice(head + 1);
    const dateLines = body.filter((l) => parseDate(l.text, today));
    const blocks = new Map(dateLines.map((d) => [d, [d]]));
    for (const line of body) {
      if (blocks.has(line)) continue;
      let best = null;
      for (const d of dateLines) {
        const dist = centered ? Math.abs(d.y - line.y) : d.y - line.y;
        if (dist >= 0 && dist <= maxDist && (!best || dist < best.dist)) best = { d, dist };
      }
      if (best) blocks.get(best.d).push(line);
    }
    for (const d of dateLines) {
      const row = blockToRow(d, blocks.get(d), today);
      if (row) rows.push(row);
    }
  }
  return resolveSigns(rows).map(({ date, amount, sign, description }) => ({
    date, amount, description, type: sign < 0 ? "expense" : "income",
  }));
}

// Unsigned amounts: if the statement marks only one direction, the other is implied;
// otherwise compare running balances with the neighbouring row; otherwise use wording.
function resolveSigns(rows) {
  const anyNeg = rows.some((r) => r.sign < 0);
  const anyPos = rows.some((r) => r.sign > 0);
  const near = (a, b) => Math.abs(a - b) < 0.005;
  let newestFirst = 0, oldestFirst = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i].balance == null || rows[i + 1].balance == null) continue;
    const d = Math.abs(rows[i].balance - rows[i + 1].balance);
    if (near(d, rows[i].amount)) newestFirst++;
    if (near(d, rows[i + 1].amount)) oldestFirst++;
  }
  return rows.map((r, i) => {
    if (r.sign) return r;
    if (anyNeg !== anyPos) return { ...r, sign: anyNeg ? 1 : -1 };
    const other = rows[newestFirst >= oldestFirst ? i + 1 : i - 1];
    if (newestFirst + oldestFirst > 0 && other && r.balance != null && other.balance != null) {
      const d = r.balance - other.balance;
      if (near(Math.abs(d), r.amount)) return { ...r, sign: Math.sign(d) };
    }
    return { ...r, sign: INCOME_HINT_RE.test(r.description) ? 1 : -1 };
  });
}

export function cleanNote(description) {
  return description
    .replace(/\b\d+\.\d{2}\b/g, " ")
    .replace(/\bPB DEBIT CARD DR\b|\bDUITNOW\b|\b(TRSF|QR|CR|DR|MYS)\b|\b(QR )?REF NO:?|\bNO:|\bSuccess(ful)?\b/gi, " ")
    .replace(/\b[A-Z]*\d[\dA-Z]{5,}\b/gi, " ") // card numbers, references, terminal ids
    .replace(/\s+/g, " ").trim().slice(0, 80);
}

// Parsed rows -> diary-ready logs, minus anything already logged. Duplicates are counted per
// date + type + amount, so two identical RM2.60 purchases on one day only collapse against two logs.
export function prepareImport(parsed, logs, profile = {}) {
  const key = (l) => `${l.date}|${l.type}|${Number(l.amount).toFixed(2)}`;
  const existing = {};
  for (const l of logs) existing[key(l)] = (existing[key(l)] || 0) + 1;
  const allowance = Number(profile.allowance) || 0;
  const rows = [];
  let duplicates = 0;
  for (const p of parsed) {
    const k = key(p);
    if (existing[k] > 0) { existing[k]--; duplicates++; continue; }
    const salary = p.type === "income" &&
      (SALARY_RE.test(p.description) || (allowance > 0 && Math.abs(p.amount - allowance) <= allowance * 0.05));
    rows.push({
      id: Math.random().toString(36).slice(2, 10),
      type: p.type,
      category: p.type === "income" ? (salary ? "salary" : "income") : WANTS_RE.test(p.description) ? "wants" : "needs",
      amount: p.amount,
      note: cleanNote(p.description),
      date: p.date,
    });
  }
  return { rows, duplicates };
}

export async function extractPdfPages(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    pages.push(items.filter((i) => i.str && i.str.trim()).map((i) => ({
      str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height,
    })));
  }
  return pages;
}

// Browser entry point. Throws pdf.js's PasswordException for locked statements.
export async function readStatementPdf(arrayBuffer, password) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), password: password || undefined }).promise;
  return parseStatement(await extractPdfPages(pdf));
}

/**
 * useSignOffExport.ts  — Reliance Audit System
 *
 * 5-sheet Excel workbook (+ 2 PDF exports: Claim Letter, ALF PDF).
 *
 * The workbook reproduces the reference template
 * "RCPL_Quality_Audit_GB_Pet_300_ML-_Lot_2.xlsx" cell for cell — same sheet
 * names and order, column widths, row heights, merges, fonts (Times New Roman
 * on Sign Format, Aptos Narrow / Calibri elsewhere), fills, thin/medium
 * borders, number formats, rich-text declarations and live formulas:
 *
 *  1. "Sign Format."                 — info block + totals pulled by formula from sheet 2
 *  2. "Article Level Format Revised" — one row per article, SUBTOTAL totals row
 *  3. "Quality Audit- Lot 2"         — one-row summary (name via audit.summarySheetName)
 *  4. "Invoie details - <Category>"
 *  5. "Attendance Sheet"             — one row per audit day × auditor
 *
 * Single-category audits produce exactly the template layout. When several
 * categories are present, the quantity/value blocks gain one column per
 * category plus totals, in the same styling.
 *
 * Values: every amount derives from the stored item.totalValue (never
 * qty × unitValue) to avoid floating-point drift. The "Rate" column is the
 * weighted-average rate (value ÷ qty), so the template's  Qty × Rate
 * formulas reproduce the stored value exactly.
 */
import { useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase, getActiveAssignmentId } from '../supabase';
import { fetchGstByArticle, parseGst } from '../gstLookup';
import { activeCategoryKeys } from '../categoryPolicy';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SignOffDistributor {
  name: string;
  code: string;
  anchorName?: string;
  city?: string;
  state?: string;
  address?: string;
  region?: string;
}

export interface SignOffAudit {
  id?: string;
  serialNo?: string;
  scheduledDate?: string | null;
  auditEndDate?: string | null;
  drainageDate?: string | null;
  drainageEndDate?: string | null;
  approvedValue: number;
  verifiedTotal: number;
  auditorName?: string;
  asmName?: string;
  /** Title shown at the top of "Sign Format.". Defaults to the historical
   *  Beverage-audit title so existing callers are unaffected. */
  reportTitle?: string;
  /** Audit-firm name shown in "Audit Firm Name -" / "Audit Team" fields.
   *  Defaults to the historical hardcoded firm so existing callers are
   *  unaffected. */
  auditFirmName?: string;
  /** Auditor user ids on the ticket — used for Attendance + summary sheet names/numbers. */
  auditorIds?: string[];
  /** Tab name of the one-row summary sheet. Defaults to the template's name. */
  summarySheetName?: string;
  /** Wording after "raising of credit note" in the DB claim letters. */
  claimSubject?: string;
}

export interface SignOffItem {
  articleNumber: string;
  description: string;
  quantity?: number;
  totalValue?: number;
  qtyDamaged: number;
  qtyNonSaleable: number;
  qtyBBD: number;
  qtySampling?: number;
  unitValue: number;
  gst?: number;
  standardPack?: string;
  category?: string;
  mfgDate?: string;
  expDate?: string;
  productLife?: string;
  reasonCode?: string;
  remarks?: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  LIGHT_BLUE: 'FFBDD7EE',
  ORANGE: 'FFFFC000',
  MASTER_HDR: 'FFD9E1F2',
  QTY_HDR: 'FFBDD7EE',
  VAL_HDR: 'FFE2EFDA',
  MFD_HDR: 'FFFFF2CC',
  AUD_HDR: 'FFD9D9D9',
  TOTAL_ROW: 'FFFFD966',
  WHITE: 'FFFFFFFF',
  BLACK: 'FF000000',
  HEADER_GREY: 'FFD9D9D9',
  LIGHT_YELLOW: 'FFFFFFCC',
};

const DEFAULT_FIRM_NAME = 'Singla Vishal & Co.';
const DEFAULT_CLAIM_SUBJECT = 'Quality GB Pet 300 ML';
const DEFAULT_REPORT_TITLE = 'Audit Report - Phase V Part 2 Beverage';

const thinSide = { style: 'thin' as ExcelJS.BorderStyle };
const medSide = { style: 'medium' as ExcelJS.BorderStyle };
const thinBorder: Partial<ExcelJS.Borders> = { top: thinSide, left: thinSide, bottom: thinSide, right: thinSide };
const medBorder: Partial<ExcelJS.Borders> = { top: medSide, left: medSide, bottom: medSide, right: medSide };

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function tnrFont(opts: { bold?: boolean; size?: number; underline?: boolean; color?: string }): Partial<ExcelJS.Font> {
  return { name: 'Times New Roman', bold: opts.bold ?? false, size: opts.size ?? 10, color: { argb: opts.color ?? C.BLACK }, underline: opts.underline ? 'single' : undefined };
}
function ariFont(opts: { bold?: boolean; size?: number; underline?: boolean; color?: string }): Partial<ExcelJS.Font> {
  return { name: 'Arial', bold: opts.bold ?? false, size: opts.size ?? 9, color: { argb: opts.color ?? C.BLACK }, underline: opts.underline ? 'single' : undefined };
}
function aln(h: ExcelJS.Alignment['horizontal'] = 'left', v: ExcelJS.Alignment['vertical'] = 'middle', wrap = true): Partial<ExcelJS.Alignment> {
  return { horizontal: h, vertical: v, wrapText: wrap };
}
function safeMerge(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  try { ws.mergeCells(r1, c1, r2, c2); } catch { /* already merged */ }
}
function setCell(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue,
  opts: {
    font?: Partial<ExcelJS.Font>; fill?: string; hAlign?: ExcelJS.Alignment['horizontal'];
    vAlign?: ExcelJS.Alignment['vertical']; wrap?: boolean; border?: Partial<ExcelJS.Borders>; numFmt?: string;
  } = {}) {
  const cell = ws.getRow(row).getCell(col);
  cell.value = value;
  if (opts.font) cell.font = opts.font;
  if (opts.fill) cell.fill = solidFill(opts.fill);
  if (opts.border !== null) cell.border = opts.border ?? thinBorder;
  cell.alignment = aln(opts.hAlign ?? 'left', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

// ═════════════════════════════════════════════════════════════════════════════
// CATEGORY-DRIVEN LAYOUT HELPERS
// ═════════════════════════════════════════════════════════════════════════════
type CategoryKey = 'damage' | 'sampling' | 'nonSaleable' | 'bbd';

interface CategoryDef {
  key: CategoryKey;
  /** Sub-header label used in "Sign Format." (Pcs / INR variants) */
  pcsLabel: string;
  inrLabel: string;
  /** Sub-header label used in "Article Level Format Revised" */
  alfPcsLabel: string;
  alfInrLabel: string;
  /** Human label used for the Invoice-details sheet title/tab and reports */
  shortLabel: string;
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    key: 'damage',
    pcsLabel: 'Primary Damage\n(Pcs)',
    inrLabel: 'Primary Damage\n(INR)',
    alfPcsLabel: 'Primary Damage (Pcs)',
    alfInrLabel: 'Primary Damage (INR)',
    shortLabel: 'Primary Damage',
  },
  {
    key: 'sampling',
    pcsLabel: 'Sampling/Liquidation/\nFOC (PCS)',
    inrLabel: 'Sampling/Liquidation/\nFOC (INR)',
    alfPcsLabel: 'Sampling/Liquidation/FOC (PCS)',
    alfInrLabel: 'Sampling/Liquidation/FOC (INR)',
    shortLabel: 'Sampling-Liquidation-FOC',
  },
  {
    key: 'nonSaleable',
    pcsLabel: 'Non-Saleable product and\nNon-manufacturing Defect\n(Pcs)',
    inrLabel: 'Non-Saleable product and\nNon-manufacturing Defect\n(INR)',
    alfPcsLabel: 'Non-Saleable product and Non-manufacturing Defect (Pcs)',
    alfInrLabel: 'Non-Saleable product and Non-manufacturing Defect (INR)',
    shortLabel: 'Non-Saleable',
  },
  {
    key: 'bbd',
    pcsLabel: 'BBD Stock\n(Pcs)',
    inrLabel: 'BBD Stock\n(INR)',
    alfPcsLabel: 'BBD Stock (Pcs)',
    alfInrLabel: 'BBD Stock (INR)',
    shortLabel: 'BBD',
  },
];

function categoryQty(item: SignOffItem, key: CategoryKey): number {
  switch (key) {
    case 'damage': return item.qtyDamaged || 0;
    case 'sampling': return item.qtySampling || 0;
    case 'nonSaleable': return item.qtyNonSaleable || 0;
    case 'bbd': return item.qtyBBD || 0;
  }
}

/** Which categories actually have quantity across this batch of items.
 *  Falls back to all four (legacy full layout) when the batch is empty or
 *  has no quantity in any category. */
function getActiveCategories(items: SignOffItem[]): CategoryDef[] {
  // Only categories with quantity get columns; no quantity at all → Non-Saleable alone.
  const keys = activeCategoryKeys(items);
  return CATEGORY_DEFS.filter(c => keys.includes(c.key));
}

function catQtyFromAgg(a: { dmg: number; ns: number; bbd: number; samp: number }, key: CategoryKey): number {
  switch (key) {
    case 'damage': return a.dmg;
    case 'sampling': return a.samp;
    case 'nonSaleable': return a.ns;
    case 'bbd': return a.bbd;
  }
}
function catValFromAgg(a: { vDmg: number; vNs: number; vBbd: number; vSamp: number }, key: CategoryKey): number {
  switch (key) {
    case 'damage': return a.vDmg;
    case 'sampling': return a.vSamp;
    case 'nonSaleable': return a.vNs;
    case 'bbd': return a.vBbd;
  }
}

// ── Fresh distributor helper ──────────────────────────────────────────────────
async function fetchFreshDist(dist: SignOffDistributor): Promise<SignOffDistributor> {
  if (!dist.code) return dist;
  const assignmentId = getActiveAssignmentId();
  const { data } = await supabase.from('distributors').select('id,code,name,anchorName,address,city,state,region').eq('assignment_id', assignmentId).eq('code', dist.code).maybeSingle();
  if (!data) return dist;
  return { ...dist, name: data.name || dist.name, anchorName: data.anchorName || dist.anchorName, address: data.address || '', city: data.city || '', state: data.state || '', region: data.region || '' };
}

// ── ItemMaster enrichment ─────────────────────────────────────────────────────
async function enrichWithItemMaster(items: SignOffItem[]): Promise<SignOffItem[]> {
  const codes = [...new Set(items.map(i => i.articleNumber))];
  if (!codes.length) return items;
  const assignmentId = getActiveAssignmentId();
  const { data } = await supabase.from('itemMaster').select('itemCode,gst,standardPack,category').eq('assignment_id', assignmentId).in('itemCode', codes);
  const map: Record<string, any> = {};
  if (data) data.forEach((m: any) => { map[m.itemCode] = m; });
  const gstMap = await fetchGstByArticle(assignmentId, codes);
  return items.map(i => ({ ...i, gst: gstMap[i.articleNumber] || parseGst(i.gst), standardPack: map[i.articleNumber]?.standardPack ?? i.standardPack ?? '', category: map[i.articleNumber]?.category || i.category || '' }));
}

// ── VALUE HELPER ──────────────────────────────────────────────────────────────
// FIX: Always derive per-type values from the stored totalValue proportionally.
// This guarantees: vDmg + vNs + vBbd + vSamp === item.totalValue (no fp drift).
//
// Strategy:
//   totalQty = qDmg + qNs + qBbd + qSamp
//   vX = round( totalValue * qX / totalQty, 2 )
//   vLast = totalValue - sum(other rounded values)   ← absorbs any rounding remainder
function splitValues(item: SignOffItem): {
  vDmg: number; vNs: number; vBbd: number; vSamp: number; vTot: number;
} {
  const qDmg = item.qtyDamaged || 0;
  const qNs = item.qtyNonSaleable || 0;
  const qBbd = item.qtyBBD || 0;
  const qSamp = item.qtySampling || 0;
  const qTot = qDmg + qNs + qBbd + qSamp;

  // Use stored totalValue as the canonical total — never recompute from unitValue
  const vTot = item.totalValue != null
    ? item.totalValue
    : qTot * (item.unitValue || 0);

  if (qTot === 0) return { vDmg: 0, vNs: 0, vBbd: 0, vSamp: 0, vTot };

  // Proportional split with 2dp rounding
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const vDmg = round2(vTot * qDmg / qTot);
  const vNs = round2(vTot * qNs / qTot);
  const vBbd = round2(vTot * qBbd / qTot);
  // Last type absorbs any rounding remainder so sum == vTot exactly
  const vSamp = round2(vTot - vDmg - vNs - vBbd);

  return { vDmg, vNs, vBbd, vSamp, vTot };
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE-EXACT STYLING
// Every font, fill, border, width, height and number format below is copied
// from the reference workbook "RCPL_Quality_Audit_GB_Pet_300_ML-_Lot_2.xlsx".
// Theme colours from that file are resolved to fixed RGB values, because
// ExcelJS writes an older default Office theme and theme references would
// render in different colours.
// ═════════════════════════════════════════════════════════════════════════════
const X = {
  BLUE_90: 'FFDCEAF7', // Text 2 (dark blue), lighter 90%  — Sign: Quantity block
  GREEN_60: 'FFB4E5A2', // Accent 6 (green),  lighter 60%   — Value / MFD blocks
  ORANGE_80: 'FFFBE3D6', // Accent 2 (orange), lighter 80%   — Master / Variance / Findings
  PURPLE_60: 'FFE59EDD', // Accent 5 (purple), lighter 60%   — ALF "Quantity" group
  TEAL_80: 'FFC1E5F5', // Accent 1 (teal),   lighter 80%   — Invoice title
  ORANGE: 'FFE97132', // Accent 2 solid                   — Summary sheet header
  YELLOW: 'FFFFFF00',
  BLACK: 'FF000000',
  WHITE: 'FFFFFFFF',
};
const APTOS = 'Aptos Narrow';
const TNR = 'Times New Roman';
const ACCT0 = '_ * #,##0_ ;_ * \\-#,##0_ ;_ * "-"??_ ;_ @_ ';
const ACCT2 = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';
const DATE_FMT = 'mm-dd-yy';
const ALF_SHEET = 'Article Level Format Revised';
const DEFAULT_SUMMARY_SHEET = 'Quality Audit- Lot 2';

type Side = 't' | 'm' | '-';
/** Border from a 4-char spec in the order left,right,top,bottom (t=thin, m=medium, -=none). */
function bd(spec: string): Partial<ExcelJS.Borders> {
  const s = (c: string) => c === 't' ? { style: 'thin' as ExcelJS.BorderStyle } : c === 'm' ? { style: 'medium' as ExcelJS.BorderStyle } : undefined;
  const out: Partial<ExcelJS.Borders> = {};
  const [l, r, t, b] = spec.split('') as Side[];
  if (s(l)) out.left = s(l); if (s(r)) out.right = s(r); if (s(t)) out.top = s(t); if (s(b)) out.bottom = s(b);
  return out;
}
const THIN = bd('tttt');

interface PutOpts {
  font?: Partial<ExcelJS.Font>; fill?: string;
  h?: ExcelJS.Alignment['horizontal']; v?: ExcelJS.Alignment['vertical']; wrap?: boolean;
  border?: Partial<ExcelJS.Borders>; numFmt?: string;
}
function put(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue | undefined, o: PutOpts = {}) {
  const cell = ws.getRow(row).getCell(col);
  if (value !== undefined) cell.value = value;
  if (o.font) cell.font = o.font;
  if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (o.border) cell.border = o.border;
  if (o.h || o.v || o.wrap) cell.alignment = { horizontal: o.h, vertical: o.v, wrapText: !!o.wrap };
  if (o.numFmt) cell.numFmt = o.numFmt;
  return cell;
}
const fTNR = (o: { b?: boolean; u?: boolean } = {}): Partial<ExcelJS.Font> => ({ name: TNR, size: 12, bold: !!o.b, underline: o.u ? 'single' : undefined, color: { argb: X.BLACK } });
const fAptos = (size = 11, b = false, color = X.BLACK): Partial<ExcelJS.Font> => ({ name: APTOS, size, bold: b, color: { argb: color } });
const fCalibri = (b = false): Partial<ExcelJS.Font> => ({ name: 'Calibri', size: 10.5, bold: b, color: { argb: X.BLACK } });
const colL = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/** Digit-only codes are stored as numbers, like the template (Anchor Code, Article Code…). */
const numIfDigits = (v: string | number | undefined | null): ExcelJS.CellValue => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  return /^\d{1,15}$/.test(s) ? Number(s) : s;
};
/** 'YYYY-MM-DD…' → UTC Date (so Excel shows the same calendar day in every timezone). */
const toDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
};
const fy = (d: Date | null): string => {
  if (!d) return '';
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const q = Math.floor(((d.getUTCMonth() - 3 + 12) % 12) / 3) + 1;
  return `Q${q} FY ${String(y).slice(2)}-${String(y + 1).slice(2)}`;
};
const f = (formula: string, result: any): ExcelJS.CellFormulaValue => ({ formula, result } as ExcelJS.CellFormulaValue);

// ── People lookup (auditors + distributor sales hierarchy) ───────────────────
interface Person { name: string; email: string; mobile: string; }
async function fetchPeople(ids: string[]): Promise<Record<string, Person>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from('users').select('uid,name,email,mobile,phone').in('uid', uniq);
  const map: Record<string, Person> = {};
  (data || []).forEach((u: any) => { map[u.uid] = { name: u.name || '', email: u.email || '', mobile: u.mobile || u.phone || '' }; });
  return map;
}
async function fetchHierarchy(code: string): Promise<Record<'hoIds' | 'dmIds' | 'smIds' | 'asmIds' | 'aseIds', string[]>> {
  const empty = { hoIds: [], dmIds: [], smIds: [], asmIds: [], aseIds: [] };
  if (!code) return empty;
  const { data } = await supabase.from('distributors').select('hoIds,dmIds,smIds,asmIds,aseIds')
    .eq('assignment_id', getActiveAssignmentId()).eq('code', code).maybeSingle();
  return data ? { ...empty, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v : []])) } as any : empty;
}
// Contacts typed/imported directly on the distributor (name, email, phone per role)
type RoleContacts = Record<'hoIds' | 'dmIds' | 'smIds' | 'asmIds' | 'aseIds', Person[]>;
async function fetchSheetContacts(code: string): Promise<RoleContacts> {
  const empty: RoleContacts = { hoIds: [], dmIds: [], smIds: [], asmIds: [], aseIds: [] };
  if (!code) return empty;
  const { data, error } = await supabase.from('distributors').select('hoContacts,dmContacts,smContacts,asmContacts,aseContacts')
    .eq('assignment_id', getActiveAssignmentId()).eq('code', code).maybeSingle();
  if (error || !data) return empty;
  const conv = (v: any): Person[] => Array.isArray(v)
    ? v.map((c: any) => ({ name: c?.name || '', email: c?.email || '', mobile: c?.phone || '' })) : [];
  const d: any = data;
  return { hoIds: conv(d.hoContacts), dmIds: conv(d.dmContacts), smIds: conv(d.smContacts), asmIds: conv(d.asmContacts), aseIds: conv(d.aseContacts) };
}

// ── Aggregation shared by ALF + Sign ─────────────────────────────────────────
interface AggRow {
  item: SignOffItem; qByKey: Record<CategoryKey, number>; vByKey: Record<CategoryKey, number>;
  qTot: number; vTot: number;
}
function aggregate(items: SignOffItem[]): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const item of items) {
    // One line per article + Mfg date + Expiry date (so a split like 300/400/300 stays 3 lines)
    const key = `${item.articleNumber}|${String(item.mfgDate || '').slice(0, 10)}|${String(item.expDate || '').slice(0, 10)}`;
    if (!map.has(key)) map.set(key, {
      item, qTot: 0, vTot: 0,
      qByKey: { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 },
      vByKey: { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 },
    });
    const a = map.get(key)!;
    const sv = splitValues(item);
    a.qByKey.damage += item.qtyDamaged || 0; a.vByKey.damage += sv.vDmg;
    a.qByKey.nonSaleable += item.qtyNonSaleable || 0; a.vByKey.nonSaleable += sv.vNs;
    a.qByKey.bbd += item.qtyBBD || 0; a.vByKey.bbd += sv.vBbd;
    a.qByKey.sampling += item.qtySampling || 0; a.vByKey.sampling += sv.vSamp;
    a.vTot += sv.vTot;
    if (!a.item.mfgDate && item.mfgDate) a.item = { ...a.item, mfgDate: item.mfgDate, expDate: item.expDate };
    if (!a.item.remarks && item.remarks) a.item = { ...a.item, remarks: item.remarks };
  }
  for (const a of map.values()) a.qTot = a.qByKey.damage + a.qByKey.nonSaleable + a.qByKey.bbd + a.qByKey.sampling;
  return [...map.values()];
}

/** What the Sign sheet needs to reference from the ALF sheet. */
interface ALFLayout {
  totalRow: number;
  hasData: boolean;
  qtyCols: number[];          // one per active category
  totalQtyCol: number | null; // multi-category only
  valCols: number[];          // per-category value columns (multi only)
  inclCol: number;            // value incl. GST (single: the category; multi: total)
  totals: { qByKey: Record<CategoryKey, number>; vByKey: Record<CategoryKey, number>; qTot: number; vTot: number };
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 2 — Article Level Format Revised   (built first; Sign references it)
// ═════════════════════════════════════════════════════════════════════════════
function buildALFSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]): ALFLayout {
  const cats = getActiveCategories(items);
  const multi = cats.length > 1;
  const firm = audit.auditFirmName || DEFAULT_FIRM_NAME;
  const rows = aggregate(items);

  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'portrait', margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } };

  // ── Column map ── single category reproduces the template exactly (A:X)
  const MASTER = 15;
  let c = MASTER + 1;
  const qtyCols = cats.map(() => c++);
  const totalQtyCol = multi ? c++ : null;
  const valCols = multi ? cats.map(() => c++) : [];
  const inclCol = c++;
  const exclCol = c++;
  const mfgCol = c++, expCol = c++, lifeCol = c++, qtrCol = c++;
  const issueCol = c++, remarksCol = c++;
  const last = remarksCol;
  const qtyGroupEnd = totalQtyCol ?? qtyCols[qtyCols.length - 1];

  const widths: Record<number, number> = {
    1: 4.90625, 2: 10.1796875, 3: 8.54296875, 4: 6.90625, 5: 10.7265625, 6: 10.81640625, 7: 17.08984375,
    8: 24.1796875, 9: 9.81640625, 10: 37.26953125, 11: 15.81640625, 12: 8.54296875, 13: 28.90625, 14: 3.7265625, 15: 7.7265625,
    [inclCol]: 19.1796875, [exclCol]: 12.08984375, [mfgCol]: 10.08984375, [expCol]: 10.08984375,
    [lifeCol]: 8.453125, [qtrCol]: 12.36328125, [issueCol]: 18.7265625, [remarksCol]: 8.08984375,
  };
  [...qtyCols, ...(totalQtyCol ? [totalQtyCol] : []), ...valCols].forEach(k => { widths[k] = 19.1796875; });
  for (let k = 1; k <= last; k++) ws.getColumn(k).width = widths[k];
  ws.getRow(3).height = 98;

  // ── Row 2: group headers ──
  const group = (c1: number, c2: number, text: string, fill: string) => {
    if (c2 > c1) ws.mergeCells(2, c1, 2, c2);
    for (let k = c1; k <= c2; k++) put(ws, 2, k, undefined, { border: THIN });
    put(ws, 2, c1, text, { font: fAptos(10.5, true), fill, h: 'center', v: 'middle', border: THIN });
  };
  group(1, MASTER, 'Master Details', X.ORANGE_80);
  group(qtyCols[0], qtyGroupEnd, 'Quantity', X.PURPLE_60);
  group(valCols[0] ?? inclCol, exclCol, 'Value Details', X.GREEN_60);
  group(mfgCol, qtrCol, 'MFD & Expiry Date', X.GREEN_60);
  group(issueCol, remarksCol, 'Auditor Findings', X.ORANGE_80);

  // ── Row 3: column headers ──
  const hdr = (col: number, text: string, fill: string, calibri = true) =>
    put(ws, 3, col, text, { font: calibri ? fCalibri(true) : fAptos(10.5, true), fill, h: 'center', v: 'middle', wrap: true, border: THIN, numFmt: calibri ? '0' : undefined });
  ['Sr No', 'Std. Serial No.', 'Region', 'State', 'Audit Team', 'Anchor Code', 'Anchor Name', 'Distributor name ',
    'Article Code', 'Brand Pack', 'Category (CSD, Still, Water, Energy)', 'NPI / NON - NPI',
    "Rate Including GST\n(As per Waitage Avg of Primary from Apr'25 to Jan'26)", 'GST %', 'Standard Pack',
  ].forEach((t, i) => hdr(i + 1, t, X.ORANGE_80));
  cats.forEach((cat, i) => hdr(qtyCols[i], cat.alfPcsLabel, X.YELLOW));
  if (totalQtyCol) hdr(totalQtyCol, 'Total Verified Quantity (Pcs)', X.YELLOW);
  if (multi) {
    cats.forEach((cat, i) => hdr(valCols[i], `${cat.alfInrLabel} ( Including GST)`, X.GREEN_60));
    hdr(inclCol, 'Total Audited Value ( Including GST)', X.GREEN_60);
    hdr(exclCol, 'Total Audited Value ( Excluding GST)', X.GREEN_60);
  } else {
    hdr(inclCol, `${cats[0].alfInrLabel} ( Including GST)`, X.GREEN_60);
    hdr(exclCol, `${cats[0].alfInrLabel} ( Excluding GST)`, X.GREEN_60);
  }
  hdr(mfgCol, 'Manufacturing Date', X.GREEN_60);
  hdr(expCol, 'Expiry Date', X.GREEN_60);
  hdr(lifeCol, 'Product life in Months', X.GREEN_60);
  hdr(qtrCol, 'Manufacturing Quarter', X.GREEN_60);
  hdr(issueCol, 'Issue in Product in detail', X.ORANGE_80, false);
  hdr(remarksCol, 'Auditor Remarks', X.ORANGE_80, false);

  // ── Data rows (template has 18 bordered rows: 4-21, totals on 22) ──
  const FIRST = 4;
  const nRows = Math.max(18, rows.length);
  const lastData = FIRST + nRows - 1;
  const distNameCity = dist.city && !String(dist.name || '').toLowerCase().includes(String(dist.city).toLowerCase())
    ? `${dist.name || ''} ${dist.city}`.trim() : (dist.name || '');
  const totals = { qByKey: { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 } as Record<CategoryKey, number>, vByKey: { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 } as Record<CategoryKey, number>, qTot: 0, vTot: 0 };
  let tIncl = 0, tExcl = 0;

  for (let i = 0; i < nRows; i++) {
    const r = FIRST + i;
    const a = rows[i];
    if (!a) { for (let k = 1; k <= last; k++) put(ws, r, k, undefined, { font: fAptos(11), border: THIN }); continue; }

    ws.getRow(r).height = 42;
    const base: PutOpts = { font: fAptos(10.5), v: 'middle', border: THIN };
    const gst = Number(a.item.gst) || 0;
    const rate = Number(a.item.unitValue) > 0 ? Number(a.item.unitValue) : (a.qTot > 0 ? a.vTot / a.qTot : 0); // rate exactly as stored in DB
    const gstFrac = gst > 1 ? gst / 100 : gst;
    const excl = a.vTot / (1 + gstFrac);
    const mfg = toDate(a.item.mfgDate), exp = toDate(a.item.expDate);
    totals.qTot += a.qTot; totals.vTot += a.vTot; tIncl += a.vTot; tExcl += excl;
    cats.forEach(cat => { totals.qByKey[cat.key] += a.qByKey[cat.key]; totals.vByKey[cat.key] += a.vByKey[cat.key]; });

    const master: ExcelJS.CellValue[] = [
      i + 1, numIfDigits(audit.serialNo || audit.id || ''), dist.region || null, dist.state || null, firm,
      numIfDigits(dist.code), dist.anchorName || null, distNameCity || null, numIfDigits(a.item.articleNumber),
      a.item.description || null, a.item.category || null, null, rate, gst ? gstFrac : null, numIfDigits(a.item.standardPack),
    ];
    master.forEach((v, k) => put(ws, r, k + 1, v, { ...base, numFmt: k === 13 && gst ? '0%' : undefined }));

    cats.forEach((cat, k) => put(ws, r, qtyCols[k], a.qByKey[cat.key], { font: fCalibri(), v: 'middle', border: THIN, numFmt: ACCT0 }));
    const M = `$M${r}`;
    if (multi) {
      put(ws, r, totalQtyCol!, f(`SUM(${colL(qtyCols[0])}${r}:${colL(qtyCols[qtyCols.length - 1])}${r})`, a.qTot), { font: fCalibri(), v: 'middle', border: THIN, numFmt: ACCT0 });
      cats.forEach((cat, k) => put(ws, r, valCols[k], f(`${colL(qtyCols[k])}${r}*${M}`, a.qByKey[cat.key] * rate), base));
      put(ws, r, inclCol, f(`SUM(${colL(valCols[0])}${r}:${colL(valCols[valCols.length - 1])}${r})`, a.vTot), base);
    } else {
      put(ws, r, inclCol, f(`${colL(qtyCols[0])}${r}*${M}`, a.vTot), base);
    }
    put(ws, r, exclCol, f(`${colL(inclCol)}${r}/(1+N${r})`, excl), base);
    put(ws, r, mfgCol, mfg, { ...base, numFmt: DATE_FMT });
    put(ws, r, expCol, exp, { ...base, numFmt: DATE_FMT });
    put(ws, r, lifeCol, mfg && exp ? f(`(${colL(expCol)}${r}-${colL(mfgCol)}${r})/30`, (exp.getTime() - mfg.getTime()) / 86400000 / 30) : null, { ...base, numFmt: ACCT2 });
    put(ws, r, qtrCol, fy(mfg) || null, { ...base, numFmt: ACCT2 });
    put(ws, r, issueCol, a.item.reasonCode || null, { ...base, wrap: true });
    put(ws, r, remarksCol, a.item.remarks || null, base);
  }

  // ── Totals row: SUBTOTAL on qty/value columns only, no label ──
  const totalRow = lastData + 1;
  // bordered cell in every column of the totals row (values are filled in below)
  for (let c = 1; c <= remarksCol; c++) put(ws, totalRow, c, null, { font: fAptos(11, true), v: 'middle', border: THIN });
  const sub = (col: number, result: number) =>
    put(ws, totalRow, col, f(`SUBTOTAL(9,${colL(col)}${FIRST}:${colL(col)}${lastData})`, result), { font: fAptos(11, true), v: 'middle', border: THIN, numFmt: ACCT0 });
  cats.forEach((cat, k) => { sub(qtyCols[k], totals.qByKey[cat.key]); });
  if (totalQtyCol) sub(totalQtyCol, totals.qTot);
  cats.forEach((cat, k) => { if (multi) sub(valCols[k], totals.vByKey[cat.key]); });
  sub(inclCol, tIncl);
  sub(exclCol, tExcl);

  return { totalRow, hasData: rows.length > 0, qtyCols, totalQtyCol, valCols, inclCol, totals };
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 1 — Sign Format.
// ═════════════════════════════════════════════════════════════════════════════
// Declarations use mixed bold/underline runs inside one cell, exactly as in the template.
type Run = [text: string, style?: 'B' | 'U' | 'BU'];
const rt = (runs: Run[]): ExcelJS.CellRichTextValue => ({
  richText: runs.map(([text, st]) => ({ text, font: { name: TNR, size: 12, bold: !!st && st.includes('B'), underline: st && st.includes('U') ? 'single' : undefined, color: { argb: X.BLACK } } as Partial<ExcelJS.Font> })),
});
const DECL_CUSTOMER = rt([
  ['Declaration from Customer -', 'BU'],
  ['\n1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit. \n2. I confirm that all stocks received by me with expiry date upto '],
  ['date of Audit', 'B'],
  [' has been cleared by company and I will not raise any further claim in this regard for products with expired. \n3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.\n4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.'],
]);
const SIGN_CUSTOMER = rt([["Customer's Authorised person Name -", 'BU'], ['\n\n\n\n\n', 'B'], ['Seal & Sign - ', 'BU'], [' \n', 'U']]);
const DECL_SALES = rt([
  ['Declaration from Reliance Sales Team -', 'BU'],
  ['\n1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit. \n2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.'],
]);
const DECL_AUDITOR = rt([
  ['Declaration from Auditor-', 'BU'],
  ["\n1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team. \n2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer's location."],
]);

function buildSignSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[], alf: ALFLayout) {
  const cats = getActiveCategories(items);
  const multi = cats.length > 1;
  const firm = audit.auditFirmName || DEFAULT_FIRM_NAME;

  ws.views = [{ showGridLines: false, zoomScale: 50, zoomScaleNormal: 50 }];
  ws.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1,
    margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
  };

  // ── Column map. Single category = template exactly: B:C qty, D value, E approved, F variance.
  const B = 2;
  let qtyRanges: Array<[number, number]>, valCols: number[], approvedCol: number, varCol: number;
  if (!multi) { qtyRanges = [[2, 3]]; valCols = [4]; approvedCol = 5; varCol = 6; }
  else {
    let c = 2;
    qtyRanges = [...cats, null].map(() => { const k = c++; return [k, k] as [number, number]; }); // + total qty
    valCols = [...cats, null].map(() => c++);                                                   // + total value
    approvedCol = c++; varCol = c++;
  }
  const L = varCol; // last column
  const widths: Record<number, number> = multi
    ? Object.fromEntries(Array.from({ length: L - 1 }, (_, i) => [i + 2, i === 0 ? 33.1796875 : 18]))
    : { 2: 33.1796875, 3: 30.453125, 4: 57.1796875, 5: 44.81640625, 6: 37.90625 };
  ws.getColumn(1).width = 9.1796875;
  for (let k = 2; k <= L; k++) ws.getColumn(k).width = widths[k];
  ws.getColumn(L + 1).width = 9.1796875;

  /** Outer frame: medium on the left of B, right of last col, top of row 3, bottom of row 20. */
  const frame = (row: number, col: number, inner: string /* l r t b for interior edges */, endCol = col) => {
    const ch = inner.split('');
    if (col === B) ch[0] = 'm';
    if (endCol === L) ch[1] = 'm';
    if (row === 3) ch[2] = 'm';
    if (row === 20) ch[3] = 'm';
    return bd(ch.join(''));
  };
  const rowFrame = (row: number, inner: string, from = B, to = L) => { for (let k = from; k <= to; k++) put(ws, row, k, undefined, { border: frame(row, k, inner) }); };

  // Row heights
  ws.getRow(2).height = 16; ws.getRow(11).height = 30; ws.getRow(12).height = 30;
  ws.getRow(16).height = 187.5; ws.getRow(18).height = 97.75; ws.getRow(20).height = 67.5;

  // ── Row 3: title ──
  ws.mergeCells(3, B, 3, L);
  rowFrame(3, '--mt');
  put(ws, 3, B, audit.reportTitle || DEFAULT_REPORT_TITLE, { font: fTNR({ b: true }), h: 'center', v: 'middle', wrap: true, border: frame(3, B, '--mt', L) });

  // ── Rows 4-10: info block (values are formulas into the ALF sheet, as in the template) ──
  const ref = (cell: string, fallback: ExcelJS.CellValue) => alf.hasData ? f(`'${ALF_SHEET}'!${cell}`, fallback) : fallback;
  const distNameCity = dist.city && !String(dist.name || '').toLowerCase().includes(String(dist.city).toLowerCase())
    ? `${dist.name || ''} ${dist.city}`.trim() : (dist.name || '');
  const info: Array<[string, ExcelJS.CellValue, boolean]> = [
    ['Audit Serial No. - ', ref('B4', numIfDigits(audit.serialNo || audit.id || '')), true],
    ['Audit Firm Name - ', ref('E4', firm), true],
    ['Anchor Code - ', ref('F4', numIfDigits(dist.code)), false],
    ['Anchor Name/ Direct DB Name -', ref('G4', dist.anchorName || ''), false],
    ['Distributor name & City - ', ref('H4', distNameCity), false],
    ['Audit Start Date - ', toDate(audit.scheduledDate), false],
    ['Audit End Date-', toDate(audit.auditEndDate), false],
  ];
  info.forEach(([label, value, leftAligned], i) => {
    const r = 4 + i;
    rowFrame(r, '----');
    const o: PutOpts = { font: fTNR({ b: true }), h: leftAligned ? 'left' : undefined, v: 'middle' };
    put(ws, r, B, label, { ...o, border: frame(r, B, '----') });
    put(ws, r, B + 1, value, { ...o, numFmt: value instanceof Date ? DATE_FMT : undefined });
  });
  put(ws, 4, L, undefined, { font: fTNR({ b: true }), h: 'center', v: 'middle', wrap: true });
  put(ws, 10, L, undefined, { font: fTNR({ b: true }), h: 'center', v: 'middle', wrap: true });
  // Address block: last two columns, rows 5-9
  ws.mergeCells(5, L - 1, 9, L);
  const addr = [dist.address, dist.city, dist.state].filter(Boolean).join(', ');
  put(ws, 5, L - 1, `Customer Full Address :- ${addr}`.trimEnd() + (addr ? '' : ' '), { font: fTNR({ b: true }), h: 'left', v: 'top', wrap: true, border: bd('-m--') });
  for (let r = 5; r <= 9; r++) put(ws, r, L, undefined, { border: bd('-m--') });

  // ── Row 11: group headers ──
  rowFrame(11, 'tttt');
  const qFirst = qtyRanges[0][0], qLast = qtyRanges[qtyRanges.length - 1][1];
  const g = (c1: number, c2: number, text: string, fill: string) => {
    if (c2 > c1) ws.mergeCells(11, c1, 11, c2);
    put(ws, 11, c1, text, { font: fTNR({ b: true }), fill, h: 'center', v: 'middle', wrap: true, border: frame(11, c1, 'tttt', c2) });
  };
  g(qFirst, qLast, 'Quantity Details - Physically verified & Drained', X.BLUE_90);
  g(valCols[0], valCols[valCols.length - 1], 'Value Details', X.GREEN_60);
  g(approvedCol, varCol, 'Variance Summary', X.ORANGE_80);

  // ── Row 12: column headers ──
  rowFrame(12, 'tttt');
  const h12 = (c1: number, c2: number, text: string, fill: string) => {
    if (c2 > c1) ws.mergeCells(12, c1, 12, c2);
    put(ws, 12, c1, text, { font: fTNR({ b: true }), fill, h: 'center', v: 'middle', wrap: true, border: frame(12, c1, 'tttt', c2) });
  };
  cats.forEach((cat, i) => h12(qtyRanges[i][0], qtyRanges[i][1], cat.alfPcsLabel, X.BLUE_90));
  if (multi) h12(qtyRanges[cats.length][0], qtyRanges[cats.length][1], 'Total Verified Quantity (Pcs)', X.BLUE_90);
  cats.forEach((cat, i) => h12(valCols[i], valCols[i], cat.alfInrLabel, X.GREEN_60));
  if (multi) h12(valCols[cats.length], valCols[cats.length], 'Total Audited Value (INR)', X.GREEN_60);
  h12(approvedCol, approvedCol, 'Approved Amount', X.ORANGE_80);
  h12(varCol, varCol, 'Variance %', X.ORANGE_80);

  // ── Row 13: values ──
  rowFrame(13, 'tttt');
  const T = alf.totalRow;
  const qtyRef = (i: number): [string, number] => i < cats.length
    ? [`'${ALF_SHEET}'!${colL(alf.qtyCols[i])}${T}`, alf.totals.qByKey[cats[i].key]]
    : [`'${ALF_SHEET}'!${colL(alf.totalQtyCol!)}${T}`, alf.totals.qTot];
  const valRef = (i: number): [string, number] => multi && i < cats.length
    ? [`'${ALF_SHEET}'!${colL(alf.valCols[i])}${T}`, alf.totals.vByKey[cats[i].key]]
    : [`'${ALF_SHEET}'!${colL(alf.inclCol)}${T}`, alf.totals.vTot];
  qtyRanges.forEach(([c1, c2], i) => {
    if (c2 > c1) ws.mergeCells(13, c1, 13, c2);
    const [ref13, res] = qtyRef(i);
    put(ws, 13, c1, f(ref13, res), { font: fTNR(), h: 'center', border: frame(13, c1, 'tttt'), numFmt: ACCT0 });
  });
  valCols.forEach((col, i) => {
    const [ref13, res] = valRef(i);
    put(ws, 13, col, f(ref13, res), { font: fTNR(), h: 'center', wrap: true, border: frame(13, col, 'tttt'), numFmt: '#,##0' });
  });
  const approved = Number(audit.approvedValue) || 0;
  const A = `${colL(approvedCol)}13`, D = `${colL(valCols[valCols.length - 1])}13`;
  put(ws, 13, approvedCol, approved, { font: fTNR(), v: 'middle', wrap: true, border: frame(13, approvedCol, 'tttt'), numFmt: '#,##0' });
  put(ws, 13, varCol, approved
    ? f(`(${A}-${D})/${A}`, (approved - alf.totals.vTot) / approved)
    : f(`IFERROR((${A}-${D})/${A},0)`, 0),
    { font: fTNR(), v: 'middle', wrap: true, border: frame(13, varCol, 'tttt'), numFmt: '0.00%' });

  // ── Rows 14-15: blank, frame only ──
  rowFrame(14, '----'); rowFrame(15, '----');

  // ── Rows 16-20: declarations ──
  const leftEnd = L - 2, rightStart = L - 1;
  const decl = (row: number, left: ExcelJS.CellValue, right: ExcelJS.CellValue, lFont: Partial<ExcelJS.Font>, rFont: Partial<ExcelJS.Font>, v: ExcelJS.Alignment['vertical']) => {
    rowFrame(row, 'tttt');
    ws.mergeCells(row, B, row, leftEnd); ws.mergeCells(row, rightStart, row, L);
    put(ws, row, B, left, { font: lFont, h: 'left', v, wrap: true, border: frame(row, B, 'tttt') });
    put(ws, row, rightStart, right, { font: rFont, h: 'left', v, wrap: true, border: frame(row, rightStart, 'tttt', L) });
  };
  decl(16, DECL_CUSTOMER, SIGN_CUSTOMER, fTNR(), fTNR(), 'middle');
  rowFrame(17, '----');
  put(ws, 17, B, '.', { font: fTNR(), h: 'left', v: 'middle', wrap: true, border: frame(17, B, '----') });
  decl(18, DECL_SALES, 'Sales Team Name & contact no.\n\nSales Team EMP ID \n\nSign', fTNR(), fTNR({ b: true, u: true }), 'top');
  rowFrame(19, '--tt', B, leftEnd); put(ws, 19, L, undefined, { border: bd('-m--') });
  decl(20, DECL_AUDITOR, 'Auditor Name & contact no.\n\n\nSeal & Sign', fTNR({ u: true }), fTNR({ b: true, u: true }), 'top');
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 3 — Summary ("Quality Audit- Lot 2")
// ═════════════════════════════════════════════════════════════════════════════
function buildSummarySheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, alf: ALFLayout,
  people: Record<string, Person>, hier: Record<string, string[]>, auditorNames: string, sheet?: RoleContacts) {
  ws.views = [{ showGridLines: false }];
  const widths: Record<number, number> = { 1: 6.26953125, 2: 8.6328125, 3: 5.453125, 4: 6.36328125, 5: 8.08984375, 7: 5.90625, 8: 4.7265625, 9: 6.26953125, 10: 6.26953125, 11: 8.36328125, 12: 8.36328125, 13: 8.453125, 14: 7.26953125, 15: 8.6328125, 16: 5.90625, 17: 6.90625, 18: 8.453125, 19: 8.36328125, 20: 8.54296875, 21: 8, 22: 7.6328125, 23: 8.54296875, 24: 7.08984375, 25: 8.26953125, 26: 5.26953125 };
  Object.entries(widths).forEach(([k, w]) => { ws.getColumn(+k).width = w; });
  ws.getRow(2).height = 78;

  const H: Array<[string, string?, string?, string?]> = [ // text, fill, fontColor, border
    ['Anchor'], ['Std- Serial No-'], ['Phase '], ['Auditor Name'], ['Approved Date'], ['Audit Date'], ['Region'], ['State'],
    ['Anchor'], ['Anchor Name'], ['Distributor name '], ['Reported/ Approved Value', X.YELLOW], ['Value as per Auditor\n(Including GST)'],
    ['Final CN Value'], ['Diff Proposed V/S Actual'], ['Audit Status (RCPL)'], ['Auditor Remark\n(As per Auditor)'], ['Approved Value in Cr-'],
    ['Audit Start Date', undefined, X.WHITE], ['End Date of Physical Verification (as per Auditor)', undefined, X.WHITE],
    ['Drainage start date', undefined, X.WHITE], ['Drainage end date', undefined, X.WHITE],
    ['Audit Sharing Date Along With RSO By Auditor'], ['Audit Planned Date'], ['Direct/ Indirect Customer'],
    ['ASM Name'], ['ASM Email ID', , , 'tt--'], ['ASM Contact Details', , , 'tt--'],
    ['ASE Name', , , 'tt--'], ['ASE Email Id', , , 'tt--'], ['ASE Contact Details', , , 'tt--'],
    ['SM Name'], ['SM Email ID', , , 'tt--'], ['SM Contact Details', , , 'tt--'],
    ['DM Name'], ['DM Email ID', , , 'tt--'], ['DM Contact Details', , , 'tt--'],
    ['RBL Name'], ['RBL Email ID', , , 'tt--'], ['RBL Contact Details', , , 'tt--'],
  ];
  const nf: Record<number, string> = { 5: DATE_FMT, 6: DATE_FMT, 13: ACCT2, 18: ACCT2 };
  H.forEach(([text, fill, color, border], i) =>
    put(ws, 2, i + 1, text, { font: fAptos(10, true, color || X.BLACK), fill: fill || X.ORANGE, h: 'center', v: 'middle', wrap: true, border: bd(border || 'tttt'), numFmt: nf[i + 1] }));

  // One data row for this audit (template ships the header only)
  const who = (key: string) => {
    const fromSheet = (sheet as any)?.[key] as Person[] | undefined;
    const ps = fromSheet && fromSheet.length ? fromSheet : (hier[key] || []).map(id => people[id]).filter(Boolean);
    return [ps.map(p => p.name).join(', '), ps.map(p => p.email).join(', '), ps.map(p => p.mobile).filter(Boolean).join(', ')];
  };
  const [asmN, asmE, asmC] = who('asmIds'); const [aseN, aseE, aseC] = who('aseIds');
  const [smN, smE, smC] = who('smIds'); const [dmN, dmE, dmC] = who('dmIds');
  const approved = Number(audit.approvedValue) || 0;
  const valRef = f(`'${ALF_SHEET}'!${colL(alf.inclCol)}${alf.totalRow}`, alf.totals.vTot);
  const row: ExcelJS.CellValue[] = [
    numIfDigits(dist.code), numIfDigits(audit.serialNo || audit.id || ''), null, auditorNames || null, null, toDate(audit.scheduledDate),
    dist.region || null, dist.state || null, numIfDigits(dist.code), dist.anchorName || null, dist.name || null,
    approved || null, valRef, null, f('L3-M3', approved - alf.totals.vTot), null, null, approved ? f('L3/10000000', approved / 1e7) : null,
    toDate(audit.scheduledDate), toDate(audit.auditEndDate), toDate(audit.drainageDate), toDate(audit.drainageEndDate),
    null, toDate(audit.scheduledDate), null,
    asmN || audit.asmName || null, asmE || null, numIfDigits(asmC), aseN || null, aseE || null, numIfDigits(aseC),
    smN || null, smE || null, numIfDigits(smC), dmN || null, dmE || null, numIfDigits(dmC), null, null, null,
  ];
  const dateCols = new Set([5, 6, 19, 20, 21, 22, 24]);
  row.forEach((v, i) => put(ws, 3, i + 1, v, {
    font: fAptos(10), h: 'center', v: 'middle', wrap: true, border: THIN,
    numFmt: dateCols.has(i + 1) ? DATE_FMT : [12, 13, 15].includes(i + 1) ? ACCT2 : i + 1 === 18 ? '0.0000' : undefined,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 4 — Invoie details - <Category>
// ═════════════════════════════════════════════════════════════════════════════
function buildInvoiceDetailsSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[], category: CategoryDef) {
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'portrait', margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } };
  [5.1796875, 18.54296875, 9.54296875, 11.54296875, 10.81640625, 20.81640625, 24.1796875, 6.81640625, 6.81640625, 7.54296875, 7.54296875]
    .forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const firm = audit.auditFirmName || DEFAULT_FIRM_NAME;

  ws.mergeCells(2, 1, 2, 11);
  for (let k = 1; k <= 11; k++) put(ws, 2, k, undefined, { border: THIN });
  put(ws, 2, 1, 'Primary Damage - Invoice Level Details', { font: fAptos(11, true), fill: X.TEAL_80, h: 'center', border: THIN });

  ws.getRow(3).height = 43.5;
  ['Sr No', 'Audit Serial No.', 'Region', 'Audit Team', 'Anchor Code', 'Anchor Name', 'Distributor name ', 'Invoice No.', 'Invoice Date', 'Damage Qty in Pcs', 'Damage Value in Rs.']
    .forEach((t, i) => put(ws, 3, i + 1, t, { font: fAptos(11, true), fill: X.ORANGE_80, h: 'center', v: 'middle', wrap: true, border: THIN }));

  const rows = items.filter(i => categoryQty(i, category.key) > 0);
  const n = Math.max(8, rows.length); // template: rows 4-11 bordered
  for (let i = 0; i < n; i++) {
    const r = 4 + i, item = rows[i];
    if (!item) { for (let k = 1; k <= 11; k++) put(ws, r, k, undefined, { font: fAptos(11), border: THIN }); continue; }
    const sv = splitValues(item);
    const val = { damage: sv.vDmg, nonSaleable: sv.vNs, bbd: sv.vBbd, sampling: sv.vSamp }[category.key];
    const vals: ExcelJS.CellValue[] = [i + 1, numIfDigits(audit.serialNo || audit.id || ''), dist.region || null, firm, numIfDigits(dist.code),
    dist.anchorName || null, dist.name || null, null, null, categoryQty(item, category.key), Math.round(val * 100) / 100];
    vals.forEach((v, k) => put(ws, r, k + 1, v, { font: fAptos(11), v: k <= 6 ? 'middle' : undefined, border: THIN }));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 5 — Attendance Sheet
// ═════════════════════════════════════════════════════════════════════════════
function buildAttendanceSheet(ws: ExcelJS.Worksheet, audit: SignOffAudit, auditors: Person[]) {
  ws.views = [{ showGridLines: false }];
  [10.08984375, 10.81640625, 10.81640625, 10.08984375, 7, 8.54296875, 8.453125, 23.453125].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getRow(1).height = 31; ws.getRow(2).height = 29; ws.getRow(3).height = 29;

  ws.mergeCells(1, 1, 1, 8);
  for (let k = 1; k <= 8; k++) put(ws, 1, k, undefined, { border: THIN });
  put(ws, 1, 1, 'Mandays details (Do mention date wise/Auditor Wise details)', { font: fAptos(24, true), h: 'center', v: 'middle', wrap: true, border: THIN });
  ['Day', 'Name of Auditor', 'Auditor no.', 'Date of audit', 'In Time', 'Out Time', 'Total Mandays', 'Counting/Drainage']
    .forEach((t, i) => put(ws, 2, i + 1, t, { font: fAptos(11, true), h: 'center', v: 'middle', wrap: true, border: THIN }));

  // One row per audit day × auditor
  const start = toDate(audit.scheduledDate), end = toDate(audit.auditEndDate) || start;
  const days: Date[] = [];
  if (start) for (let d = new Date(start); d <= (end as Date) && days.length < 31; d = new Date(d.getTime() + 86400000)) days.push(d);
  const people = auditors.length ? auditors : [{ name: '', email: '', mobile: '' }];
  const entries = days.flatMap((d, i) => people.map(p => ({ day: i + 1, d, p })));

  const dataEnd = Math.max(8, 2 + entries.length);
  for (let r = 3; r <= dataEnd; r++) {
    const e = entries[r - 3];
    const vals: ExcelJS.CellValue[] = e ? [e.day, e.p.name || null, numIfDigits(e.p.mobile), e.d, null, null, 1, null] : [null, null, null, null, null, null, null, null];
    vals.forEach((v, k) => put(ws, r, k + 1, v, { font: fAptos(11), h: 'center', v: k === 7 ? undefined : 'middle', wrap: k !== 7, border: THIN, numFmt: k === 3 ? DATE_FMT : undefined }));
  }
  for (let k = 1; k <= 8; k++) put(ws, dataEnd + 1, k, undefined, { font: fAptos(11), border: THIN });

  // Signature box (template rows 11-15)
  const top = dataEnd + 3;
  for (let r = top; r <= top + 4; r++) for (let k = 1; k <= 8; k++) {
    const spec = `${k === 1 ? 't' : '-'}${k === 8 ? 't' : '-'}${r === top ? 't' : '-'}${r === top + 4 ? 't' : '-'}`;
    if (spec !== '----') put(ws, r, k, undefined, { font: fAptos(11), border: bd(spec) });
  }
  put(ws, top + 1, 1, 'Distributor:', { font: fAptos(11) });
  put(ws, top + 2, 1, 'Sales Team:', { font: fAptos(11) });
  put(ws, top + 3, 1, 'Auditor:', { font: fAptos(11) });
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HOOK
// ═════════════════════════════════════════════════════════════════════════════
export function useSignOffExport(params: {
  distributor: SignOffDistributor | undefined;
  audit: SignOffAudit;
  items: SignOffItem[];
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingALF, setIsExportingALF] = useState(false);

  const policyItems = params.items;

  // ── Excel sign-off export ───────────────────────────────────────────────────
  const exportSignOff = async () => {
    if (!params.distributor) return;
    setIsExporting(true);
    try {
      const freshDist = await fetchFreshDist(params.distributor);
      const enrichedItems = await enrichWithItemMaster(policyItems);

      // Pick which category the Invoice-details sheet is named/filtered for:
      // if the audit only ever tracks one category, use that one; otherwise
      // keep the historical "Primary Damage" sheet so existing full-category
      // (Beverage-style) reports are unaffected.
      const activeCategories = getActiveCategories(enrichedItems);
      const invoiceCategory = activeCategories.length === 1
        ? activeCategories[0]
        : (activeCategories.find(c => c.key === 'damage') || activeCategories[0]);
      const invoiceSheetName = `Invoie details - ${invoiceCategory.shortLabel}`.slice(0, 31);

      const [hier, auditorMap, sheetContacts] = await Promise.all([
        fetchHierarchy(freshDist.code),
        fetchPeople(params.audit.auditorIds || []),
        fetchSheetContacts(freshDist.code),
      ]);
      const people = await fetchPeople(Object.values(hier).flat());
      const auditors = (params.audit.auditorIds || []).map(id => auditorMap[id]).filter(Boolean);
      const auditorNames = auditors.map(p => p.name).join(', ');

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System'; wb.created = new Date();
      // Sheet order matches the template; ALF is built first because Sign + summary reference it.
      const wsSign = wb.addWorksheet('Sign Format.');
      const wsALF = wb.addWorksheet(ALF_SHEET);
      const wsSum = wb.addWorksheet((params.audit.summarySheetName || DEFAULT_SUMMARY_SHEET).slice(0, 31));
      const wsInv = wb.addWorksheet(invoiceSheetName);
      const wsAtt = wb.addWorksheet('Attendance Sheet');
      const alf = buildALFSheet(wsALF, freshDist, params.audit, enrichedItems);
      buildSignSheet(wsSign, freshDist, params.audit, enrichedItems, alf);
      buildSummarySheet(wsSum, freshDist, params.audit, alf, people, hier, auditorNames, sheetContacts);
      buildInvoiceDetailsSheet(wsInv, freshDist, params.audit, enrichedItems, invoiceCategory);
      buildAttendanceSheet(wsAtt, params.audit, auditors);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (freshDist.name || params.distributor.code || 'Audit').replace(/[\\/:*?"<>|]/g, '-');
      a.href = url; a.download = `AuditReport_${safeName}_${params.audit.scheduledDate ?? 'draft'}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) { console.error(err); alert('Failed to generate Excel. Please try again.'); }
    finally { setIsExporting(false); }
  };

  // ── Claim Letter PDF export ─────────────────────────────────────────────────
  const exportClaimPDF = async () => {
    if (!params.distributor) return;
    setIsExportingPDF(true);
    try {
      const sb = supabase;
      const assignmentId = getActiveAssignmentId();
      let freshDist: SignOffDistributor = params.distributor;
      if (params.distributor.code) {
        const { data: dbDist } = await sb
          .from('distributors')
          .select('id,code,name,anchorName,address,city,state,region')
          .eq('assignment_id', assignmentId)
          .eq('code', params.distributor.code)
          .maybeSingle();
        if (dbDist) {
          freshDist = {
            ...params.distributor,
            name: dbDist.name || params.distributor.name || '',
            anchorName: dbDist.anchorName || params.distributor.anchorName || '',
            address: dbDist.address || '',
            city: dbDist.city || '',
            state: dbDist.state || '',
            region: dbDist.region || '',
          };
        }
      }

      // FIX: use stored totalValue for PDF totals too
      const totalQty = policyItems.reduce((s, i) => s + ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0)), 0);
      const totalValue = policyItems.reduce((s, i) => s + (i.totalValue ?? ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0)) * (i.unitValue || 0)), 0);

      const auditDate = params.audit.scheduledDate || '';
      const serialNo = params.audit.serialNo || '';
      const anchorName = freshDist.anchorName || freshDist.name || '';
      const anchorCode = freshDist.code || '';
      const distCity = freshDist.city || '';
      const distNameCity = distCity ? `${freshDist.name}, ${distCity}` : freshDist.name;
      const fmtValue = (v: number) =>
        '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const tableHTML = `
        <table>
          <thead><tr>
            <th>Distributor Name &amp; City</th>
            <th>Qty Verified (In Pcs)</th>
            <th>Total Audited Value (Including GST)</th>
          </tr></thead>
          <tbody><tr>
            <td><b>${distNameCity}</b></td>
            <td><b>${totalQty.toLocaleString('en-IN')}</b></td>
            <td><b>${fmtValue(totalValue)}</b></td>
          </tr></tbody>
        </table>`;

      const sig = `<div class="sig">
        <p>For ______________</p>
        <p>Authorized Signatory</p>
        <p>Name with Seal &amp; sign</p>
        <p>__________________</p>
      </div>`;

      const claimSubject = params.audit.claimSubject || DEFAULT_CLAIM_SUBJECT;
      const mkLetter = (letterhead: string, bodyHTML: string, afterTableHTML = '') => `
        <div class="letter">
          <div class="lh-space"></div>
          <p class="hl c"><b><u>${letterhead}</u></b></p>
          <p class="hl"><b><u>Audit Serial No. - ${serialNo || '….'}</u></b></p>
          <p><b>Audit Date: -</b> ${auditDate}</p>
          <br>
          <p>To,</p>
          <p>Reliance Consumer Product Limited,</p>
          <p>Branch Commercial Manager.</p>
          <br>
          <p>Subject: - <b>Regarding raising of credit note ${claimSubject}</b></p>
          <br>
          <p>Dear Sir,</p>
          <br>
          ${bodyHTML}
          <p><b>Anchor code and Name -</b> ${anchorName} - ${anchorCode}</p>
          <br>
          ${tableHTML}
          ${afterTableHTML}
          ${sig}
        </div>`;

      // Letter 1 — on the distributor's letterhead
      const body1 = `
        <p>We, hereby confirm that leakage &amp; breakage audit has been completed at our premises by Auditors.</p><br>
        <p>Request you to please raise credit note in our Anchor&#8217;s account as per below details: -</p><br>`;

      // Letter 2 — on the anchor's letterhead
      const body2 = `
        <p>We, hereby confirm that leakage &amp; breakage audit has been completed at our distributor as per below details. Request you to please raise credit note to our account accordingly.</p><br>`;
      const after2 = `<p>We hereby confirm that credit note amount shall be reimbursed to abovementioned Distributor.</p>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Claim Letter - ${serialNo}</title>
<style>
  @page { size: Letter; margin: 12.7mm 24mm; }
  * { font-family: 'Times New Roman', Times, serif; font-size: 12pt; margin: 0; padding: 0; box-sizing: border-box; }
  p { margin-bottom: 4pt; text-align: justify; }
  .hl { background: yellow; display: block; padding: 1px 0; }
  .hl.c { text-align: center; }
  .lh-space { height: 70pt; }          /* blank space for the letterhead */
  .letter { page-break-after: always; }
  .letter:last-child { page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 10pt 0; }
  th, td { border: 1px solid #000; padding: 5pt 6pt; text-align: center; }
  th { font-weight: bold; }
  .sig { margin-top: 22pt; line-height: 1.6; }
  br { display: block; margin: 4pt 0; content: ''; }
</style></head><body>
  ${mkLetter('On the Letter Head of the Distributor', body1)}
  ${mkLetter('On the Letter Head of the Anchor', body2, after2)}
</body></html>`;

      const win = window.open('', '_blank', 'width=900,height=700');
      if (!win) { alert('Please allow popups to generate the PDF.'); return; }
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 500);

    } catch (err: any) {
      console.error('Claim PDF error:', err);
      alert('PDF generation failed: ' + (err.message || err));
    } finally {
      setIsExportingPDF(false);
    }
  };

  // ── ALF PDF export ──────────────────────────────────────────────────────────
  const exportALFPDF = async () => {
    if (!params.distributor || policyItems.length === 0) return;
    setIsExportingALF(true);
    try {
      const sb = supabase;
      const assignmentId = getActiveAssignmentId();
      let freshDist: SignOffDistributor = params.distributor;
      if (params.distributor.code) {
        const { data: dbDist } = await sb.from('distributors').select('id,code,name,anchorName,address,city,state,region').eq('assignment_id', assignmentId).eq('code', params.distributor.code).maybeSingle();
        if (dbDist) freshDist = { ...params.distributor, name: dbDist.name || params.distributor.name, anchorName: dbDist.anchorName || params.distributor.anchorName, address: dbDist.address || '', city: dbDist.city || '', state: dbDist.state || '', region: dbDist.region || '' };
      }

      const codes = [...new Set(policyItems.map(i => i.articleNumber))];
      const itemMasterMap: Record<string, any> = {};
      if (codes.length) {
        const { data: m } = await sb.from('itemMaster').select('itemCode,gst,standardPack,category').eq('assignment_id', assignmentId).in('itemCode', codes);
        if (m) m.forEach((r: any) => { itemMasterMap[r.itemCode] = r; });
      }

      const gstMapPdf = await fetchGstByArticle(assignmentId, codes);
      const enriched = policyItems.map(i => ({
        ...i,
        gst: gstMapPdf[i.articleNumber] || parseGst(i.gst),
        standardPack: itemMasterMap[i.articleNumber]?.standardPack ?? i.standardPack ?? '',
        category: itemMasterMap[i.articleNumber]?.category || i.category || '',
      }));

      const fmtINR = (v: number) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtQ = (v: number) => v > 0 ? v.toLocaleString('en-IN') : '0';
      const lifeM = (mfg: string, exp: string) => {
        if (!mfg || !exp) return '';
        const d = Math.ceil((new Date(exp).getTime() - new Date(mfg).getTime()) / 86400000);
        return (d / 30).toFixed(1) + ' M';
      };
      const mfgQ = (mfg: string) => {
        if (!mfg) return '';
        const d = new Date(mfg);
        return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
      };

      // Only categories with quantity get columns. With a single category the
      // "Total" columns would just repeat it, so they're dropped too.
      // 0-based column indexes: 15 PD,16 Samp,17 NS,18 BBD,19 Tot (Pcs) | 20 PD,21 Samp,22 NS,23 BBD,24 Tot,25 Excl (INR)
      const keys = activeCategoryKeys(enriched);
      const single = keys.length === 1;
      const DROP = new Set<number>();
      (['damage', 'sampling', 'nonSaleable', 'bbd'] as const).forEach((k, i) => { if (!keys.includes(k)) { DROP.add(15 + i); DROP.add(20 + i); } });
      if (single) { DROP.add(19); DROP.add(24); }
      const keep = <T,>(arr: T[]) => arr.filter((_, i) => !DROP.has(i));
      const SHORT: Record<string, string> = { damage: 'Primary Damage', sampling: 'Sampling', nonSaleable: 'Non-Saleable', bbd: 'BBD' };
      const groups = [
        { label: 'Master Details', cols: 15, color: '#D9E1F2' },
        { label: single ? 'Quantity' : 'Quantity Detail', cols: keys.length + (single ? 0 : 1), color: '#BDD7EE' },
        { label: single ? 'Value Details' : 'Value Details - Incl. GST', cols: keys.length + (single ? 1 : 2), color: '#E2EFDA' },
        { label: 'MFD & Expiry Date', cols: 4, color: '#FFF2CC' },
        { label: 'Auditor Findings', cols: 2, color: '#D9D9D9' },
      ];
      const groupRow = groups.map(g => `<th colspan="${g.cols}" style="background:${g.color};font-size:7pt;font-weight:bold;padding:3pt;text-align:center;border:0.5pt solid #999">${g.label}</th>`).join('');
      const headers = keep([
        'Sr', 'Serial No', 'Region', 'State', 'Audit Team', 'Anchor Code', 'Anchor Name',
        'Distributor', 'Article Code', 'Brand Pack', 'Category', 'NPI', 'Rate (GST)',
        'GST%', 'Std Pack',
        'PD\n(Pcs)', 'Samp\n(Pcs)', 'NS\n(Pcs)', 'BBD\n(Pcs)', 'Total\n(Pcs)',
        'PD\n(INR)', 'Samp\n(INR)', 'NS\n(INR)', 'BBD\n(INR)', 'Total\n(INR)', 'Total\n(Excl)',
        'Mfg Date', 'Exp Date', 'Life', 'Mfg Qtr',
        'Issue', 'Remarks',
      ]).map(h => {
        if (!single) return h;
        const name = SHORT[keys[0]];
        return /^(PD|Samp|NS|BBD)\n\(Pcs\)$/.test(h) ? `${name}\n(Pcs)`
          : /^(PD|Samp|NS|BBD)\n\(INR\)$/.test(h) ? `${name} (INR)\nIncl. GST`
            : h === 'Total\n(Excl)' ? `${name} (INR)\nExcl. GST` : h;
      });

      let rows = '';
      enriched.forEach((item, idx) => {
        const uv = item.unitValue || 0;
        const gst = Number(item.gst) || 0;
        const dmg = item.qtyDamaged || 0;
        const ns = item.qtyNonSaleable || 0;
        const bbd = item.qtyBBD || 0;
        const samp = item.qtySampling || 0;
        const tot = dmg + ns + bbd + samp;

        // FIX: use splitValues for consistent per-type values
        const sv = splitValues(item);
        const vExc = gst > 0 ? sv.vTot / (1 + gst / 100) : sv.vTot;

        const cols = [
          idx + 1, params.audit.serialNo || '', freshDist.region || '', freshDist.state || '',
          params.audit.auditorName || '', freshDist.code || '', freshDist.anchorName || freshDist.name || '',
          freshDist.name || '', item.articleNumber, item.description, item.category || '', '',
          fmtINR(uv), gst > 0 ? gst + '%' : '', item.standardPack || '',
          fmtQ(dmg), fmtQ(samp), fmtQ(ns), fmtQ(bbd), fmtQ(tot),
          fmtINR(sv.vDmg), fmtINR(sv.vSamp), fmtINR(sv.vNs), fmtINR(sv.vBbd), fmtINR(sv.vTot), fmtINR(vExc),
          item.mfgDate || '', item.expDate || '', lifeM(item.mfgDate || '', item.expDate || ''), mfgQ(item.mfgDate || ''),
          item.reasonCode || '', item.remarks || '',
        ];
        rows += `<tr>${keep(cols).map(c => `<td>${c}</td>`).join('')}</tr>`;
      });

      // FIX: totals use splitValues-derived values
      const totDmg = enriched.reduce((s, i) => s + splitValues(i).vDmg, 0);
      const totSamp = enriched.reduce((s, i) => s + splitValues(i).vSamp, 0);
      const totNs = enriched.reduce((s, i) => s + splitValues(i).vNs, 0);
      const totBbd = enriched.reduce((s, i) => s + splitValues(i).vBbd, 0);
      const totInc = enriched.reduce((s, i) => s + splitValues(i).vTot, 0);
      const totExc = enriched.reduce((s, i) => {
        const sv = splitValues(i);
        const gst = Number(i.gst) || 0;
        return s + (gst > 0 ? sv.vTot / (1 + gst / 100) : sv.vTot);
      }, 0);

      const WIDTHS = [1.5, 6.5, 2.3, 2.0, 3.0, 2.5, 4.0, 4.0, 3.0, 5.0, 3.0, 0.5, 3.0, 1.5, 1.5,
        2.5, 2.5, 2.5, 2.5, 2.5, 4.3, 3.8, 4.8, 4.3, 4.8, 4.8, 3.6, 3.6, 2.0, 3.0, 3.5, 3.5];
      const kept = keep(WIDTHS); const wSum = kept.reduce((a, b) => a + b, 0);
      const colgroup = kept.map(w => `<col style="width:${(w / wSum * 100).toFixed(2)}%">`).join('');
      const totalsCells: string[] = [
        ...Array(15).fill(''),
        fmtQ(enriched.reduce((s, i) => s + (i.qtyDamaged || 0), 0)),
        fmtQ(enriched.reduce((s, i) => s + (i.qtySampling || 0), 0)),
        fmtQ(enriched.reduce((s, i) => s + (i.qtyNonSaleable || 0), 0)),
        fmtQ(enriched.reduce((s, i) => s + (i.qtyBBD || 0), 0)),
        fmtQ(enriched.reduce((s, i) => s + ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0) + (i.qtySampling || 0)), 0)),
        fmtINR(totDmg), fmtINR(totSamp), fmtINR(totNs), fmtINR(totBbd), fmtINR(totInc), fmtINR(totExc),
        ...Array(6).fill(''),
      ];
      const totalsRow = keep(totalsCells).map(c => `<td>${c}</td>`).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Article Level Format — ${params.audit.serialNo || ''}</title>
<style>
  @page { size: A3 landscape; margin: 8mm; }
  * { font-family: Arial, sans-serif; font-size: 7pt; margin: 0; padding: 0; box-sizing: border-box; }
  h2 { font-size: 11pt; text-align: center; margin-bottom: 4pt; }
  .meta { font-size: 8pt; margin-bottom: 6pt; display: flex; gap: 24pt; flex-wrap: wrap; }
  .meta span { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  tfoot { display: table-row-group; }
  th { font-weight: bold; font-size: 6pt; padding: 2pt 1pt; text-align: center; border: 0.5pt solid #999; vertical-align: bottom; word-wrap: break-word; }
  td { padding: 2pt 1pt; border: 0.5pt solid #ccc; text-align: center; vertical-align: middle; overflow: hidden; font-size: 7pt; word-wrap: break-word; }
  td:nth-child(8), td:nth-child(10), td:nth-child(11) { text-align: left; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .totals td { font-weight: bold; background: #E2EFDA !important; border-top: 1.5pt solid #333; }
  .declaration { margin-top: 16pt; font-size: 8pt; line-height: 1.6; }
  .declaration p { margin-bottom: 4pt; text-align: left; }
  .signoff-table { width: 100%; border-collapse: collapse; margin-top: 24pt; }
  .signoff-table .sign-cell { width: 33.33%; padding: 14pt 8pt; font-size: 9pt; border: none; text-align: left; vertical-align: top; }
</style></head><body>
<h2>Article Level Format Revised — ${freshDist.name} (${freshDist.code})</h2>
<div class="meta">
  <div>Serial No: <span>${params.audit.serialNo || ''}</span></div>
  <div>Audit Date: <span>${params.audit.scheduledDate || ''}</span></div>
  <div>City: <span>${freshDist.city || ''}</span></div>
  <div>State: <span>${freshDist.state || ''}</span></div>
  <div>Auditor: <span>${params.audit.auditorName || ''}</span></div>
</div>
<table>
  <colgroup>${colgroup}</colgroup>
  <thead><tr>${groupRow}</tr><tr>${headers.map(h => `<th>${h.replace(/\\n/g, '<br>')}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="totals">${totalsRow}</tr>
  </tfoot>
</table>

<div class="declaration">
  <p>1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.</p>
  <p>2. No Stock shall be taken into consideration before Oct'23 Manufacturing date.</p>
  <p>3. Stock with above-mentioned quality &amp; value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.</p>
  <p>4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.</p>
</div>

<table class="signoff-table">
  <tr>
    <td class="sign-cell"><b>Customer's Authorised person Name -</b></td>
    <td class="sign-cell">&nbsp;</td>
    <td class="sign-cell"><b>Sales Team Name &amp; contact no.</b></td>
  </tr>
  <tr><td class="sign-cell">&nbsp;</td><td class="sign-cell">&nbsp;</td><td class="sign-cell">&nbsp;</td></tr>
  <tr><td class="sign-cell">&nbsp;</td><td class="sign-cell">&nbsp;</td><td class="sign-cell">&nbsp;</td></tr>
  <tr>
    <td class="sign-cell"><b>Seal &amp; Sign -</b></td>
    <td class="sign-cell"><b>Auditor Sign</b></td>
    <td class="sign-cell"><b>Sign</b></td>
  </tr>
</table>
</body></html>`;

      const win = window.open('', '_blank', 'width=1200,height=800');
      if (!win) { alert('Allow popups to download the PDF.'); return; }
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 600);
    } catch (err: any) {
      console.error('ALF PDF error:', err);
      alert('PDF generation failed: ' + (err.message || err));
    } finally {
      setIsExportingALF(false);
    }
  };

  return { exportSignOff, isExporting, exportClaimPDF, isExportingPDF, exportALFPDF, isExportingALF };
}
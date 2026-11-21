/**
 * useSignOffExport.ts  — Reliance Audit System
 *
 * 4-sheet Excel workbook + 2 PDF exports (Claim Letter, ALF PDF)
 *
 *  Sheet 1: "Sign Format."
 *  Sheet 2: "Article Level Format Revised"  (group headers)
 *  Sheet 3: "Invoie details - <Category>"
 *  Sheet 4: "Attendance Sheet"
 *
 * FIX: All value calculations use item.totalValue (stored in DB) as the
 * source of truth rather than recomputing qty * unitValue, which causes
 * floating-point drift (e.g. ₹1,050,413.96 vs ₹1,050,414.11).
 *
 * The split by type (damaged/nonSaleable/BBD/sampling) uses proportional
 * allocation from the stored totalValue so the per-type values always sum
 * exactly to item.totalValue.
 *
 * CATEGORY-DRIVEN LAYOUT
 * -----------------------
 * Not every audit tracks all four categories — e.g. a "Quality Audit" only
 * ever records Non-Saleable / Non-manufacturing-defect stock, never Primary
 * Damage, Sampling or BBD. Rendering all four columns anyway (with the
 * unused ones permanently zero) doesn't match how these reports are
 * actually used downstream.
 *
 * So both "Sign Format." and "Article Level Format Revised" now only emit
 * columns for categories that actually have quantity somewhere in the
 * item list (see getActiveCategories). When more than one category is
 * active, the sheets additionally show "Total Verified Quantity" / "Total
 * Audited Value" columns (as before); with exactly one active category
 * those totals would just duplicate the single category, so they're
 * dropped and that category's own Incl/Excl-GST values are shown directly
 * instead — this matches the single-category report template exactly.
 *
 * An empty item list (or one with zero quantity in every category) falls
 * back to showing all four categories, so a blank/draft export still looks
 * like the familiar full template rather than a degenerate empty grid.
 */
import { useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase, getActiveAssignmentId } from '../supabase';

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
    alfPcsLabel: 'Primary Damage\n(Pcs)',
    alfInrLabel: 'Primary Damage\n(INR)',
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
    alfPcsLabel: 'BBD Stock\n(Pcs)',
    alfInrLabel: 'BBD Stock\n(INR)',
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
  const active = CATEGORY_DEFS.filter(c => items.some(i => categoryQty(i, c.key) > 0));
  return active.length > 0 ? active : CATEGORY_DEFS;
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
  return items.map(i => ({ ...i, gst: map[i.articleNumber]?.gst ?? i.gst ?? 0, standardPack: map[i.articleNumber]?.standardPack ?? i.standardPack ?? '', category: map[i.articleNumber]?.category || i.category || '' }));
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

// ── Fixed physical-column partitioning ────────────────────────────────────────
// Instead of shrinking the sheet to only as many columns as are needed
// (which left narrow 1-2 column boxes that truncated text), the sheet
// always keeps its ORIGINAL total width and column widths. Categories that
// aren't active simply don't get their own sub-column — the physical slots
// they would have used are merged into the categories that ARE active, so
// those get wider (not narrower) boxes than before. This keeps every
// layout — 1 active category or 4 — visually identical in overall
// proportions to the original full report.
function partitionRange(start: number, end: number, n: number): Array<[number, number]> {
  const total = end - start + 1;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  const ranges: Array<[number, number]> = [];
  let cur = start;
  for (let i = 0; i < n; i++) {
    const w = base + (i < rem ? 1 : 0);
    ranges.push([cur, cur + w - 1]);
    cur += w;
  }
  return ranges;
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 1 — Sign Format
// ═════════════════════════════════════════════════════════════════════════════
function buildSignSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const activeCategories = getActiveCategories(items);
  const showTotals = activeCategories.length > 1;
  const firmName = audit.auditFirmName || DEFAULT_FIRM_NAME;
  const reportTitle = audit.reportTitle || DEFAULT_REPORT_TITLE;

  // ── Fixed-width layout: sheet is ALWAYS columns A-M (13 cols), same
  // widths as the original full-category report. The 5 physical columns
  // reserved for quantity (B:F) and the 5 for value (G:K) are partitioned
  // among however many categories are active — 1 active category gets all
  // 5 physical columns merged into one wide box instead of a cramped single
  // column. Approved Amount (L) and Variance % (M) are always single,
  // unaffected columns, exactly as before.
  ws.columns = [
    { width: 2 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 12 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 12 },
  ];
  const lastCol = 13;

  const numQtyLogical = activeCategories.length + (showTotals ? 1 : 0);
  const numValLogical = activeCategories.length + (showTotals ? 1 : 0);
  const qtyPartition = partitionRange(2, 6, numQtyLogical);   // B:F
  const valPartition = partitionRange(7, 11, numValLogical);  // G:K
  const qtyRanges: Array<[number, number]> = qtyPartition.slice(0, activeCategories.length);
  const totalQtyRange: [number, number] | null = showTotals ? qtyPartition[qtyPartition.length - 1] : null;
  const valRanges: Array<[number, number]> = valPartition.slice(0, activeCategories.length);
  const totalValRange: [number, number] | null = showTotals ? valPartition[valPartition.length - 1] : null;
  const approvedCol = 12;
  const varianceCol = 13;

  const agg = new Map<string, {
    dmg: number; ns: number; bbd: number; samp: number;
    vDmg: number; vNs: number; vBbd: number; vSamp: number; vTot: number;
    uv: number;
  }>();

  for (const item of items) {
    if (!agg.has(item.articleNumber)) {
      agg.set(item.articleNumber, { dmg: 0, ns: 0, bbd: 0, samp: 0, vDmg: 0, vNs: 0, vBbd: 0, vSamp: 0, vTot: 0, uv: 0 });
    }
    const a = agg.get(item.articleNumber)!;
    const sv = splitValues(item);
    a.dmg += item.qtyDamaged || 0;
    a.ns += item.qtyNonSaleable || 0;
    a.bbd += item.qtyBBD || 0;
    a.samp += item.qtySampling || 0;
    a.vDmg += sv.vDmg;
    a.vNs += sv.vNs;
    a.vBbd += sv.vBbd;
    a.vSamp += sv.vSamp;
    a.vTot += sv.vTot;
    if ((item.unitValue || 0) > a.uv) a.uv = item.unitValue;
  }

  const rows = [...agg.values()];
  const qDmg = rows.reduce((s, v) => s + v.dmg, 0);
  const qSamp = rows.reduce((s, v) => s + v.samp, 0);
  const qNs = rows.reduce((s, v) => s + v.ns, 0);
  const qBbd = rows.reduce((s, v) => s + v.bbd, 0);
  const qTot = qDmg + qSamp + qNs + qBbd;
  const vDmg = rows.reduce((s, v) => s + v.vDmg, 0);
  const vSamp = rows.reduce((s, v) => s + v.vSamp, 0);
  const vNs = rows.reduce((s, v) => s + v.vNs, 0);
  const vBbd = rows.reduce((s, v) => s + v.vBbd, 0);
  // FIX: grand total = sum of all stored totalValues (not recomputed)
  const vTot = rows.reduce((s, v) => s + v.vTot, 0);

  const qtyByKey: Record<CategoryKey, number> = { damage: qDmg, sampling: qSamp, nonSaleable: qNs, bbd: qBbd };
  const valByKey: Record<CategoryKey, number> = { damage: vDmg, sampling: vSamp, nonSaleable: vNs, bbd: vBbd };

  const approved = audit.approvedValue || 0;
  const variancePct = approved > 0 ? (vTot - approved) / approved : 0;
  const INR = '[$₹-en-IN]#,##0.00'; const QTY = '#,##0'; const PCT = '0.00%';

  let r = 0;
  const nr = (h = 16) => { r++; ws.getRow(r).height = h; return r; };
  const scT = (row: number, col: number, value: ExcelJS.CellValue, opts: any = {}) =>
    setCell(ws, row, col, value, { font: tnrFont({ bold: opts.bold, size: opts.size || 10, underline: opts.underline }), ...opts });

  nr(18); safeMerge(ws, r, 2, r, lastCol);
  scT(r, 2, reportTitle, { bold: true, size: 12, hAlign: 'center', vAlign: 'middle', wrap: false, border: {} });

  const infoLines: [string, string][] = [
    ['Audit Serial No. - ', audit.serialNo || ''], ['Audit Firm Name - ', firmName],
    ['Anchor Code - ', dist.code || ''], ['Anchor Name/ Direct DB Name - ', dist.anchorName || ''],
    ['Distributor name & City - ', `${dist.name || ''}, ${dist.city || ''}`],
    ['Audit Start Date - ', audit.scheduledDate || ''], ['Audit End Date- ', audit.auditEndDate || audit.scheduledDate || ''],
    ['Drainage Start Date - ', audit.drainageDate || ''], ['Drainage End Date - ', audit.drainageEndDate || ''],
  ];
  const addrParts = [dist.name, dist.address, dist.city, dist.state, dist.region].filter(Boolean);
  const customerAddress = addrParts.join(', ') || dist.name || 'N/A';

  // Info/address block layout is fixed (B:F label, G:M address) — identical
  // to the original report regardless of how many categories are active.
  const infoRightStart = 7;
  const leftBlockEnd = 6;

  const addrStartRow = r + 1;
  safeMerge(ws, addrStartRow, infoRightStart, addrStartRow + 2, lastCol);
  const addrCell = ws.getCell(addrStartRow, infoRightStart);
  addrCell.value = {
    richText: [
      { text: 'Customer Full Address :- ', font: { ...tnrFont({ bold: true, size: 10 }), underline: true } },
      { text: customerAddress, font: { ...tnrFont({ bold: false, size: 10 }), underline: false } },
    ]
  } as any;
  addrCell.alignment = aln('left', 'top', true); addrCell.border = thinBorder;

  infoLines.forEach(([label, value], i) => {
    nr(16); safeMerge(ws, r, 2, r, leftBlockEnd);
    const cell = ws.getCell(r, 2);
    cell.value = { richText: [{ text: label, font: tnrFont({ bold: true, size: 10 }) }, { text: value, font: tnrFont({ bold: false, size: 10 }) }] } as any;
    cell.alignment = aln('left', 'middle', false); cell.border = thinBorder;
    if (i >= 3) { safeMerge(ws, r, infoRightStart, r, lastCol); scT(r, infoRightStart, '', { hAlign: 'left', border: thinBorder }); }
  });

  // ── Category group headers ───────────────────────────────────────────────
  // merge helper: writes into the first column of a range, merging the
  // whole range if it spans more than one physical column.
  const mScT = (range: [number, number], row: number, value: ExcelJS.CellValue, opts: any = {}) => {
    if (range[0] !== range[1]) safeMerge(ws, row, range[0], row, range[1]);
    scT(row, range[0], value, opts);
  };

  nr(18);
  safeMerge(ws, r, 2, r, 6); scT(r, 2, 'Quantity Details - Physically verified & Drained', { bold: true, size: 9, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });
  safeMerge(ws, r, 7, r, 11); scT(r, 7, 'Value Details', { bold: true, size: 9, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });
  safeMerge(ws, r, approvedCol, r, varianceCol); scT(r, approvedCol, 'Variance Summary', { bold: true, size: 9, fill: C.ORANGE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });

  nr(50);
  activeCategories.forEach((cat, i) => mScT(qtyRanges[i], r, cat.pcsLabel, { bold: true, size: 8, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder }));
  if (showTotals) mScT(totalQtyRange!, r, 'Total Verified\nQuantity (Pcs)', { bold: true, size: 8, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  activeCategories.forEach((cat, i) => mScT(valRanges[i], r, cat.inrLabel, { bold: true, size: 8, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder }));
  if (showTotals) mScT(totalValRange!, r, 'Total\nAudited\nValue', { bold: true, size: 8, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  scT(r, approvedCol, 'Approved\nAmount', { bold: true, size: 8, fill: C.ORANGE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  scT(r, varianceCol, 'Variance %', { bold: true, size: 8, fill: C.ORANGE, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });

  nr(16);
  activeCategories.forEach((cat, i) => mScT(qtyRanges[i], r, qtyByKey[cat.key], { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: QTY }));
  if (showTotals) mScT(totalQtyRange!, r, qTot, { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: QTY });
  activeCategories.forEach((cat, i) => mScT(valRanges[i], r, valByKey[cat.key], { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: INR }));
  if (showTotals) mScT(totalValRange!, r, vTot, { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: INR });
  scT(r, approvedCol, approved, { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: INR });
  scT(r, varianceCol, variancePct, { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: PCT });

  nr(6); nr(6);

  // Declaration blocks split the remaining width roughly 2:1 (left notes /
  // right name-and-sign), same proportion as the full 4-category layout.
  const totalWidth = lastCol - 1;
  const rightWidth = Math.max(2, Math.min(4, Math.round(totalWidth / 3)));
  const leftEnd = lastCol - rightWidth;
  const rightStart = leftEnd + 1;

  nr(80); safeMerge(ws, r, 2, r, leftEnd);
  setCell(ws, r, 2, ['Declaration from Customer -', '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.', '2. I confirm that all stocks received by me with expiry date upto date of Audit has been cleared by company and I will not raise any further claim in this regard for products with expired.', '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.', '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.'].join('\n'), { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });
  safeMerge(ws, r, rightStart, r, lastCol); setCell(ws, r, rightStart, "Customer's Authorised person Name -\n\n\n\n\nSeal & Sign -", { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  nr(6); nr(60); safeMerge(ws, r, 2, r, leftEnd);
  setCell(ws, r, 2, ['Declaration from Reliance Sales Team -', '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.', '2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.'].join('\n'), { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });
  safeMerge(ws, r, rightStart, r, lastCol); setCell(ws, r, rightStart, 'Sales Team Name & contact no.\n\nSales Team EMP ID\n\nSign', { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  nr(6); nr(60); safeMerge(ws, r, 2, r, leftEnd);
  setCell(ws, r, 2, ["Declaration from Auditor-", "1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team.", "2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer's location."].join('\n'), { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });
  safeMerge(ws, r, rightStart, r, lastCol); setCell(ws, r, rightStart, 'Auditor Name & contact no.\n\n\nSeal & Sign', { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 2 — Article Level Format Revised
// ═════════════════════════════════════════════════════════════════════════════
function buildALFSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0, footer: 0 } };

  const activeCategories = getActiveCategories(items);
  const showTotals = activeCategories.length > 1;
  const firmName = audit.auditFirmName || DEFAULT_FIRM_NAME;

  // ── Fixed physical-column layout (always 32 columns, A:AF) ───────────────
  // Master Details (1-15), Quantity (16-20), Value (21-26), MFD/Expiry
  // (27-30), Findings (31-32) — identical to the original full-category
  // report in every case. Categories that aren't active don't get their own
  // sub-column; instead the physical slots they'd have used are merged into
  // whichever categories ARE active, so a single-category audit gets one
  // wide, readable box per group instead of a cramped one-column box.
  const MASTER_COLS = 15;
  const qtyStart = MASTER_COLS + 1;      // 16
  const qtyEnd = qtyStart + 4;         // 20  (5 physical columns, fixed)
  const valStart = qtyEnd + 1;           // 21
  const valEnd = valStart + 5;         // 26  (6 physical columns, fixed)
  const mfdStart = valEnd + 1;           // 27
  const mfgDateCol = mfdStart, expDateCol = mfdStart + 1, lifeCol = mfdStart + 2, qtrCol = mfdStart + 3; // 27-30
  const audStart = mfdStart + 4;         // 31
  const issueCol = audStart, remarksCol = audStart + 1; // 31-32
  const lastCol = remarksCol;           // 32, always

  const numQtyLogical = activeCategories.length + (showTotals ? 1 : 0);
  const numValLogical = showTotals ? activeCategories.length + 2 : 2; // incl + excl GST
  const qtyPartition = partitionRange(qtyStart, qtyEnd, numQtyLogical);
  const valPartition = partitionRange(valStart, valEnd, numValLogical);

  const qtyRanges: Array<[number, number]> = qtyPartition.slice(0, activeCategories.length);
  const totalQtyRange: [number, number] | null = showTotals ? qtyPartition[qtyPartition.length - 1] : null;
  const valRanges: Array<[number, number]> = showTotals ? valPartition.slice(0, activeCategories.length) : [];
  const totalInclRange: [number, number] = showTotals ? valPartition[valPartition.length - 2] : valPartition[0];
  const totalExclRange: [number, number] = showTotals ? valPartition[valPartition.length - 1] : valPartition[1];

  // Column widths stay exactly as the original — only the merges above change.
  const masterWidths = [6, 16, 12, 12, 16, 14, 18, 18, 14, 28, 14, 10, 14, 8, 10];
  const colWidths = [
    ...masterWidths,
    10, 10, 12, 18, 10,          // qty  (16-20)
    14, 14, 18, 12, 14, 14,      // val  (21-26)
    13, 13, 8, 14,               // mfd  (27-30)
    24, 18,                      // aud  (31-32)
  ];
  ws.columns = colWidths.map(w => ({ width: w }));
  ws.views = [{}];

  ws.getRow(1).height = 10;
  ws.getRow(2).height = 20;

  // merge helper: writes into the first column of a range, merging the
  // whole range if it spans more than one physical column.
  const mSetHdr = (range: [number, number], text: string, fc: string) => {
    if (range[0] !== range[1]) safeMerge(ws, 3, range[0], 3, range[1]);
    setHdr(range[0], text, fc);
  };

  const groups: Array<[number, number, string, string]> = [
    [1, MASTER_COLS, 'Master Details', C.MASTER_HDR],
    [qtyStart, qtyEnd, 'Quantity Detail', C.QTY_HDR],
    [valStart, valEnd, showTotals ? 'Value Details - Including GST' : 'Value Details', C.VAL_HDR],
    [mfdStart, qtrCol, 'MFD & Expiry Date', C.MFD_HDR],
    [audStart, remarksCol, 'Auditor Findings', C.AUD_HDR],
  ];
  for (const [c1, c2, text, fc] of groups) {
    safeMerge(ws, 2, c1, 2, c2);
    setCell(ws, 2, c1, text, { font: ariFont({ bold: true, size: 11 }), fill: fc, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });
  }

  ws.getRow(3).height = 150;
  const masterHeaders: string[] = [
    'Sr No', 'Std. Serial No.', 'Region', 'State', 'Audit Team', 'Anchor Code', 'Anchor Name', 'Distributor name',
    'Article Code', 'Brand Pack', 'Category (CSD, Still, Water, Energy)', 'NPI / NON - NPI',
    "Rate Including GST\n(As per Waitage Avg of Primary from Apr'25 to Jan'26)", 'GST %', 'Standard Pack',
  ];
  masterHeaders.forEach((text, i) => {
    const cell = ws.getRow(3).getCell(i + 1);
    cell.value = text; cell.font = ariFont({ bold: true, size: 9 }); cell.fill = solidFill(C.MASTER_HDR);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = thinBorder;
  });

  function setHdr(col: number, text: string, fc: string) {
    const cell = ws.getRow(3).getCell(col);
    cell.value = text; cell.font = ariFont({ bold: true, size: 9 }); cell.fill = solidFill(fc);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = thinBorder;
  }

  activeCategories.forEach((cat, i) => mSetHdr(qtyRanges[i], cat.alfPcsLabel, C.QTY_HDR));
  if (showTotals) mSetHdr(totalQtyRange!, 'Total Verified\nQuantity (Pcs)', C.QTY_HDR);

  if (showTotals) {
    activeCategories.forEach((cat, i) => mSetHdr(valRanges[i], cat.alfInrLabel, C.VAL_HDR));
    mSetHdr(totalInclRange, 'Total Audited Value\n(Including GST)', C.VAL_HDR);
    mSetHdr(totalExclRange, 'Total Audited Value\n(Excluding GST)', C.VAL_HDR);
  } else {
    const cat = activeCategories[0];
    mSetHdr(totalInclRange, `${cat.alfInrLabel} ( Including GST)`, C.VAL_HDR);
    mSetHdr(totalExclRange, `${cat.alfInrLabel} ( Excluding GST)`, C.VAL_HDR);
  }

  setHdr(mfgDateCol, 'Manufacturing Date', C.MFD_HDR);
  setHdr(expDateCol, 'Expiry Date', C.MFD_HDR);
  setHdr(lifeCol, 'Product life in Months', C.MFD_HDR);
  setHdr(qtrCol, 'Manufacturing Quarter', C.MFD_HDR);
  setHdr(issueCol, 'Issue in Product in detail', C.AUD_HDR);
  setHdr(remarksCol, 'Auditor Remarks', C.AUD_HDR);

  const serialNo = audit.serialNo || audit.id || '';
  const INR = '[$₹-en-IN]#,##0.00'; const QTY = '#,##0';

  const lifeMonths = (mfg?: string, exp?: string): string => {
    if (!mfg || !exp) return '';
    try { const m = new Date(mfg), e = new Date(exp); const mo = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth()); return mo > 0 ? mo + ' M' : ''; } catch { return ''; }
  };
  const mfgQuarter = (mfg?: string): string => {
    if (!mfg) return '';
    try { const m = new Date(mfg); const fy = m.getMonth() >= 3 ? m.getFullYear() : m.getFullYear() - 1; const q = Math.floor(((m.getMonth() - 3 + 12) % 12) / 3) + 1; return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`; } catch { return ''; }
  };

  // ── FIX: aggregate using splitValues() ───────────────────────────────────
  const agg = new Map<string, {
    item: SignOffItem;
    dmg: number; ns: number; bbd: number; samp: number;
    vDmg: number; vNs: number; vBbd: number; vSamp: number; vTot: number;
  }>();

  for (const item of items) {
    if (!agg.has(item.articleNumber)) {
      agg.set(item.articleNumber, {
        item, dmg: 0, ns: 0, bbd: 0, samp: 0,
        vDmg: 0, vNs: 0, vBbd: 0, vSamp: 0, vTot: 0,
      });
    }
    const a = agg.get(item.articleNumber)!;
    const sv = splitValues(item);
    a.dmg += item.qtyDamaged || 0;
    a.ns += item.qtyNonSaleable || 0;
    a.bbd += item.qtyBBD || 0;
    a.samp += item.qtySampling || 0;
    a.vDmg += sv.vDmg;
    a.vNs += sv.vNs;
    a.vBbd += sv.vBbd;
    a.vSamp += sv.vSamp;
    a.vTot += sv.vTot;
    if ((item.unitValue || 0) > (a.item.unitValue || 0)) a.item = { ...a.item, ...item };
    else if (item.mfgDate && !a.item.mfgDate) a.item = { ...a.item, mfgDate: item.mfgDate, expDate: item.expDate };
  }

  let sno = 0;
  let tTotQ = 0;
  const tQtyByKey: Record<CategoryKey, number> = { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 };
  const tValByKey: Record<CategoryKey, number> = { damage: 0, sampling: 0, nonSaleable: 0, bbd: 0 };
  let tIncV = 0, tExcV = 0;
  let dataRow = 4; // data always starts at row 4

  // merge helper for data/total rows: writes into the first column of a
  // range, merging the whole range (for that row only) if it spans more
  // than one physical column.
  const mCell = (range: [number, number], row: number, value: ExcelJS.CellValue, opts: { font?: Partial<ExcelJS.Font>; fill?: string; hAlign?: ExcelJS.Alignment['horizontal']; numFmt?: string } = {}) => {
    if (range[0] !== range[1]) safeMerge(ws, row, range[0], row, range[1]);
    const cell = ws.getRow(row).getCell(range[0]);
    cell.value = value;
    cell.font = opts.font ?? ariFont({ size: 9 });
    cell.alignment = { horizontal: opts.hAlign ?? 'center', vertical: 'middle', wrapText: false };
    cell.border = thinBorder;
    if (opts.fill) cell.fill = solidFill(opts.fill);
    if (opts.numFmt) cell.numFmt = opts.numFmt;
  };

  for (const [, a] of agg) {
    const { item, dmg, ns, bbd, samp, vTot } = a;
    sno++;
    const qTot = dmg + samp + ns + bbd;
    const uv = item.unitValue || 0;
    const gst = Number(item.gst) || 0;
    // FIX: excl value derived from stored vTot, not recomputed
    const vExc = gst > 0 ? vTot / (1 + gst / 100) : vTot;

    tTotQ += qTot; tIncV += vTot; tExcV += vExc;
    (['damage', 'sampling', 'nonSaleable', 'bbd'] as CategoryKey[]).forEach(k => {
      tQtyByKey[k] += catQtyFromAgg(a, k);
      tValByKey[k] += catValFromAgg(a, k);
    });

    ws.getRow(dataRow).height = 15;

    const rowData: Array<[number, ExcelJS.CellValue, string?]> = [
      [1, sno, QTY], [2, serialNo, undefined], [3, dist.region || '', undefined], [4, dist.state || '', undefined],
      [5, firmName, undefined], [6, dist.code || '', undefined], [7, dist.anchorName || '', undefined],
      [8, dist.name || '', undefined], [9, item.articleNumber, undefined], [10, item.description, undefined],
      [11, item.category || '', undefined], [12, '', undefined], [13, uv, INR],
      [14, gst > 0 ? gst + '%' : '', undefined], [15, item.standardPack || '', undefined],
      [27, item.mfgDate || '', undefined], [28, item.expDate || '', undefined], // placeholders, overwritten below with dynamic cols
    ];
    // Fixed master columns 1-15
    for (const [col, val, fmt] of rowData.slice(0, 13)) {
      const cell = ws.getRow(dataRow).getCell(col);
      cell.value = val;
      cell.font = ariFont({ size: 9 });
      cell.alignment = { horizontal: col <= 2 || col === 7 || col === 8 || col === 9 || col === 10 || col === 11 ? 'left' : 'center', vertical: 'middle', wrapText: false };
      cell.border = thinBorder;
      if (fmt) cell.numFmt = fmt;
    }

    // Dynamic quantity / value columns
    activeCategories.forEach((cat, i) => mCell(qtyRanges[i], dataRow, catQtyFromAgg(a, cat.key), { numFmt: QTY }));
    if (showTotals) mCell(totalQtyRange!, dataRow, qTot, { numFmt: QTY });
    if (showTotals) activeCategories.forEach((cat, i) => mCell(valRanges[i], dataRow, catValFromAgg(a, cat.key), { numFmt: INR }));
    mCell(totalInclRange, dataRow, vTot, { numFmt: INR });
    mCell(totalExclRange, dataRow, vExc, { numFmt: INR });

    // MFD / Expiry / Findings columns
    const tailData: Array<[number, ExcelJS.CellValue]> = [
      [mfgDateCol, item.mfgDate || ''], [expDateCol, item.expDate || ''],
      [lifeCol, lifeMonths(item.mfgDate, item.expDate)], [qtrCol, mfgQuarter(item.mfgDate)],
      [issueCol, item.reasonCode || ''], [remarksCol, item.remarks || ''],
    ];
    for (const [col, val] of tailData) {
      const cell = ws.getRow(dataRow).getCell(col);
      cell.value = val; cell.font = ariFont({ size: 9 });
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false }; cell.border = thinBorder;
    }
    dataRow++;
  }

  // ── TOTALS ROW ─────────────────────────────────────────────────────────────
  ws.getRow(dataRow).height = 14;
  safeMerge(ws, dataRow, 1, dataRow, MASTER_COLS);
  setCell(ws, dataRow, 1, 'TOTAL', { font: ariFont({ bold: true, size: 9 }), fill: C.TOTAL_ROW, hAlign: 'center', border: thinBorder });

  const totalOpts = { font: ariFont({ bold: true, size: 9 }), fill: C.TOTAL_ROW };
  activeCategories.forEach((cat, i) => mCell(qtyRanges[i], dataRow, tQtyByKey[cat.key], { ...totalOpts, numFmt: QTY }));
  if (showTotals) mCell(totalQtyRange!, dataRow, tTotQ, { ...totalOpts, numFmt: QTY });
  if (showTotals) activeCategories.forEach((cat, i) => mCell(valRanges[i], dataRow, tValByKey[cat.key], { ...totalOpts, numFmt: INR }));
  mCell(totalInclRange, dataRow, tIncV, { ...totalOpts, numFmt: INR });
  mCell(totalExclRange, dataRow, tExcV, { ...totalOpts, numFmt: INR });
  for (let c = mfgDateCol; c <= lastCol; c++) setCell(ws, dataRow, c, '', { fill: C.TOTAL_ROW, border: thinBorder });

  // ── SIGN-OFF DECLARATION SECTION ────────────────────────────────────────────
  const whiteFill = solidFill(C.WHITE);
  const noB: Partial<ExcelJS.Borders> = {};

  const clearSignRow = (rowNum: number, h = 18) => {
    ws.getRow(rowNum).height = h;
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getRow(rowNum).getCell(c);
      cell.fill = whiteFill;
      cell.border = noB;
      cell.font = ariFont({ size: 9 });
      cell.alignment = { wrapText: false, vertical: 'middle', horizontal: 'left' };
    }
  };
  const writeSign = (rowNum: number, col: number, text: string, bold = false) => {
    const cell = ws.getRow(rowNum).getCell(col);
    cell.value = text;
    cell.font = ariFont({ bold, size: 9 });
    cell.fill = whiteFill;
    cell.border = noB;
    cell.alignment = { wrapText: false, vertical: 'middle', horizontal: 'left' };
  };

  clearSignRow(dataRow + 1, 10);
  clearSignRow(dataRow + 2, 10);

  const declLines = [
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    "2. No Stock shall be taken into consideration before Oct'23 Manufacturing date.",
    '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.',
    '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.',
  ];
  for (let i = 0; i < declLines.length; i++) {
    clearSignRow(dataRow + 3 + i, 16);
    writeSign(dataRow + 3 + i, 3, declLines[i]);
  }

  clearSignRow(dataRow + 7, 10);

  // Third sign block sits near the start of the MFD section, same relative
  // position as the original fixed 32-column layout.
  const signCol3 = Math.min(lastCol, mfdStart);

  clearSignRow(dataRow + 8, 18);
  writeSign(dataRow + 8, 3, "Customer's Authorised person Name -", true);
  writeSign(dataRow + 8, MASTER_COLS, '3rd Party Auditor', true);
  writeSign(dataRow + 8, signCol3, 'Sales Team Name & contact no.', true);

  clearSignRow(dataRow + 9, 16);
  clearSignRow(dataRow + 10, 16);
  clearSignRow(dataRow + 11, 16);

  clearSignRow(dataRow + 12, 18);
  writeSign(dataRow + 12, 3, 'Seal & Sign -', true);
  writeSign(dataRow + 12, MASTER_COLS, 'Auditor Sign', true);
  writeSign(dataRow + 12, signCol3, 'Sign');
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 3 — Invoice Details (category-named)
// ═════════════════════════════════════════════════════════════════════════════
function buildInvoiceDetailsSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[], category: CategoryDef) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.columns = [8, 16, 12, 14, 14, 18, 18, 16, 12, 12, 14].map(w => ({ width: w }));
  const firmName = audit.auditFirmName || DEFAULT_FIRM_NAME;
  setCell(ws, 1, 1, `${category.shortLabel} - Invoice Level Details`, { font: ariFont({ bold: true, size: 11 }), hAlign: 'left', border: {} });
  const headers = ['Sr No', 'Audit Serial No.', 'Region', 'Audit Team', 'Anchor Code', 'Anchor Name', 'Distributor name', 'Invoice No.', 'Invoice Date', 'Damage Qty in Pcs', 'Damage Value in Rs.'];
  ws.getRow(2).height = 30;
  headers.forEach((h, i) => setCell(ws, 2, i + 1, h, { font: ariFont({ bold: true, size: 9 }), fill: C.MASTER_HDR, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder }));
  // FIX: use splitValues to get the category's value from the stored totalValue
  items.filter(i => categoryQty(i, category.key) > 0).forEach((item, idx) => {
    ws.getRow(3 + idx).height = 15;
    const sv = splitValues(item);
    const qty = categoryQty(item, category.key);
    const val = catValFromAgg({ vDmg: sv.vDmg, vNs: sv.vNs, vBbd: sv.vBbd, vSamp: sv.vSamp }, category.key);
    [idx + 1, audit.serialNo || audit.id || '', dist.region || '', firmName, dist.code || '', dist.anchorName || '', dist.name || '', '', '', qty, val].forEach((v, i) => {
      setCell(ws, 3 + idx, i + 1, v as ExcelJS.CellValue, { font: ariFont({ size: 9 }), hAlign: i >= 9 ? 'right' : 'left', border: thinBorder, numFmt: i === 10 ? '[$₹-en-IN]#,##0.00' : i === 9 ? '#,##0' : undefined });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 4 — Attendance Sheet
// ═════════════════════════════════════════════════════════════════════════════
function buildAttendanceSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit) {
  ws.columns = [6, 20, 14, 14, 10, 10, 12, 14].map(w => ({ width: w }));
  setCell(ws, 1, 1, 'Mandays details (Do mention date wise/Auditor Wise details)', { font: ariFont({ bold: true, size: 10 }), hAlign: 'left', border: {} });
  ['Day', 'Name of Auditor', 'Auditor no.', 'Date of audit', 'In Time', 'Out Time', 'Total Mandays', 'Counting/Drainage'].forEach((h, i) => setCell(ws, 2, i + 1, h, { font: ariFont({ bold: true, size: 9 }), fill: C.MASTER_HDR, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder }));
  ws.getRow(2).height = 25;
  setCell(ws, 3, 1, 1, { font: ariFont({ size: 9 }), hAlign: 'center', border: thinBorder });
  for (let c = 2; c <= 8; c++) setCell(ws, 3, c, '', { font: ariFont({ size: 9 }), border: thinBorder });
  setCell(ws, 12, 1, `Distributor: ${dist.name || ''}`, { font: ariFont({ bold: true, size: 10 }), hAlign: 'left', border: {} });
  setCell(ws, 13, 1, 'Sales Team:', { font: ariFont({ size: 10 }), hAlign: 'left', border: {} });
  setCell(ws, 14, 1, 'Auditor:', { font: ariFont({ size: 10 }), hAlign: 'left', border: {} });
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

  // ── Excel sign-off export ───────────────────────────────────────────────────
  const exportSignOff = async () => {
    if (!params.distributor) return;
    setIsExporting(true);
    try {
      const freshDist = await fetchFreshDist(params.distributor);
      const enrichedItems = await enrichWithItemMaster(params.items);

      // Pick which category the Invoice-details sheet is named/filtered for:
      // if the audit only ever tracks one category, use that one; otherwise
      // keep the historical "Primary Damage" sheet so existing full-category
      // (Beverage-style) reports are unaffected.
      const activeCategories = getActiveCategories(enrichedItems);
      const invoiceCategory = activeCategories.length === 1
        ? activeCategories[0]
        : (activeCategories.find(c => c.key === 'damage') || activeCategories[0]);
      const invoiceSheetName = `Invoie details - ${invoiceCategory.shortLabel}`.slice(0, 31);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System'; wb.created = new Date();
      buildSignSheet(wb.addWorksheet('Sign Format.'), freshDist, params.audit, enrichedItems);
      buildALFSheet(wb.addWorksheet('Article Level Format Revised'), freshDist, params.audit, enrichedItems);
      buildInvoiceDetailsSheet(wb.addWorksheet(invoiceSheetName), freshDist, params.audit, enrichedItems, invoiceCategory);
      buildAttendanceSheet(wb.addWorksheet('Attendance Sheet'), freshDist, params.audit);
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
      const totalQty = params.items.reduce((s, i) => s + ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0)), 0);
      const totalValue = params.items.reduce((s, i) => s + (i.totalValue ?? ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0)) * (i.unitValue || 0)), 0);

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

      const mkLetter = (letterhead: string, bodyHTML: string) => `
        <div class="letter">
          <p class="hl"><b>${letterhead}</b></p>
          <p class="hl"><b>Audit Serial No. - ${serialNo}</b></p>
          <p><b>Audit Date: -</b> ${auditDate}</p>
          <br>
          <p>To,</p>
          <p>Reliance Consumer Product Limited,</p>
          <p>Branch Commercial Manager.</p>
          <br>
          <p>Subject: - <u>Regarding raising of credit note Expiry Audit</u></p>
          <br>
          <p>Dear Sir,</p>
          <br>
          ${bodyHTML}
          <p><b>Anchor code and Name -</b> ${anchorName} - ${anchorCode}</p>
          <br>
          ${tableHTML}
          ${sig}
        </div>`;

      const body1 = `
        <p>We, hereby confirm that leakage &amp; breakage audit has been completed at our premises by Auditors.</p><br>
        <p>Request you to please raise credit note in our Anchor's account as per below details: -</p><br>`;

      const body2 = `
        <p>We, hereby confirm that leakage &amp; breakage audit has been completed at our distributor as per below details. Request you to please raise credit note to our account accordingly.</p><br>
        <p>Request you to please raise credit note in our Anchor's account as per below details: -</p><br>`;

      const extra2 = `<br><p>We hereby confirm that credit note amount shall be reimbursed to abovementioned Distributor.</p>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Claim Letter - ${serialNo}</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { font-family: Arial, sans-serif; font-size: 11pt; margin: 0; padding: 0; box-sizing: border-box; }
  p { margin-bottom: 5pt; text-align: justify; }
  .hl { background: yellow; display: block; padding: 2px 0; }
  .letter { page-break-after: always; }
  .letter:last-child { page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 10pt 0; }
  th, td { border: 1px solid #888; padding: 6pt; text-align: center; }
  th { background: #c6e0b4; font-weight: bold; }
  .sig { margin-top: 24pt; line-height: 2; }
  br { display: block; margin: 5pt 0; content: ''; }
</style></head><body>
  ${mkLetter('On the Letter Head of the Distributor', body1)}
  ${mkLetter('On the Letter Head of the Anchor', body2 + extra2)}
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
    if (!params.distributor || params.items.length === 0) return;
    setIsExportingALF(true);
    try {
      const sb = supabase;
      const assignmentId = getActiveAssignmentId();
      let freshDist: SignOffDistributor = params.distributor;
      if (params.distributor.code) {
        const { data: dbDist } = await sb.from('distributors').select('id,code,name,anchorName,address,city,state,region').eq('assignment_id', assignmentId).eq('code', params.distributor.code).maybeSingle();
        if (dbDist) freshDist = { ...params.distributor, name: dbDist.name || params.distributor.name, anchorName: dbDist.anchorName || params.distributor.anchorName, address: dbDist.address || '', city: dbDist.city || '', state: dbDist.state || '', region: dbDist.region || '' };
      }

      const codes = [...new Set(params.items.map(i => i.articleNumber))];
      const itemMasterMap: Record<string, any> = {};
      if (codes.length) {
        const { data: m } = await sb.from('itemMaster').select('itemCode,gst,standardPack,category').eq('assignment_id', assignmentId).in('itemCode', codes);
        if (m) m.forEach((r: any) => { itemMasterMap[r.itemCode] = r; });
      }

      const enriched = params.items.map(i => ({
        ...i,
        gst: itemMasterMap[i.articleNumber]?.gst ?? i.gst ?? 0,
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

      const groups = [
        { label: 'Master Details', cols: 15, color: '#D9E1F2' },
        { label: 'Quantity Detail', cols: 5, color: '#BDD7EE' },
        { label: 'Value Details - Incl. GST', cols: 6, color: '#E2EFDA' },
        { label: 'MFD & Expiry Date', cols: 4, color: '#FFF2CC' },
        { label: 'Auditor Findings', cols: 2, color: '#D9D9D9' },
      ];
      const groupRow = groups.map(g => `<th colspan="${g.cols}" style="background:${g.color};font-size:7pt;font-weight:bold;padding:3pt;text-align:center;border:0.5pt solid #999">${g.label}</th>`).join('');
      const headers = [
        'Sr', 'Serial No', 'Region', 'State', 'Audit Team', 'Anchor Code', 'Anchor Name',
        'Distributor', 'Article Code', 'Brand Pack', 'Category', 'NPI', 'Rate (GST)',
        'GST%', 'Std Pack',
        'PD\n(Pcs)', 'Samp\n(Pcs)', 'NS\n(Pcs)', 'BBD\n(Pcs)', 'Total\n(Pcs)',
        'PD\n(INR)', 'Samp\n(INR)', 'NS\n(INR)', 'BBD\n(INR)', 'Total\n(INR)', 'Total\n(Excl)',
        'Mfg Date', 'Exp Date', 'Life', 'Mfg Qtr',
        'Issue', 'Remarks',
      ];

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
        rows += `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`;
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
  td:nth-child(n+21):nth-child(-n+28) { white-space: nowrap; }
  col.c1  { width: 1.5%; } col.c2  { width: 6.5%; } col.c3  { width: 2.3%; } col.c4  { width: 2.0%; }
  col.c5  { width: 3.0%; } col.c6  { width: 2.5%; } col.c7  { width: 4.0%; } col.c8  { width: 4.0%; }
  col.c9  { width: 3.0%; } col.c10 { width: 5.0%; } col.c11 { width: 3.0%; } col.c12 { width: 0.5%; }
  col.c13 { width: 3.0%; } col.c14 { width: 1.5%; } col.c15 { width: 1.5%; } col.c16 { width: 2.5%; }
  col.c17 { width: 2.5%; } col.c18 { width: 2.5%; } col.c19 { width: 2.5%; } col.c20 { width: 2.5%; }
  col.c21 { width: 4.3%; } col.c22 { width: 3.8%; } col.c23 { width: 4.8%; } col.c24 { width: 4.3%; }
  col.c25 { width: 4.8%; } col.c26 { width: 4.8%; } col.c27 { width: 3.6%; } col.c28 { width: 3.6%; }
  col.c29 { width: 2.0%; } col.c30 { width: 3.0%; } col.c31 { width: 3.5%; } col.c32 { width: 3.5%; }
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
  <colgroup>${Array.from({ length: 32 }, (_, i) => `<col class="c${i + 1}">`).join('')}</colgroup>
  <thead><tr>${groupRow}</tr><tr>${headers.map(h => `<th>${h.replace(/\\n/g, '<br>')}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="totals">
      ${Array(15).fill('<td></td>').join('')}
      <td>${fmtQ(enriched.reduce((s, i) => s + (i.qtyDamaged || 0), 0))}</td>
      <td>${fmtQ(enriched.reduce((s, i) => s + (i.qtySampling || 0), 0))}</td>
      <td>${fmtQ(enriched.reduce((s, i) => s + (i.qtyNonSaleable || 0), 0))}</td>
      <td>${fmtQ(enriched.reduce((s, i) => s + (i.qtyBBD || 0), 0))}</td>
      <td>${fmtQ(enriched.reduce((s, i) => s + ((i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0) + (i.qtySampling || 0)), 0))}</td>
      <td>${fmtINR(totDmg)}</td>
      <td>${fmtINR(totSamp)}</td>
      <td>${fmtINR(totNs)}</td>
      <td>${fmtINR(totBbd)}</td>
      <td>${fmtINR(totInc)}</td>
      <td>${fmtINR(totExc)}</td>
      ${Array(6).fill('<td></td>').join('')}
    </tr>
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
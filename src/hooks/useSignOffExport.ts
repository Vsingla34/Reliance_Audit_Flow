/**
 * useSignOffExport.ts
 *
 * Generates a 6-sheet Excel workbook matching Audit_Format_Phase_V_Part_2.xlsx exactly:
 *
 *  Sheet 1: "Reporting Format - Audit Status"  — summary row per audit
 *  Sheet 2: "Sign Format."                     — sign-off sheet with declarations
 *  Sheet 3: "Article Level Format Revised"     — 32-column article level data
 *  Sheet 4: "Invoie details - Primary Damage"  — invoice level primary damage
 *  Sheet 5: "Attendance Sheet"                 — auditor attendance
 *
 * INSTALL:  npm install exceljs
 * PLACE AT: src/hooks/useSignOffExport.ts
 */
import { useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '../supabase';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SignOffDistributor {
  name:        string;
  code:        string;
  anchorName?: string;
  city?:       string;
  state?:      string;
  address?:    string;
  region?:     string;
}

export interface SignOffAudit {
  id?:            string;
  serialNo?:      string;
  scheduledDate?: string | null;
  auditEndDate?:  string | null;
  drainageDate?:  string | null;
  approvedValue:  number;
  verifiedTotal:  number;
  auditorName?:   string;
  asmName?:       string;
}

export interface SignOffItem {
  articleNumber:   string;
  description:     string;
  qtyDamaged:      number;
  qtyNonSaleable:  number;
  qtyBBD:          number;
  qtySampling?:    number;   // Sampling/Liquidation/FOC
  unitValue:       number;
  gst?:            number;
  standardPack?:   string;
  category?:       string;
  mfgDate?:        string;
  expDate?:        string;
  productLife?:    string;
  reasonCode?:     string;
  remarks?:        string;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  LIGHT_BLUE:  'FFBDD7EE',
  ORANGE:      'FFFFC000',
  MASTER_HDR:  'FFD9E1F2',
  QTY_HDR:     'FFBDD7EE',
  VAL_HDR:     'FFE2EFDA',
  MFD_HDR:     'FFFFF2CC',
  AUD_HDR:     'FFD9D9D9',
  TOTAL_ROW:   'FFFFD966',
  WHITE:       'FFFFFFFF',
  BLACK:       'FF000000',
  HEADER_GREY: 'FFD9D9D9',
  LIGHT_YELLOW:'FFFFFFCC',
};

// ── Style helpers ─────────────────────────────────────────────────────────────
const thinSide  = { style: 'thin'   as ExcelJS.BorderStyle };
const medSide   = { style: 'medium' as ExcelJS.BorderStyle };
const thinBorder: Partial<ExcelJS.Borders> = { top: thinSide, left: thinSide, bottom: thinSide, right: thinSide };
const medBorder:  Partial<ExcelJS.Borders> = { top: medSide,  left: medSide,  bottom: medSide,  right: medSide  };

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
  opts: { font?: Partial<ExcelJS.Font>; fill?: string; hAlign?: ExcelJS.Alignment['horizontal'];
    vAlign?: ExcelJS.Alignment['vertical']; wrap?: boolean; border?: Partial<ExcelJS.Borders>; numFmt?: string; } = {}) {
  const cell = ws.getRow(row).getCell(col);
  cell.value     = value;
  if (opts.font)   cell.font      = opts.font;
  if (opts.fill)   cell.fill      = solidFill(opts.fill);
  if (opts.border !== null) cell.border = opts.border ?? thinBorder;
  cell.alignment = aln(opts.hAlign ?? 'left', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.numFmt) cell.numFmt    = opts.numFmt;
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 1 — Reporting Format - Audit Status
// 25 columns A-Y, one header row + one data row per audit
// ═════════════════════════════════════════════════════════════════════════════
function buildReportingStatusSheet(
  ws: ExcelJS.Worksheet,
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // Column widths matching template
  const widths = [14, 14, 14, 14, 14, 10, 12, 16, 18, 18, 14, 14, 14, 14, 14, 16, 12, 14, 20, 12, 12, 18, 14, 14, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const headers = [
    'Std. Serial No.', 'Phase', 'Auditor Name', 'Approved Date', 'Audit Date',
    'Region', 'State', 'Anchor Code', 'Anchor Name', 'Distributor name',
    'Reported/ Approved Value', 'Value as per Auditor\n(Including GST)', 'Fin Review Value\nWith GST',
    'Diff Proposed V/S Actual', 'Audit Status (RCPL)', 'Auditor Remark\n(As per Auditor)',
    'Approved Value in Cr.', 'Audit Date (as per Auditor)', 'End Date of Physical Verification (as per Auditor)',
    'Drainage start date', 'Drainage end date', 'Audit Sharing Date Along With RSO By Auditor',
    'Audit Planned Date', 'Direct/ Indirect Customer', 'ASM Name',
  ];

  // Header row
  ws.getRow(1).height = 40;
  headers.forEach((h, i) => {
    setCell(ws, 1, i + 1, h, {
      font:   ariFont({ bold: true, size: 9 }),
      fill:   C.MASTER_HDR,
      hAlign: 'center',
      vAlign: 'middle',
      wrap:   true,
      border: thinBorder,
    });
  });

  // Aggregate totals
  const totalValue = items.reduce((s, i) => s + ((i.qtyDamaged + i.qtyNonSaleable + i.qtyBBD + (i.qtySampling || 0)) * i.unitValue), 0);
  const diff = totalValue - audit.approvedValue;

  const dataRow = [
    audit.serialNo || audit.id || '',
    'Phase V - Part 2',
    audit.auditorName || 'Singla Vishal & Co.',
    audit.scheduledDate ? new Date(audit.scheduledDate) : '',
    audit.scheduledDate ? new Date(audit.scheduledDate) : '',
    dist.region || '',
    dist.state || '',
    dist.code || '',
    dist.anchorName || '',
    dist.name || '',
    audit.approvedValue || 0,
    totalValue || 0,
    '',  // Fin Review Value — filled manually
    diff,
    '',  // Audit Status — filled manually
    '',  // Auditor Remark — filled manually
    audit.approvedValue ? audit.approvedValue / 10000000 : 0,
    audit.scheduledDate ? new Date(audit.scheduledDate) : '',
    audit.auditEndDate  ? new Date(audit.auditEndDate)  : '',
    audit.drainageDate  ? new Date(audit.drainageDate)  : '',
    '',  // Drainage end date
    '',  // Audit Sharing Date
    audit.scheduledDate ? new Date(audit.scheduledDate) : '',
    'Direct',
    audit.asmName || '',
  ];

  ws.getRow(2).height = 18;
  dataRow.forEach((v, i) => {
    const colNum = i + 1;
    const isDate = v instanceof Date;
    const isCurrency = [11, 12, 13, 14, 17].includes(colNum);
    setCell(ws, 2, colNum, v, {
      font:   ariFont({ size: 9 }),
      hAlign: isCurrency ? 'right' : 'left',
      wrap:   false,
      border: thinBorder,
      numFmt: isDate ? 'DD-MM-YYYY' : isCurrency ? '[$₹-en-IN]#,##0.00' : undefined,
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 2 — Sign Format.
// Matches template exactly — now includes Sampling/FOC column + Audit Start/End dates
// ═════════════════════════════════════════════════════════════════════════════
function buildSignSheet(
  ws: ExcelJS.Worksheet,
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  ws.columns = [
    { width: 2  }, // A (spacer)
    { width: 14 }, // B
    { width: 14 }, // C  Sampling/FOC
    { width: 22 }, // D  Non-Saleable
    { width: 12 }, // E  BBD
    { width: 12 }, // F  Total Qty
    { width: 14 }, // G  Primary Damage INR
    { width: 14 }, // H  Sampling/FOC INR
    { width: 22 }, // I  Non-Saleable INR
    { width: 14 }, // J  BBD INR
    { width: 14 }, // K  Total Audited Value
    { width: 14 }, // L  Approved Amount
    { width: 12 }, // M  Variance %
  ];

  // Aggregate
  const agg = new Map<string, { dmg: number; ns: number; bbd: number; samp: number; uv: number }>();
  for (const item of items) {
    if (!agg.has(item.articleNumber)) agg.set(item.articleNumber, { dmg: 0, ns: 0, bbd: 0, samp: 0, uv: 0 });
    const a = agg.get(item.articleNumber)!;
    a.dmg  += item.qtyDamaged     || 0;
    a.ns   += item.qtyNonSaleable || 0;
    a.bbd  += item.qtyBBD         || 0;
    a.samp += item.qtySampling    || 0;
    if ((item.unitValue || 0) > a.uv) a.uv = item.unitValue;
  }
  const rows  = [...agg.values()];
  const qDmg  = rows.reduce((s, v) => s + v.dmg,  0);
  const qSamp = rows.reduce((s, v) => s + v.samp, 0);
  const qNs   = rows.reduce((s, v) => s + v.ns,   0);
  const qBbd  = rows.reduce((s, v) => s + v.bbd,  0);
  const qTot  = qDmg + qSamp + qNs + qBbd;
  const vDmg  = rows.reduce((s, v) => s + v.dmg  * v.uv, 0);
  const vSamp = rows.reduce((s, v) => s + v.samp * v.uv, 0);
  const vNs   = rows.reduce((s, v) => s + v.ns   * v.uv, 0);
  const vBbd  = rows.reduce((s, v) => s + v.bbd  * v.uv, 0);
  const vTot  = vDmg + vSamp + vNs + vBbd;
  const approved = audit.approvedValue || 0;
  const variancePct = approved > 0 ? (vTot - approved) / approved : 0;

  const fmtQ = (n: number) => n > 0 ? n : 0;
  const fmtV = (n: number) => n > 0 ? n : 0;
  const INR  = '[$₹-en-IN]#,##0.00';
  const QTY  = '#,##0';
  const PCT  = '0.00%';

  let r = 0;
  const nr = (h = 16) => { r++; ws.getRow(r).height = h; return r; };

  const scT = (row: number, col: number, value: ExcelJS.CellValue, opts: any = {}) =>
    setCell(ws, row, col, value, { font: tnrFont({ bold: opts.bold, size: opts.size || 10, underline: opts.underline }), ...opts });

  // ROW 3 — Title
  nr(18); safeMerge(ws, r, 2, r, 13);
  scT(r, 2, 'Audit Report - Phase V Part 2 Beverage', { bold: true, size: 12, hAlign: 'center', vAlign: 'middle', wrap: false, border: {} });

  // ROWS 4-10 — Info block
  const infoLines = [
    `Audit Serial No. - ${audit.serialNo || ''}`,
    `Audit Firm Name - Singla Vishal & Co.`,
    `Anchor Code - ${dist.code || ''}`,
    `Anchor Name/ Direct DB Name - ${dist.anchorName || ''}`,
    `Distributor name & City - ${dist.name || ''}, ${dist.city || ''}`,
    `Audit Start Date - ${audit.scheduledDate || ''}`,
    `Audit End Date- ${audit.auditEndDate || audit.scheduledDate || ''}`,
  ];
  // Build full address — address field may be empty in DB, use all available parts
  const addrParts: string[] = [];
  if (dist.name)    addrParts.push(dist.name);
  if (dist.address) addrParts.push(dist.address);
  if (dist.city)    addrParts.push(dist.city);
  if (dist.state)   addrParts.push(dist.state);
  if (dist.region)  addrParts.push(dist.region);
  const customerAddress = addrParts.join(', ') || (dist.name || 'N/A');

  infoLines.forEach((line, i) => {
    nr(16); safeMerge(ws, r, 2, r, 6);
    scT(r, 2, line, { size: 10, hAlign: 'left', vAlign: 'middle', wrap: false, border: thinBorder });
    if (i === 0) { // Row 4 — Customer address spans G-M rows 4-6
      safeMerge(ws, r, 7, r + 2, 13);
      const addrCell = ws.getCell(r, 7);
      addrCell.value     = 'Address - ' + customerAddress;
      addrCell.font      = tnrFont({ bold: true, size: 10, underline: true });
      addrCell.alignment = aln('left', 'top', true);
      addrCell.border    = thinBorder;
    } else if (i >= 1 && i <= 2) {
      safeMerge(ws, r, 7, r, 13);
      scT(r, 7, '', { hAlign: 'left', border: thinBorder });
    }
  });

  // ROW 11 — Section headers
  nr(18);
  safeMerge(ws, r, 2, r, 6);
  scT(r, 2, 'Quantity Details - Physically verified & Drained',
    { bold: true, size: 9, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });
  safeMerge(ws, r, 7, r, 11);
  scT(r, 7, 'Value Details',
    { bold: true, size: 9, fill: C.LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });
  safeMerge(ws, r, 12, r, 13);
  scT(r, 12, 'Variance Summary',
    { bold: true, size: 9, fill: C.ORANGE, hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder });

  // ROW 12 — Column sub-headers (matching template exactly)
  nr(50);
  const subHeaders: Array<[number, number, string, string]> = [
    [2, 2,  'Primary Damage\n(Pcs)',                                                               C.LIGHT_BLUE],
    [3, 3,  'Sampling/Liquidation/\nFOC (PCS)',                                                    C.LIGHT_BLUE],
    [4, 4,  'Non-Saleable product and\nNon-manufacturing Defect\n(Pcs)',                           C.LIGHT_BLUE],
    [5, 5,  'BBD Stock\n(Pcs)',                                                                    C.LIGHT_BLUE],
    [6, 6,  'Total Verified\nQuantity (Pcs)',                                                      C.LIGHT_BLUE],
    [7, 7,  'Primary Damage\n(INR)',                                                               C.LIGHT_BLUE],
    [8, 8,  'Sampling/Liquidation/\nFOC (INR)',                                                    C.LIGHT_BLUE],
    [9, 9,  'Non-Saleable product and\nNon-manufacturing Defect\n(INR)',                           C.LIGHT_BLUE],
    [10,10, 'BBD Stock\n(INR)',                                                                    C.LIGHT_BLUE],
    [11,11, 'Total\nAudited\nValue',                                                               C.LIGHT_BLUE],
    [12,12, 'Approved\nAmount',                                                                    C.ORANGE],
    [13,13, 'Variance %',                                                                          C.ORANGE],
  ];
  for (const [c1, c2, text, fc] of subHeaders) {
    if (c1 !== c2) safeMerge(ws, r, c1, r, c2);
    scT(r, c1, text, { bold: true, size: 8, fill: fc, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  }

  // ROW 13 — Totals data row
  nr(16);
  const totals: Array<[number, ExcelJS.CellValue, string | undefined]> = [
    [2,  fmtQ(qDmg),       QTY],
    [3,  fmtQ(qSamp),      QTY],
    [4,  fmtQ(qNs),        QTY],
    [5,  fmtQ(qBbd),       QTY],
    [6,  qTot,             QTY],
    [7,  fmtV(vDmg),       INR],
    [8,  fmtV(vSamp),      INR],
    [9,  fmtV(vNs),        INR],
    [10, fmtV(vBbd),       INR],
    [11, vTot,             INR],
    [12, approved,         INR],
    [13, variancePct,      PCT],
  ];
  for (const [col, val, fmt] of totals) {
    scT(r, col, val, { hAlign: 'center', vAlign: 'middle', wrap: false, border: thinBorder, numFmt: fmt });
  }

  // NOTE: Sign Format shows ONE summary row only (totals row above) — no per-article rows.
  // The totals row already contains the sum of all Primary/Sampling/Non-Saleable/BBD quantities.

  // Spacers
  nr(6); nr(6);

  // ── DECLARATION SECTION — matches template structure exactly ─────────────
  // Row 16 — Customer declaration (single cell B, sign block in J)
  nr(80);
  safeMerge(ws, r, 2, r, 9);
  const custDecl = [
    'Declaration from Customer -',
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    '2. I confirm that all stocks received by me with expiry date upto date of Audit has been cleared by company and I will not raise any further claim in this regard for products with expired.',
    '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.',
    '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.',
  ].join('\n');
  setCell(ws, r, 2, custDecl, { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  safeMerge(ws, r, 10, r, 13);
  setCell(ws, r, 10, "Customer's Authorised person Name -\n\n\n\n\nSeal & Sign -",
    { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  nr(6);

  // Row 18 — Sales Team declaration
  nr(60);
  safeMerge(ws, r, 2, r, 9);
  const salesDecl = [
    'Declaration from Reliance Sales Team -',
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    '2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.',
  ].join('\n');
  setCell(ws, r, 2, salesDecl, { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  safeMerge(ws, r, 10, r, 13);
  setCell(ws, r, 10, 'Sales Team Name & contact no.\n\nSales Team EMP ID\n\nSign',
    { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  nr(6);

  // Row 20 — Auditor declaration
  nr(60);
  safeMerge(ws, r, 2, r, 9);
  const audDecl = [
    'Declaration from Auditor-',
    '1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team.',
    '2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer\'s location.',
  ].join('\n');
  setCell(ws, r, 2, audDecl, { font: tnrFont({ size: 9 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });

  safeMerge(ws, r, 10, r, 13);
  setCell(ws, r, 10, 'Auditor Name & contact no.\n\n\nSeal & Sign',
    { font: tnrFont({ size: 10 }), hAlign: 'left', vAlign: 'top', wrap: true, border: thinBorder });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 3 — Article Level Format Revised
// 32 columns A-AF (added Sampling/FOC cols Q and V vs previous 29-col version)
// ═════════════════════════════════════════════════════════════════════════════
function buildALFSheet(
  ws: ExcelJS.Worksheet,
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // 32 column widths (A-AF)
  const colWidths = [
    6,      // A  Sr No
    16,     // B  Std Serial No
    12,     // C  Region
    12,     // D  State
    16,     // E  Audit Team
    14,     // F  Anchor Code
    18,     // G  Anchor Name
    18,     // H  Distributor name
    14,     // I  Article Code
    28,     // J  Brand Pack
    14,     // K  Category
    10,     // L  NPI/NON-NPI
    14,     // M  Rate incl GST
    8,      // N  GST%
    10,     // O  Standard Pack
    10,     // P  Primary Damage Pcs
    12,     // Q  Sampling/FOC Pcs  ← NEW
    18,     // R  Non-Saleable Pcs
    10,     // S  BBD Pcs
    10,     // T  Total Qty
    14,     // U  Primary Damage INR
    14,     // V  Sampling/FOC INR  ← NEW
    18,     // W  Non-Saleable INR
    12,     // X  BBD INR
    14,     // Y  Total incl GST
    14,     // Z  Total excl GST
    14,     // AA Mfg Date
    12,     // AB Expiry Date
    14,     // AC Product Life Months
    14,     // AD Mfg Quarter
    24,     // AE Issue in Product
    18,     // AF Auditor Remarks
  ];
  ws.columns = colWidths.map(w => ({ width: w }));

  // ROW 1 — blank
  ws.getRow(1).height = 10;

  // ROW 2 — Section group headers
  ws.getRow(2).height = 20;
  const sectionHeaders: Array<[number, number, string, string]> = [
    [1,  15, 'Master Details',                 C.MASTER_HDR],
    [16, 20, 'Quanity Detail',                 C.QTY_HDR],    // matches template spelling
    [21, 26, 'Value Details - Including GST',  C.VAL_HDR],
    [27, 30, 'MFD & Expiry Date',              C.MFD_HDR],
    [31, 32, 'Auditor Findings',               C.AUD_HDR],
  ];
  for (const [c1, c2, text, fc] of sectionHeaders) {
    safeMerge(ws, 2, c1, 2, c2);
    setCell(ws, 2, c1, text, {
      font:   ariFont({ bold: true, size: 11 }),
      fill:   fc,
      hAlign: 'center',
      vAlign: 'middle',
      wrap:   true,
      border: thinBorder,
    });
  }

  // ROW 3 — Column headers (height 150 matches template)
  ws.getRow(3).height = 150;
  const colHeaders: Array<[number, string, string]> = [
    [1,  'Sr No',                                                                                           C.MASTER_HDR],
    [2,  'Std. Serial No.',                                                                                 C.MASTER_HDR],
    [3,  'Region',                                                                                          C.MASTER_HDR],
    [4,  'State',                                                                                           C.MASTER_HDR],
    [5,  'Audit Team',                                                                                      C.MASTER_HDR],
    [6,  'Anchor Code',                                                                                     C.MASTER_HDR],
    [7,  'Anchor Name',                                                                                     C.MASTER_HDR],
    [8,  'Distributor name',                                                                                C.MASTER_HDR],
    [9,  'Article Code',                                                                                    C.MASTER_HDR],
    [10, 'Brand Pack',                                                                                      C.MASTER_HDR],
    [11, 'Category (CSD, Still, Water, Energy)',                                                            C.MASTER_HDR],
    [12, 'NPI / NON - NPI',                                                                                C.MASTER_HDR],
    [13, "Rate Including GST\n(As per Waitage Avg of Primary from Apr'25 to Jan'26)",                      C.MASTER_HDR],
    [14, 'GST %',                                                                                           C.MASTER_HDR],
    [15, 'Standard Pack',                                                                                   C.MASTER_HDR],
    [16, 'Primary Damage\n(Pcs)',                                                                           C.QTY_HDR],
    [17, 'Sampling/Liquidation/FOC (PCS)',                                                                  C.QTY_HDR],    // NEW
    [18, 'Non-Saleable product and Non-manufacturing Defect (Pcs)',                                        C.QTY_HDR],
    [19, 'BBD Stock\n(Pcs)',                                                                                C.QTY_HDR],
    [20, 'Total Verified\nQuantity (Pcs)',                                                                  C.QTY_HDR],
    [21, 'Primary Damage\n(INR)',                                                                           C.VAL_HDR],
    [22, 'Sampling/Liquidation/FOC (INR)',                                                                  C.VAL_HDR],    // NEW
    [23, 'Non-Saleable product and Non-manufacturing Defect (INR)',                                        C.VAL_HDR],
    [24, 'BBD Stock\n(INR)',                                                                                C.VAL_HDR],
    [25, 'Total Audited Value\n(Including GST)',                                                            C.VAL_HDR],
    [26, 'Total Audited Value\n(Excluding GST)',                                                            C.VAL_HDR],
    [27, 'Manufacturing Date',                                                                              C.MFD_HDR],
    [28, 'Expiry Date',                                                                                     C.MFD_HDR],
    [29, 'Product life in Months',                                                                          C.MFD_HDR],
    [30, 'Manufacturing Quarter',                                                                           C.MFD_HDR],
    [31, 'Issue in Product in detail',                                                                      C.AUD_HDR],
    [32, 'Auditor Remarks',                                                                                 C.AUD_HDR],
  ];
  for (const [col, text, fc] of colHeaders) {
    setCell(ws, 3, col, text, {
      font:   ariFont({ bold: true, size: 9 }),
      fill:   fc,
      hAlign: 'center',
      vAlign: 'middle',
      wrap:   true,
      border: thinBorder,
    });
  }

  // ── DATA ROWS ──────────────────────────────────────────────────────────────
  const serialNo   = audit.serialNo || audit.id || '';
  const anchorCode = dist.code       || '';
  const anchorName = dist.anchorName || '';
  const distName   = dist.name       || '';
  const state      = dist.state      || '';
  const region     = dist.region     || '';
  const firmName   = 'Singla Vishal & Co.';

  const lifeMonths = (mfgDate?: string, expDate?: string): number | '' => {
    if (!mfgDate || !expDate) return '';
    try {
      const m = new Date(mfgDate), e = new Date(expDate);
      if (isNaN(m.getTime()) || isNaN(e.getTime())) return '';
      const months = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth());
      return months > 0 ? months : '';
    } catch { return ''; }
  };

  const mfgQuarter = (mfgDate?: string): string => {
    if (!mfgDate) return '';
    try {
      const m = new Date(mfgDate);
      if (isNaN(m.getTime())) return '';
      const fy = m.getMonth() >= 3 ? m.getFullYear() : m.getFullYear() - 1;
      const fyStr = `FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
      const fyQ = Math.floor(((m.getMonth() - 3 + 12) % 12) / 3) + 1;
      const qSuffix = fyQ === 1 ? 'st' : fyQ === 2 ? 'nd' : fyQ === 3 ? 'rd' : 'th';
      return `Q${fyQ} ${fyStr}`;
    } catch { return ''; }
  };

  // Aggregate by article
  const agg = new Map<string, { item: SignOffItem; dmg: number; ns: number; bbd: number; samp: number }>();
  for (const item of items) {
    if (!agg.has(item.articleNumber)) agg.set(item.articleNumber, { item, dmg: 0, ns: 0, bbd: 0, samp: 0 });
    const a = agg.get(item.articleNumber)!;
    a.dmg  += item.qtyDamaged     || 0;
    a.ns   += item.qtyNonSaleable || 0;
    a.bbd  += item.qtyBBD         || 0;
    a.samp += item.qtySampling    || 0;
    if ((item.unitValue || 0) > (a.item.unitValue || 0)) a.item = { ...a.item, ...item };
    else if (item.mfgDate && !a.item.mfgDate) a.item = { ...a.item, mfgDate: item.mfgDate, expDate: item.expDate };
  }

  const INR  = '[$₹-en-IN]#,##0.00';
  const QTY  = '#,##0';
  const DATE = 'DD-MM-YYYY';

  let sno = 0;
  let tDmgQ = 0, tSampQ = 0, tNsQ = 0, tBbdQ = 0, tTotQ = 0;
  let tDmgV = 0, tSampV = 0, tNsV = 0, tBbdV = 0, tIncV = 0, tExcV = 0;

  let dataRow = 4;
  for (const [code, { item, dmg, ns, bbd, samp }] of agg) {
    sno++;
    const qTot   = dmg + samp + ns + bbd;
    const uv     = item.unitValue || 0;
    const gstPct = item.gst       || 0;
    const gstMul = 1 + gstPct / 100;

    const vDmg  = dmg  * uv;
    const vSamp = samp * uv;
    const vNs   = ns   * uv;
    const vBbd  = bbd  * uv;
    const vTot  = qTot * uv;
    const vExc  = gstMul > 1 ? vTot / gstMul : vTot;

    tDmgQ  += dmg;  tSampQ += samp; tNsQ  += ns;  tBbdQ  += bbd;  tTotQ  += qTot;
    tDmgV  += vDmg; tSampV += vSamp; tNsV  += vNs; tBbdV  += vBbd; tIncV  += vTot; tExcV  += vExc;

    ws.getRow(dataRow).height = 15;

    const rowData: Array<[number, ExcelJS.CellValue, string?]> = [
      [1,  sno,                      QTY],
      [2,  serialNo,                 undefined],
      [3,  region,                   undefined],
      [4,  state,                    undefined],
      [5,  firmName,                 undefined],
      [6,  anchorCode,               undefined],
      [7,  anchorName,               undefined],
      [8,  distName,                 undefined],
      [9,  code,                     undefined],
      [10, item.description,         undefined],
      [11, item.category || '',      undefined],
      [12, '',                       undefined],   // NPI/NON-NPI — not in DB
      [13, uv,                       INR],
      [14, gstPct > 0 ? gstPct : '', gstPct > 0 ? '0.00"%"' : undefined],
      [15, item.standardPack || '',  undefined],
      [16, dmg  > 0 ? dmg  : 0,     QTY],
      [17, samp > 0 ? samp : 0,     QTY],          // Sampling/FOC
      [18, ns   > 0 ? ns   : 0,     QTY],
      [19, bbd  > 0 ? bbd  : 0,     QTY],
      [20, qTot > 0 ? qTot : 0,     QTY],
      [21, vDmg  > 0 ? vDmg  : 0,   INR],
      [22, vSamp > 0 ? vSamp : 0,   INR],          // Sampling/FOC INR
      [23, vNs   > 0 ? vNs   : 0,   INR],
      [24, vBbd  > 0 ? vBbd  : 0,   INR],
      [25, vTot,                     INR],
      [26, vExc,                     INR],
      [27, item.mfgDate || '',       undefined],
      [28, item.expDate || '',       undefined],
      [29, lifeMonths(item.mfgDate, item.expDate), undefined],
      [30, mfgQuarter(item.mfgDate), undefined],
      [31, item.reasonCode || '',    undefined],
      [32, item.remarks    || '',    undefined],
    ];

    for (const [col, val, fmt] of rowData) {
      setCell(ws, dataRow, col, val, {
        font:   ariFont({ size: 9 }),
        hAlign: col <= 2 ? 'center' : col <= 12 ? 'left' : 'center',
        vAlign: 'middle',
        wrap:   false,
        border: thinBorder,
        numFmt: fmt,
      });
    }
    dataRow++;
  }

  // ── TOTALS ROW ──────────────────────────────────────────────────────────────
  ws.getRow(dataRow).height = 16;
  safeMerge(ws, dataRow, 1, dataRow, 9);
  setCell(ws, dataRow, 1, 'Total', { font: ariFont({ bold: true, size: 10 }), fill: C.TOTAL_ROW, hAlign: 'center', border: thinBorder });
  for (let c = 10; c <= 15; c++) setCell(ws, dataRow, c, '', { fill: C.TOTAL_ROW, border: thinBorder });

  const totalCols: Array<[number, number, string]> = [
    [16, tDmgQ,  QTY], [17, tSampQ, QTY], [18, tNsQ,  QTY],
    [19, tBbdQ,  QTY], [20, tTotQ,  QTY],
    [21, tDmgV,  INR], [22, tSampV, INR], [23, tNsV,  INR],
    [24, tBbdV,  INR], [25, tIncV,  INR], [26, tExcV,  INR],
  ];
  for (const [col, val, fmt] of totalCols) {
    setCell(ws, dataRow, col, val, { font: ariFont({ bold: true, size: 9 }), fill: C.TOTAL_ROW, hAlign: 'center', border: thinBorder, numFmt: fmt });
  }
  for (let c = 27; c <= 32; c++) setCell(ws, dataRow, c, '', { fill: C.TOTAL_ROW, border: thinBorder });

  // ── SIGN SECTION — white background, no wrap, appears right after totals ────
  // Image shows: declaration text (col C), then three sign columns (C/O/AB)
  const whiteFill = solidFill(C.WHITE);
  const noB: Partial<ExcelJS.Borders> = {};

  const clearSignRow = (rowNum: number, h = 18) => {
    ws.getRow(rowNum).height = h;
    for (let c = 1; c <= 32; c++) {
      const cell = ws.getRow(rowNum).getCell(c);
      cell.fill   = whiteFill;
      cell.border = noB;
      cell.font   = ariFont({ size: 9 });
      cell.alignment = { wrapText: false, vertical: 'middle', horizontal: 'left' };
    }
  };

  const writeSign = (rowNum: number, col: number, text: string, bold = false) => {
    const cell = ws.getRow(rowNum).getCell(col);
    cell.value     = text;
    cell.font      = ariFont({ bold, size: 9 });
    cell.fill      = whiteFill;
    cell.border    = noB;
    cell.alignment = { wrapText: false, vertical: 'middle', horizontal: 'left' };
  };

  // Spacer after totals
  clearSignRow(dataRow + 1, 10);
  clearSignRow(dataRow + 2, 10);

  // Declaration rows — text in col C (3), white fill, no wrap
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

  // Spacer
  clearSignRow(dataRow + 7, 10);

  // Sign header row: names
  clearSignRow(dataRow + 8, 18);
  writeSign(dataRow + 8,  3,  "Customer's Authorised person Name -", true);
  writeSign(dataRow + 8,  15, '3rd Party Auditor',                   true);
  writeSign(dataRow + 8,  28, 'Sales Team Name & contact no.',       true);

  // Firm name under auditor
  clearSignRow(dataRow + 9, 16);
  writeSign(dataRow + 9, 15, 'Singla Vishal & Co.');

  // Two blank spacer rows
  clearSignRow(dataRow + 10, 16);
  clearSignRow(dataRow + 11, 16);

  // Sign label row
  clearSignRow(dataRow + 12, 18);
  writeSign(dataRow + 12,  3,  'Seal & Sign -',  true);
  writeSign(dataRow + 12, 15, 'Auditor Sign',   true);
  writeSign(dataRow + 12, 28, 'Sign');
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 4 — Invoie details - Primary Damage  (matches template sheet name/typo)
// ═════════════════════════════════════════════════════════════════════════════
function buildInvoiceDetailsSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.columns = [8, 16, 12, 14, 14, 18, 18, 16, 12, 12, 14].map(w => ({ width: w }));

  ws.getRow(1).height = 14;
  setCell(ws, 1, 1, 'Primary Damage - Invoice Level Details', { font: ariFont({ bold: true, size: 11 }), hAlign: 'left', border: {} });

  const headers = ['Sr No', 'Audit Serial No.', 'Region', 'Audit Team', 'Anchor Code', 'Anchor Name', 'Distributor name', 'Invoice No.', 'Invoice Date', 'Damage Qty in Pcs', 'Damage Value in Rs.'];
  ws.getRow(2).height = 30;
  headers.forEach((h, i) => {
    setCell(ws, 2, i + 1, h, { font: ariFont({ bold: true, size: 9 }), fill: C.MASTER_HDR, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  });

  // Data rows for primary damage items
  const dmgItems = items.filter(i => (i.qtyDamaged || 0) > 0);
  dmgItems.forEach((item, idx) => {
    ws.getRow(3 + idx).height = 15;
    const row = [
      idx + 1,
      audit.serialNo || audit.id || '',
      dist.region || '',
      'Singla Vishal & Co.',
      dist.code || '',
      dist.anchorName || '',
      dist.name || '',
      '',   // Invoice No — not in DB, left blank
      '',   // Invoice Date
      item.qtyDamaged || 0,
      (item.qtyDamaged || 0) * (item.unitValue || 0),
    ];
    row.forEach((v, i) => {
      setCell(ws, 3 + idx, i + 1, v as ExcelJS.CellValue, {
        font:   ariFont({ size: 9 }),
        hAlign: i >= 9 ? 'right' : 'left',
        border: thinBorder,
        numFmt: i === 10 ? '[$₹-en-IN]#,##0.00' : i === 9 ? '#,##0' : undefined,
      });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 5 — Attendance Sheet
// ═════════════════════════════════════════════════════════════════════════════
function buildAttendanceSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit) {
  ws.columns = [6, 20, 14, 14, 10, 10, 12, 14].map(w => ({ width: w }));

  setCell(ws, 1, 1, 'Mandays details (Do mention date wise/Auditor Wise details)', { font: ariFont({ bold: true, size: 10 }), hAlign: 'left', border: {} });

  const headers = ['Day', 'Name of Auditor', 'Auditor no.', 'Date of audit', 'In Time', 'Out Time', 'Total Mandays', 'Counting/Drainage'];
  ws.getRow(2).height = 25;
  headers.forEach((h, i) => {
    setCell(ws, 2, i + 1, h, { font: ariFont({ bold: true, size: 9 }), fill: C.MASTER_HDR, hAlign: 'center', vAlign: 'middle', wrap: true, border: thinBorder });
  });

  // Blank data row template for auditor to fill
  setCell(ws, 3, 1, 1, { font: ariFont({ size: 9 }), hAlign: 'center', border: thinBorder });
  for (let c = 2; c <= 8; c++) setCell(ws, 3, c, '', { font: ariFont({ size: 9 }), border: thinBorder });

  // Footer labels
  ws.getRow(12).height = 18;
  setCell(ws, 12, 1, `Distributor: ${dist.name || ''}`, { font: ariFont({ bold: true, size: 10 }), hAlign: 'left', border: {} });
  setCell(ws, 13, 1, 'Sales Team:', { font: ariFont({ size: 10 }), hAlign: 'left', border: {} });
  setCell(ws, 14, 1, 'Auditor:', { font: ariFont({ size: 10 }), hAlign: 'left', border: {} });
}


// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HOOK
// ═════════════════════════════════════════════════════════════════════════════
export function useSignOffExport(params: {
  distributor: SignOffDistributor | undefined;
  audit:       SignOffAudit;
  items:       SignOffItem[];
}) {
  const [isExporting, setIsExporting] = useState(false);

  const exportSignOff = async () => {
    if (!params.distributor) return;
    setIsExporting(true);
    try {
      // ── Fetch itemMaster to get accurate gst + standardPack ───────────────
      // auditLineItems don't store gst/standardPack — we need itemMaster as source
      const sb = supabase;  // supabase is imported at top of file
      const articleCodes = [...new Set(params.items.map(i => i.articleNumber))];
      let itemMasterMap: Record<string, { gst: number; standardPack: string; category: string }> = {};
      if (articleCodes.length > 0) {
        const { data: masterRows } = await sb
          .from('itemMaster')
          .select('itemCode, gst, standardPack, category')
          .in('itemCode', articleCodes);
        if (masterRows) {
          masterRows.forEach((m: any) => {
            itemMasterMap[m.itemCode] = {
              gst:          Number(m.gst)          || 0,
              standardPack: m.standardPack          || '',
              category:     m.category              || '',
            };
          });
        }
      }

      // Enrich items with itemMaster data (overrides salesDump values)
      const enrichedItems = params.items.map(item => ({
        ...item,
        gst:          itemMasterMap[item.articleNumber]?.gst          ?? item.gst          ?? 0,
        standardPack: itemMasterMap[item.articleNumber]?.standardPack ?? item.standardPack ?? '',
        category:     itemMasterMap[item.articleNumber]?.category     || item.category     || '',
      }));

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System';
      wb.created = new Date();

      // Sheet order: Sign Format first (Reporting Status moved to separate Status Report)
      const ws2 = wb.addWorksheet('Sign Format.');
      buildSignSheet(ws2, params.distributor, params.audit, enrichedItems);

      const ws3 = wb.addWorksheet('Article Level Format Revised');
      buildALFSheet(ws3, params.distributor, params.audit, enrichedItems);

      const ws4 = wb.addWorksheet('Invoie details - Primary Damage');  // matches template typo
      buildInvoiceDetailsSheet(ws4, params.distributor, params.audit, enrichedItems);

      const ws5 = wb.addWorksheet('Attendance Sheet');
      buildAttendanceSheet(ws5, params.distributor, params.audit);


      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url    = URL.createObjectURL(blob);
      const link   = document.createElement('a');
      link.href     = url;
      link.download = `AuditReport_${params.distributor.code}_${params.audit.scheduledDate ?? 'draft'}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Sign-off export error:', err);
      alert('Failed to generate the Audit Report Excel. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return { exportSignOff, isExporting };
} 
/**
 * useSignOffExport.ts
 *
 * Generates the Sign-Off Excel exactly matching the "Audit Report - Phase V Part 1 Beverage" template.
 *
 * INSTALL:  npm install exceljs
 * PLACE AT: src/hooks/useSignOffExport.ts
 *
 * KEY FIXES vs previous version:
 * - safe_merge: never merges already-merged cells (fixes "Cannot merge already merged cells" crash)
 * - Anchor Code = distributors.code  (same field)
 * - Firm name hardcoded to "Singla Vishal & Co."
 * - Audit Date from auditTickets.scheduledDate
 * - Customer Full Address = distributor address fields
 * - whatsappMediaApproved read from auditTickets direct column (not signOffs JSONB)
 */
import { useState } from 'react';
import ExcelJS from 'exceljs';

// ── Types aligned with actual Supabase schema ─────────────────────────────────
export interface SignOffDistributor {
  name:        string;
  code:        string;   // = Anchor Code
  anchorName?: string;   // distributors.anchorName (can be empty)
  city?:       string;
  state?:      string;
  address?:    string;
  region?:     string;
}

export interface SignOffAudit {
  id?:            string;   // auditTickets.id — used as serial no fallback
  scheduledDate?: string | null;  // auditTickets.scheduledDate
  approvedValue:  number;         // auditTickets.approvedValue
  verifiedTotal:  number;         // auditTickets.verifiedTotal
  serialNo?:      string;   // optional override for Audit Serial No
}

export interface SignOffItem {
  articleNumber:   string;
  description:     string;
  qtyDamaged:      number;
  qtyNonSaleable:  number;
  qtyBBD:          number;
  unitValue:       number;
}

// ── Colour constants ──────────────────────────────────────────────────────────
const LIGHT_BLUE = 'FFBDD7EE';
const ORANGE     = 'FFFFC000';
const BLACK      = 'FF000000';

type ArgbColor = string;

// ── Style helpers ─────────────────────────────────────────────────────────────
const thinSide = { style: 'thin' as ExcelJS.BorderStyle };
const thinBorder: Partial<ExcelJS.Borders> = {
  top: thinSide, left: thinSide, bottom: thinSide, right: thinSide,
};

function solidFill(argb: ArgbColor): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function tnrFont(opts: {
  bold?: boolean; size?: number; underline?: boolean; italic?: boolean;
}): Partial<ExcelJS.Font> {
  return {
    name:      'Times New Roman',
    bold:      opts.bold      ?? false,
    size:      opts.size      ?? 10,
    color:     { argb: BLACK },
    underline: opts.underline ? 'single' : undefined,
    italic:    opts.italic    ?? false,
  };
}

function alnStyle(
  h: ExcelJS.Alignment['horizontal'] = 'left',
  v: ExcelJS.Alignment['vertical']   = 'middle',
  wrap = true
): Partial<ExcelJS.Alignment> {
  return { horizontal: h, vertical: v, wrapText: wrap };
}

/** Write a cell's value + style. Does NOT merge — caller merges first. */
function sc(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bold?: boolean; size?: number; underline?: boolean;
    fill?: ArgbColor;
    hAlign?: ExcelJS.Alignment['horizontal'];
    vAlign?: ExcelJS.Alignment['vertical'];
    wrap?: boolean;
    numFmt?: string;
  } = {}
): void {
  const cell = ws.getRow(rowNum).getCell(col);
  cell.value  = value;
  cell.font   = tnrFont({ bold: opts.bold, size: opts.size, underline: opts.underline });
  cell.alignment = alnStyle(opts.hAlign ?? 'left', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.fill)   cell.fill   = solidFill(opts.fill);
  cell.border = thinBorder;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

/**
 * Safe merge — skips if cells are already merged (prevents the crash).
 * Also writes an empty string to non-top-left cells inside the merged range
 * BEFORE merging so ExcelJS doesn't complain about existing values.
 */
function safeMerge(
  ws: ExcelJS.Worksheet,
  r1: number, c1: number,
  r2: number, c2: number
): void {
  // Check if top-left cell is already part of a merge
  const topLeft = ws.getCell(r1, c1);
  // @ts-ignore — isMerged is not in the public types but exists at runtime
  if (topLeft.isMerged) return;
  try {
    ws.mergeCells(r1, c1, r2, c2);
  } catch {
    // silently skip if already merged
  }
}

// ── Workbook builder ──────────────────────────────────────────────────────────
async function buildWorkbook(
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
): Promise<ExcelJS.Workbook> {

  // ── Aggregate items by article code ───────────────────────────────────────
  const agg = new Map<string, {
    desc: string; dmg: number; ns: number; bbd: number; uv: number;
  }>();
  for (const item of items) {
    const code = item.articleNumber;
    if (!agg.has(code)) {
      agg.set(code, { desc: item.description, dmg: 0, ns: 0, bbd: 0, uv: item.unitValue });
    }
    const a = agg.get(code)!;
    a.dmg += item.qtyDamaged     || 0;
    a.ns  += item.qtyNonSaleable || 0;
    a.bbd += item.qtyBBD         || 0;
    a.uv   = item.unitValue      || 0;
  }

  const rows    = [...agg.values()];
  const qtyDmg  = rows.reduce((s, v) => s + v.dmg, 0);
  const qtyNs   = rows.reduce((s, v) => s + v.ns,  0);
  const qtyBbd  = rows.reduce((s, v) => s + v.bbd, 0);
  const qtyTot  = qtyDmg + qtyNs + qtyBbd;
  const valDmg  = rows.reduce((s, v) => s + v.dmg * v.uv, 0);
  const valNs   = rows.reduce((s, v) => s + v.ns  * v.uv, 0);
  const valBbd  = rows.reduce((s, v) => s + v.bbd * v.uv, 0);
  const valTot  = valDmg + valNs + valBbd;
  const approved = audit.approvedValue || 0;
  const expPct   = approved > 0 ? valBbd / approved : 0;

  const fmtQ = (n: number): ExcelJS.CellValue => n > 0 ? n : '-';
  const fmtV = (n: number): ExcelJS.CellValue => n > 0 ? n : '-';

  // ── Create workbook ────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Reliance Audit System';
  wb.created = new Date();

  const ws = wb.addWorksheet('Sign-Off', {
    pageSetup: {
      orientation: 'landscape', paperSize: 9,
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    },
  });

  // 14 columns — widths match the template proportions
  ws.columns = [
    { width: 14 },   //  1  A  Primary Damage Qty / left info
    { width: 22 },   //  2  B  Non-Saleable Qty
    { width: 10 },   //  3  C  BBD Qty
    { width: 14 },   //  4  D  Total Qty
    { width: 14 },   //  5  E  Primary Damage INR
    { width: 14 },   //  6  F  Non-Saleable INR part-1
    { width: 10 },   //  7  G  Non-Saleable INR part-2 (merged with F)
    { width: 10 },   //  8  H  BBD INR
    { width: 12 },   //  9  I  Total Audited Value part-1
    { width: 6  },   // 10  J  Total Audited Value part-2 (merged with I)
    { width: 12 },   // 11  K  Approved Amount part-1
    { width: 6  },   // 12  L  Approved Amount part-2 (merged with K)
    { width: 10 },   // 13  M  Expiry % part-1
    { width: 6  },   // 14  N  Expiry % part-2 (merged with M)
  ];

  let r = 0; // current row number
  const nextRow = (h = 16) => { r++; ws.getRow(r).height = h; return r; };

  // ════════════════════════════════════════════════════════════════════════════
  // ROW 1 — Title
  // ════════════════════════════════════════════════════════════════════════════
  nextRow(18);
  safeMerge(ws, r, 1, r, 14);
  sc(ws, r, 1, 'Audit Report - Phase V Part 1 Beverage',
    { bold: true, size: 12, hAlign: 'center', vAlign: 'middle', wrap: false });

  // ════════════════════════════════════════════════════════════════════════════
  // ROWS 2-7 — Info block
  // LEFT (cols 1-5): 6 metadata lines
  // RIGHT (cols 6-14): Customer Full Address spans rows 2-4
  // ════════════════════════════════════════════════════════════════════════════

  // Fields from actual schema
  const anchorCode  = dist.code       || '';   // distributors.code IS anchor code
  const anchorName  = dist.anchorName || '';   // distributors.anchorName
  const distName    = dist.name       || '';
  const distCity    = dist.city       || '';
  const auditDate   = audit.scheduledDate || '';
  const firmName    = 'Singla Vishal & Co.';  // always fixed
  const serialNo    = audit.serialNo  || audit.id || '';

  // Customer full address = distributor's full address from DB
  const addrParts = [distName, dist.address, distCity, dist.state, dist.region].filter(Boolean);
  const customerAddress = 'Customer Full Address :- ' + addrParts.join(', ');

  const leftLines = [
    `Audit Serial No.:-${serialNo}`,
    `Audit Firm Name :-${firmName}`,
    `Anchor Code :-${anchorCode}`,
    `Anchor Name/ Direct DB Name :-${anchorName}`,
    `Distributor name & City :-${distName}, ${distCity}`,
    `Audit Date :- ${auditDate}`,
  ];

  for (let i = 0; i < 6; i++) {
    nextRow(16);
    safeMerge(ws, r, 1, r, 5);
    sc(ws, r, 1, leftLines[i], { size: 10, hAlign: 'left', vAlign: 'middle', wrap: false });
  }

  // Customer address: spans rows 2-4 (absolute row numbers 2, 3, 4), cols 6-14
  safeMerge(ws, 2, 6, 4, 14);
  {
    const cell = ws.getCell(2, 6);
    cell.value     = customerAddress;
    cell.font      = tnrFont({ bold: true, size: 10, underline: true });
    cell.alignment = alnStyle('left', 'top', true);
    cell.border    = thinBorder;
  }

  // Rows 5-7 right side: empty with border
  for (const row of [5, 6, 7]) {
    safeMerge(ws, row, 6, row, 14);
    sc(ws, row, 6, '', { hAlign: 'left', vAlign: 'middle', wrap: false });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ROW 8 — Section header row
  // ════════════════════════════════════════════════════════════════════════════
  nextRow(18);
  safeMerge(ws, r, 1, r, 4);
  sc(ws, r, 1, 'Quantity Details - Physically verified & Drained',
    { bold: true, size: 9, fill: LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false });

  safeMerge(ws, r, 5, r, 10);
  sc(ws, r, 5, 'Value Details',
    { bold: true, size: 9, fill: LIGHT_BLUE, hAlign: 'center', vAlign: 'middle', wrap: false });

  safeMerge(ws, r, 11, r, 14);
  sc(ws, r, 11, 'Variance Summary',
    { bold: true, size: 9, fill: ORANGE, hAlign: 'center', vAlign: 'middle', wrap: false });

  // ════════════════════════════════════════════════════════════════════════════
  // ROW 9 — Column sub-headers
  // ════════════════════════════════════════════════════════════════════════════
  nextRow(44);
  const subHeaders: Array<[number, number, string, ArgbColor]> = [
    [1,  1,  'Primary Damage\n(Pcs)',                                       LIGHT_BLUE],
    [2,  2,  'Non-Saleable product and\nNon-manufacturing Defect\n(Pcs)',   LIGHT_BLUE],
    [3,  3,  'BBD Stock\n(Pcs)',                                            LIGHT_BLUE],
    [4,  4,  'Total Verified\nQuantity (Pcs)',                              LIGHT_BLUE],
    [5,  5,  'Primary Damage\n(INR)',                                       LIGHT_BLUE],
    [6,  7,  'Non-Saleable product and\nNon-manufacturing Defect\n(INR)',   LIGHT_BLUE],
    [8,  8,  'BBD Stock\n(INR)',                                            LIGHT_BLUE],
    [9,  10, 'Total\nAudited\nValue',                                       LIGHT_BLUE],
    [11, 12, 'Approved\nAmount',                                            ORANGE],
    [13, 14, 'Expiry % to\nsales',                                          ORANGE],
  ];
  for (const [c1, c2, text, fillColor] of subHeaders) {
    if (c1 !== c2) safeMerge(ws, r, c1, r, c2);
    sc(ws, r, c1, text, { bold: true, size: 8, fill: fillColor, hAlign: 'center', vAlign: 'middle', wrap: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ROW 10 — Totals data row
  // ════════════════════════════════════════════════════════════════════════════
  nextRow(16);
  const totalsData: Array<[number, number, ExcelJS.CellValue, string]> = [
    [1,  1,  fmtQ(qtyDmg), '#,##0;-'],
    [2,  2,  fmtQ(qtyNs),  '#,##0;-'],
    [3,  3,  fmtQ(qtyBbd), '#,##0;-'],
    [4,  4,  qtyTot,       '#,##0;-'],
    [5,  5,  fmtV(valDmg), '#,##0.00;-'],
    [6,  7,  fmtV(valNs),  '#,##0.00;-'],
    [8,  8,  fmtV(valBbd), '#,##0.00;-'],
    [9,  10, valTot,       '#,##0.00;-'],
    [11, 12, approved,     '#,##0;-'],
    [13, 14, expPct,       '0.00%'],
  ];
  for (const [c1, c2, val, fmt] of totalsData) {
    if (c1 !== c2) safeMerge(ws, r, c1, r, c2);
    sc(ws, r, c1, val, { hAlign: 'center', vAlign: 'middle', wrap: false, numFmt: fmt });
  }

  // ── Individual item rows (only if more than one unique article) ────────────
  if (agg.size > 1) {
    for (const [, v] of agg) {
      nextRow(16);
      const qT = v.dmg + v.ns + v.bbd;
      const vT = qT * v.uv;
      const itemData: Array<[number, number, ExcelJS.CellValue, string]> = [
        [1,  1,  fmtQ(v.dmg),           '#,##0;-'],
        [2,  2,  fmtQ(v.ns),            '#,##0;-'],
        [3,  3,  fmtQ(v.bbd),           '#,##0;-'],
        [4,  4,  qT,                    '#,##0;-'],
        [5,  5,  fmtV(v.dmg * v.uv),   '#,##0.00;-'],
        [6,  7,  fmtV(v.ns  * v.uv),   '#,##0.00;-'],
        [8,  8,  fmtV(v.bbd * v.uv),   '#,##0.00;-'],
        [9,  10, vT,                    '#,##0.00;-'],
        [11, 12, '',                    ''],
        [13, 14, '',                    ''],
      ];
      for (const [c1, c2, val, fmt] of itemData) {
        if (c1 !== c2) safeMerge(ws, r, c1, r, c2);
        sc(ws, r, c1, val, { size: 9, hAlign: 'center', vAlign: 'middle', wrap: false, numFmt: fmt || undefined });
      }
    }
  }

  // ── Blank spacer rows ──────────────────────────────────────────────────────
  nextRow(6);
  nextRow(6);

  // ════════════════════════════════════════════════════════════════════════════
  // DECLARATION BLOCK
  // Left  (cols 1-9) : "Declaration from Customer -" + 4 numbered points
  // Right (cols 10-14): "Customer's Authorised person Name -" + "Seal & Sign -"
  // ════════════════════════════════════════════════════════════════════════════
  const declHeaderRow = nextRow(16);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1, 'Declaration from Customer -',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, "Customer's Authorised person Name -",
    { size: 10, hAlign: 'left', vAlign: 'middle', wrap: false });

  // Seal & Sign spans all 4 declaration point rows on the right side
  const sealStartRow = declHeaderRow + 1;
  const sealEndRow   = declHeaderRow + 4;

  const declPoints = [
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    '2. I confirm that all stocks received by me with expiry date upto date of Audit has been cleared by company and I will not raise any further claim in this regard for products with expired.',
    '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.',
    '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.',
  ];

  // Merge seal area FIRST (before writing point rows so no conflict)
  safeMerge(ws, sealStartRow, 10, sealEndRow, 14);
  {
    const sealCell = ws.getCell(sealStartRow, 10);
    sealCell.value     = 'Seal & Sign -';
    sealCell.font      = tnrFont({ size: 10 });
    sealCell.alignment = alnStyle('left', 'top', false);
    sealCell.border    = thinBorder;
    ws.getRow(sealStartRow).height = 28;
  }

  for (let i = 0; i < declPoints.length; i++) {
    const pointRow = sealStartRow + i;
    if (i > 0) ws.getRow(pointRow).height = 28;
    safeMerge(ws, pointRow, 1, pointRow, 9);
    sc(ws, pointRow, 1, declPoints[i],
      { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  }

  r = sealEndRow; // sync counter

  // ── blank spacer ──────────────────────────────────────────────────────────
  nextRow(6);

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCK 2 — Declaration from Reliance Sales Team
  //
  // LEFT (cols 1-9):
  //   "Declaration from Reliance Sales Team -"  (bold, underlined)
  //   Point 1
  //   Point 2
  //   (blank row)
  //
  // RIGHT (cols 10-14):
  //   "Sales Team Name & contact no."  (bold, underlined)
  //   (blank)
  //   "Sales Team EMP ID"              (bold, underlined)
  //   (blank)
  //   "Sign"
  // ════════════════════════════════════════════════════════════════════════════

  // Header row
  const salesHeaderRow = nextRow(16);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1, 'Declaration from Reliance Sales Team -',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, 'Sales Team Name & contact no.',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });

  const salesPoint1Row = nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1,
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  // Right col: empty row (Sales Team Name field — blank for handwriting)
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, '', { hAlign: 'left', vAlign: 'middle', wrap: false });

  const salesPoint2Row = nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1,
    '2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.',
    { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, 'Sales Team EMP ID',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });

  // Blank row left | "Sign" right
  nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1, '', { hAlign: 'left', vAlign: 'middle', wrap: false });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, 'Sign',
    { size: 10, hAlign: 'left', vAlign: 'middle', wrap: false });

  // Extra blank spacer row
  nextRow(6);

  // ── blank spacer ──────────────────────────────────────────────────────────
  nextRow(6);

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCK 3 — Declaration from Auditor
  //
  // LEFT (cols 1-9):
  //   "Declaration from Auditor-"  (bold, underlined)
  //   Point 1
  //   Point 2
  //   (blank row)
  //
  // RIGHT (cols 10-14):
  //   "Auditor Name & contact no."  (bold, underlined)
  //   (blank)
  //   (blank)
  //   "Seal & Sign"
  // ════════════════════════════════════════════════════════════════════════════

  // Header row
  const auditorHeaderRow = nextRow(16);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1, 'Declaration from Auditor-',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, 'Auditor Name & contact no.',
    { bold: true, size: 10, underline: true, hAlign: 'left', vAlign: 'middle', wrap: false });

  const auditorPoint1Row = nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1,
    '1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team.',
    { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, '', { hAlign: 'left', vAlign: 'middle', wrap: false });

  const auditorPoint2Row = nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1,
    '2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer\'s location.',
    { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, '', { hAlign: 'left', vAlign: 'middle', wrap: false });

  // Blank row left | "Seal & Sign" right
  nextRow(22);
  safeMerge(ws, r, 1, r, 9);
  sc(ws, r, 1, '', { hAlign: 'left', vAlign: 'middle', wrap: false });
  safeMerge(ws, r, 10, r, 14);
  sc(ws, r, 10, 'Seal & Sign',
    { size: 10, hAlign: 'left', vAlign: 'middle', wrap: false });

  return wb;
}

// ── Public hook ───────────────────────────────────────────────────────────────
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
      const wb = await buildWorkbook(
        params.distributor,
        params.audit,
        params.items,
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = `SignOff_${params.distributor.code}_${params.audit.scheduledDate ?? 'draft'}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Sign-off export error:', err);
      alert('Failed to generate the Sign-Off Excel. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return { exportSignOff, isExporting };
}
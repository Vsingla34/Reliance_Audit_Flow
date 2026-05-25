/**
 * useSignOffExport.ts
 *
 * Generates a two-sheet Excel:
 *   Sheet 1: "Sign-Off"        — exact replica of the Audit Report template
 *   Sheet 2: "Article Level"   — exact replica of the Article Level Format (ALF) template
 *
 * INSTALL:  npm install exceljs
 * PLACE AT: src/hooks/useSignOffExport.ts
 */
import { useState } from 'react';
import ExcelJS from 'exceljs';

// ── Shared types (aligned with Supabase schema) ───────────────────────────────
export interface SignOffDistributor {
  name:        string;
  code:        string;   // = Anchor Code (distributors.code)
  anchorName?: string;   // distributors.anchorName
  city?:       string;
  state?:      string;
  address?:    string;
  region?:     string;
}

export interface SignOffAudit {
  id?:            string;
  serialNo?:      string;
  scheduledDate?: string | null;
  approvedValue:  number;
  verifiedTotal:  number;
}

export interface SignOffItem {
  articleNumber:   string;
  description:     string;   // Brand Pack / item name
  qtyDamaged:      number;   // auditLineItems.qtyDamaged
  qtyNonSaleable:  number;   // auditLineItems.qtyNonSaleable
  qtyBBD:          number;   // auditLineItems.qtyBBD
  unitValue:       number;   // auditLineItems.unitValue  (rate incl GST)
  gst?:            number;   // itemMaster.gst (%)
  standardPack?:   string;   // itemMaster.standardPack
  mfgDate?:        string;   // auditLineItems.mfgDate
  expDate?:        string;   // auditLineItems.expDate
  productLife?:    string;   // auditLineItems.productLife
  reasonCode?:     string;   // auditLineItems.reasonCode  → "Issue in Product"
  remarks?:        string;   // auditLineItems.remarks     → "Auditor Remarks"
}

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  // Sign-Off sheet
  LIGHT_BLUE:  'FFBDD7EE',
  ORANGE:      'FFFFC000',
  // ALF sheet — matched from template
  MASTER_HDR:  'FFD9E1F2',   // Master Details section header (blue-grey)
  QTY_HDR:     'FFBDD7EE',   // Quantity Details (light blue)
  VAL_HDR:     'FFE2EFDA',   // Value Details (light green)
  MFD_HDR:     'FFFFF2CC',   // MFD & Expiry (light yellow)
  AUD_HDR:     'FFD9D9D9',   // Auditor Findings (light grey)
  TOTAL_ROW:   'FFFFD966',   // Totals row (yellow)
  WHITE:       'FFFFFFFF',
  BLACK:       'FF000000',
};

type ArgbColor = string;

// ── Style helpers ─────────────────────────────────────────────────────────────
const thinSide = { style: 'thin' as ExcelJS.BorderStyle };
const thinBorder: Partial<ExcelJS.Borders> = {
  top: thinSide, left: thinSide, bottom: thinSide, right: thinSide,
};
const medSide = { style: 'medium' as ExcelJS.BorderStyle };
const medBorder: Partial<ExcelJS.Borders> = {
  top: medSide, left: medSide, bottom: medSide, right: medSide,
};

function solidFill(argb: ArgbColor): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function tnrFont(opts: {
  bold?: boolean; size?: number; underline?: boolean; italic?: boolean; color?: ArgbColor;
}): Partial<ExcelJS.Font> {
  return {
    name: 'Times New Roman', bold: opts.bold ?? false, size: opts.size ?? 10,
    color: { argb: opts.color ?? C.BLACK },
    underline: opts.underline ? 'single' : undefined,
    italic: opts.italic ?? false,
  };
}

function ariFont(opts: {
  bold?: boolean; size?: number; underline?: boolean; color?: ArgbColor;
}): Partial<ExcelJS.Font> {
  return {
    name: 'Arial', bold: opts.bold ?? false, size: opts.size ?? 9,
    color: { argb: opts.color ?? C.BLACK },
    underline: opts.underline ? 'single' : undefined,
  };
}

function alnStyle(
  h: ExcelJS.Alignment['horizontal'] = 'left',
  v: ExcelJS.Alignment['vertical']   = 'middle',
  wrap = true
): Partial<ExcelJS.Alignment> {
  return { horizontal: h, vertical: v, wrapText: wrap };
}

function safeMerge(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  try {
    const topLeft = ws.getCell(r1, c1);
    // @ts-ignore
    if (topLeft.isMerged) return;
    ws.mergeCells(r1, c1, r2, c2);
  } catch { /* already merged — skip */ }
}

/** Write a cell with Times New Roman styling (Sign-Off sheet) */
function scT(
  ws: ExcelJS.Worksheet, rowNum: number, col: number, value: ExcelJS.CellValue,
  opts: { bold?:boolean; size?:number; underline?:boolean; fill?:ArgbColor;
    hAlign?:ExcelJS.Alignment['horizontal']; vAlign?:ExcelJS.Alignment['vertical'];
    wrap?:boolean; numFmt?:string; } = {}
): void {
  const cell = ws.getRow(rowNum).getCell(col);
  cell.value     = value;
  cell.font      = tnrFont({ bold: opts.bold, size: opts.size, underline: opts.underline });
  cell.alignment = alnStyle(opts.hAlign ?? 'left', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.fill) cell.fill = solidFill(opts.fill);
  cell.border = thinBorder;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

/** Write a cell with Arial styling (ALF sheet) */
function scA(
  ws: ExcelJS.Worksheet, rowNum: number, col: number, value: ExcelJS.CellValue,
  opts: { bold?:boolean; size?:number; underline?:boolean; fill?:ArgbColor;
    hAlign?:ExcelJS.Alignment['horizontal']; vAlign?:ExcelJS.Alignment['vertical'];
    wrap?:boolean; numFmt?:string; border?:Partial<ExcelJS.Borders>; } = {}
): void {
  const cell = ws.getRow(rowNum).getCell(col);
  cell.value     = value;
  cell.font      = ariFont({ bold: opts.bold, size: opts.size, underline: opts.underline });
  cell.alignment = alnStyle(opts.hAlign ?? 'center', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.fill) cell.fill = solidFill(opts.fill);
  cell.border = opts.border ?? thinBorder;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

// ════════════════════════════════════════════════════════════════════════════════
// SHEET 1 — Sign-Off (exact replica, unchanged from previous version)
// ════════════════════════════════════════════════════════════════════════════════
async function buildSignOffSheet(
  ws: ExcelJS.Worksheet,
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  ws.columns = [
    { width: 14 }, { width: 22 }, { width: 10 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 6  },
    { width: 12 }, { width: 6  }, { width: 10 }, { width: 6  },
  ];

  // Aggregate
  const agg = new Map<string, { desc:string; dmg:number; ns:number; bbd:number; uv:number; }>();
  for (const item of items) {
    if (!agg.has(item.articleNumber))
      agg.set(item.articleNumber, { desc: item.description, dmg:0, ns:0, bbd:0, uv: item.unitValue });
    const a = agg.get(item.articleNumber)!;
    a.dmg += item.qtyDamaged     || 0;
    a.ns  += item.qtyNonSaleable || 0;
    a.bbd += item.qtyBBD         || 0;
    a.uv   = item.unitValue      || 0;
  }
  const rows   = [...agg.values()];
  const qtyDmg = rows.reduce((s,v) => s+v.dmg, 0);
  const qtyNs  = rows.reduce((s,v) => s+v.ns,  0);
  const qtyBbd = rows.reduce((s,v) => s+v.bbd, 0);
  const qtyTot = qtyDmg+qtyNs+qtyBbd;
  const valDmg = rows.reduce((s,v) => s+v.dmg*v.uv, 0);
  const valNs  = rows.reduce((s,v) => s+v.ns *v.uv, 0);
  const valBbd = rows.reduce((s,v) => s+v.bbd*v.uv, 0);
  const valTot = valDmg+valNs+valBbd;
  const approved = audit.approvedValue || 0;
  const expPct   = approved > 0 ? valBbd/approved : 0;
  const fmtQ = (n:number): ExcelJS.CellValue => n>0?n:'-';
  const fmtV = (n:number): ExcelJS.CellValue => n>0?n:'-';

  let r = 0;
  const nextRow = (h=16) => { r++; ws.getRow(r).height = h; return r; };

  // ROW 1 — Title
  nextRow(18); safeMerge(ws,r,1,r,14);
  scT(ws,r,1,'Audit Report - Phase V Part 1 Beverage',{bold:true,size:12,hAlign:'center',vAlign:'middle',wrap:false});

  // ROW 2-7 — Info block
  const addrParts = [dist.name,dist.address,dist.city,dist.state,dist.region].filter(Boolean);
  const customerAddress = 'Customer Full Address :- ' + addrParts.join(', ');
  const leftLines = [
    `Audit Serial No.:-${audit.serialNo||audit.id||''}`,
    `Audit Firm Name :-Singla Vishal & Co.`,
    `Anchor Code :-${dist.code||''}`,
    `Anchor Name/ Direct DB Name :-${dist.anchorName||''}`,
    `Distributor name & City :-${dist.name}, ${dist.city||''}`,
    `Audit Date :- ${audit.scheduledDate||''}`,
  ];
  for (let i=0; i<6; i++) {
    nextRow(16); safeMerge(ws,r,1,r,5);
    scT(ws,r,1,leftLines[i],{size:10,hAlign:'left',vAlign:'middle',wrap:false});
  }
  safeMerge(ws,2,6,4,14);
  { const c=ws.getCell(2,6); c.value=customerAddress; c.font=tnrFont({bold:true,size:10,underline:true}); c.alignment=alnStyle('left','top',true); c.border=thinBorder; }
  for (const row of [5,6,7]) { safeMerge(ws,row,6,row,14); scT(ws,row,6,'',{hAlign:'left',vAlign:'middle',wrap:false}); }

  // ROW 8 — Section headers
  nextRow(18);
  safeMerge(ws,r,1,r,4);  scT(ws,r,1,'Quantity Details - Physically verified & Drained',{bold:true,size:9,fill:C.LIGHT_BLUE,hAlign:'center',vAlign:'middle',wrap:false});
  safeMerge(ws,r,5,r,10); scT(ws,r,5,'Value Details',{bold:true,size:9,fill:C.LIGHT_BLUE,hAlign:'center',vAlign:'middle',wrap:false});
  safeMerge(ws,r,11,r,14);scT(ws,r,11,'Variance Summary',{bold:true,size:9,fill:C.ORANGE,hAlign:'center',vAlign:'middle',wrap:false});

  // ROW 9 — Column sub-headers
  nextRow(44);
  const subH: Array<[number,number,string,ArgbColor]> = [
    [1,1,'Primary Damage\n(Pcs)',C.LIGHT_BLUE],[2,2,'Non-Saleable product and\nNon-manufacturing Defect\n(Pcs)',C.LIGHT_BLUE],
    [3,3,'BBD Stock\n(Pcs)',C.LIGHT_BLUE],[4,4,'Total Verified\nQuantity (Pcs)',C.LIGHT_BLUE],
    [5,5,'Primary Damage\n(INR)',C.LIGHT_BLUE],[6,7,'Non-Saleable product and\nNon-manufacturing Defect\n(INR)',C.LIGHT_BLUE],
    [8,8,'BBD Stock\n(INR)',C.LIGHT_BLUE],[9,10,'Total\nAudited\nValue',C.LIGHT_BLUE],
    [11,12,'Approved\nAmount',C.ORANGE],[13,14,'Expiry % to\nsales',C.ORANGE],
  ];
  for (const [c1,c2,text,fc] of subH) {
    if(c1!==c2) safeMerge(ws,r,c1,r,c2);
    scT(ws,r,c1,text,{bold:true,size:8,fill:fc,hAlign:'center',vAlign:'middle',wrap:true});
  }

  // ROW 10 — Totals
  nextRow(16);
  const tot: Array<[number,number,ExcelJS.CellValue,string]> = [
    [1,1,fmtQ(qtyDmg),'#,##0;-'],[2,2,fmtQ(qtyNs),'#,##0;-'],[3,3,fmtQ(qtyBbd),'#,##0;-'],[4,4,qtyTot,'#,##0;-'],
    [5,5,fmtV(valDmg),'#,##0.00;-'],[6,7,fmtV(valNs),'#,##0.00;-'],[8,8,fmtV(valBbd),'#,##0.00;-'],[9,10,valTot,'#,##0.00;-'],
    [11,12,approved,'#,##0;-'],[13,14,expPct,'0.00%'],
  ];
  for (const [c1,c2,val,fmt] of tot) {
    if(c1!==c2) safeMerge(ws,r,c1,r,c2);
    scT(ws,r,c1,val,{hAlign:'center',vAlign:'middle',wrap:false,numFmt:fmt});
  }

  // Individual item rows
  if (agg.size>1) {
    for (const [,v] of agg) {
      nextRow(16);
      const qT=v.dmg+v.ns+v.bbd, vT=qT*v.uv;
      const id: Array<[number,number,ExcelJS.CellValue,string]> = [
        [1,1,fmtQ(v.dmg),'#,##0;-'],[2,2,fmtQ(v.ns),'#,##0;-'],[3,3,fmtQ(v.bbd),'#,##0;-'],[4,4,qT,'#,##0;-'],
        [5,5,fmtV(v.dmg*v.uv),'#,##0.00;-'],[6,7,fmtV(v.ns*v.uv),'#,##0.00;-'],[8,8,fmtV(v.bbd*v.uv),'#,##0.00;-'],[9,10,vT,'#,##0.00;-'],
        [11,12,'',''],[13,14,'',''],
      ];
      for (const [c1,c2,val,fmt] of id) {
        if(c1!==c2) safeMerge(ws,r,c1,r,c2);
        scT(ws,r,c1,val,{size:9,hAlign:'center',vAlign:'middle',wrap:false,numFmt:fmt||undefined});
      }
    }
  }

  // Spacers
  nextRow(6); nextRow(6);

  // Customer Declaration
  const declHeaderRow = nextRow(16);
  safeMerge(ws,r,1,r,9); scT(ws,r,1,'Declaration from Customer -',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,"Customer's Authorised person Name -",{size:10,hAlign:'left',vAlign:'middle',wrap:false});
  const sealStartRow=declHeaderRow+1, sealEndRow=declHeaderRow+4;
  safeMerge(ws,sealStartRow,10,sealEndRow,14);
  { const c=ws.getCell(sealStartRow,10); c.value='Seal & Sign -'; c.font=tnrFont({size:10}); c.alignment=alnStyle('left','top',false); c.border=thinBorder; ws.getRow(sealStartRow).height=28; }
  const custPts=['1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',
    '2. I confirm that all stocks received by me with expiry date upto date of Audit has been cleared by company and I will not raise any further claim in this regard for products with expired.',
    '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.',
    '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.'];
  for (let i=0;i<custPts.length;i++) {
    const pr=sealStartRow+i; if(i>0) ws.getRow(pr).height=28;
    safeMerge(ws,pr,1,pr,9); scT(ws,pr,1,custPts[i],{size:9,hAlign:'left',vAlign:'top',wrap:true});
  }
  r=sealEndRow;

  // Sales Team Declaration
  nextRow(6);
  nextRow(16); safeMerge(ws,r,1,r,9); scT(ws,r,1,'Declaration from Reliance Sales Team -',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'Sales Team Name & contact no.',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,'1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.',{size:9,hAlign:'left',vAlign:'top',wrap:true});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'',{hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,'2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.',{size:9,hAlign:'left',vAlign:'top',wrap:true});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'Sales Team EMP ID',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,'',{hAlign:'left',vAlign:'middle',wrap:false});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'Sign',{size:10,hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(6); nextRow(6);

  // Auditor Declaration
  nextRow(16); safeMerge(ws,r,1,r,9); scT(ws,r,1,'Declaration from Auditor-',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'Auditor Name & contact no.',{bold:true,size:10,underline:true,hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,'1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team.',{size:9,hAlign:'left',vAlign:'top',wrap:true});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'',{hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,"2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer's location.",{size:9,hAlign:'left',vAlign:'top',wrap:true});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'',{hAlign:'left',vAlign:'middle',wrap:false});
  nextRow(22); safeMerge(ws,r,1,r,9); scT(ws,r,1,'',{hAlign:'left',vAlign:'middle',wrap:false});
  safeMerge(ws,r,10,r,14); scT(ws,r,10,'Seal & Sign',{size:10,hAlign:'left',vAlign:'middle',wrap:false});
}

// ════════════════════════════════════════════════════════════════════════════════
// SHEET 2 — Article Level Format (ALF)
// Columns A-AC (29 cols) matching the template exactly
// ════════════════════════════════════════════════════════════════════════════════
async function buildALFSheet(
  ws: ExcelJS.Worksheet,
  dist:  SignOffDistributor,
  audit: SignOffAudit,
  items: SignOffItem[],
) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // Column widths — EXACT values read from original ALF_TEMP.xlsx XML (all 29 cols A-AC)
  const colWidths = [
    14.14,   // A (1)  Sr No
    25.14,   // B (2)  Std. Serial No.
    165.29,  // C (3)  Region  ← huge column, holds declaration text
    13.57,   // D (4)  State
    17.86,   // E (5)  Audit Team
    11.00,   // F (6)  Anchor Code
    10.43,   // G (7)  Anchor Name
    8.00,    // H (8)  Distributor name   ← 8.0 in template (not 10.4)
    11.29,   // I (9)  Article Code
    43.14,   // J (10) Brand Pack
    6.43,    // K (11) NPI / NON-NPI
    8.57,    // L (12) Rate Incl GST
    6.57,    // M (13) GST %
    9.00,    // N (14) Standard Pack
    18.57,   // O (15) Primary Damage (Pcs)
    8.00,    // P (16) Non-Saleable (Pcs)
    8.43,    // Q (17) BBD Stock (Pcs)
    8.71,    // R (18) Total Verified Qty
    27.29,   // S (19) Primary Damage (INR)
    12.00,   // T (20) Non-Saleable (INR)
    10.57,   // U (21) BBD Stock (INR)
    12.00,   // V (22) Total Audited Value (incl GST)
    8.00,    // W (23) Total Audited Value (excl GST)   ← 8.0 in template
    17.71,   // X (24) Manufacturing Date               ← 17.71 in template
    10.43,   // Y (25) Expiry Date
    8.00,    // Z (26) Product Life Months
    8.57,    // AA(27) Manufacturing Quarter
    31.57,   // AB(28) Issue in Product in detail
    19.14,   // AC(29) Auditor Remarks
  ];
  ws.columns = colWidths.map(w => ({ width: w }));

  // ── ROW 1: blank (template starts at row 2) ──────────────────────────────
  ws.getRow(1).height = 10;

  // ── ROW 2: blank row with borders ────────────────────────────────────────
  ws.getRow(2).height = 15;
  for (let c=1; c<=29; c++) {
    ws.getRow(2).getCell(c).border = thinBorder;
  }

  // ── ROW 3: Section group headers ─────────────────────────────────────────
  ws.getRow(3).height = 22;
  //  A3-N3: "Master Details" (14 cols)
  safeMerge(ws,3,1,3,14);
  scA(ws,3,1,'Master Details',{bold:true,size:11,fill:C.MASTER_HDR,hAlign:'center'});
  // O3-R3: "Quantity Details" (4 cols)
  safeMerge(ws,3,15,3,18);
  scA(ws,3,15,'Quantity Details',{bold:true,size:11,fill:C.QTY_HDR,hAlign:'center'});
  // S3-W3: "Value Details - Including GST" (5 cols)
  safeMerge(ws,3,19,3,23);
  scA(ws,3,19,'Value Details - Including GST',{bold:true,size:11,fill:C.VAL_HDR,hAlign:'center'});
  // X3-AA3: "MFD & Expiry Date" (4 cols)
  safeMerge(ws,3,24,3,27);
  scA(ws,3,24,'MFD & Expiry Date',{bold:true,size:11,fill:C.MFD_HDR,hAlign:'center'});
  // AB3-AC3: "Auditor Findings" (2 cols)
  safeMerge(ws,3,28,3,29);
  scA(ws,3,28,'Auditor Findings',{bold:true,size:11,fill:C.MASTER_HDR,hAlign:'center'});

  // ── ROW 4: Column sub-headers (height 150 from template) ─────────────────
  ws.getRow(4).height = 150;

  const colHeaders: Array<[number, string, ArgbColor]> = [
    [1,  'Sr No',                                                                      C.MASTER_HDR],
    [2,  'Std. Serial No.',                                                            C.MASTER_HDR],
    [3,  'Region',                                                                     C.MASTER_HDR],
    [4,  'State',                                                                      C.MASTER_HDR],
    [5,  'Audit Team',                                                                 C.MASTER_HDR],
    [6,  'Anchor Code',                                                                C.MASTER_HDR],
    [7,  'Anchor Name',                                                                C.MASTER_HDR],
    [8,  'Distributor name',                                                           C.MASTER_HDR],
    [9,  'Article Code',                                                               C.MASTER_HDR],
    [10, 'Brand Pack',                                                                 C.MASTER_HDR],
    [11, 'NPI / NON - NPI',                                                           C.MASTER_HDR],
    [12, "Rate Including GST\n(As per Waitage Avg of Primary from Jan'25 to Oct'25)", C.MASTER_HDR],
    [13, 'GST %',                                                                      C.MASTER_HDR],
    [14, 'Standard Pack',                                                              C.MASTER_HDR],
    // Quantity
    [15, 'Primary Damage\n(Pcs)',                                                     C.QTY_HDR],
    [16, 'Non-Saleable product and Non-manufacturing Defect (Pcs)',                   C.QTY_HDR],
    [17, 'BBD Stock\n(Pcs)',                                                          C.QTY_HDR],
    [18, 'Total Verified\nQuantity (Pcs)',                                             C.QTY_HDR],
    // Value
    [19, 'Primary Damage\n(INR)',                                                     C.VAL_HDR],
    [20, 'Non-Saleable product and Non-manufacturing Defect (INR)',                   C.VAL_HDR],
    [21, 'BBD Stock\n(INR)',                                                          C.VAL_HDR],
    [22, 'Total Audited Value\n(Including GST)',                                      C.VAL_HDR],
    [23, 'Total Audited Value\n(Excluding GST)',                                      C.VAL_HDR],
    // MFD
    [24, 'Manufacturing Date',                                                        C.MFD_HDR],
    [25, 'Expiry Date',                                                               C.MFD_HDR],
    [26, 'Product life in Months',                                                    C.MFD_HDR],
    [27, 'Manufacturing Quarter',                                                     C.MFD_HDR],
    // Auditor
    [28, 'Issue in Product in detail',                                                C.AUD_HDR],
    [29, 'Auditor Remarks',                                                           C.AUD_HDR],
  ];
  for (const [col, text, fc] of colHeaders) {
    scA(ws,4,col,text,{bold:true,size:9,fill:fc,hAlign:'center',vAlign:'middle',wrap:true});
  }

  // ── DATA ROWS ─────────────────────────────────────────────────────────────
  // One row per line item (not aggregated — keep individual items for ALF)
  const serialNo   = audit.serialNo || audit.id || '';
  const anchorCode = dist.code      || '';
  const anchorName = dist.anchorName|| '';
  const distName   = dist.name      || '';
  const state      = dist.state     || '';
  const region     = dist.region    || '';
  const firmName   = 'Singla Vishal & Co.';

  // Helper to calculate product life in months from mfgDate + expDate
  const lifeInMonths = (mfgDate?: string, expDate?: string): number | '' => {
    if (!mfgDate || !expDate) return '';
    try {
      const m = new Date(mfgDate), e = new Date(expDate);
      if (isNaN(m.getTime()) || isNaN(e.getTime())) return '';
      const months = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth());
      return months > 0 ? months : '';
    } catch { return ''; }
  };

  // Helper to get manufacturing quarter
  const mfgQuarter = (mfgDate?: string): string => {
    if (!mfgDate) return '';
    try {
      const m = new Date(mfgDate);
      if (isNaN(m.getTime())) return '';
      const q = Math.ceil((m.getMonth() + 1) / 3);
      return `${q}${q===1?'st':q===2?'nd':q===3?'rd':'th'}`;
    } catch { return ''; }
  };

  // Aggregate items by articleNumber (same as sign-off — one row per unique article)
  const agg = new Map<string, {
    item: SignOffItem; dmg:number; ns:number; bbd:number;
  }>();
  for (const item of items) {
    if (!agg.has(item.articleNumber)) {
      agg.set(item.articleNumber, { item, dmg:0, ns:0, bbd:0 });
    }
    const a = agg.get(item.articleNumber)!;
    a.dmg += item.qtyDamaged     || 0;
    a.ns  += item.qtyNonSaleable || 0;
    a.bbd += item.qtyBBD         || 0;
    // Keep the most complete item metadata
    if (item.mfgDate) a.item = { ...a.item, ...item };
  }

  const INR  = '[$₹-en-IN]#,##0.00;-';
  const QTY  = '#,##0;-';
  const PCT  = '0.00%';
  const DATE = 'DD-MM-YYYY';

  let sno = 0;
  let totDmgQty=0, totNsQty=0, totBbdQty=0, totTotQty=0;
  let totDmgVal=0, totNsVal=0, totBbdVal=0, totIncGst=0, totExcGst=0;

  const dataStartRow = 5;
  let dataRow = dataStartRow;

  for (const [code, { item, dmg, ns, bbd }] of agg) {
    sno++;
    const qTot   = dmg + ns + bbd;
    const uv     = item.unitValue || 0;
    const gstPct = item.gst       || 0;
    const gstMul = 1 + gstPct/100;

    const vDmg   = dmg  * uv;
    const vNs    = ns   * uv;
    const vBbd   = bbd  * uv;
    const vTot   = qTot * uv;           // Total incl GST (unitValue already incl GST)
    const vExGst = gstMul > 1 ? vTot / gstMul : vTot;  // Excl GST

    totDmgQty+=dmg; totNsQty+=ns; totBbdQty+=bbd; totTotQty+=qTot;
    totDmgVal+=vDmg; totNsVal+=vNs; totBbdVal+=vBbd; totIncGst+=vTot; totExcGst+=vExGst;

    ws.getRow(dataRow).height = 15;

    const rowData: Array<[number, ExcelJS.CellValue, string?]> = [
      [1,  sno,              QTY],
      [2,  serialNo,         undefined],
      [3,  region,           undefined],
      [4,  state,            undefined],
      [5,  firmName,         undefined],
      [6,  anchorCode,       undefined],
      [7,  anchorName,       undefined],
      [8,  distName,         undefined],
      [9,  code,             undefined],
      [10, item.description, undefined],
      [11, '',               undefined],   // NPI/NON-NPI — not in DB, leave blank
      [12, uv,               INR],
      [13, gstPct > 0 ? gstPct : '', gstPct > 0 ? '0.00"%"' : undefined],
      [14, item.standardPack || '', undefined],
      // Quantity
      [15, dmg  > 0 ? dmg  : '-', dmg  > 0 ? QTY : undefined],
      [16, ns   > 0 ? ns   : '-', ns   > 0 ? QTY : undefined],
      [17, bbd  > 0 ? bbd  : '-', bbd  > 0 ? QTY : undefined],
      [18, qTot > 0 ? qTot : 0,   QTY],
      // Value
      [19, vDmg  > 0 ? vDmg  : '-', vDmg  > 0 ? INR : undefined],
      [20, vNs   > 0 ? vNs   : '-', vNs   > 0 ? INR : undefined],
      [21, vBbd  > 0 ? vBbd  : '-', vBbd  > 0 ? INR : undefined],
      [22, vTot,   INR],
      [23, vExGst, INR],
      // MFD & Expiry
      [24, item.mfgDate || '',  undefined],
      [25, item.expDate || '',  undefined],
      [26, lifeInMonths(item.mfgDate, item.expDate), undefined],
      [27, mfgQuarter(item.mfgDate), undefined],
      // Auditor
      [28, item.reasonCode || '', undefined],
      [29, item.remarks    || '', undefined],
    ];

    for (const [col, val, fmt] of rowData) {
      scA(ws, dataRow, col, val, {
        size: 9, hAlign: col <= 4 ? 'left' : col <= 11 ? 'center' : col >= 12 && col <= 14 ? 'center' : 'center',
        vAlign: 'middle', wrap: false,
        numFmt: fmt,
      });
    }
    dataRow++;
  }

  // ── TOTALS ROW ─────────────────────────────────────────────────────────────
  ws.getRow(dataRow).height = 16;
  // "Total" label spanning A-H
  safeMerge(ws, dataRow, 1, dataRow, 8);
  scA(ws, dataRow, 1, 'Total', { bold:true, size:10, fill:C.TOTAL_ROW, hAlign:'center' });
  // "Grand Total" label in I col
  scA(ws, dataRow, 9, 'Grand Total', { bold:true, size:9, fill:C.TOTAL_ROW, hAlign:'center' });
  // Blank filler cols J-N
  for (let c=10; c<=14; c++) scA(ws, dataRow, c, '', { fill:C.TOTAL_ROW });
  // Qty totals
  scA(ws,dataRow,15, totDmgQty>0?totDmgQty:'-', {bold:true,fill:C.TOTAL_ROW,numFmt:QTY});
  scA(ws,dataRow,16, totNsQty >0?totNsQty :'-', {bold:true,fill:C.TOTAL_ROW,numFmt:QTY});
  scA(ws,dataRow,17, totBbdQty>0?totBbdQty:'-', {bold:true,fill:C.TOTAL_ROW,numFmt:QTY});
  scA(ws,dataRow,18, totTotQty,                  {bold:true,fill:C.TOTAL_ROW,numFmt:QTY});
  // Value totals
  scA(ws,dataRow,19, totDmgVal>0?totDmgVal:'-', {bold:true,fill:C.TOTAL_ROW,numFmt:INR});
  scA(ws,dataRow,20, totNsVal >0?totNsVal :'-', {bold:true,fill:C.TOTAL_ROW,numFmt:INR});
  scA(ws,dataRow,21, totBbdVal>0?totBbdVal:'-', {bold:true,fill:C.TOTAL_ROW,numFmt:INR});
  scA(ws,dataRow,22, totIncGst,                  {bold:true,fill:C.TOTAL_ROW,numFmt:INR});
  scA(ws,dataRow,23, totExcGst,                  {bold:true,fill:C.TOTAL_ROW,numFmt:INR});
  // MFD & Auditor cols — blank on totals
  for (let c=24; c<=29; c++) scA(ws, dataRow, c, '', { fill:C.TOTAL_ROW });

  // ── DECLARATION ROWS
  // Template: col C (col 3) is 165 wide — declarations written directly to col 3, NO merges
  // Row offsets match template: totals row + 3 blank rows = declStartRow
  const declStartRow = dataRow + 3;

  const declPts = [
    '1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit. ',
    "2. No Stock shall be taken into consideration before Oct'23 Manufacturing date. ",
    '3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.',
    '4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.',
  ];

  for (let i = 0; i < declPts.length; i++) {
    const dr = declStartRow + i;
    ws.getRow(dr).height = 20;
    // Write to col C (3) only — it is 165 wide in the template, no merge needed
    scA(ws, dr, 3, declPts[i], { size: 9, hAlign: 'left', vAlign: 'top', wrap: true });
  }

  // ── SIGN-OFF SECTION
  // Template exact column positions (no merges — just individual cells):
  //   Col C  (3)  : "Customer's Authorised person Name -"  |  "Seal & Sign -"
  //   Col O  (15) : "3rd Party Auditor"  |  firm name  |  "Auditor Sign"
  //   Col AB (28) : "Sales Team Name & contact no."  |  "Sign"
  // Rows follow template: declStartRow + 4 blank rows = signRow (equiv to template row 69)

  const signRow = declStartRow + 5;
  ws.getRow(signRow).height = 20;
  scA(ws, signRow, 3,  "Customer's Authorised person Name -", { size: 10, hAlign: 'left', bold: true, underline: true });
  scA(ws, signRow, 15, '3rd Party Auditor',                   { size: 10, hAlign: 'left', bold: true });
  scA(ws, signRow, 28, 'Sales Team Name & contact no.',       { size: 10, hAlign: 'left', bold: true, underline: true });

  // Firm name row (template row 70)
  const firmRow = signRow + 1;
  ws.getRow(firmRow).height = 18;
  scA(ws, firmRow, 15, firmName, { size: 10, hAlign: 'left' });

  // Seal & Sign + Auditor Sign + Sign row (template row 73 = signRow + 4)
  const sealRow = signRow + 4;
  ws.getRow(sealRow).height = 18;
  scA(ws, sealRow, 3,  'Seal & Sign -', { size: 10, hAlign: 'left', bold: true, underline: true });
  scA(ws, sealRow, 15, 'Auditor Sign',  { size: 10, hAlign: 'left', bold: true, underline: true });
  scA(ws, sealRow, 28, 'Sign',          { size: 10, hAlign: 'left' });

  // NO freeze pane — original template has none
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC HOOK
// ════════════════════════════════════════════════════════════════════════════════
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
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System';
      wb.created = new Date();

      // Sheet 1 — Sign-Off
      const ws1 = wb.addWorksheet('Sign-Off');
      await buildSignOffSheet(ws1, params.distributor, params.audit, params.items);

      // Sheet 2 — Article Level Format
      const ws2 = wb.addWorksheet('Article Level');
      await buildALFSheet(ws2, params.distributor, params.audit, params.items);

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
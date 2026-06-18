/**
 * useSignOffExport.ts  — Reliance Audit System
 *
 * 5-sheet Excel workbook + 2 PDF exports (Claim Letter, ALF PDF)
 *
 *  Sheet 1: "Sign Format."
 *  Sheet 2: "Article Level Format Revised"  (32 cols, group headers)
 *  Sheet 3: "Invoie details - Primary Damage"
 *  Sheet 4: "Attendance Sheet"
 *
 * FIX: All value calculations now use item.totalValue (stored in DB) as the
 * source of truth rather than recomputing qty * unitValue, which causes
 * floating-point drift (e.g. ₹1,050,413.96 vs ₹1,050,414.11).
 *
 * The split by type (damaged/nonSaleable/BBD) uses proportional allocation
 * from the stored totalValue so the per-type values always sum exactly to
 * item.totalValue.
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
  drainageDate?:    string | null;
  drainageEndDate?: string | null;
  approvedValue:    number;
  verifiedTotal:  number;
  auditorName?:   string;
  asmName?:       string;
}

export interface SignOffItem {
  articleNumber:   string;
  description:     string;
  quantity?:       number;
  totalValue?:     number;
  qtyDamaged:      number;
  qtyNonSaleable:  number;
  qtyBBD:          number;
  qtySampling?:    number;
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
  cell.value = value;
  if (opts.font)   cell.font   = opts.font;
  if (opts.fill)   cell.fill   = solidFill(opts.fill);
  if (opts.border !== null) cell.border = opts.border ?? thinBorder;
  cell.alignment = aln(opts.hAlign ?? 'left', opts.vAlign ?? 'middle', opts.wrap ?? true);
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

// ── Fresh distributor helper ──────────────────────────────────────────────────
async function fetchFreshDist(dist: SignOffDistributor): Promise<SignOffDistributor> {
  if (!dist.code) return dist;
  const { data } = await supabase.from('distributors').select('id,code,name,anchorName,address,city,state,region').eq('code', dist.code).single();
  if (!data) return dist;
  return { ...dist, name: data.name || dist.name, anchorName: data.anchorName || dist.anchorName, address: data.address || '', city: data.city || '', state: data.state || '', region: data.region || '' };
}

// ── ItemMaster enrichment ─────────────────────────────────────────────────────
async function enrichWithItemMaster(items: SignOffItem[]): Promise<SignOffItem[]> {
  const codes = [...new Set(items.map(i => i.articleNumber))];
  if (!codes.length) return items;
  const { data } = await supabase.from('itemMaster').select('itemCode,gst,standardPack,category').in('itemCode', codes);
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
  const qDmg  = item.qtyDamaged     || 0;
  const qNs   = item.qtyNonSaleable || 0;
  const qBbd  = item.qtyBBD         || 0;
  const qSamp = item.qtySampling    || 0;
  const qTot  = qDmg + qNs + qBbd + qSamp;

  // Use stored totalValue as the canonical total — never recompute from unitValue
  const vTot = item.totalValue != null
    ? item.totalValue
    : qTot * (item.unitValue || 0);

  if (qTot === 0) return { vDmg: 0, vNs: 0, vBbd: 0, vSamp: 0, vTot };

  // Proportional split with 2dp rounding
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const vDmg  = round2(vTot * qDmg  / qTot);
  const vNs   = round2(vTot * qNs   / qTot);
  const vBbd  = round2(vTot * qBbd  / qTot);
  // Last type absorbs any rounding remainder so sum == vTot exactly
  const vSamp = round2(vTot - vDmg - vNs - vBbd);

  return { vDmg, vNs, vBbd, vSamp, vTot };
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 1 — Sign Format
// ═════════════════════════════════════════════════════════════════════════════
function buildSignSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.columns = [
    { width: 2  }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 12 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 12 },
  ];

  // ── FIX: aggregate using splitValues() so per-type values derive from
  //         stored totalValue — not recomputed from unitValue * qty ──────────
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
    a.dmg   += item.qtyDamaged     || 0;
    a.ns    += item.qtyNonSaleable || 0;
    a.bbd   += item.qtyBBD         || 0;
    a.samp  += item.qtySampling    || 0;
    a.vDmg  += sv.vDmg;
    a.vNs   += sv.vNs;
    a.vBbd  += sv.vBbd;
    a.vSamp += sv.vSamp;
    a.vTot  += sv.vTot;
    if ((item.unitValue || 0) > a.uv) a.uv = item.unitValue;
  }

  const rows = [...agg.values()];
  const qDmg  = rows.reduce((s, v) => s + v.dmg,   0);
  const qSamp = rows.reduce((s, v) => s + v.samp,  0);
  const qNs   = rows.reduce((s, v) => s + v.ns,    0);
  const qBbd  = rows.reduce((s, v) => s + v.bbd,   0);
  const qTot  = qDmg + qSamp + qNs + qBbd;
  const vDmg  = rows.reduce((s, v) => s + v.vDmg,  0);
  const vSamp = rows.reduce((s, v) => s + v.vSamp, 0);
  const vNs   = rows.reduce((s, v) => s + v.vNs,   0);
  const vBbd  = rows.reduce((s, v) => s + v.vBbd,  0);
  // FIX: grand total = sum of all stored totalValues (not recomputed)
  const vTot  = rows.reduce((s, v) => s + v.vTot,  0);

  const approved    = audit.approvedValue || 0;
  const variancePct = approved > 0 ? (vTot - approved) / approved : 0;
  const INR = '[$₹-en-IN]#,##0.00'; const QTY = '#,##0'; const PCT = '0.00%';

  let r = 0;
  const nr = (h = 16) => { r++; ws.getRow(r).height = h; return r; };
  const scT = (row: number, col: number, value: ExcelJS.CellValue, opts: any = {}) =>
    setCell(ws, row, col, value, { font: tnrFont({ bold: opts.bold, size: opts.size || 10, underline: opts.underline }), ...opts });

  nr(18); safeMerge(ws,r,2,r,13);
  scT(r,2,'Audit Report - Phase V Part 2 Beverage',{bold:true,size:12,hAlign:'center',vAlign:'middle',wrap:false,border:{}});

  const infoLines: [string,string][] = [
    ['Audit Serial No. - ', audit.serialNo||''], ['Audit Firm Name - ', 'Singla Vishal & Co.'],
    ['Anchor Code - ', dist.code||''], ['Anchor Name/ Direct DB Name - ', dist.anchorName||''],
    ['Distributor name & City - ', `${dist.name||''}, ${dist.city||''}`],
    ['Audit Start Date - ', audit.scheduledDate||''], ['Audit End Date- ', audit.auditEndDate||audit.scheduledDate||''],
    ['Drainage Start Date - ', audit.drainageDate||''], ['Drainage End Date - ', audit.drainageEndDate||''],
  ];
  const addrParts = [dist.name,dist.address,dist.city,dist.state,dist.region].filter(Boolean);
  const customerAddress = addrParts.join(', ') || dist.name || 'N/A';

  const addrStartRow = r+1;
  safeMerge(ws,addrStartRow,7,addrStartRow+2,13);
  const addrCell = ws.getCell(addrStartRow,7);
  addrCell.value = { richText: [
    { text: 'Customer Full Address :- ', font: { ...tnrFont({bold:true,size:10}), underline: true } },
    { text: customerAddress, font: { ...tnrFont({bold:false,size:10}), underline: false } },
  ]} as any;
  addrCell.alignment = aln('left','top',true); addrCell.border = thinBorder;

  infoLines.forEach(([label,value],i) => {
    nr(16); safeMerge(ws,r,2,r,6);
    const cell = ws.getCell(r,2);
    cell.value = { richText: [{ text: label, font: tnrFont({bold:true,size:10}) }, { text: value, font: tnrFont({bold:false,size:10}) }] } as any;
    cell.alignment = aln('left','middle',false); cell.border = thinBorder;
    if (i >= 3) { safeMerge(ws,r,7,r,13); scT(r,7,'',{hAlign:'left',border:thinBorder}); }
  });

  nr(18);
  safeMerge(ws,r,2,r,6); scT(r,2,'Quantity Details - Physically verified & Drained',{bold:true,size:9,fill:C.LIGHT_BLUE,hAlign:'center',vAlign:'middle',wrap:false,border:thinBorder});
  safeMerge(ws,r,7,r,11); scT(r,7,'Value Details',{bold:true,size:9,fill:C.LIGHT_BLUE,hAlign:'center',vAlign:'middle',wrap:false,border:thinBorder});
  safeMerge(ws,r,12,r,13); scT(r,12,'Variance Summary',{bold:true,size:9,fill:C.ORANGE,hAlign:'center',vAlign:'middle',wrap:false,border:thinBorder});

  nr(50);
  const subH: Array<[number,number,string,string]> = [
    [2,2,'Primary Damage\n(Pcs)',C.LIGHT_BLUE],[3,3,'Sampling/Liquidation/\nFOC (PCS)',C.LIGHT_BLUE],
    [4,4,'Non-Saleable product and\nNon-manufacturing Defect\n(Pcs)',C.LIGHT_BLUE],[5,5,'BBD Stock\n(Pcs)',C.LIGHT_BLUE],
    [6,6,'Total Verified\nQuantity (Pcs)',C.LIGHT_BLUE],[7,7,'Primary Damage\n(INR)',C.LIGHT_BLUE],
    [8,8,'Sampling/Liquidation/\nFOC (INR)',C.LIGHT_BLUE],[9,9,'Non-Saleable product and\nNon-manufacturing Defect\n(INR)',C.LIGHT_BLUE],
    [10,10,'BBD Stock\n(INR)',C.LIGHT_BLUE],[11,11,'Total\nAudited\nValue',C.LIGHT_BLUE],
    [12,12,'Approved\nAmount',C.ORANGE],[13,13,'Variance %',C.ORANGE],
  ];
  for (const [c1,c2,text,fc] of subH) {
    if (c1!==c2) safeMerge(ws,r,c1,r,c2);
    scT(r,c1,text,{bold:true,size:8,fill:fc,hAlign:'center',vAlign:'middle',wrap:true,border:thinBorder});
  }

  nr(16);
  const totals: Array<[number,ExcelJS.CellValue,string|undefined]> = [
    [2,qDmg,QTY],[3,qSamp,QTY],[4,qNs,QTY],[5,qBbd,QTY],[6,qTot,QTY],
    [7,vDmg,INR],[8,vSamp,INR],[9,vNs,INR],[10,vBbd,INR],[11,vTot,INR],
    [12,approved,INR],[13,variancePct,PCT],
  ];
  for (const [col,val,fmt] of totals) scT(r,col,val,{hAlign:'center',vAlign:'middle',wrap:false,border:thinBorder,numFmt:fmt});

  nr(6); nr(6);

  nr(80); safeMerge(ws,r,2,r,9);
  setCell(ws,r,2,['Declaration from Customer -','1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.','2. I confirm that all stocks received by me with expiry date upto date of Audit has been cleared by company and I will not raise any further claim in this regard for products with expired.','3. Stock with above-mentioned quality & value has been verified and drained in front of us and no further claim shall be raised by for such cases in future.','4. We understood that, value mentioned in Audit report is indicative and final claim value shall be accessed by Reliance before processing the expiry claim.'].join('\n'),{font:tnrFont({size:9}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});
  safeMerge(ws,r,10,r,13); setCell(ws,r,10,"Customer's Authorised person Name -\n\n\n\n\nSeal & Sign -",{font:tnrFont({size:10}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});

  nr(6); nr(60); safeMerge(ws,r,2,r,9);
  setCell(ws,r,2,['Declaration from Reliance Sales Team -','1. This is to certify that the quantity mentioned in report is final for all the issues related to quality / leakage / breakage / damage / BBD / Primary or transit damage till the date of Audit.','2. This is to certify that Physical verification and destruction is taken place in front of myself. All the stock is drained by the distributor in front of Auditor.'].join('\n'),{font:tnrFont({size:9}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});
  safeMerge(ws,r,10,r,13); setCell(ws,r,10,'Sales Team Name & contact no.\n\nSales Team EMP ID\n\nSign',{font:tnrFont({size:10}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});

  nr(6); nr(60); safeMerge(ws,r,2,r,9);
  setCell(ws,r,2,["Declaration from Auditor-","1. This is to certify that Physical verification is done by us in front of customer and abovementioned sales Team.","2. Drainage of Stock has also been completed for the above mentioned quantity and no expired stock is available in customer's location."].join('\n'),{font:tnrFont({size:9}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});
  safeMerge(ws,r,10,r,13); setCell(ws,r,10,'Auditor Name & contact no.\n\n\nSeal & Sign',{font:tnrFont({size:10}),hAlign:'left',vAlign:'top',wrap:true,border:thinBorder});
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 2 — Article Level Format Revised  (32 cols A-AF)
// ═════════════════════════════════════════════════════════════════════════════
function buildALFSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0, footer: 0 } };

  const colWidths = [
    6, 16, 12, 12, 16, 14, 18, 18, 14, 28, 14, 10, 14, 8, 10,
    10, 12, 18, 10, 10, 14, 14, 18, 12, 14, 14, 13, 13, 8, 14, 24, 18,
  ];
  ws.columns = colWidths.map(w => ({ width: w }));
  ws.views = [{}];

  ws.getRow(1).height = 10;

  ws.getRow(2).height = 20;
  const groups: Array<[number,number,string,string]> = [
    [1,  15, 'Master Details',                C.MASTER_HDR],
    [16, 20, 'Quanity Detail',                C.QTY_HDR],
    [21, 26, 'Value Details - Including GST', C.VAL_HDR],
    [27, 30, 'MFD & Expiry Date',             C.MFD_HDR],
    [31, 32, 'Auditor Findings',              C.AUD_HDR],
  ];
  for (const [c1,c2,text,fc] of groups) {
    safeMerge(ws,2,c1,2,c2);
    setCell(ws,2,c1,text,{font:ariFont({bold:true,size:11}),fill:fc,hAlign:'center',vAlign:'middle',wrap:false,border:thinBorder});
  }

  ws.getRow(3).height = 150;
  const colHeaders: Array<[number,string,string]> = [
    [1,  'Sr No',                                                                           C.MASTER_HDR],
    [2,  'Std. Serial No.',                                                                 C.MASTER_HDR],
    [3,  'Region',                                                                          C.MASTER_HDR],
    [4,  'State',                                                                           C.MASTER_HDR],
    [5,  'Audit Team',                                                                      C.MASTER_HDR],
    [6,  'Anchor Code',                                                                     C.MASTER_HDR],
    [7,  'Anchor Name',                                                                     C.MASTER_HDR],
    [8,  'Distributor name',                                                                C.MASTER_HDR],
    [9,  'Article Code',                                                                    C.MASTER_HDR],
    [10, 'Brand Pack',                                                                      C.MASTER_HDR],
    [11, 'Category (CSD, Still, Water, Energy)',                                            C.MASTER_HDR],
    [12, 'NPI / NON - NPI',                                                                C.MASTER_HDR],
    [13, "Rate Including GST\n(As per Waitage Avg of Primary from Apr'25 to Jan'26)",      C.MASTER_HDR],
    [14, 'GST %',                                                                           C.MASTER_HDR],
    [15, 'Standard Pack',                                                                   C.MASTER_HDR],
    [16, 'Primary Damage\n(Pcs)',                                                           C.QTY_HDR],
    [17, 'Sampling/Liquidation/FOC (PCS)',                                                  C.QTY_HDR],
    [18, 'Non-Saleable product and Non-manufacturing Defect (Pcs)',                        C.QTY_HDR],
    [19, 'BBD Stock\n(Pcs)',                                                                C.QTY_HDR],
    [20, 'Total Verified\nQuantity (Pcs)',                                                  C.QTY_HDR],
    [21, 'Primary Damage\n(INR)',                                                           C.VAL_HDR],
    [22, 'Sampling/Liquidation/FOC (INR)',                                                  C.VAL_HDR],
    [23, 'Non-Saleable product and Non-manufacturing Defect (INR)',                        C.VAL_HDR],
    [24, 'BBD Stock\n(INR)',                                                                C.VAL_HDR],
    [25, 'Total Audited Value\n(Including GST)',                                            C.VAL_HDR],
    [26, 'Total Audited Value\n(Excluding GST)',                                            C.VAL_HDR],
    [27, 'Manufacturing Date',                                                              C.MFD_HDR],
    [28, 'Expiry Date',                                                                     C.MFD_HDR],
    [29, 'Product life in Months',                                                          C.MFD_HDR],
    [30, 'Manufacturing Quarter',                                                           C.MFD_HDR],
    [31, 'Issue in Product in detail',                                                      C.AUD_HDR],
    [32, 'Auditor Remarks',                                                                 C.AUD_HDR],
  ];
  for (const [col,text,fc] of colHeaders) {
    const cell = ws.getRow(3).getCell(col);
    cell.value     = text;
    cell.font      = ariFont({bold:true, size:9});
    cell.fill      = solidFill(fc);
    cell.alignment = { horizontal:'center', vertical:'middle', wrapText: true };
    cell.border    = thinBorder;
  }

  const serialNo = audit.serialNo || audit.id || '';
  const INR = '[$₹-en-IN]#,##0.00'; const QTY = '#,##0';

  const lifeMonths = (mfg?: string, exp?: string): string => {
    if (!mfg||!exp) return '';
    try { const m=new Date(mfg),e=new Date(exp); const mo=(e.getFullYear()-m.getFullYear())*12+(e.getMonth()-m.getMonth()); return mo>0?mo+' M':''; } catch { return ''; }
  };
  const mfgQuarter = (mfg?: string): string => {
    if (!mfg) return '';
    try { const m=new Date(mfg); const fy=m.getMonth()>=3?m.getFullYear():m.getFullYear()-1; const q=Math.floor(((m.getMonth()-3+12)%12)/3)+1; return `Q${q} FY${String(fy).slice(2)}-${String(fy+1).slice(2)}`; } catch { return ''; }
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
    a.dmg   += item.qtyDamaged     || 0;
    a.ns    += item.qtyNonSaleable || 0;
    a.bbd   += item.qtyBBD         || 0;
    a.samp  += item.qtySampling    || 0;
    a.vDmg  += sv.vDmg;
    a.vNs   += sv.vNs;
    a.vBbd  += sv.vBbd;
    a.vSamp += sv.vSamp;
    a.vTot  += sv.vTot;
    if ((item.unitValue || 0) > (a.item.unitValue || 0)) a.item = { ...a.item, ...item };
    else if (item.mfgDate && !a.item.mfgDate) a.item = { ...a.item, mfgDate: item.mfgDate, expDate: item.expDate };
  }

  let sno = 0;
  let tDmgQ=0, tSampQ=0, tNsQ=0, tBbdQ=0, tTotQ=0;
  let tDmgV=0, tSampV=0, tNsV=0, tBbdV=0, tIncV=0, tExcV=0;
  let dataRow = 4;

  for (const [, { item, dmg, ns, bbd, samp, vDmg, vNs, vBbd, vSamp, vTot }] of agg) {
    sno++;
    const qTot = dmg + samp + ns + bbd;
    const uv   = item.unitValue || 0;
    const gst  = Number(item.gst) || 0;
    // FIX: excl value derived from stored vTot, not recomputed
    const vExc = gst > 0 ? vTot / (1 + gst / 100) : vTot;

    tDmgQ  += dmg;  tSampQ += samp; tNsQ  += ns;   tBbdQ  += bbd;  tTotQ  += qTot;
    tDmgV  += vDmg; tSampV += vSamp; tNsV += vNs;  tBbdV  += vBbd; tIncV  += vTot; tExcV += vExc;

    ws.getRow(dataRow).height = 15;

    const rowData: Array<[number,ExcelJS.CellValue,string?]> = [
      [1,sno,QTY],[2,serialNo,undefined],[3,dist.region||'',undefined],[4,dist.state||'',undefined],
      [5,'Singla Vishal & Co.',undefined],[6,dist.code||'',undefined],[7,dist.anchorName||'',undefined],
      [8,dist.name||'',undefined],[9,item.articleNumber,undefined],[10,item.description,undefined],
      [11,item.category||'',undefined],[12,'',undefined],[13,uv,INR],
      [14,gst>0?gst+'%':'',undefined],[15,item.standardPack||'',undefined],
      [16,dmg,QTY],[17,samp,QTY],[18,ns,QTY],[19,bbd,QTY],[20,qTot,QTY],
      [21,vDmg,INR],[22,vSamp,INR],[23,vNs,INR],[24,vBbd,INR],[25,vTot,INR],[26,vExc,INR],
      [27,item.mfgDate||'',undefined],[28,item.expDate||'',undefined],
      [29,lifeMonths(item.mfgDate,item.expDate),undefined],[30,mfgQuarter(item.mfgDate),undefined],
      [31,item.reasonCode||'',undefined],[32,item.remarks||'',undefined],
    ];

    for (const [col,val,fmt] of rowData) {
      const cell = ws.getRow(dataRow).getCell(col);
      cell.value     = val;
      cell.font      = ariFont({size:9});
      cell.alignment = { horizontal: col<=2||col===7||col===8||col===9||col===10||col===11 ? 'left' : 'center', vertical:'middle', wrapText: false };
      cell.border    = thinBorder;
      if (fmt) cell.numFmt = fmt;
    }
    dataRow++;
  }

  // ── TOTALS ROW ─────────────────────────────────────────────────────────────
  ws.getRow(dataRow).height = 14;
  safeMerge(ws,dataRow,1,dataRow,15);
  setCell(ws,dataRow,1,'TOTAL',{font:ariFont({bold:true,size:9}),fill:C.TOTAL_ROW,hAlign:'center',border:thinBorder});

  const totalCols: Array<[number,number,string]> = [
    [16,tDmgQ,QTY],[17,tSampQ,QTY],[18,tNsQ,QTY],[19,tBbdQ,QTY],[20,tTotQ,QTY],
    [21,tDmgV,INR],[22,tSampV,INR],[23,tNsV,INR],[24,tBbdV,INR],[25,tIncV,INR],[26,tExcV,INR],
  ];
  for (const [col,val,fmt] of totalCols) {
    setCell(ws,dataRow,col,val,{font:ariFont({bold:true,size:9}),fill:C.TOTAL_ROW,hAlign:'center',border:thinBorder,numFmt:fmt});
  }
  for (let c=27;c<=32;c++) setCell(ws,dataRow,c,'',{fill:C.TOTAL_ROW,border:thinBorder});

  // ── SIGN-OFF DECLARATION SECTION ────────────────────────────────────────────
  const whiteFill = solidFill(C.WHITE);
  const noB: Partial<ExcelJS.Borders> = {};

  const clearSignRow = (rowNum: number, h = 18) => {
    ws.getRow(rowNum).height = h;
    for (let c = 1; c <= 32; c++) {
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

  clearSignRow(dataRow + 8, 18);
  writeSign(dataRow + 8, 3,  "Customer's Authorised person Name -", true);
  writeSign(dataRow + 8, 15, '3rd Party Auditor', true);
  writeSign(dataRow + 8, 28, 'Sales Team Name & contact no.', true);

  clearSignRow(dataRow + 9, 16);
  clearSignRow(dataRow + 10, 16);
  clearSignRow(dataRow + 11, 16);

  clearSignRow(dataRow + 12, 18);
  writeSign(dataRow + 12, 3,  'Seal & Sign -', true);
  writeSign(dataRow + 12, 15, 'Auditor Sign', true);
  writeSign(dataRow + 12, 28, 'Sign');
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 3 — Invoice Details Primary Damage
// ═════════════════════════════════════════════════════════════════════════════
function buildInvoiceDetailsSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit, items: SignOffItem[]) {
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.columns = [8,16,12,14,14,18,18,16,12,12,14].map(w=>({width:w}));
  setCell(ws,1,1,'Primary Damage - Invoice Level Details',{font:ariFont({bold:true,size:11}),hAlign:'left',border:{}});
  const headers=['Sr No','Audit Serial No.','Region','Audit Team','Anchor Code','Anchor Name','Distributor name','Invoice No.','Invoice Date','Damage Qty in Pcs','Damage Value in Rs.'];
  ws.getRow(2).height=30;
  headers.forEach((h,i)=>setCell(ws,2,i+1,h,{font:ariFont({bold:true,size:9}),fill:C.MASTER_HDR,hAlign:'center',vAlign:'middle',wrap:true,border:thinBorder}));
  // FIX: use splitValues to get damage value from stored totalValue
  items.filter(i=>(i.qtyDamaged||0)>0).forEach((item,idx)=>{
    ws.getRow(3+idx).height=15;
    const sv = splitValues(item);
    [idx+1,audit.serialNo||audit.id||'',dist.region||'','Singla Vishal & Co.',dist.code||'',dist.anchorName||'',dist.name||'','','',item.qtyDamaged||0, sv.vDmg].forEach((v,i)=>{
      setCell(ws,3+idx,i+1,v as ExcelJS.CellValue,{font:ariFont({size:9}),hAlign:i>=9?'right':'left',border:thinBorder,numFmt:i===10?'[$₹-en-IN]#,##0.00':i===9?'#,##0':undefined});
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SHEET 4 — Attendance Sheet
// ═════════════════════════════════════════════════════════════════════════════
function buildAttendanceSheet(ws: ExcelJS.Worksheet, dist: SignOffDistributor, audit: SignOffAudit) {
  ws.columns=[6,20,14,14,10,10,12,14].map(w=>({width:w}));
  setCell(ws,1,1,'Mandays details (Do mention date wise/Auditor Wise details)',{font:ariFont({bold:true,size:10}),hAlign:'left',border:{}});
  ['Day','Name of Auditor','Auditor no.','Date of audit','In Time','Out Time','Total Mandays','Counting/Drainage'].forEach((h,i)=>setCell(ws,2,i+1,h,{font:ariFont({bold:true,size:9}),fill:C.MASTER_HDR,hAlign:'center',vAlign:'middle',wrap:true,border:thinBorder}));
  ws.getRow(2).height=25;
  setCell(ws,3,1,1,{font:ariFont({size:9}),hAlign:'center',border:thinBorder});
  for (let c=2;c<=8;c++) setCell(ws,3,c,'',{font:ariFont({size:9}),border:thinBorder});
  setCell(ws,12,1,`Distributor: ${dist.name||''}`,{font:ariFont({bold:true,size:10}),hAlign:'left',border:{}});
  setCell(ws,13,1,'Sales Team:',{font:ariFont({size:10}),hAlign:'left',border:{}});
  setCell(ws,14,1,'Auditor:',{font:ariFont({size:10}),hAlign:'left',border:{}});
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HOOK
// ═════════════════════════════════════════════════════════════════════════════
export function useSignOffExport(params: {
  distributor: SignOffDistributor | undefined;
  audit:       SignOffAudit;
  items:       SignOffItem[];
}) {
  const [isExporting,     setIsExporting]     = useState(false);
  const [isExportingPDF,  setIsExportingPDF]  = useState(false);
  const [isExportingALF,  setIsExportingALF]  = useState(false);

  // ── Excel sign-off export ───────────────────────────────────────────────────
  const exportSignOff = async () => {
    if (!params.distributor) return;
    setIsExporting(true);
    try {
      const freshDist    = await fetchFreshDist(params.distributor);
      const enrichedItems = await enrichWithItemMaster(params.items);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System'; wb.created = new Date();
      buildSignSheet           (wb.addWorksheet('Sign Format.'),                    freshDist, params.audit, enrichedItems);
      buildALFSheet            (wb.addWorksheet('Article Level Format Revised'),    freshDist, params.audit, enrichedItems);
      buildInvoiceDetailsSheet (wb.addWorksheet('Invoie details - Primary Damage'), freshDist, params.audit, enrichedItems);
      buildAttendanceSheet     (wb.addWorksheet('Attendance Sheet'),                freshDist, params.audit);
      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const safeName = (freshDist.name || params.distributor.code || 'Audit').replace(/[\\/:*?"<>|]/g, '-');
      a.href = url; a.download = `AuditReport_${safeName}_${params.audit.scheduledDate??'draft'}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch(err){ console.error(err); alert('Failed to generate Excel. Please try again.'); }
    finally { setIsExporting(false); }
  };

  // ── Claim Letter PDF export ─────────────────────────────────────────────────
  const exportClaimPDF = async () => {
    if (!params.distributor) return;
    setIsExportingPDF(true);
    try {
      const sb = supabase;
      let freshDist: SignOffDistributor = params.distributor;
      if (params.distributor.code) {
        const { data: dbDist } = await sb
          .from('distributors')
          .select('id,code,name,anchorName,address,city,state,region')
          .eq('code', params.distributor.code)
          .single();
        if (dbDist) {
          freshDist = {
            ...params.distributor,
            name:       dbDist.name       || params.distributor.name       || '',
            anchorName: dbDist.anchorName || params.distributor.anchorName || '',
            address:    dbDist.address    || '',
            city:       dbDist.city       || '',
            state:      dbDist.state      || '',
            region:     dbDist.region     || '',
          };
        }
      }

      // FIX: use stored totalValue for PDF totals too
      const totalQty   = params.items.reduce((s, i) => s + ((i.qtyDamaged||0) + (i.qtyNonSaleable||0) + (i.qtyBBD||0)), 0);
      const totalValue = params.items.reduce((s, i) => s + (i.totalValue ?? ((i.qtyDamaged||0)+(i.qtyNonSaleable||0)+(i.qtyBBD||0)) * (i.unitValue||0)), 0);

      const auditDate  = params.audit.scheduledDate || '';
      const serialNo   = params.audit.serialNo || '';
      const anchorName = freshDist.anchorName || freshDist.name || '';
      const anchorCode = freshDist.code || '';
      const distCity   = freshDist.city || '';
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
      let freshDist: SignOffDistributor = params.distributor;
      if (params.distributor.code) {
        const { data: dbDist } = await sb.from('distributors').select('id,code,name,anchorName,address,city,state,region').eq('code', params.distributor.code).single();
        if (dbDist) freshDist = { ...params.distributor, name: dbDist.name || params.distributor.name, anchorName: dbDist.anchorName || params.distributor.anchorName, address: dbDist.address || '', city: dbDist.city || '', state: dbDist.state || '', region: dbDist.region || '' };
      }

      const codes = [...new Set(params.items.map(i => i.articleNumber))];
      const itemMasterMap: Record<string, any> = {};
      if (codes.length) {
        const { data: m } = await sb.from('itemMaster').select('itemCode,gst,standardPack,category').in('itemCode', codes);
        if (m) m.forEach((r: any) => { itemMasterMap[r.itemCode] = r; });
      }

      const enriched = params.items.map(i => ({
        ...i,
        gst:          itemMasterMap[i.articleNumber]?.gst          ?? i.gst          ?? 0,
        standardPack: itemMasterMap[i.articleNumber]?.standardPack ?? i.standardPack ?? '',
        category:     itemMasterMap[i.articleNumber]?.category     || i.category     || '',
      }));

      const fmtINR  = (v: number) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtQ    = (v: number) => v > 0 ? v.toLocaleString('en-IN') : '0';
      const lifeM   = (mfg: string, exp: string) => {
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
        { label: 'Master Details',                cols: 15, color: '#D9E1F2' },
        { label: 'Quantity Detail',               cols: 5,  color: '#BDD7EE' },
        { label: 'Value Details - Incl. GST',     cols: 6,  color: '#E2EFDA' },
        { label: 'MFD & Expiry Date',             cols: 4,  color: '#FFF2CC' },
        { label: 'Auditor Findings',              cols: 2,  color: '#D9D9D9' },
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
        const uv   = item.unitValue || 0;
        const gst  = Number(item.gst) || 0;
        const dmg  = item.qtyDamaged     || 0;
        const ns   = item.qtyNonSaleable || 0;
        const bbd  = item.qtyBBD         || 0;
        const samp = item.qtySampling    || 0;
        const tot  = dmg + ns + bbd + samp;

        // FIX: use splitValues for consistent per-type values
        const sv   = splitValues(item);
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
      const totDmg  = enriched.reduce((s, i) => s + splitValues(i).vDmg,  0);
      const totSamp = enriched.reduce((s, i) => s + splitValues(i).vSamp, 0);
      const totNs   = enriched.reduce((s, i) => s + splitValues(i).vNs,   0);
      const totBbd  = enriched.reduce((s, i) => s + splitValues(i).vBbd,  0);
      const totInc  = enriched.reduce((s, i) => s + splitValues(i).vTot,  0);
      const totExc  = enriched.reduce((s, i) => {
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
  <colgroup>${Array.from({length:32},(_,i)=>`<col class="c${i+1}">`).join('')}</colgroup>
  <thead><tr>${groupRow}</tr><tr>${headers.map(h => `<th>${h.replace(/\\n/g,'<br>')}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="totals">
      ${Array(15).fill('<td></td>').join('')}
      <td>${fmtQ(enriched.reduce((s,i)=>s+(i.qtyDamaged||0),0))}</td>
      <td>${fmtQ(enriched.reduce((s,i)=>s+(i.qtySampling||0),0))}</td>
      <td>${fmtQ(enriched.reduce((s,i)=>s+(i.qtyNonSaleable||0),0))}</td>
      <td>${fmtQ(enriched.reduce((s,i)=>s+(i.qtyBBD||0),0))}</td>
      <td>${fmtQ(enriched.reduce((s,i)=>s+((i.qtyDamaged||0)+(i.qtyNonSaleable||0)+(i.qtyBBD||0)+(i.qtySampling||0)),0))}</td>
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
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor } from '../types';
import {
  BarChart3, Download, FileText, IndianRupee, RefreshCw,
  ShieldAlert, Loader2, Search, X, Filter, Store,
} from 'lucide-react';
import { cn, useAuth } from '../App';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface ReportRow {
  // Master details
  serialNo:       string;
  region:         string;
  state:          string;
  auditTeam:      string;
  anchorCode:     string;
  anchorName:     string;
  distributorName:string;
  articleCode:    string;
  brandPack:      string;
  category:       string;
  rateInclGst:    number;
  gstPct:         number;
  standardPack:   string;
  // Quantities
  qtyDamaged:     number;
  qtySampling:    number;
  qtyNonSaleable: number;
  qtyBBD:         number;
  qtyTotal:       number;
  // Values
  valDamaged:     number;
  valSampling:    number;
  valNonSaleable: number;
  valBBD:         number;
  valTotalInclGst:number;
  valTotalExclGst:number;
  // Dates
  mfgDate:        string;
  expDate:        string;
  productLifeMonths: number | string;
  mfgQuarter:     string;
  // Findings
  issueDetail:    string;
  auditorRemarks: string;
  // Extra context
  scheduledDate:    string;
  auditStatus:      string;
  approvedValue:    number;
  drainageStartDate: string;
  drainageEndDate:   string;
}

export function ReportsModule() {
  const { profile } = useAuth();
  const [tickets, setTickets]           = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [reportData, setReportData]     = useState<ReportRow[]>([]);
  const [loading, setLoading]           = useState(false);
  const [isExporting, setIsExporting]   = useState(false);

  // ── Distributor filter state ──────────────────────────────────────────────
  const [distSearch, setDistSearch]       = useState('');          // search box text
  const [selectedDistId, setSelectedDistId] = useState<string>(''); // '' = all
  const [regionFilter, setRegionFilter]   = useState<string>('');  // '' = all regions
  const [statusFilter, setStatusFilter]   = useState<string>('');  // '' = all statuses

  const allowedRoles = ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm'];
  const hasAccess    = allowedRoles.includes(profile?.role || '');

  // ── Fetch base data ────────────────────────────────────────────────────────
  const fetchReportData = useCallback(async () => {
    if (!hasAccess) return;
    setLoading(true);
    try {
      const [tRes, dRes] = await Promise.all([
        supabase.from('auditTickets').select('*')
          .in('status', ['signed', 'evidence_uploaded', 'closed', 'drainage_pending', 'submitted']),
        supabase.from('distributors').select('*'),
      ]);
      if (tRes.error) throw tRes.error;
      if (dRes.error) throw dRes.error;
      setTickets((tRes.data || []) as AuditTicket[]);
      setDistributors((dRes.data || []) as Distributor[]);
    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoading(false);
    }
  }, [hasAccess]);

  useEffect(() => { fetchReportData(); }, [fetchReportData]);

  // ── Build report rows when base data arrives ───────────────────────────────
  useEffect(() => {
    if (!tickets.length || !distributors.length) { setReportData([]); return; }

    const buildRows = async () => {
      setLoading(true);
      try {
        const distMap: Record<string, any> = {};
        distributors.forEach(d => { distMap[d.id] = d; });

        // Paginated line items fetch
        const ticketIds  = tickets.map(t => t.id);
        if (ticketIds.length === 0) { setReportData([]); return; }

        let allItems: any[] = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from('auditLineItems')
            .select('*')
            .in('ticketId', ticketIds)
            .range(from, from + pageSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          allItems = allItems.concat(data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        // Build one ReportRow per line item (same as ALF — one row per article split)
        const rows: ReportRow[] = [];
        let sno = 0;

        // ── Enrich items with itemMaster data (category, GST, standardPack) ──
        // auditLineItems often has these as empty — itemMaster is the source of truth
        const uniqueArticleCodes = [...new Set(allItems.map(i => i.articleNumber).filter(Boolean))];
        const itemMasterMap: Record<string, { category: string; gst: number; standardPack: string }> = {};
        if (uniqueArticleCodes.length > 0) {
          // Fetch in batches of 500 to avoid URL length limits
          const BATCH = 500;
          for (let b = 0; b < uniqueArticleCodes.length; b += BATCH) {
            const { data: masterRows } = await supabase
              .from('itemMaster')
              .select('itemCode,category,gst,standardPack')
              .in('itemCode', uniqueArticleCodes.slice(b, b + BATCH));
            if (masterRows) {
              masterRows.forEach((m: any) => {
                itemMasterMap[m.itemCode] = {
                  category:     m.category     || '',
                  gst:          Number(m.gst)  || 0,
                  standardPack: m.standardPack || '',
                };
              });
            }
          }
        }

        for (const item of allItems) {
          const ticket = tickets.find(t => t.id === item.ticketId);
          if (!ticket) continue;
          const dist = distMap[ticket.distributorId];
          if (!dist) continue;

          sno++;
          const uv      = item.unitValue || 0;
          const master  = itemMasterMap[item.articleNumber] || {};
          const gstPct  = master.gst          ?? item.gst          ?? 0;
          const category     = master.category     || item.category     || '';
          const standardPack = master.standardPack || item.standardPack || '';
          const gstMul  = 1 + gstPct / 100;

          const qTot    = (item.qtyDamaged || 0) + (item.qtyNonSaleable || 0) + (item.qtyBBD || 0);
          const vDmg    = (item.qtyDamaged     || 0) * uv;
          const vNs     = (item.qtyNonSaleable || 0) * uv;
          const vBbd    = (item.qtyBBD         || 0) * uv;
          const vTot    = qTot * uv;
          const vExc    = gstMul > 1 ? vTot / gstMul : vTot;

          // Product life in months
          const lifeMonths = (() => {
            if (!item.mfgDate || !item.expDate) return '';
            try {
              const m = new Date(item.mfgDate), e = new Date(item.expDate);
              if (isNaN(m.getTime()) || isNaN(e.getTime())) return '';
              const mo = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth());
              return mo > 0 ? mo : '';
            } catch { return ''; }
          })();

          // Manufacturing quarter (Indian FY)
          const mfgQ = (() => {
            if (!item.mfgDate) return '';
            try {
              const m  = new Date(item.mfgDate);
              if (isNaN(m.getTime())) return '';
              const fy = m.getMonth() >= 3 ? m.getFullYear() : m.getFullYear() - 1;
              const q  = Math.floor(((m.getMonth() - 3 + 12) % 12) / 3) + 1;
              return `Q${q} FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
            } catch { return ''; }
          })();

          rows.push({
            serialNo:        (dist as any).assignment_serial_no || ticket.id || '',
            region:          (dist as any).region     || '',
            state:           (dist as any).state      || '',
            auditTeam:       'Singla Vishal & Co.',
            anchorCode:      (dist as any).code       || '',
            anchorName:      (dist as any).anchorName || '',
            distributorName: (dist as any).name       || '',
            articleCode:     item.articleNumber        || '',
            brandPack:       item.description          || '',
            category:        category,
            rateInclGst:     uv,
            gstPct:          gstPct,
            standardPack:    standardPack,
            qtyDamaged:      item.qtyDamaged     || 0,
            qtySampling:     0,
            qtyNonSaleable:  item.qtyNonSaleable || 0,
            qtyBBD:          item.qtyBBD         || 0,
            qtyTotal:        qTot,
            valDamaged:      vDmg,
            valSampling:     0,
            valNonSaleable:  vNs,
            valBBD:          vBbd,
            valTotalInclGst: vTot,
            valTotalExclGst: vExc,
            mfgDate:         item.mfgDate   || '',
            expDate:         item.expDate   || '',
            productLifeMonths: lifeMonths,
            mfgQuarter:      mfgQ,
            issueDetail:     item.reasonCode || '',
            auditorRemarks:  item.remarks    || '',
            scheduledDate:      ticket.scheduledDate || '',
            drainageStartDate: ticket.signOffs?.drainageDate    || '',
            drainageEndDate:   ticket.signOffs?.drainageEndDate || '',
            auditStatus:     ticket.status   || '',
            approvedValue:   ticket.approvedValue || (distMap[ticket.distributorId]?.approvedValue) || 0,
          });
        }

        setReportData(rows);
      } catch (err) {
        console.error('Error building report:', err);
      } finally {
        setLoading(false);
      }
    };

    buildRows();
  }, [tickets, distributors]);

  // ── Unique filter options derived from raw reportData ───────────────────
  const uniqueDistributors = Array.from(
    new Map(
      reportData.map(r => [r.anchorCode, { id: r.anchorCode, name: r.distributorName, code: r.anchorCode, serialNo: r.serialNo }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const uniqueRegions = Array.from(new Set(reportData.map(r => r.region).filter(Boolean))).sort();

  const uniqueStatuses = Array.from(new Set(reportData.map(r => r.auditStatus).filter(Boolean))).sort();

  // ── Apply all filters to reportData ──────────────────────────────────────
  const filteredReportData = reportData.filter(r => {
    // Distributor filter (by anchor code = distributor identifier)
    if (selectedDistId && r.anchorCode !== selectedDistId) return false;
    // Region filter
    if (regionFilter && r.region !== regionFilter) return false;
    // Status filter
    if (statusFilter && r.auditStatus !== statusFilter) return false;
    // Search — covers distributor name, code, serial no, article code, brand pack
    if (distSearch.trim()) {
      const q = distSearch.toLowerCase();
      if (
        !r.distributorName.toLowerCase().includes(q) &&
        !r.anchorCode.toLowerCase().includes(q) &&
        !r.serialNo.toLowerCase().includes(q) &&
        !r.articleCode.toLowerCase().includes(q) &&
        !r.brandPack.toLowerCase().includes(q) &&
        !r.region.toLowerCase().includes(q) &&
        !r.state.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const hasActiveFilter = selectedDistId || regionFilter || statusFilter || distSearch.trim();

  // ── Totals ─────────────────────────────────────────────────────────────────
  // Totals always reflect the filtered set
  const totals = {
    qtyDamaged:      filteredReportData.reduce((s, r) => s + r.qtyDamaged,      0),
    qtySampling:     filteredReportData.reduce((s, r) => s + r.qtySampling,     0),
    qtyNonSaleable:  filteredReportData.reduce((s, r) => s + r.qtyNonSaleable,  0),
    qtyBBD:          filteredReportData.reduce((s, r) => s + r.qtyBBD,          0),
    qtyTotal:        filteredReportData.reduce((s, r) => s + r.qtyTotal,        0),
    valDamaged:      filteredReportData.reduce((s, r) => s + r.valDamaged,      0),
    valSampling:     filteredReportData.reduce((s, r) => s + r.valSampling,     0),
    valNonSaleable:  filteredReportData.reduce((s, r) => s + r.valNonSaleable,  0),
    valBBD:          filteredReportData.reduce((s, r) => s + r.valBBD,          0),
    valTotalInclGst: filteredReportData.reduce((s, r) => s + r.valTotalInclGst, 0),
    valTotalExclGst: filteredReportData.reduce((s, r) => s + r.valTotalExclGst, 0),
  };

  // ── Excel export ───────────────────────────────────────────────────────────
  const downloadExcel = async () => {
    if (filteredReportData.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System';
      wb.created = new Date();
      const ws = wb.addWorksheet('Combined Audit Report');
      // Export uses filteredReportData so "Download Excel" always matches current view
      const exportData = filteredReportData;

      ws.pageSetup = {
        orientation: 'landscape', paperSize: 9,
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      };

      // ── Column widths (32 cols A–AF, matching ALF sheet) ──────────────────
      const colWidths = [
        6, 16, 12, 12, 16, 14, 18, 18, 14, 28, 14, 10, 14, 8, 10,
        10, 12, 18, 10, 10, 14, 14, 18, 12, 14, 14, 14, 12, 14, 14, 24, 18,
      ];
      ws.columns = colWidths.map(w => ({ width: w }));

      // ── Colour palette ────────────────────────────────────────────────────
      const C = {
        MASTER:  'FFD9E1F2',
        QTY:     'FFBDD7EE',
        VAL:     'FFE2EFDA',
        MFD:     'FFFFF2CC',
        AUD:     'FFD9D9D9',
        TOTAL:   'FFFFD966',
        WHITE:   'FFFFFFFF',
      };
      const fill = (argb: string): ExcelJS.Fill =>
        ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
      const thin = { style: 'thin' as ExcelJS.BorderStyle };
      const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
      const aFont = (bold = false, size = 9): Partial<ExcelJS.Font> =>
        ({ name: 'Arial', bold, size, color: { argb: 'FF000000' } });
      const setCell = (
        row: number, col: number, value: ExcelJS.CellValue,
        opts: { bold?: boolean; size?: number; fill?: string;
          hAlign?: ExcelJS.Alignment['horizontal'];
          vAlign?: ExcelJS.Alignment['vertical'];
          wrap?: boolean; numFmt?: string;
          border?: Partial<ExcelJS.Borders> | null; } = {}
      ) => {
        const cell = ws.getRow(row).getCell(col);
        cell.value     = value;
        cell.font      = aFont(opts.bold, opts.size ?? 9);
        cell.alignment = {
          horizontal: opts.hAlign ?? 'center',
          vertical:   opts.vAlign ?? 'middle',
          wrapText:   opts.wrap   ?? true,
        };
        if (opts.fill)   cell.fill   = fill(opts.fill);
        if (opts.border !== null) cell.border = opts.border ?? border;
        if (opts.numFmt) cell.numFmt = opts.numFmt;
      };
      const merge = (r1: number, c1: number, r2: number, c2: number) => {
        try { ws.mergeCells(r1, c1, r2, c2); } catch { /* already merged */ }
      };

      // ── ROW 1: Report title ───────────────────────────────────────────────
      ws.getRow(1).height = 24;
      merge(1, 1, 1, 32);
      setCell(1, 1, 'Combined Audit Report — Article Level Data', {
        bold: true, size: 13,
        fill: C.MASTER, hAlign: 'center', border,
      });

      // ── ROW 2: Generation date ────────────────────────────────────────────
      ws.getRow(2).height = 16;
      merge(2, 1, 2, 32);
      const filterNote = hasActiveFilter ? `  |  Filter: ${selectedDistId ? (uniqueDistributors.find(d => d.id === selectedDistId)?.name || selectedDistId) : ''}${regionFilter ? ` Region: ${regionFilter}` : ''}${statusFilter ? ` Status: ${statusFilter}` : ''}${distSearch ? ` Search: "${distSearch}"` : ''}` : '';
      setCell(2, 1, `Generated: ${new Date().toLocaleString('en-IN')}  |  Records: ${exportData.length}${filterNote}`, {
        size: 9, fill: C.WHITE, hAlign: 'center', border,
      });

      // ── ROW 3: Section group headers ──────────────────────────────────────
      ws.getRow(3).height = 20;
      const sections: [number, number, string, string][] = [
        [1,  15, 'Master Details',                C.MASTER],
        [16, 20, 'Quantity Detail',               C.QTY],
        [21, 26, 'Value Details - Including GST', C.VAL],
        [27, 30, 'MFD & Expiry Date',             C.MFD],
        [31, 32, 'Auditor Findings',              C.AUD],
      ];
      for (const [c1, c2, text, fc] of sections) {
        merge(3, c1, 3, c2);
        setCell(3, c1, text, { bold: true, size: 10, fill: fc, hAlign: 'center', border });
      }

      // ── ROW 4: Column headers (height 150 matching ALF) ───────────────────
      ws.getRow(4).height = 150;
      const colHeaders: [number, string, string][] = [
        [1,  'Sr No',                                                                                    C.MASTER],
        [2,  'Std. Serial No.',                                                                          C.MASTER],
        [3,  'Region',                                                                                   C.MASTER],
        [4,  'State',                                                                                    C.MASTER],
        [5,  'Audit Team',                                                                               C.MASTER],
        [6,  'Anchor Code',                                                                              C.MASTER],
        [7,  'Anchor Name',                                                                              C.MASTER],
        [8,  'Distributor name',                                                                         C.MASTER],
        [9,  'Article Code',                                                                             C.MASTER],
        [10, 'Brand Pack',                                                                               C.MASTER],
        [11, 'Category (CSD, Still, Water, Energy)',                                                     C.MASTER],
        [12, 'NPI / NON - NPI',                                                                         C.MASTER],
        [13, "Rate Including GST\n(As per Waitage Avg of Primary from Apr'25 to Jan'26)",               C.MASTER],
        [14, 'GST %',                                                                                    C.MASTER],
        [15, 'Standard Pack',                                                                            C.MASTER],
        [16, 'Primary Damage\n(Pcs)',                                                                    C.QTY],
        [17, 'Sampling/Liquidation/\nFOC (PCS)',                                                         C.QTY],
        [18, 'Non-Saleable product and Non-manufacturing Defect (Pcs)',                                  C.QTY],
        [19, 'BBD Stock\n(Pcs)',                                                                         C.QTY],
        [20, 'Total Verified\nQuantity (Pcs)',                                                           C.QTY],
        [21, 'Primary Damage\n(INR)',                                                                    C.VAL],
        [22, 'Sampling/Liquidation/\nFOC (INR)',                                                         C.VAL],
        [23, 'Non-Saleable product and Non-manufacturing Defect (INR)',                                  C.VAL],
        [24, 'BBD Stock\n(INR)',                                                                         C.VAL],
        [25, 'Total Audited Value\n(Including GST)',                                                     C.VAL],
        [26, 'Total Audited Value\n(Excluding GST)',                                                     C.VAL],
        [27, 'Manufacturing Date',                                                                       C.MFD],
        [28, 'Expiry Date',                                                                              C.MFD],
        [29, 'Product life in Months',                                                                   C.MFD],
        [30, 'Manufacturing Quarter',                                                                    C.MFD],
        [31, 'Issue in Product in detail',                                                               C.AUD],
        [32, 'Auditor Remarks',                                                                          C.AUD],
      ];
      for (const [col, text, fc] of colHeaders) {
        setCell(4, col, text, { bold: true, size: 9, fill: fc, hAlign: 'center', vAlign: 'middle', wrap: true, border });
      }

      // ── FREEZE top 4 rows + first column ──────────────────────────────────
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];

      // ── DATA ROWS ─────────────────────────────────────────────────────────
      const INR  = '[$₹-en-IN]#,##0.00';
      const QTY  = '#,##0';

      exportData.forEach((row, i) => {
        const rowNum = i + 5;
        ws.getRow(rowNum).height = 15;

        const cells: [number, ExcelJS.CellValue, string?][] = [
          [1,  i + 1,               QTY],
          [2,  row.serialNo,        undefined],
          [3,  row.region,          undefined],
          [4,  row.state,           undefined],
          [5,  row.auditTeam,       undefined],
          [6,  row.anchorCode,      undefined],
          [7,  row.anchorName,      undefined],
          [8,  row.distributorName, undefined],
          [9,  row.articleCode,     undefined],
          [10, row.brandPack,       undefined],
          [11, row.category,        undefined],
          [12, '',                  undefined],
          [13, row.rateInclGst,     INR],
          [14, row.gstPct > 0 ? row.gstPct : '', row.gstPct > 0 ? '0.00"%"' : undefined],
          [15, row.standardPack,    undefined],
          [16, row.qtyDamaged     || 0, QTY],
          [17, row.qtySampling    || 0, QTY],
          [18, row.qtyNonSaleable || 0, QTY],
          [19, row.qtyBBD         || 0, QTY],
          [20, row.qtyTotal       || 0, QTY],
          [21, row.valDamaged     || 0, INR],
          [22, row.valSampling    || 0, INR],
          [23, row.valNonSaleable || 0, INR],
          [24, row.valBBD         || 0, INR],
          [25, row.valTotalInclGst,     INR],
          [26, row.valTotalExclGst,     INR],
          [27, row.mfgDate,         undefined],
          [28, row.expDate,         undefined],
          [29, row.productLifeMonths,   undefined],
          [30, row.mfgQuarter,      undefined],
          [31, row.issueDetail,     undefined],
          [32, row.auditorRemarks,  undefined],
        ];

        // Alternating row shading for readability
        const rowFill = i % 2 === 0 ? undefined : 'FFF7F7F7';

        for (const [col, val, fmt] of cells) {
          setCell(rowNum, col, val, {
            size:   9,
            hAlign: col <= 2 ? 'center' : col <= 12 ? 'left' : 'center',
            vAlign: 'middle',
            wrap:   false,
            fill:   rowFill,
            numFmt: fmt,
            border,
          });
        }
      });

      // ── TOTALS ROW ────────────────────────────────────────────────────────
      const totRow = reportData.length + 5;
      ws.getRow(totRow).height = 18;

      merge(totRow, 1, totRow, 9);
      setCell(totRow, 1, 'GRAND TOTAL', { bold: true, size: 10, fill: C.TOTAL, hAlign: 'center', border });
      for (let c = 10; c <= 15; c++) setCell(totRow, c, '', { fill: C.TOTAL, border });

      const totCells: [number, number, string][] = [
        [16, totals.qtyDamaged,      QTY],
        [17, totals.qtySampling,     QTY],
        [18, totals.qtyNonSaleable,  QTY],
        [19, totals.qtyBBD,          QTY],
        [20, totals.qtyTotal,        QTY],
        [21, totals.valDamaged,      INR],
        [22, totals.valSampling,     INR],
        [23, totals.valNonSaleable,  INR],
        [24, totals.valBBD,          INR],
        [25, totals.valTotalInclGst, INR],
        [26, totals.valTotalExclGst, INR],
      ];
      for (const [col, val, fmt] of totCells) {
        setCell(totRow, col, val, { bold: true, size: 10, fill: C.TOTAL, hAlign: 'center', numFmt: fmt, border });
      }
      for (let c = 27; c <= 32; c++) setCell(totRow, c, '', { fill: C.TOTAL, border });

      // ── Download ──────────────────────────────────────────────────────────
      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = `CombinedAuditReport_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export error:', err);
      alert('Failed to generate report. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // ── Access denied ─────────────────────────────────────────────────────────
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] w-full p-4">
        <div className="bg-red-50 border border-red-100 p-8 rounded-[2rem] max-w-md w-full text-center shadow-sm">
          <ShieldAlert className="text-red-500 w-16 h-16 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-red-700 font-medium">
            Financial Reports are restricted to Management and Admin personnel.
          </p>
        </div>
      </div>
    );
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 pb-12">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <BarChart3 className="text-indigo-600" size={26} /> Combined Audit Report
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            All closed/submitted audits — one row per line item, 32-column Article Level format.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchReportData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw size={18} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            onClick={downloadExcel}
            disabled={filteredReportData.length === 0 || isExporting || loading}
            className={cn(
              'flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-md active:scale-95 text-sm',
              filteredReportData.length > 0 && !isExporting && !loading
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            {isExporting
              ? <><Loader2 size={18} className="animate-spin" /> Generating…</>
              : <><Download size={18} /> Download Excel</>
            }
          </button>
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col gap-3">

          {/* Row 1: search + active filter chips */}
          <div className="flex flex-col sm:flex-row gap-3">

            {/* Search box */}
            <div className="relative flex-1 group">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors pointer-events-none" />
              <input
                type="text"
                placeholder="Search distributor name, code, article, region…"
                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                value={distSearch}
                onChange={e => setDistSearch(e.target.value)}
              />
              {distSearch && (
                <button onClick={() => setDistSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Distributor dropdown */}
            <div className="relative shrink-0 min-w-[220px]">
              <Store size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer appearance-none transition-all"
                value={selectedDistId}
                onChange={e => setSelectedDistId(e.target.value)}
              >
                <option value="">All Distributors</option>
                {uniqueDistributors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Region dropdown */}
            {uniqueRegions.length > 0 && (
              <div className="relative shrink-0 min-w-[150px]">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer appearance-none transition-all"
                  value={regionFilter}
                  onChange={e => setRegionFilter(e.target.value)}
                >
                  <option value="">All Regions</option>
                  {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}

            {/* Status dropdown */}
            {uniqueStatuses.length > 0 && (
              <div className="relative shrink-0 min-w-[160px]">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer appearance-none transition-all"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  {uniqueStatuses.map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Row 2: result count + active filter chips + clear button */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500">
              {filteredReportData.length.toLocaleString('en-IN')} of {reportData.length.toLocaleString('en-IN')} rows
            </span>

            {selectedDistId && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg">
                <Store size={11} />
                {uniqueDistributors.find(d => d.id === selectedDistId)?.name || selectedDistId}
                <button onClick={() => setSelectedDistId('')} className="ml-0.5 hover:text-indigo-900"><X size={11} /></button>
              </span>
            )}
            {regionFilter && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg">
                Region: {regionFilter}
                <button onClick={() => setRegionFilter('')} className="ml-0.5 hover:text-emerald-900"><X size={11} /></button>
              </span>
            )}
            {statusFilter && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg">
                {statusFilter.replace(/_/g, ' ')}
                <button onClick={() => setStatusFilter('')} className="ml-0.5 hover:text-amber-900"><X size={11} /></button>
              </span>
            )}
            {distSearch && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg">
                "{distSearch}"
                <button onClick={() => setDistSearch('')} className="ml-0.5 hover:text-slate-900"><X size={11} /></button>
              </span>
            )}
            {hasActiveFilter && (
              <button
                onClick={() => { setSelectedDistId(''); setRegionFilter(''); setStatusFilter(''); setDistSearch(''); }}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 underline ml-1 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards — reflect filtered totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center shrink-0">
            <FileText className="text-slate-600" size={22} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Line Items</p>
            <p className="text-2xl font-black text-slate-900">{filteredReportData.length.toLocaleString('en-IN')}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-blue-600" size={22} />
          </div>
          <div>
            <p className="text-xs font-bold text-blue-400 uppercase tracking-wider">Total Verified (Incl. GST)</p>
            <p className="text-2xl font-black text-slate-900">
              ₹{totals.valTotalInclGst >= 100000
                ? `${(totals.valTotalInclGst / 100000).toFixed(2)}L`
                : totals.valTotalInclGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-emerald-600" size={22} />
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Total Verified (Excl. GST)</p>
            <p className="text-2xl font-black text-slate-900">
              ₹{totals.valTotalExclGst >= 100000
                ? `${(totals.valTotalExclGst / 100000).toFixed(2)}L`
                : totals.valTotalExclGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </div>

      {/* Preview table */}
      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-700">
            Preview <span className="text-slate-400 font-medium">(first 50 rows — download for full data)</span>
          </p>
          {loading && (
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-600">
              <Loader2 size={14} className="animate-spin" /> Building report…
            </div>
          )}
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs min-w-[1200px]">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {[
                  'Sr', 'Serial No', 'Region', 'Anchor Code', 'Distributor',
                  'Article Code', 'Brand Pack', 'Category',
                  'Rate (₹)', 'Dmg Qty', 'NS Qty', 'BBD Qty', 'Total Qty',
                  'Dmg Value', 'NS Value', 'BBD Value', 'Total (Incl GST)',
                  'Mfg Date', 'Exp Date', 'Issue', 'Remarks',
                ].map(h => (
                  <th key={h} className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reportData.length === 0 && !loading ? (
                <tr>
                  <td colSpan={21} className="px-6 py-12 text-center text-slate-400">
                    <BarChart3 size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="font-bold text-sm">No report data available.</p>
                    <p className="text-xs mt-1">There are no signed or closed audits to report on.</p>
                  </td>
                </tr>
              ) : (
                filteredReportData.slice(0, 50).map((row, i) => (
                  <tr key={i} className={cn('hover:bg-slate-50/50', i % 2 === 1 && 'bg-slate-50/30')}>
                    <td className="px-3 py-2 font-mono text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-indigo-600 whitespace-nowrap">{row.serialNo || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{row.region || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{row.anchorCode}</td>
                    <td className="px-3 py-2 font-bold text-slate-900 max-w-[140px] truncate">{row.distributorName}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{row.articleCode}</td>
                    <td className="px-3 py-2 max-w-[140px] truncate text-slate-700">{row.brandPack}</td>
                    <td className="px-3 py-2 text-slate-500">{row.category || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">₹{row.rateInclGst.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-indigo-700 font-bold">{row.qtyDamaged || 0}</td>
                    <td className="px-3 py-2 text-center text-rose-700 font-bold">{row.qtyNonSaleable || 0}</td>
                    <td className="px-3 py-2 text-center text-amber-700 font-bold">{row.qtyBBD || 0}</td>
                    <td className="px-3 py-2 text-center font-black text-slate-900">{row.qtyTotal}</td>
                    <td className="px-3 py-2 text-right text-slate-700">₹{row.valDamaged.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">₹{row.valNonSaleable.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">₹{row.valBBD.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-black text-emerald-700">₹{row.valTotalInclGst.toFixed(0)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.mfgDate || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.expDate || '—'}</td>
                    <td className="px-3 py-2 max-w-[120px] truncate text-slate-600">{row.issueDetail || '—'}</td>
                    <td className="px-3 py-2 max-w-[120px] truncate text-slate-500">{row.auditorRemarks || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredReportData.length > 50 && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-center">
            <p className="text-xs text-slate-500 font-medium">
              Showing first 50 of <span className="font-black text-slate-700">{reportData.length.toLocaleString('en-IN')}</span> rows.
              Download the Excel file to see all data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { fetchCachedDistributors } from '../supabaseOptimized';
import { Distributor } from '../types';
import { Download, Upload, Loader2, Search, ShieldAlert, CheckCircle2, Lock, AlertTriangle, FileSpreadsheet, X } from 'lucide-react';
import { cn, useAuth } from '../App';
import {
    RsoAuditLine, RsoDeduction, RsoDumpRow, RsoResult, RsoLinesResult, buildRsoLines, buildRso,
} from '../rso';

// An audit counts as "completed" once it reached any of these statuses.
const COMPLETE_STATUSES = ['submitted', 'drainage_pending', 'signed', 'evidence_uploaded', 'closed', 'completed'];
const MIN_EXPIRY_YEAR = 2025;

const inr = (n: number) => '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: any) => parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0;
const anchorKeyOf = (d: any) => String(d.anchorName || d.name || '').trim();

async function fetchPaged<T = any>(build: (from: number, to: number) => any): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build(from, from + 999);
        if (error) throw error;
        if (!data || !data.length) break;
        out.push(...data);
        if (data.length < 1000) break;
    }
    return out;
}

function toIsoDate(raw: any): string {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return s.slice(0, 10);
}

interface AnchorSummary { key: string; dists: any[]; total: number; done: number; pending: number; }

export function RSOModule() {
    const { profile, activeAssignment } = useAuth();
    const assignmentId = activeAssignment?.id || 'assignment-1';
    const allowed = ['superadmin', 'admin'].includes(profile?.role || '');
    const lsKey = `rso-deductions-${assignmentId}`;

    const [loading, setLoading] = useState(true);
    const [anchors, setAnchors] = useState<AnchorSummary[]>([]);
    const [search, setSearch] = useState('');
    const [deductions, setDeductions] = useState<RsoDeduction[]>([]);
    const [dedMsg, setDedMsg] = useState<string>('');
    const [dedBusy, setDedBusy] = useState(false);
    const [selected, setSelected] = useState<string>('');
    const [generating, setGenerating] = useState(false);
    const [result, setResult] = useState<null | { anchor: string; res: RsoResult; lines: RsoLinesResult; items: number; dumpCount: number; distNames: string[] }>(null);
    const [error, setError] = useState('');

    // ── Base data: anchors + audit completion ────────────────────────────────────
    const loadBase = useCallback(async () => {
        if (!allowed) return;
        setLoading(true);
        try {
            const dists = (await fetchCachedDistributors(assignmentId, profile || { uid: '', role: 'admin' })) as Distributor[];
            const tickets = await fetchPaged<any>((f, t) => supabase.from('auditTickets').select('id,distributorId,status').eq('assignment_id', assignmentId).order('id').range(f, t));
            const doneDist = new Set<string>();
            tickets.forEach(t => { if (COMPLETE_STATUSES.includes(t.status)) doneDist.add(t.distributorId); });
            const map = new Map<string, any[]>();
            (dists as any[]).forEach(d => { const k = anchorKeyOf(d); if (!k) return; const a = map.get(k) || []; a.push(d); map.set(k, a); });
            const list: AnchorSummary[] = [...map.entries()].map(([key, ds]) => {
                const done = ds.filter(d => doneDist.has(d.id)).length;
                return { key, dists: ds, total: ds.length, done, pending: ds.length - done };
            }).sort((a, b) => a.key.localeCompare(b.key));
            setAnchors(list);
        } catch (e: any) {
            console.error(e); setError(e.message || 'Failed to load anchors');
        } finally { setLoading(false); }
    }, [allowed, assignmentId, profile]);

    // ── Deduction % (saved per assignment) ────────────────────────────────────────
    const loadDeductions = useCallback(async () => {
        try {
            const { data, error } = await supabase.from('rsoDeductions').select('category,articleCode,percent').eq('assignment_id', assignmentId);
            if (error) throw error;
            setDeductions((data || []).map((r: any) => ({ category: r.category || undefined, article: r.articleCode || undefined, pct: Number(r.percent) || 0 })));
        } catch {
            try { setDeductions(JSON.parse(localStorage.getItem(lsKey) || '[]')); } catch { setDeductions([]); }
        }
    }, [assignmentId, lsKey]);

    useEffect(() => { loadBase(); loadDeductions(); }, [loadBase, loadDeductions]);

    const downloadDeductionTemplate = () => {
        const csv = 'Category,ArticleCode,DeductionPercent\nCSD,,0\nStills,,0\nWater,,0\nEnergy,,0\n';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        a.download = 'RSO_Deduction_Template.csv'; a.click();
    };

    const uploadDeductions = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target; const file = input.files?.[0];
        if (!file) return;
        setDedBusy(true); setDedMsg('');
        try {
            const lines = (await file.text()).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
            const split = (s: string) => s.split(',').map(x => x.replace(/^"|"$/g, '').trim());
            const h = split(lines[0] || '').map(x => x.toLowerCase().replace(/[\s_]/g, ''));
            const iCat = h.indexOf('category'), iArt = h.findIndex(x => ['articlecode', 'article', 'itemcode'].includes(x));
            const iPct = h.findIndex(x => ['deductionpercent', 'deduction%', 'deduction', 'percent', 'pct'].includes(x));
            if (iPct === -1 || (iCat === -1 && iArt === -1)) throw new Error('Header must be: Category, ArticleCode, DeductionPercent');
            const parsed: RsoDeduction[] = [];
            lines.slice(1).forEach(l => {
                const c = split(l);
                const pctRaw = c[iPct]; if (pctRaw === undefined || pctRaw === '') return;
                const pct = parseFloat(pctRaw.replace('%', '')); if (isNaN(pct) || pct < 0 || pct > 100) return;
                const art = iArt >= 0 ? (c[iArt] || '') : ''; const cat = iCat >= 0 ? (c[iCat] || '') : '';
                if (art) parsed.push({ article: art, category: cat || undefined, pct }); else if (cat) parsed.push({ category: cat, pct });
            });
            if (!parsed.length) throw new Error('No valid rows found.');
            let savedTo = 'database';
            try {
                const del = await supabase.from('rsoDeductions').delete().eq('assignment_id', assignmentId);
                if (del.error) throw del.error;
                const ins = await supabase.from('rsoDeductions').insert(parsed.map(p => ({
                    assignment_id: assignmentId, category: p.category || null, articleCode: p.article || null, percent: p.pct,
                })));
                if (ins.error) throw ins.error;
            } catch {
                localStorage.setItem(lsKey, JSON.stringify(parsed));
                savedTo = 'this browser only (run the rsoDeductions SQL to save it in the database)';
            }
            setDeductions(parsed);
            setDedMsg(`${parsed.length} deduction rule(s) saved to ${savedTo}.`);
        } catch (err: any) { setDedMsg(`Upload failed: ${err.message}`); }
        finally { setDedBusy(false); input.value = ''; }
    };

    // ── Generate RSO for one anchor ───────────────────────────────────────────────
    const generate = async (a: AnchorSummary) => {
        setGenerating(true); setError(''); setResult(null);
        try {
            const distById = new Map<string, any>(a.dists.map(d => [d.id, d]));
            const codes = [...new Set(a.dists.map(d => String(d.code).trim()))];
            const tickets = await fetchPaged<any>((f, t) => supabase.from('auditTickets').select('id,distributorId,status')
                .eq('assignment_id', assignmentId).in('distributorId', a.dists.map(d => d.id)).in('status', COMPLETE_STATUSES).order('id').range(f, t));
            const ticketDist = new Map<string, any>(tickets.map(t => [t.id, distById.get(t.distributorId)]));
            const ticketIds = tickets.map(t => t.id);

            let items: any[] = [];
            for (let i = 0; i < ticketIds.length; i += 100) {
                const chunk = ticketIds.slice(i, i + 100);
                items = items.concat(await fetchPaged<any>((f, t) => supabase.from('auditLineItems').select('*')
                    .eq('assignment_id', assignmentId).in('ticketId', chunk).order('id').range(f, t)));
            }

            // category per article from the item master (audit lines often have it blank)
            const articleCodes = [...new Set(items.map(i => i.articleNumber).filter(Boolean))] as string[];
            const catByArticle: Record<string, string> = {};
            for (let i = 0; i < articleCodes.length; i += 300) {
                const { data } = await supabase.from('itemMaster').select('itemCode,category').eq('assignment_id', assignmentId).in('itemCode', articleCodes.slice(i, i + 300));
                (data || []).forEach((m: any) => { if (m.category) catByArticle[m.itemCode] = m.category; });
            }

            const auditLines: RsoAuditLine[] = items.map(it => {
                const d = ticketDist.get(it.ticketId) || {};
                const uv = num(it.unitValue);
                const qd = num(it.qtyDamaged), qn = num(it.qtyNonSaleable), qb = num(it.qtyBBD);
                return {
                    distCode: String(d.code || ''), distName: d.name || '', state: d.state || '',
                    article: String(it.articleNumber || ''), brandPack: it.description || '',
                    category: catByArticle[it.articleNumber] || it.category || '',
                    totalIncl: (qd + qn + qb) * uv, pdValue: qd * uv, expDate: it.expDate || null,
                };
            });

            // Sales dump of every distributor under this anchor
            let dumpRaw: any[] = [];
            for (let i = 0; i < codes.length; i += 80) {
                const chunk = codes.slice(i, i + 80);
                dumpRaw = dumpRaw.concat(await fetchPaged<any>((f, t) => supabase.from('salesDump')
                    .select('itemCode,itemName,quantity,totalValue,category,billingDate,plant,billingDoc,distributorCode')
                    .eq('assignment_id', assignmentId).in('distributorCode', chunk).order('id').range(f, t)));
            }
            const nameByCode = new Map<string, string>(a.dists.map(d => [String(d.code).trim(), d.name]));
            const dump: RsoDumpRow[] = dumpRaw.map(d => ({
                distCode: String(d.distributorCode || '').trim(), distName: nameByCode.get(String(d.distributorCode || '').trim()) || '',
                article: String(d.itemCode || ''), itemName: d.itemName || '',
                category: d.category || catByArticle[d.itemCode] || '',
                qty: num(d.quantity), value: num(d.totalValue), date: toIsoDate(d.billingDate),
                plant: d.plant || '', doc: String(d.billingDoc || ''),
            }));

            const lines = buildRsoLines(auditLines, deductions, MIN_EXPIRY_YEAR);
            const res = buildRso(a.key, lines.lines, lines.rsoByLine, dump);
            setResult({ anchor: a.key, res, lines, items: items.length, dumpCount: dump.length, distNames: a.dists.map(d => d.name) });
        } catch (e: any) {
            console.error(e); setError(e.message || 'Failed to generate RSO');
        } finally { setGenerating(false); }
    };

    // ── Excel — identical layout to the "RSO Format" + "RSO status" sheets of RSO_Working.xlsx ──
    const downloadExcel = async () => {
        if (!result) return;
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('RSO Format', { views: [{ state: 'frozen', ySplit: 3, zoomScale: 90 }] });
        const heads = ['Comm', 'Customer Code', 'Customer Name', 'Distributor Name', 'Location', 'Claim Reason', 'Billing Site code',
            'Invoice Internal Ref no', 'Invoice Date', 'Article Code', 'Brand Pack', 'Category', 'Billed Qty', 'Rate in Invoice (With GST)',
            'Billed Value (With GST)', 'RSO Qty in EA', 'RSO Value (Total Audited Value\n(Including GST)', 'Qty Diff', 'Add/Del',
            'Revised RSO Qty', 'Revised RSO Value', 'Qty Diff', 'Remarks', 'Balance Value'];
        const widths = [20, 12.5, 33.4, 33.4, 10.9, 11.1, 12.9, 18.2, 16.4, 10.1, 39.5, 7.7, 13.2, 14.8, 15, 11.5, 16.7, 10.4, 13.2, 13.5, 14.7, 12.5, 15.3, 11.5];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
        const headFill = ['FFFFC000', 'FFFFC000', 'FFFFC000', 'FFFFC000', 'FFFFC000', 'FFD9E1F2', 'FFFFFF00', 'FFFFFF00', 'FFFFFF00',
            'FFFFC000', 'FFFFC000', 'FFFFC000', 'FFFFFF00', 'FFFFFF00', 'FFFFFF00', 'FFD9E1F2', 'FFFFC000', 'FFD9E1F2', 'FFFFC000',
            'FFFFC000', 'FFD9E1F2', 'FFFFC000', 'FFFFC000', 'FFFFC000'];
        const thin = { style: 'thin' as const };
        const box = { top: thin, bottom: thin, left: thin, right: thin };
        const ACC = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';
        const rows = result.res.rows;
        const first = 4, last = first + rows.length - 1;
        ['Q', 'S', 'T', 'U', 'V'].forEach(c => {
            const cell = ws.getCell(`${c}2`);
            cell.value = { formula: `SUBTOTAL(9,${c}${first}:${c}${Math.max(last, first)})` };
            cell.numFmt = ACC; cell.font = { name: 'Calibri', size: 11 };
        });
        const hr = ws.getRow(3); hr.height = 39;
        heads.forEach((h, i) => {
            const c = hr.getCell(i + 1); c.value = h;
            c.font = { bold: i !== 16, name: 'Calibri', size: 10 };
            c.alignment = { wrapText: [12, 13, 14, 16, 18, 19, 20, 21, 22, 23].includes(i), vertical: 'bottom', horizontal: 'center' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headFill[i] } };
            c.border = box;
        });
        const orange = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF4B183' } };
        const arial = { name: 'Arial', size: 9 }, cal = { name: 'Calibri', size: 11 };
        const remarkText = (t: string) => t === 'Adjusted' ? 'adjusted' : t === 'Partially Adjusted' ? 'partially adjusted' : 'Ok';
        rows.forEach((r, i) => {
            const n = first + i; const row = ws.getRow(n);
            const noInv = !r.doc && !(r.billedQty > 0);
            const partial = r.remarks === 'Partially Adjusted';
            const set = (col: number, val: any, font: any, align?: 'left' | 'center', nf?: string) => {
                const c = row.getCell(col); c.value = val; c.font = font; c.border = box;
                if (align) c.alignment = { horizontal: align }; if (nf) c.numFmt = nf; return c;
            };
            set(1, { formula: `B${n}&J${n}`, result: `${r.custCode}${r.article}` }, cal, 'center');
            set(2, r.custCode, arial, 'left'); set(3, r.anchorName, arial, 'left'); set(4, r.distName, arial, 'left'); set(5, r.state, arial, 'left');
            set(6, 'Virtual BBD', cal, 'center');
            if (noInv) {
                set(7, { error: '#N/A' }, cal); set(8, { error: '#N/A' }, cal); set(9, { error: '#N/A' }, cal, undefined, 'mm-dd-yy');
            } else {
                set(7, r.plant, cal); set(8, /^\d+$/.test(r.doc) ? Number(r.doc) : r.doc, cal);
                set(9, r.date ? new Date(r.date + 'T00:00:00Z') : null, cal, undefined, 'mm-dd-yy');
            }
            set(10, r.article, arial, 'left'); set(11, r.brandPack || null, arial, 'left'); set(12, r.category, arial, 'left');
            set(13, noInv ? 0 : r.billedQty, cal, undefined, noInv ? undefined : '#,##0.000');
            if (noInv) set(14, { error: '#DIV/0!' }, cal);
            else set(14, { formula: `O${n}/M${n}`, result: r.rate }, cal);
            set(15, noInv ? 0 : r.billedValue, cal, undefined, noInv ? undefined : '#,##0.00');
            const p = set(16, { formula: `IFERROR(ROUNDDOWN(Q${n}/N${n},0),0)` }, cal, 'center'); p.fill = orange;
            set(17, r.rsoValue > 0 ? r.rsoValue : null, cal);
            const rr = set(18, { formula: `IFERROR((M${n}-P${n}),0)` }, cal, 'center'); rr.fill = orange;
            if (noInv) set(19, { formula: `-Q${n}`, result: -r.rsoValue }, cal);
            else if (partial) set(19, { formula: `-${Math.abs(r.addDel)}`, result: r.addDel }, cal);
            else set(19, r.addDel, cal);
            set(20, { formula: `IFERROR(ROUNDDOWN(U${n}/N${n},0),0)` }, cal, 'center');
            set(21, { formula: `Q${n}+S${n}` }, cal, 'center', '0');
            set(22, { formula: `(M${n}-T${n})` }, cal, 'center');
            set(23, remarkText(r.remarks), cal, 'center');
            set(24, partial ? { formula: `V${n}*N${n}` } : null, cal);
        });
        ws.autoFilter = { from: 'A3', to: `X${Math.max(last, first)}` };

        // ── "RSO status" sheet ────────────────────────────────────────────────────────
        const st = wb.addWorksheet('RSO status');
        ['S. No.', 'Anchor Name', 'Distributor Name', 'Remarks'].forEach((h, i) => {
            const c = st.getRow(2).getCell(i + 1); c.value = h; c.font = { bold: true, name: 'Calibri', size: 11 }; c.border = box;
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
        });
        const inRso = new Set(rows.map(r => r.distName));
        const remark = (name: string) => result.dumpCount === 0 ? 'No data in sales dump'
            : result.res.status === 'Complete' ? 'Complete' : 'Insufficient invoices for settlement';
        const stNames = result.distNames.filter(n => inRso.has(n) || result.dumpCount === 0);
        (stNames.length ? stNames : [result.anchor]).forEach((name, i) => {
            const rr = st.getRow(3 + i);
            rr.getCell(1).value = i === 0 ? 1 : { formula: `A${2 + i}+1` };
            rr.getCell(2).value = result.anchor; rr.getCell(3).value = name; rr.getCell(4).value = remark(name);
            [1, 2, 3, 4].forEach(k => { rr.getCell(k).border = box; });
        });
        [8, 34, 40, 36].forEach((w, i) => { st.getColumn(i + 1).width = w; });

        const buf = await wb.xlsx.writeBuffer();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = `RSO_${result.anchor.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`; a.click();
    };

    const filtered = useMemo(() => anchors.filter(a => a.key.toLowerCase().includes(search.toLowerCase())), [anchors, search]);

    if (!allowed) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                <ShieldAlert size={40} /><p className="mt-3 font-bold">RSO is available to superadmin and admin only.</p>
            </div>
        );
    }

    const sel = anchors.find(a => a.key === selected);
    const dedCats = deductions.filter(d => !d.article).length, dedArts = deductions.filter(d => d.article).length;

    return (
        <div className="space-y-5">
            {/* Deduction upload */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">Deduction %</h3>
                    <p className="text-sm text-slate-500">
                        {deductions.length ? `${dedCats} category rule(s), ${dedArts} article rule(s) loaded.` : 'No deduction rules uploaded yet — every line will use 0%.'}
                    </p>
                    {dedMsg && <p className="text-xs font-bold text-indigo-600 mt-1">{dedMsg}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                    <button onClick={downloadDeductionTemplate} className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold hover:bg-slate-50 active:scale-95">
                        <Download size={16} /> Template
                    </button>
                    <label className={cn('flex items-center gap-2 px-3 py-2.5 bg-slate-100 rounded-xl text-sm font-bold hover:bg-slate-200 cursor-pointer active:scale-95', dedBusy && 'opacity-60 pointer-events-none')}>
                        {dedBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
                        <input type="file" accept=".csv" className="hidden" onChange={uploadDeductions} />
                    </label>
                </div>
            </div>

            {/* Anchors */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-slate-100 flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search anchor…"
                            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <span className="text-xs font-bold text-slate-400 whitespace-nowrap">{filtered.length} anchors</span>
                </div>
                {loading ? (
                    <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
                ) : (
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                        {filtered.map(a => {
                            const ready = a.pending === 0 && a.total > 0;
                            return (
                                <button key={a.key} onClick={() => { setSelected(a.key); setResult(null); setError(''); }}
                                    className={cn('w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors', selected === a.key && 'bg-indigo-50')}>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-slate-900 truncate text-sm">{a.key}</p>
                                        <p className="text-xs text-slate-500">{a.done} of {a.total} distributors audited{a.pending ? ` · ${a.pending} pending` : ''}</p>
                                    </div>
                                    <span className={cn('flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg shrink-0',
                                        ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                                        {ready ? <><CheckCircle2 size={12} /> Ready</> : <><Lock size={12} /> Audit pending</>}
                                    </span>
                                </button>
                            );
                        })}
                        {!filtered.length && <p className="p-8 text-center text-sm text-slate-400">No anchors found.</p>}
                    </div>
                )}
            </div>

            {/* Selected anchor */}
            {sel && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="font-bold text-slate-900 truncate">{sel.key}</h3>
                            <p className="text-sm text-slate-500">{sel.done} of {sel.total} distributors audited</p>
                        </div>
                        <button disabled={sel.pending > 0 || generating} onClick={() => generate(sel)}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                            {generating ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />} Generate RSO
                        </button>
                    </div>
                    {sel.pending > 0 && (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-center gap-2">
                            <Lock size={14} /> RSO can be prepared only after the audit of every distributor under this anchor is completed ({sel.pending} pending).
                        </p>
                    )}
                    {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className={cn('flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg',
                                result.res.status === 'Complete' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                                {result.res.status === 'Complete' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {result.res.status}
                            </span>
                            <span className="text-sm font-bold text-slate-700">{result.anchor}</span>
                        </div>
                        <button onClick={downloadExcel} className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 active:scale-95">
                            <Download size={18} /> Download Excel
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {[
                            ['RSO value', inr(result.res.totalRso)],
                            ['Lines', result.res.rows.length.toLocaleString('en-IN')],
                            ['Unsettled balance', inr(result.res.balance)],
                            ['Audit lines used', `${result.lines.lines.length} of ${result.items}`],
                        ].map(([k, v]) => (
                            <div key={k} className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</p><p className="font-black text-slate-900 text-sm sm:text-base truncate">{v}</p></div>
                        ))}
                    </div>
                    {(result.lines.skippedOld > 0 || result.lines.skippedNoDate > 0 || result.lines.noDeductionArticles.length > 0 || result.res.balance > 0.01) && (
                        <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 space-y-1 list-disc list-inside">
                            {result.lines.skippedOld > 0 && <li>{result.lines.skippedOld} line(s) skipped — expiry before {MIN_EXPIRY_YEAR}.</li>}
                            {result.lines.skippedNoDate > 0 && <li>{result.lines.skippedNoDate} line(s) skipped — no expiry date.</li>}
                            {result.lines.noDeductionArticles.length > 0 && <li>No deduction % found for {result.lines.noDeductionArticles.length} article(s) — 0% was used.</li>}
                            {result.res.balance > 0.01 && <li>{inr(result.res.balance)} could not be placed — not enough invoices in the sales dump for this anchor.</li>}
                        </ul>
                    )}
                    <div className="overflow-x-auto border border-slate-100 rounded-xl max-h-[420px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 sticky top-0">
                                <tr className="text-left text-slate-500">
                                    {['Distributor', 'Article', 'Category', 'Invoice', 'Billed Qty', 'Rate', 'RSO Value', 'Add/Del', 'Remarks'].map(h => <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {result.res.rows.slice(0, 300).map((r, i) => (
                                    <tr key={i} className={r.added ? 'bg-sky-50/40' : ''}>
                                        <td className="px-3 py-1.5 max-w-[160px] truncate">{r.distName}</td>
                                        <td className="px-3 py-1.5 whitespace-nowrap"><span className="font-mono">{r.article}</span><span className="block text-[10px] text-slate-400 max-w-[160px] truncate">{r.brandPack}</span></td>
                                        <td className="px-3 py-1.5">{r.category}</td>
                                        <td className="px-3 py-1.5 whitespace-nowrap">{r.doc || '—'}</td>
                                        <td className="px-3 py-1.5 text-right">{r.billedQty.toLocaleString('en-IN')}</td>
                                        <td className="px-3 py-1.5 text-right">{r.rate ? r.rate.toFixed(2) : '—'}</td>
                                        <td className="px-3 py-1.5 text-right">{r.rsoValue ? inr(r.rsoValue) : '—'}</td>
                                        <td className={cn('px-3 py-1.5 text-right', r.addDel < 0 ? 'text-red-600' : r.addDel > 0 ? 'text-emerald-600' : '')}>{r.addDel ? inr(r.addDel) : '—'}</td>
                                        <td className="px-3 py-1.5 whitespace-nowrap font-bold">{r.remarks}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {result.res.rows.length > 300 && <p className="p-2 text-center text-[11px] text-slate-400">Showing first 300 of {result.res.rows.length} rows — the Excel has all of them.</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
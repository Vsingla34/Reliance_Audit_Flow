// ─────────────────────────────────────────────────────────────────────────────
// RSO (settlement of expired stock) — calculation engine.
// Follows the "Standard Operating Procedure – RSO working" step by step.
// Pure functions only (no React / no database) so the logic can be tested alone.
// ─────────────────────────────────────────────────────────────────────────────

export interface RsoAuditLine {
    distCode: string;
    distName: string;
    state: string;
    article: string;
    brandPack: string;
    category: string;
    totalIncl: number;     // Total audited value incl. GST
    pdValue: number;       // Primary damage value (excluded from RSO)
    expDate?: string | null;
}

export interface RsoDumpRow {
    distCode: string;
    distName: string;
    article: string;
    itemName: string;
    category: string;
    qty: number;
    value: number;         // Billed value incl. GST
    date: string;          // ISO yyyy-mm-dd
    plant: string;
    doc: string;
}

export interface RsoDeduction { category?: string; article?: string; pct: number; }

export interface RsoRow {
    custCode: string;
    anchorName: string;
    distName: string;
    state: string;
    plant: string;
    doc: string;
    date: string;
    article: string;
    brandPack: string;
    category: string;
    billedQty: number;
    rate: number;          // invoice rate incl. GST
    billedValue: number;
    rsoValue: number;      // Q
    addDel: number;        // S
    remarks: 'Adjusted' | 'Partially Adjusted' | 'Ok';
    added: boolean;        // invoice line added for settlement
}

export interface RsoLinesResult {
    lines: RsoAuditLine[];
    rsoByLine: number[];           // RSO value of each line
    deductionByLine: number[];
    skippedOld: number;            // expiry before the cut-off year
    skippedNoDate: number;         // no expiry date
    noDeductionArticles: string[]; // lines for which no deduction % matched (treated as 0)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-6) / 100;

/** "Stills" / "STILL" → "still", "Water" → "water" … */
export function catKey(c: string): string {
    const k = (c || '').toLowerCase().replace(/[^a-z]/g, '');
    return k.endsWith('s') && k !== 'csd' ? k.slice(0, -1) : k;
}
/** Categories that may be combined when invoices of one category are not enough. */
function catGroup(k: string): string[] {
    if (k === 'csd' || k === 'energy') return ['csd', 'energy'];
    if (k === 'still' || k === 'water') return ['still', 'water'];
    return [k];
}

export function expiryYear(d?: string | null): number | null {
    if (!d) return null;
    const m = String(d).match(/(\d{4})/);
    if (m && /^\d{4}-/.test(String(d))) return +m[1];
    const dt = new Date(d as string);
    return isNaN(dt.getTime()) ? null : dt.getFullYear();
}

// ── Steps 1–2: RSO value per audited line ──────────────────────────────────────
export function buildRsoLines(
    items: RsoAuditLine[], deductions: RsoDeduction[], minExpiryYear = 2025,
): RsoLinesResult {
    const byArticle = new Map<string, number>();
    const byCategory = new Map<string, number>();
    deductions.forEach(d => {
        if (d.article) byArticle.set(String(d.article).trim(), d.pct);
        else if (d.category) byCategory.set(catKey(d.category), d.pct);
    });

    const out: RsoLinesResult = { lines: [], rsoByLine: [], deductionByLine: [], skippedOld: 0, skippedNoDate: 0, noDeductionArticles: [] };
    const missing = new Set<string>();
    for (const it of items) {
        const y = expiryYear(it.expDate);
        if (y === null) { out.skippedNoDate++; continue; }
        if (y < minExpiryYear) { out.skippedOld++; continue; }
        const base = round2(it.totalIncl - it.pdValue);          // total incl. GST − primary damage
        if (base <= 0) continue;
        let pct = byArticle.get(String(it.article).trim());
        if (pct === undefined) pct = byCategory.get(catKey(it.category));
        if (pct === undefined) { pct = 0; missing.add(it.article); }
        const ded = round2(base * pct / 100);
        out.lines.push(it);
        out.deductionByLine.push(ded);
        out.rsoByLine.push(round2(base - ded));
    }
    out.noDeductionArticles = [...missing];
    return out;
}

// ── Steps 3–7: match invoices and settle ───────────────────────────────────────
interface Inv extends RsoDumpRow { rate: number; used: number; usedInRows: boolean; }

export interface RsoResult {
    rows: RsoRow[];
    status: 'Complete' | 'Insufficient invoices for settlement';
    balance: number;       // value that could not be placed on invoices (0 when complete)
    totalRso: number;
}

export function buildRso(
    anchorName: string, lines: RsoAuditLine[], rsoValues: number[], dump: RsoDumpRow[],
): RsoResult {
    // Invoice pool: only real sales (positive qty & value). Returns / zero rows are ignored.
    const pool: Inv[] = dump
        .filter(d => d.qty > 0 && d.value > 0)
        .map(d => ({ ...d, rate: d.value / d.qty, used: 0, usedInRows: false }));
    // Preference: largest billed value, then newest, then oldest (stable by doc number).
    const cmp = (a: Inv, b: Inv) =>
        b.value - a.value || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || (a.doc > b.doc ? 1 : -1);
    pool.sort(cmp);

    // Step 4 — every article appears once: consolidate RSO value per article
    const consolidated = new Map<string, { line: RsoAuditLine; value: number }>();
    lines.forEach((l, i) => {
        const c = consolidated.get(l.article);
        if (c) c.value = round2(c.value + rsoValues[i]);
        else consolidated.set(l.article, { line: l, value: rsoValues[i] });
    });

    const rows: RsoRow[] = [];
    const mkRow = (l: RsoAuditLine, inv: Inv | null, q: number, add: number, remarks: RsoRow['remarks'], added: boolean): RsoRow => ({
        custCode: inv?.distCode || l.distCode, anchorName,
        distName: inv?.distName || l.distName, state: l.state,
        plant: inv?.plant || '', doc: inv?.doc || '', date: inv?.date || '',
        article: l.article, brandPack: l.brandPack || inv?.itemName || '', category: l.category,
        billedQty: inv?.qty || 0, rate: inv?.rate || 0, billedValue: inv?.value || 0,
        rsoValue: q, addDel: add, remarks, added,
    });

    const excess = new Map<string, number>();       // category key → value taken off, to be re-placed
    const addExcess = (k: string, v: number) => excess.set(k, round2((excess.get(k) || 0) + v));

    for (const { line, value } of consolidated.values()) {
        if (value <= 0) continue;
        const k = catKey(line.category);
        const invs = pool.filter(p => p.article === line.article);
        let remaining = value;
        const mine: { inv: Inv; q: number }[] = [];
        for (const inv of invs) {
            if (remaining <= 0.004) break;
            const cap = round2(inv.value - inv.used);
            if (cap <= 0.004) continue;
            const take = Math.min(remaining, cap);
            inv.used = round2(inv.used + take); inv.usedInRows = true;
            remaining = round2(remaining - take);
            mine.push({ inv, q: round2(take) });
        }
        if (mine.length === 0) {
            // Step 5 — no invoice / qty difference zero → Add/Del = −RSO value
            rows.push(mkRow(line, null, value, -value, 'Adjusted', false));
            addExcess(k, value);
            continue;
        }
        mine.forEach((m, idx) => {
            const last = idx === mine.length - 1;
            if (last && remaining > 0.004) {
                // Step 6 — qty difference negative → Add/Del = −(qty diff) × invoice rate
                const q = round2(m.q + remaining);
                const p = Math.floor(q / m.inv.rate + 1e-9);
                const over = Math.max(0, p - m.inv.qty);
                const cut = Math.min(q, round2(over * m.inv.rate));
                rows.push(mkRow(line, m.inv, q, -cut, 'Partially Adjusted', false));
                addExcess(k, cut);
            } else {
                rows.push(mkRow(line, m.inv, m.q, 0, 'Ok', false));
            }
        });
    }

    // ── Step 7 — move the value taken off onto lines with spare invoice quantity ───
    const spareOf = (r: RsoRow) => {
        // value that can still be added without the revised qty exceeding billed qty
        const u = r.rsoValue + r.addDel;
        return Math.max(0, floor2(r.billedQty * r.rate - u - 0.01));
    };
    const place = (k: string, groupKeys: string[]) => {
        let rem = excess.get(k) || 0;
        if (rem <= 0.004) return;
        // 1) lines already in the sheet (same category set), largest invoice first
        const cands = rows
            .filter(r => r.billedQty > 0 && groupKeys.includes(catKey(r.category)))
            .sort((a, b) => b.billedValue - a.billedValue || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
        for (const r of cands) {
            if (rem <= 0.004) break;
            const sp = spareOf(r);
            if (sp <= 0) continue;
            const put = Math.min(rem, sp);
            r.addDel = round2(r.addDel + put);
            rem = round2(rem - put);
        }
        // 2) additional invoices from the sales dump (same Anchor, same category set)
        if (rem > 0.004) {
            for (const inv of pool) {
                if (rem <= 0.004) break;
                if (inv.usedInRows || !groupKeys.includes(catKey(inv.category))) continue;
                const put = Math.min(rem, floor2(inv.value - 0.01));
                if (put <= 0) continue;
                const l: RsoAuditLine = {
                    distCode: inv.distCode, distName: inv.distName, state: rows[0]?.state || '', article: inv.article,
                    brandPack: inv.itemName, category: inv.category, totalIncl: 0, pdValue: 0,
                };
                rows.push(mkRow(l, inv, 0, put, 'Ok', true));
                inv.usedInRows = true; inv.used = inv.value;
                rem = round2(rem - put);
            }
        }
        excess.set(k, rem);
    };
    const cats = [...excess.keys()];
    // pass 1 — within the same category
    cats.forEach(k => place(k, [k]));
    // pass 2 — still short: CSD+Energy / Stills+Water may be combined
    cats.forEach(k => { if ((excess.get(k) || 0) > 0.004) place(k, catGroup(k)); });

    const balance = round2([...excess.values()].reduce((s, v) => s + v, 0));
    const totalRso = round2(rows.reduce((s, r) => s + r.rsoValue, 0));
    return { rows, status: balance > 0.01 ? 'Insufficient invoices for settlement' : 'Complete', balance, totalRso };
}
import { supabase } from './supabase';

/** "18", "18%", 0.18, "0.18" → 18 (percent). Blank / invalid → 0. */
export function parseGst(v: any): number {
    const g = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
    return g > 0 && g < 1 ? Math.round(g * 10000) / 100 : g;
}

/**
 * GST % per article code, straight from the database.
 * Priority: itemMaster → salesDump. The first NON-ZERO value wins, so a blank/0 in
 * itemMaster no longer hides the GST that is stored in the sales dump.
 */
export async function fetchGstByArticle(assignmentId: string, codes: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const unique = [...new Set(codes.filter(Boolean))];
    const BATCH = 300;
    for (let b = 0; b < unique.length; b += BATCH) {
        const chunk = unique.slice(b, b + BATCH);
        const { data } = await supabase.from('itemMaster').select('itemCode,gst').eq('assignment_id', assignmentId).in('itemCode', chunk);
        (data || []).forEach((m: any) => { const g = parseGst(m.gst); if (g > 0) out[m.itemCode] = g; });
    }
    const missing = unique.filter(c => !(c in out));
    for (let b = 0; b < missing.length; b += BATCH) {
        const chunk = missing.slice(b, b + BATCH);
        const { data } = await supabase.from('salesDump').select('itemCode,gst').eq('assignment_id', assignmentId).in('itemCode', chunk).limit(5000);
        (data || []).forEach((m: any) => { const g = parseGst(m.gst); if (g > 0 && !(m.itemCode in out)) out[m.itemCode] = g; });
    }
    return out;
}
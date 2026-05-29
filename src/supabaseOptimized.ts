/**
 * supabaseOptimized.ts
 * 
 * Drop-in helpers for optimized Supabase queries.
 * Place at: src/supabaseOptimized.ts
 * 
 * FIXES:
 *   - Column projection (no more select('*'))
 *   - Smart realtime: surgical row-level updates instead of full refetch
 *   - Debounced save queue: batches rapid inline edits into single DB writes
 *   - Request deduplication: ignores duplicate in-flight requests
 *   - Sales dump indexed lookup helper
 */

import { supabase } from './supabase';
import { AuditLineItem, AuditTicket } from './types';

// ── COLUMN PROJECTIONS ─────────────────────────────────────────────────────────
// Only fetch columns actually used in the UI — dramatically reduces payload size

export const TICKET_COLS = [
  'id','distributorId','status','scheduledDate','proposedDate','auditorIds',
  'approvedValue','maxAllowedValue','verifiedTotal','signOffs','presenceLogs',
  'drainageDate','fieldAuditors','whatsappMediaApproved','signoffDocumentUrl',
  'signoffDocumentApproved','dateProposals','auditDays','createdAt','updatedAt'
].join(',');

export const DIST_COLS = [
  'id','code','name','anchorName','address','city','state','region',
  'approvedValue','aseIds','asmIds','smIds','dmIds','hoIds','active'
].join(',');

export const USER_COLS = [
  'uid','name','email','role','phone','region','active'
].join(',');

export const LINE_ITEM_COLS = [
  'id','ticketId','articleNumber','description','category','quantity',
  'unitValue','totalValue','reasonCode','remarks','qtyNonSaleable','qtyBBD',
  'qtyDamaged','mfgDate','expDate','productLife','qtyDrained','bbdApprovalStatus'
].join(',');

export const DUMP_COLS = [
  'id','distributorCode','itemCode','itemName','quantity','rate',
  'totalValue','category','gst','standardPack'
].join(',');

// ── SAVE QUEUE ─────────────────────────────────────────────────────────────────
// Batches rapid inline edits: if the user edits qty then immediately edits
// mfgDate, only ONE write happens with both changes — not two separate round-trips.
// Also prevents data-loss from concurrent saves overwriting each other.

type SaveEntry = {
  payload: Partial<AuditLineItem>;
  timer:   ReturnType<typeof setTimeout>;
  resolve: () => void;
};

class LineItemSaveQueue {
  private queue = new Map<string, SaveEntry>();
  private readonly delay: number;

  constructor(delayMs = 600) { this.delay = delayMs; }

  /**
   * Schedule a save. If another save for the same id is already pending,
   * merge the payloads and reset the timer — only 1 DB write per burst.
   */
  schedule(id: string, patch: Partial<AuditLineItem>): Promise<void> {
    return new Promise(resolve => {
      const existing = this.queue.get(id);
      if (existing) {
        clearTimeout(existing.timer);
        const merged = { ...existing.payload, ...patch };
        const timer = setTimeout(() => this.flush(id), this.delay);
        this.queue.set(id, { payload: merged, timer, resolve });
      } else {
        const timer = setTimeout(() => this.flush(id), this.delay);
        this.queue.set(id, { payload: patch, timer, resolve });
      }
    });
  }

  /** Force-flush a specific id immediately (e.g. on modal close) */
  async flushNow(id: string): Promise<void> {
    const entry = this.queue.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      await this.flush(id);
    }
  }

  /** Flush ALL pending saves (e.g. before navigating away) */
  async flushAll(): Promise<void> {
    const ids = [...this.queue.keys()];
    await Promise.all(ids.map(id => this.flushNow(id)));
  }

  private async flush(id: string): Promise<void> {
    const entry = this.queue.get(id);
    if (!entry) return;
    this.queue.delete(id);
    try {
      const { error } = await supabase
        .from('auditLineItems')
        .update(entry.payload)
        .eq('id', id);
      if (error) console.error(`[SaveQueue] Failed to save item ${id}:`, error);
    } catch (e) {
      console.error(`[SaveQueue] Network error saving item ${id}:`, e);
    }
    entry.resolve();
  }

  hasPending(id: string) { return this.queue.has(id); }
  pendingCount()         { return this.queue.size; }
}

// Singleton — shared across all Execution instances
export const saveQueue = new LineItemSaveQueue(600);

// ── REQUEST DEDUPLICATOR ───────────────────────────────────────────────────────
// Prevents multiple in-flight fetches for the same resource.
// If fetchItems('ticket-123') is called while one is already in-flight,
// the second call waits for the first result instead of firing another request.

const inFlight = new Map<string, Promise<any>>();

export async function dedupedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>;
  const p = fetcher().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── SMART REALTIME UPDATER ─────────────────────────────────────────────────────
// Instead of re-fetching ALL tickets when any ticket changes,
// surgically update just the changed row in local state.

export function applyTicketPatch(
  prev: AuditTicket[],
  payload: { eventType: string; new: AuditTicket; old: { id: string } }
): AuditTicket[] {
  const { eventType, new: updated, old } = payload;
  if (eventType === 'INSERT') return [...prev, updated];
  if (eventType === 'DELETE') return prev.filter(t => t.id !== old.id);
  if (eventType === 'UPDATE') return prev.map(t => t.id === updated.id ? { ...t, ...updated } : t);
  return prev;
}

export function applyLineItemPatch(
  prev: AuditLineItem[],
  payload: { eventType: string; new: AuditLineItem; old: { id: string } }
): AuditLineItem[] {
  const { eventType, new: updated, old } = payload;
  if (eventType === 'INSERT') {
    // Don't add if already present (optimistic insert already in state)
    if (prev.some(i => i.id === updated.id)) return prev;
    return [...prev, updated].sort((a, b) => a.articleNumber.localeCompare(b.articleNumber));
  }
  if (eventType === 'DELETE') return prev.filter(i => i.id !== old.id);
  if (eventType === 'UPDATE') {
    // Don't overwrite if save queue has a pending write for this id
    // (local state is more up-to-date than the DB echo)
    if (saveQueue.hasPending(updated.id)) return prev;
    return prev.map(i => i.id === updated.id ? { ...i, ...updated } : i);
  }
  return prev;
}

// ── OPTIMIZED FETCH FUNCTIONS ──────────────────────────────────────────────────

export async function fetchTickets(profile: { role: string; uid: string }, distIds: string[]) {
  // Paginated — fetches all pages to handle 1100+ assignments
  const pageSize = 1000;
  let allRows: AuditTicket[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from('auditTickets').select(TICKET_COLS);
    if (profile.role === 'auditor') {
      q = q.or(`auditorIds.cs.{${profile.uid}}`);
    } else if (['ase','asm','sm','dm'].includes(profile.role)) {
      if (distIds.length === 0) return [];
      q = q.in('distributorId', distIds);
    }
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data as AuditTicket[]);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

export async function fetchLineItems(ticketId: string): Promise<AuditLineItem[]> {
  return dedupedFetch(`items-${ticketId}`, async () => {
    const { data, error } = await supabase
      .from('auditLineItems')
      .select(LINE_ITEM_COLS)
      .eq('ticketId', ticketId)
      .order('articleNumber', { ascending: true });
    if (error) throw error;
    return (data || []) as AuditLineItem[];
  });
}

export async function fetchDumpItems(distCode: string) {
  return dedupedFetch(`dump-${distCode}`, async () => {
    // Paginated salesDump fetch — a single distributor can have hundreds of lines
    const pageSize = 1000;
    let allRows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('salesDump')
        .select(DUMP_COLS)
        .ilike('distributorCode', distCode.trim())
        .range(from, from + pageSize - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return allRows;
  });
}

// ── UNSAVED CHANGES GUARD ──────────────────────────────────────────────────────
// Call this before navigating away from Execution to prevent data loss

export async function guardUnsavedChanges(): Promise<boolean> {
  const pending = saveQueue.pendingCount();
  if (pending === 0) return true;
  const ok = window.confirm(
    `You have ${pending} unsaved change${pending > 1 ? 's' : ''}. ` +
    `Saving now before leaving...`
  );
  if (ok) await saveQueue.flushAll();
  return ok;
}
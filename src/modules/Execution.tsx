import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { supabase, logActivity, notifyLinkedUsers } from '../supabase';
import { Distributor, SignOff, AuditTicket as BaseTicket, AuditLineItem as BaseItem } from '../types';
import { ClipboardCheck, Plus, Store, MapPin, CheckCircle2, ArrowLeft, AlertCircle, MessageSquare, PackageSearch, Lock, Trash2, Send, RotateCcw, CalendarClock, FileText, Upload, Loader2, User as UserIcon, X, Droplets, Search, Download, FileSpreadsheet, FileUp, CheckCheck } from 'lucide-react';
import { useSignOffExport } from '../hooks/useSignOffExport';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

import { CheckInBlock } from '../components/Execution/CheckInBlock';
import { AddItemModal } from '../components/Execution/AddItemModal';
import { ChatModal } from '../components/Execution/ChatModal';
import { saveQueue } from '../supabaseOptimized';

const BUCKET_NAME = 'audit-media'; 

export interface AuditTicket extends BaseTicket { 
  signOffs?: Record<string, any>;
}

export interface AuditLineItem extends BaseItem { 
  qtyDrained?: number; 
  bbdApprovalStatus?: 'none' | 'pending' | 'approved' | 'rejected';
}

export interface CombinedDumpItem {
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string;
  billingDate?: string; plant?: string; billingDoc?: string; gst?: number; approxShelfLife?: string; standardPack?: string;
}


// ─── Paginated fetch — Supabase default limit is 1000 rows. ─────────────────
// This fetches all pages automatically so 1100+ assignments never get truncated.
async function fetchAllRows<T>(
  queryBuilder: () => any,
  pageSize = 1000
): Promise<T[]> {
  let allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder()
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data as T[]);
    if (data.length < pageSize) break;  // last page
    from += pageSize;
  }
  return allRows;
}

export function ExecutionModule() {
  const { profile, user } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<any[]>([]); 
  const [activeTicket, setActiveTicket] = useState<AuditTicket | null>(null);
  const [ticketUsers, setTicketUsers] = useState<{ id: string; name: string; role: string; phone?: string }[]>([]);
  
  const [items, setItems] = useState<AuditLineItem[]>([]);
  const itemsRef = useRef<AuditLineItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const latestEditsRef = useRef<Record<string, AuditLineItem>>({});
  
  const [availableDumpItems, setAvailableDumpItems] = useState<CombinedDumpItem[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isStatusExporting, setIsStatusExporting] = useState(false);
  const [isBulkUploading, setIsBulkUploading]     = useState(false);
  const [bulkUploadResult, setBulkUploadResult]   = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  const bulkUploadRef = useRef<HTMLInputElement>(null);
  const [listSearch, setListSearch] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [drainageDateInput, setDrainageDateInput] = useState('');
  
  const [isUploadingSignoff, setIsUploadingSignoff] = useState(false);
  const signoffFileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'active' | 'drainage' | 'signoff' | 'completed'>('active');

  // --- STRICT GLOBAL ROLE FLAGS ---
  const isSuperAdmin = profile?.role === 'superadmin';
  const isAdminOrSuperadmin = ['superadmin', 'admin'].includes(profile?.role || '');
  const isAuditor = profile?.role === 'auditor';
  const isASE = profile?.role === 'ase';

  // --- GLOBAL STATUS FLAGS ---
  const todayDate = new Date();
  const offset = todayDate.getTimezoneOffset();
  const localToday = new Date(todayDate.getTime() - (offset * 60 * 1000));
  const todayStr = localToday.toISOString().split('T')[0];

  const isSubmittedPhase = activeTicket ? ['submitted', 'drainage_pending', 'signed', 'evidence_uploaded', 'closed'].includes(activeTicket.status) : false;
  const isClosedPhase = activeTicket ? activeTicket.status === 'closed' : false;
  const isDrainagePhase = activeTicket ? ['drainage_pending', 'closed'].includes(activeTicket.status) : false;
  const isActionableDate = activeTicket?.scheduledDate ? (activeTicket.scheduledDate <= todayStr || activeTicket.status === 'in_progress') : false;
  const isDrainageToday = activeTicket?.signOffs?.drainageDate === todayStr;

  const distMap = useMemo(() => {
    const map: Record<string, any> = {};
    distributors.forEach(d => { map[d.id] = d; });
    return map;
  }, [distributors]);

  const activeDistCode = activeTicket ? distMap[activeTicket.distributorId]?.code : null;

  const dumpItemMap = useMemo(() => {
    const map: Record<string, CombinedDumpItem> = {};
    availableDumpItems.forEach(d => { map[d.itemCode] = d; });
    return map;
  }, [availableDumpItems]);

  // ── Download Status Report — all tickets in a single "Reporting Format" sheet ──
  const downloadStatusReport = async () => {
    if (isStatusExporting) return;
    setIsStatusExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Reliance Audit System';
      const ws = wb.addWorksheet('Reporting Format - Audit Status');

      const thinS = { style: 'thin' as any };
      const thinB = { top: thinS, left: thinS, bottom: thinS, right: thinS };
      const fillHdr = { type: 'pattern' as any, pattern: 'solid' as any, fgColor: { argb: 'FFD9E1F2' } };

      const headers = [
        'Std. Serial No.', 'Phase', 'Auditor Name', 'Approved Date', 'Audit Date',
        'Region', 'State', 'Anchor Code', 'Anchor Name', 'Distributor name',
        'Reported/ Approved Value', 'Value as per Auditor (Including GST)', 'Fin Review Value With GST',
        'Diff Proposed V/S Actual', 'Audit Status (RCPL)', 'Auditor Remark (As per Auditor)',
        'Approved Value in Cr.', 'Audit Date (as per Auditor)', 'End Date of Physical Verification',
        'Drainage start date', 'Drainage end date', 'Audit Sharing Date', 'Audit Planned Date',
        'Direct/ Indirect Customer', 'ASM Name',
      ];
      const colWidths = [16,14,16,14,14,10,12,16,18,20,16,16,16,14,14,18,14,16,22,14,14,18,14,14,14];
      ws.columns = colWidths.map(w => ({ width: w }));
      ws.getRow(1).height = 40;
      headers.forEach((h, i) => {
        const cell = ws.getRow(1).getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', bold: true, size: 9 };
        cell.fill = fillHdr;
        cell.border = thinB;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });

      const statusLabel: Record<string, string> = {
        tentative: 'Tentative', scheduled: 'Scheduled', in_progress: 'In Progress',
        auditor_submitted: 'Auditor Submitted', submitted: 'Submitted',
        drainage_pending: 'Drainage Pending', closed: 'Closed',
      };

      let rowNum = 2;
      for (const ticket of tickets) {
        const dist = distMap[ticket.distributorId];
        if (!dist) continue;
        const auditDays = (ticket as any).auditDays || 1;
        let endDate = '';
        if (ticket.scheduledDate) {
          const d = new Date(ticket.scheduledDate);
          d.setDate(d.getDate() + auditDays - 1);
          endDate = d.toISOString().split('T')[0];
        }
        const verifiedVal = ticket.verifiedTotal || 0;
        const diff = verifiedVal - (ticket.approvedValue || 0);
        const row = [
          dist.assignment_serial_no || '',
          'Phase V - Part 2',
          'Singla Vishal & Co.',
          ticket.scheduledDate ? new Date(ticket.scheduledDate) : '',
          ticket.scheduledDate ? new Date(ticket.scheduledDate) : '',
          dist.region || '',
          dist.state || '',
          dist.code || '',
          dist.anchorName || '',
          dist.name || '',
          ticket.approvedValue || 0,
          verifiedVal,
          '',
          diff,
          statusLabel[ticket.status] || ticket.status,
          '',
          ticket.approvedValue ? (ticket.approvedValue / 10000000) : 0,
          ticket.scheduledDate ? new Date(ticket.scheduledDate) : '',
          endDate ? new Date(endDate) : '',
          (ticket as any).signOffs?.drainageDate ? new Date((ticket as any).signOffs.drainageDate) : '',
          '',
          '',
          ticket.scheduledDate ? new Date(ticket.scheduledDate) : '',
          'Direct',
          '',
        ];
        ws.getRow(rowNum).height = 16;
        row.forEach((v, i) => {
          const cell = ws.getRow(rowNum).getCell(i + 1);
          const isCurrency = [11, 12, 13, 14, 17].includes(i + 1);
          const isDate = v instanceof Date;
          cell.value = v as any;
          cell.font = { name: 'Arial', size: 9 };
          cell.border = thinB;
          cell.alignment = { horizontal: isCurrency ? 'right' : 'left', vertical: 'middle' };
          if (isDate) cell.numFmt = 'DD-MM-YYYY';
          else if (isCurrency) cell.numFmt = '[$₹-en-IN]#,##0.00';
        });
        rowNum++;
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Audit_Status_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Status report error:', err);
      alert('Failed to generate status report.');
    } finally {
      setIsStatusExporting(false);
    }
  };

  const fetchData = async () => {
    if (!profile) return;
    try {
      // Paginated distributors fetch — handles 1100+ distributors without truncation
      let distBaseQuery = () => {
        let q = supabase.from('distributors').select('id,code,name,anchorName,address,city,state,region,approvedValue,aseIds,asmIds,smIds,dmIds,hoIds,active,assignment_serial_no');
        if (profile.role === 'ase') q = q.contains('aseIds', [profile.uid]);
        else if (profile.role === 'asm') q = q.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm')  q = q.contains('smIds',  [profile.uid]);
        else if (profile.role === 'dm')  q = q.contains('dmIds',  [profile.uid]);
        return q;
      };
      const fetchedDistributors = await fetchAllRows<any>(distBaseQuery);
      setDistributors(fetchedDistributors);

      const validDistIds = new Set(fetchedDistributors.map((d: any) => d.id));

      // Paginated tickets fetch
      let ticketBaseQuery = () => {
        let q = supabase.from('auditTickets')
          .select('id,distributorId,status,scheduledDate,proposedDate,auditorIds,approvedValue,maxAllowedValue,verifiedTotal,signOffs,presenceLogs,drainageDate,auditDays,updatedAt,createdAt')
          .in('status', ['scheduled', 'in_progress', 'auditor_submitted', 'submitted', 'drainage_pending', 'signed', 'evidence_uploaded', 'closed']);
        if (profile.role === 'auditor')
          q = q.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
        return q;
      };
      const fetchedTickets = await fetchAllRows<AuditTicket>(ticketBaseQuery);
      const validTickets = fetchedTickets.filter(t => validDistIds.has(t.distributorId));
      setTickets(validTickets);

    } catch (error) {
      console.error("Execution Data Fetch Error:", error);
    }
  };

  useEffect(() => {
    fetchData();
    // Realtime: listen for any auditTicket change, then surgically update local state
    // (full fetchData only runs on mount; realtime uses applyTicketPatch pattern)
    const channel = supabase.channel('execution-channel')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auditTickets' },
        (payload: any) => {
          const updated = payload.new as AuditTicket;
          setTickets(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auditTickets' },
        (payload: any) => {
          const inserted = payload.new as AuditTicket;
          // Only add if it belongs to a distributor this user can see
          setDistributors(prevDist => {
            const ids = new Set(prevDist.map((d: any) => d.id));
            if (ids.has(inserted.distributorId)) {
              setTickets(prev => prev.some(t => t.id === inserted.id) ? prev : [...prev, inserted]);
            }
            return prevDist;
          });
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'auditTickets' },
        (payload: any) => {
          setTickets(prev => prev.filter(t => t.id !== payload.old.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const fetchItems = async (ticketId: string) => {
    const { data } = await supabase.from('auditLineItems').select('*').eq('ticketId', ticketId).order('articleNumber', { ascending: true });
    if (data) setItems(data as AuditLineItem[]);
  };

  const loadDumpData = async (distCode: string) => {
    try {
      // salesDump: paginated, column-projected (no select('*') which pulls all columns)
      const dump = await fetchAllRows<any>(
        () => supabase.from('salesDump')
          .select('id,distributorCode,itemCode,itemName,quantity,rate,totalValue,category,gst,standardPack,billingDate,plant,billingDoc')
          .ilike('distributorCode', distCode.trim())
      );
      if (dump.length > 0) {
        const combined = dump.map(d => {
          // Strip commas/spaces before parsing — DB may have stored "472,145.17" as string
          const parseNum = (v: any) => parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
          const qty  = parseNum(d.quantity);
          const tv   = parseNum(d.totalValue);
          // Rate = totalValue ÷ quantity. Falls back to stored d.rate if either is 0.
          const storedRate = parseNum(d.rate);
          const rate = qty > 0 && tv > 0 ? tv / qty : storedRate;
          return { 
            id: d.id, itemCode: d.itemCode, itemName: d.itemName || 'Unknown Item',
            expectedQty: qty, rate, category: d.category || 'Uncategorized',
            billingDate: d.billingDate, plant: d.plant, billingDoc: d.billingDoc,
            gst: d.gst, approxShelfLife: d.approxShelfLife, standardPack: d.standardPack,
            totalValue: tv,
          };
        });
        setAvailableDumpItems(combined);
      } else { setAvailableDumpItems([]); }
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    if (activeTicket) {
      fetchItems(activeTicket.id);
      if (activeDistCode) loadDumpData(activeDistCode);
      setItemSearchQuery('');

      // Fetch ASE + auditor details for this ticket
      const dist = distMap[activeTicket.distributorId];
      const aseIds: string[]     = dist?.aseIds     || [];
      const auditorIds: string[] = (activeTicket as any).auditorIds || [];
      const allIds = [...new Set([...aseIds, ...auditorIds])].filter(Boolean);
      if (allIds.length > 0) {
        supabase.from('users').select('uid,name,role,phone').in('uid', allIds)
          .then(({ data }) => {
            if (data) setTicketUsers(data.map((u: any) => ({ id: u.uid, name: u.name, role: u.role, phone: u.phone })));
          });
      } else {
        setTicketUsers([]);
      }

      const channel = supabase
        .channel(`items-${activeTicket.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'auditLineItems', filter: `ticketId=eq.${activeTicket.id}` },
          (payload: any) => {
            const { eventType, new: updated, old } = payload;

            if (eventType === 'INSERT') {
              // New row added (e.g. from AddItemModal) — append without touching existing rows.
              // This is the key fix: a full fetchItems() here would overwrite any
              // mfg/exp dates the user has typed in other rows but not yet saved.
              setItems(prev => {
                // Skip if already present (optimistic insert)
                if (prev.some(i => i.id === updated.id)) return prev;
                return [...prev, updated as AuditLineItem].sort((a, b) =>
                  a.articleNumber.localeCompare(b.articleNumber)
                );
              });
              return;
            }

            if (eventType === 'DELETE') {
              setItems(prev => prev.filter(i => i.id !== old.id));
              return;
            }

            if (eventType === 'UPDATE') {
              // Don't overwrite a row if the saveQueue has a pending write for it —
              // the local state is more up-to-date than the DB echo coming back.
              if (saveQueue.hasPending(updated.id)) return;
              setItems(prev =>
                prev.map(i => i.id === updated.id ? { ...i, ...updated } : i)
              );
            }
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    } else {
      setItems([]);
      setAvailableDumpItems([]);
      setItemSearchQuery('');
    }
  }, [activeTicket?.id, activeDistCode]);

  useEffect(() => {
    if (activeTicket) {
      const updated = tickets.find(t => t.id === activeTicket.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(activeTicket)) {
        setActiveTicket(updated);
      }
    }
  }, [tickets, activeTicket]);

  const forceUpdateStatus = async (newStatus: string) => {
    if (!activeTicket || !user || !profile) return;
    if (!window.confirm(`Are you sure you want to force change the status to: ${newStatus.replace('_', ' ').toUpperCase()}?`)) return;

    try {
      await supabase.from('auditTickets').update({ status: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, status: newStatus as any });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Status Overridden", `Super Admin manually changed status to ${newStatus.replace('_', ' ')} for ${dist?.name}`);
    } catch (error) {
      console.error("Failed to force update status:", error);
    }
  };

  const resetAuditTicket = async () => {
    if (!activeTicket) return;
    
    if (!isSuperAdmin) {
      alert("Action Denied: Only Super Admins can reset and completely clear an audit ticket.");
      return;
    }

    if (!window.confirm("Are you sure you want to completely clear this ticket? It will be removed from Execution and sent back to the Scheduler as a blank request.")) return;

    try {
      await supabase.from('auditLineItems').delete().eq('ticketId', activeTicket.id);
      await supabase.from('auditTickets').update({ 
        status: 'tentative', scheduledDate: null as any, signOffs: {}, auditorId: null as any, auditorIds: [], presenceLogs: [], media: [], comments: [], dateProposals: [], verifiedTotal: 0, updatedAt: new Date().toISOString()
      }).eq('id', activeTicket.id);
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Audit Reset", `Super Admin reset the audit for ${dist?.name} back to Scheduler`);

      setTickets(prev => prev.filter(t => t.id !== activeTicket.id)); setActiveTicket(null);
      alert("Ticket cleared successfully! It is now back in the Scheduler page.");
    } catch (error) { console.error("Error resetting audit ticket:", error); alert("Failed to reset ticket."); }
  };

  const toggleWhatsappApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.signOffs?.whatsappMediaApproved;
    const newSignOffs = { ...(activeTicket.signOffs || {}), whatsappMediaApproved: newStatus };
    
    try {
      await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "WhatsApp Media Confirmed", `Admin marked WhatsApp audit evidence as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update WhatsApp approval:", error); }
  };

  // ─── NEW: Toggle "Add Item" approval for auditor ──────────────────────────
  const toggleAddItemApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.signOffs?.addItemApprovalGranted;
    const newSignOffs = { ...(activeTicket.signOffs || {}), addItemApprovalGranted: newStatus };
    
    try {
      await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, newStatus ? "Add Item Approved" : "Add Item Revoked", `Admin ${newStatus ? 'granted' : 'revoked'} Add Item permission for ${dist?.name}`);
    } catch (error) { console.error("Failed to update Add Item approval:", error); }
  };

  const toggleDrainageMediaApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.signOffs?.drainageMediaApproved;
    const newSignOffs = { ...(activeTicket.signOffs || {}), drainageMediaApproved: newStatus };
    
    try {
      await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Drainage Media Confirmed", `Admin marked Drainage evidence as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update Drainage Media approval:", error); }
  };

  const handleSignoffUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTicket || !user) return;
    setIsUploadingSignoff(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${activeTicket.id}-signoff-${Date.now()}.${fileExt}`;
      const filePath = `signoffs/${fileName}`;
      
      const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(filePath, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

      const newSignOffs = { ...(activeTicket.signOffs || {}), signoffDocumentUrl: publicUrl };
      await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
    } catch (error: any) { alert(`Upload failed: ${error.message}`); } 
    finally { setIsUploadingSignoff(false); if (signoffFileRef.current) signoffFileRef.current.value = ''; }
  };

  const toggleSignoffApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.signOffs?.signoffDocumentApproved;
    const newSignOffs = { ...(activeTicket.signOffs || {}), signoffDocumentApproved: newStatus };
    
    try {
      await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Sign-off Document Confirmed", `Admin marked physical sign-off sheet as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update Sign-off approval:", error); }
  };

  const rejectSignoffDocument = async () => {
    if (!activeTicket || !user || !profile) return;
    
    const reason = window.prompt("Please provide a reason for rejecting this sign-off document (this will be logged in the Discussion board):");
    if (reason === null) return; 
    if (!reason.trim()) {
       alert("Cancellation aborted: A reason is required to reject the document.");
       return;
    }

    try {
      const rejectionMessage = `🚨 Sign-off Document Rejected by Admin: ${reason}`;
      const newComment = {
        id: Math.random().toString(36).substring(7),
        userId: user.id,
        userName: profile.name,
        role: profile.role,
        text: rejectionMessage,
        message: rejectionMessage,
        content: rejectionMessage, 
        timestamp: new Date().toISOString()
      };

      const newSignOffs = { ...(activeTicket.signOffs || {}), signoffDocumentUrl: null, signoffDocumentApproved: false };
      const updatedComments = [...(activeTicket.comments || []), newComment];

      await supabase.from('auditTickets').update({ 
        signOffs: newSignOffs,
        comments: updatedComments,
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
      
      setActiveTicket({ 
        ...activeTicket, 
        signOffs: newSignOffs,
        comments: updatedComments 
      });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Sign-off Rejected", `Admin rejected physical sign-off sheet for ${dist?.name}. Reason: "${reason}"`);
      notifyLinkedUsers(activeTicket.distributorId, "Sign-off Rejected", `The Sign-off Document for ${dist?.name} was rejected. Reason: "${reason}". Please upload a new copy.`);
      
      alert("Document rejected successfully. The reason has been posted to the discussion board.");
    } catch (error) { 
      console.error("Failed to reject Sign-off document:", error); 
      alert("Failed to reject the document.");
    }
  };

  const deleteItem = async (item: AuditLineItem) => {
    if (!activeTicket) return;
    // Optimistic update — remove from UI immediately
    const updatedItems = items.filter(i => i.id !== item.id);
    setItems(updatedItems);

    // Update verifiedTotal on the ticket
    const newVerifiedTotal = updatedItems.reduce((s, i) => s + (i.totalValue || 0), 0);
    setActiveTicket({ ...activeTicket, verifiedTotal: newVerifiedTotal });

    try {
      await supabase.from('auditLineItems').delete().eq('id', item.id);
      await supabase.from('auditTickets')
        .update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() })
        .eq('id', activeTicket.id);
    } catch (error) {
      console.error(error);
      // Rollback on failure
      setItems(items);
      setActiveTicket({ ...activeTicket });
    }
  };

  const handleInlineChange = (id: string, field: 'qtyNonSaleable' | 'qtyBBD' | 'qtyDamaged' | 'mfgDate' | 'expDate' | 'unitValue', value: any, e?: React.ChangeEvent<HTMLInputElement>) => {
    const oldItem = itemsRef.current.find(i => i.id === id);
    if (!oldItem) return;

    const updatedItem = { ...oldItem, [field]: value };

    if (['qtyNonSaleable', 'qtyBBD', 'qtyDamaged'].includes(field)) {
       updatedItem.quantity = (Number(updatedItem.qtyNonSaleable) || 0) + (Number(updatedItem.qtyBBD) || 0) + (Number(updatedItem.qtyDamaged) || 0);
       updatedItem.totalValue = updatedItem.quantity * updatedItem.unitValue;
    }

    if (field === 'mfgDate' || field === 'expDate') {
       if (updatedItem.mfgDate && updatedItem.expDate) {
         const m = new Date(updatedItem.mfgDate);
         const eDate = new Date(updatedItem.expDate);
         if (!isNaN(m.getTime()) && !isNaN(eDate.getTime())) {
           const diffDays = Math.ceil((eDate.getTime() - m.getTime()) / (1000 * 60 * 60 * 24));
           updatedItem.productLife = `${diffDays} Days`;
         } else { updatedItem.productLife = '-'; }
       } else { updatedItem.productLife = '-'; }
    }
    
    if (field === 'mfgDate' && value && activeTicket?.scheduledDate && !isAdminOrSuperadmin) {
        const mfgDateObj = new Date(value);
        const auditDateObj = new Date(activeTicket.scheduledDate);
        mfgDateObj.setHours(0,0,0,0);
        auditDateObj.setHours(0,0,0,0);
        if (mfgDateObj > auditDateObj) {
            alert("Manufacturing Date cannot be in the future.");
            if (e && e.target) e.target.value = oldItem[field] || ''; 
            return;
        }
    }
    // Rule 1: exp cannot be before mfg
    if (field === 'expDate' && value && updatedItem.mfgDate && value < updatedItem.mfgDate) {
        alert(`Expiry date (${value}) cannot be before Manufacturing date (${updatedItem.mfgDate}).`);
        if (e && e.target) e.target.value = oldItem.expDate || '';
        return;
    }
    if (field === 'mfgDate' && value && updatedItem.expDate && updatedItem.expDate < value) {
        alert(`Manufacturing date (${value}) cannot be after Expiry date (${updatedItem.expDate}).`);
        if (e && e.target) e.target.value = oldItem.mfgDate || '';
        return;
    }

    const currentExp = field === 'expDate' ? value : updatedItem.expDate;
    if (currentExp && activeTicket?.scheduledDate) {
        const expDateObj = new Date(currentExp);
        const auditDateObj = new Date(activeTicket.scheduledDate);
        expDateObj.setHours(0,0,0,0);
        auditDateObj.setHours(0,0,0,0);
        
        if (expDateObj > auditDateObj) {
            if (isAdminOrSuperadmin) {
              updatedItem.bbdApprovalStatus = 'approved';
            } else if (oldItem.bbdApprovalStatus !== 'pending' && oldItem.bbdApprovalStatus !== 'approved') {
              const confirmMsg = `WARNING: You selected a date (${currentExp}) that is BEYOND the scheduled audit date.\n\nFuture dates cannot be recorded without Admin Approval.\n\nDo you want to request special Admin Approval to allow this exception? Click OK to request, or Cancel to revert.`;
              if (!window.confirm(confirmMsg)) {
                 if (e && e.target) e.target.value = oldItem[field] || ''; 
                 return;
              }
              updatedItem.bbdApprovalStatus = 'pending';
            } else {
               updatedItem.bbdApprovalStatus = oldItem.bbdApprovalStatus;
            }
        } else {
            updatedItem.bbdApprovalStatus = 'none';
        }
    } else {
        updatedItem.bbdApprovalStatus = 'none';
    }

    latestEditsRef.current[id] = updatedItem;

    setItems(prev => {
      const newArr = [...prev];
      const idx = newArr.findIndex(i => i.id === id);
      if (idx !== -1) newArr[idx] = updatedItem;
      return newArr;
    });
  };

  // ── SAVE QUEUE: batches rapid edits; prevents concurrent-write data loss ──
  // Multiple quick edits (qty → mfgDate → expDate) merge into ONE DB write.
  // saveQueue also guards against realtime echoes overwriting in-progress edits.
  const saveInlineEdit = useCallback(async (id: string) => {
    if (!activeTicket) return;
    
    const itemToSave = latestEditsRef.current[id] || itemsRef.current.find(i => i.id === id);
    if (!itemToSave) return;

    const newVerifiedTotal = itemsRef.current.reduce(
      (sum, item) => sum + (item.id === id ? itemToSave.totalValue : item.totalValue), 0
    );

    try {
      // Schedule via queue — merges burst edits, defers until 600ms after last change
      await saveQueue.schedule(id, { 
        quantity:          itemToSave.quantity, 
        qtyNonSaleable:    itemToSave.qtyNonSaleable,
        qtyBBD:            itemToSave.qtyBBD,
        qtyDamaged:        itemToSave.qtyDamaged,
        totalValue:        itemToSave.totalValue,
        unitValue:         itemToSave.unitValue,
        mfgDate:           itemToSave.mfgDate,
        expDate:           itemToSave.expDate,
        productLife:       itemToSave.productLife,
        bbdApprovalStatus: itemToSave.bbdApprovalStatus || 'none',
      });
    } catch (error) { console.error(error); }
  }, [activeTicket, distMap, user, profile, fetchItems]);

  const handleDrainageChange = (id: string, value: string) => {
    const oldItem = itemsRef.current.find(i => i.id === id);
    if (!oldItem) return;

    let val: number | string = parseInt(value);
    if (isNaN(val)) val = '';
    else if (val > oldItem.quantity) val = oldItem.quantity; 
    else if (val < 0) val = 0;
    
    const updatedItem = { ...oldItem, qtyDrained: val as number };
    latestEditsRef.current[id] = updatedItem;

    setItems(prev => {
      const newArr = [...prev];
      const idx = newArr.findIndex(i => i.id === id);
      if (idx !== -1) newArr[idx] = updatedItem;
      return newArr;
    });
  };

  const saveInlineDrainage = useCallback(async (id: string) => {
    if (!activeTicket) return;
    const itemToSave = latestEditsRef.current[id] || itemsRef.current.find(i => i.id === id);
    if (!itemToSave) return;
    try {
      await saveQueue.schedule(id, { qtyDrained: itemToSave.qtyDrained || 0 });
    } catch (error) { console.error(error); }
  }, [activeTicket]);

  const approveBBDItem = async (item: AuditLineItem) => {
    if (!activeTicket || !user || !profile) return;
    try {
      await supabase.from('auditLineItems').update({ bbdApprovalStatus: 'approved' }).eq('id', item.id);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, bbdApprovalStatus: 'approved' } : i));
      logActivity(user, profile, "Future Expiry Approved", `Admin approved an exception for a future-dated expiry item: ${item.articleNumber}`);
    } catch (e) { console.error(e); }
  };

  const rejectBBDItem = async (item: AuditLineItem) => {
    if (!activeTicket || !user || !profile) return;
    try {
      const newTotalQty = (Number(item.qtyNonSaleable) || 0) + 0 + (Number(item.qtyDamaged) || 0);
      const newTotalValue = newTotalQty * item.unitValue;

      await supabase.from('auditLineItems').update({ 
        qtyBBD: 0, 
        quantity: newTotalQty, 
        totalValue: newTotalValue, 
        bbdApprovalStatus: 'rejected' 
      }).eq('id', item.id);
      
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, qtyBBD: 0, quantity: newTotalQty, totalValue: newTotalValue, bbdApprovalStatus: 'rejected' } : i));
      logActivity(user, profile, "Future Expiry Rejected", `Admin rejected exception for future expiry date on ${item.articleNumber}. BBD quantity reset to 0.`);
    } catch (e) { console.error(e); }
  };

  // ── Bulk upload: parse Excel → insert line items from file ─────────────────
  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTicket) return;
    if (bulkUploadRef.current) bulkUploadRef.current.value = '';

    setIsBulkUploading(true);
    setBulkUploadResult(null);

    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await wb.xlsx.load(buffer);

      const ws = wb.worksheets[0];
      if (!ws) throw new Error('No worksheet found in the uploaded file.');

      // ── Detect header row — scan rows 1-5 to find which one has ArticleNo ────
      // Our template has: row1=title, row2=instructions, row3=headers, row4+=data
      // But user may also upload a plain file with headers in row 1
      const headers: Record<string, number> = {};
      let headerRowNum = 1;
      let dataStartRow = 2;

      const normalise = (v: any): string =>
        String(v ?? '').split('\n')[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '');

      for (let tryRow = 1; tryRow <= 5; tryRow++) {
        const row = ws.getRow(tryRow);
        const tmp: Record<string, number> = {};
        row.eachCell((cell, colNum) => {
          const h = normalise(cell.value);
          if (h) tmp[h] = colNum;
        });
        // Check if this row contains an article-like column
        const articleKeys = ['articleno','articlenumber','materialno','material','itemcode','article'];
        if (articleKeys.some(k => tmp[k] !== undefined)) {
          Object.assign(headers, tmp);
          headerRowNum = tryRow;
          dataStartRow = tryRow + 1;
          break;
        }
      }

      // Flexible column detection
      const col = (candidates: string[]): number | null => {
        for (const c of candidates) {
          const key = normalise(c);
          if (headers[key] !== undefined) return headers[key];
        }
        return null;
      };

      const articleCol   = col(['ArticleNo','ArticleNumber','MaterialNo','Material','ItemCode','Article']);
      const soldToCol    = col(['SoldToParty','SoldTo','DistributorCode','Distributor']);
      const dmgCol       = col(['PrimaryDamage','Damaged','Damage','Dmg','QtyDamaged']);
      const nsCol        = col(['NonSaleable','NonSaleableProduct','NS','QtyNonSaleable','NonManufacturing']);
      const bbdCol       = col(['BBD','BBDStock','Expired','QtyBBD','BBDQty']);
      const mfgCol       = col(['MfgDate','ManufacturingDate','MFGDate','Mfg Date','Mfg']);
      const expCol       = col(['ExpDate','ExpiryDate','EXPDate','BBDDate','Exp Date','Exp']);
      const descCol      = col(['Description','BrandPack','ItemName','Name']);
      const rateCol      = col(['Rate','UnitValue','Price']);

      if (!articleCol) throw new Error(`Column "ArticleNo" not found. Header row detected at row ${headerRowNum}. Found columns: ${Object.keys(headers).join(', ')}`);

      // ── Parse data rows ─────────────────────────────────────────────────────
      const dist = distMap[activeTicket.distributorId];
      const distCode = dist?.code?.trim().toLowerCase() || '';

      let inserted = 0;
      let skipped  = 0;
      const errors: string[] = [];
      const inserts: any[]   = [];

      ws.eachRow((row, rowNum) => {
        if (rowNum <= headerRowNum) return; // skip title, instructions, header rows

        const getCellVal = (colIdx: number | null) => {
          if (!colIdx) return null;
          const v = row.getCell(colIdx).value;
          if (v === null || v === undefined || v === '') return null;
          return v;
        };

        const articleRaw = getCellVal(articleCol);
        if (!articleRaw) return; // skip empty rows

        const articleCode = String(articleRaw).trim();

        // SoldToParty filter — if column exists, only import rows matching this distributor
        if (soldToCol) {
          const rowDist = String(getCellVal(soldToCol) ?? '').trim().toLowerCase();
          if (rowDist && distCode && rowDist !== distCode) {
            skipped++;
            return;
          }
        }

        // Quantities — default 0
        const qDmg  = Math.max(0, Math.round(Number(getCellVal(dmgCol)) || 0));
        const qNs   = Math.max(0, Math.round(Number(getCellVal(nsCol))  || 0));
        const qBbd  = Math.max(0, Math.round(Number(getCellVal(bbdCol)) || 0));
        const qTot  = Math.max(0, Math.round(Number(getCellVal(col(['Quantity','TotalQuantity','Qty','Total']))) || 0));
        // If split columns are all zero but a Total Quantity is given, treat it as Non-Saleable
        const splitTotal = qDmg + qNs + qBbd;
        const effectiveNs  = splitTotal === 0 && qTot > 0 ? qTot : qNs;
        const total = qDmg + effectiveNs + qBbd;

        if (total === 0) { skipped++; return; } // nothing to insert

        // ── Lookup dump item FIRST (needed for sysQty validation) ────────────
        const dumpItem = dumpItemMap[articleCode];

        // ── Parse dates FIRST (needed for all validations below) ──────────────
        const rawMfg = getCellVal(mfgCol);
        const rawExp = getCellVal(expCol);
        const parseDateVal = (v: any): string => {
          if (!v) return '';
          if (v instanceof Date) return v.toISOString().split('T')[0];
          const s = String(v).trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          const d = new Date(s);
          return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
        };
        const mfgDate = parseDateVal(rawMfg);
        const expDate = parseDateVal(rawExp);

        // Rule 1: Exp date cannot be before Mfg date
        if (mfgDate && expDate && expDate < mfgDate) {
          errors.push(`${articleCode} (row ${rowNum}): Exp date (${expDate}) before Mfg date (${mfgDate})`);
          skipped++; return;
        }

        // Rule 2: Gap between Mfg and Exp must be more than 3 months (90 days)
        if (mfgDate && expDate) {
          const gapDays = Math.ceil((new Date(expDate).getTime() - new Date(mfgDate).getTime()) / 86400000);
          if (gapDays <= 90) {
            errors.push(`${articleCode} (row ${rowNum}): Gap between Mfg (${mfgDate}) and Exp (${expDate}) is only ${gapDays} days — must be more than 3 months`);
            skipped++; return;
          }
        }

        // Rule 4: Exp date after audit date only allowed for pure primary damage
        const auditDateStr = activeTicket.scheduledDate?.split('T')[0] || '';
        if (auditDateStr && expDate && expDate > auditDateStr) {
          const isPureDamage = qDmg > 0 && effectiveNs === 0 && qBbd === 0;
          if (!isPureDamage) {
            errors.push(`${articleCode} (row ${rowNum}): Exp (${expDate}) after audit date (${auditDateStr}) — only Primary Damage rows allowed`);
            skipped++; return;
          }
        }

        // Rate — from salesDump map first, then Excel column, then 0
        const unitValue = dumpItem?.rate || Math.max(0, Number(getCellVal(rateCol)) || 0);
        const totalValue = total * unitValue;

        // Description — from dump map first, then Excel column
        const description = dumpItem?.itemName
          || String(getCellVal(descCol) || articleCode);

        // Product life
        let productLife = '';
        if (mfgDate && expDate) {
          const diff = Math.ceil((new Date(expDate).getTime() - new Date(mfgDate).getTime()) / 86400000);
          if (diff > 0) productLife = `${diff} Days`;
        }

        // Build one row per qty type (matches how AddItemModal splits rows)
        if (qDmg > 0) inserts.push({
          id: crypto.randomUUID(), ticketId: activeTicket.id,
          articleNumber: articleCode, description, category: dumpItem?.category || '',
          quantity: qDmg, qtyDamaged: qDmg, qtyNonSaleable: 0, qtyBBD: 0,
          unitValue, totalValue: qDmg * unitValue,
          reasonCode: 'Verified / OK', mfgDate, expDate, productLife,
          bbdApprovalStatus: 'none', qtyDrained: 0,
        });
        if (effectiveNs > 0) inserts.push({
          id: crypto.randomUUID(), ticketId: activeTicket.id,
          articleNumber: articleCode, description, category: dumpItem?.category || '',
          quantity: effectiveNs, qtyDamaged: 0, qtyNonSaleable: effectiveNs, qtyBBD: 0,
          unitValue, totalValue: effectiveNs * unitValue,
          reasonCode: 'Verified / OK', mfgDate, expDate, productLife,
          bbdApprovalStatus: 'none', qtyDrained: 0,
        });
        if (qBbd > 0) inserts.push({
          id: crypto.randomUUID(), ticketId: activeTicket.id,
          articleNumber: articleCode, description, category: dumpItem?.category || '',
          quantity: qBbd, qtyDamaged: 0, qtyNonSaleable: 0, qtyBBD: qBbd,
          unitValue, totalValue: qBbd * unitValue,
          reasonCode: 'Verified / OK', mfgDate, expDate, productLife,
          bbdApprovalStatus: qBbd > 0 && expDate && activeTicket.scheduledDate && expDate > activeTicket.scheduledDate ? 'pending' : 'none',
          qtyDrained: 0,
        });
        inserted++;
      });

      if (inserts.length === 0) {
        setBulkUploadResult({ inserted: 0, skipped, errors: ['No valid rows with non-zero quantities found.'] });
        return;
      }

      // ── Insert in batches of 500 ────────────────────────────────────────────
      const BATCH = 500;
      for (let i = 0; i < inserts.length; i += BATCH) {
        const { error } = await supabase.from('auditLineItems').insert(inserts.slice(i, i + BATCH));
        if (error) throw new Error(`DB insert error: ${error.message}`);
      }

      // ── Update verifiedTotal on the ticket ────────────────────────────────
      const addedValue = inserts.reduce((s: number, r: any) => s + r.totalValue, 0);
      const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + addedValue;
      await supabase.from('auditTickets')
        .update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() })
        .eq('id', activeTicket.id);

      setBulkUploadResult({ inserted, skipped, errors });
      logActivity(user, profile, 'Bulk Items Uploaded',
        `${inserted} articles uploaded via Excel for ${dist?.name}`);

      // Refresh items
      await fetchItems(activeTicket.id);

    } catch (err: any) {
      console.error('Bulk upload error:', err);
      setBulkUploadResult({ inserted: 0, skipped: 0, errors: [err.message || 'Unknown error'] });
    } finally {
      setIsBulkUploading(false);
    }
  };

  // ── Download template for bulk upload ────────────────────────────────────
  const downloadBulkTemplate = async () => {
    if (!activeTicket) return;
    const dist = distMap[activeTicket.distributorId];
    const distCode = dist?.code?.trim() || '';

    // Fetch fresh from salesDump for this distributor
    const ExcelJS = (await import('exceljs')).default;
    let dumpRows: CombinedDumpItem[] = [];

    if (distCode) {
      const { data: rawDump } = await supabase
        .from('salesDump')
        .select('id,itemCode,itemName,quantity,rate,category')
        .ilike('distributorCode', distCode);
      if (rawDump && rawDump.length > 0) {
        const dedupMap = new Map<string, CombinedDumpItem>();
        rawDump.forEach((d: any) => {
          const existing = dedupMap.get(d.itemCode);
          if (!existing || d.quantity > existing.expectedQty) {
            dedupMap.set(d.itemCode, {
              id: d.id, itemCode: d.itemCode,
              itemName: d.itemName || d.itemCode,
              expectedQty: d.quantity || 0,
              rate: d.rate || 0,
              category: d.category || '',
            });
          }
        });
        dumpRows = Array.from(dedupMap.values());
      }
    }

    if (dumpRows.length === 0 && availableDumpItems.length > 0) {
      const seen = new Map<string, CombinedDumpItem>();
      availableDumpItems.forEach(d => { if (!seen.has(d.itemCode)) seen.set(d.itemCode, d); });
      dumpRows = Array.from(seen.values());
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Upload');

    // Simple plain headers — row 1
    ws.columns = [
      { header: 'SoldToParty',   key: 'SoldToParty',   width: 16 },
      { header: 'ArticleNo',     key: 'ArticleNo',      width: 18 },
      { header: 'Description',   key: 'Description',    width: 32 },
      { header: 'SystemQty',     key: 'SystemQty',      width: 14 },
      { header: 'PrimaryDamage', key: 'PrimaryDamage',  width: 16 },
      { header: 'NonSaleable',   key: 'NonSaleable',    width: 16 },
      { header: 'BBD',           key: 'BBD',            width: 14 },
      { header: 'MfgDate',       key: 'MfgDate',        width: 14 },
      { header: 'ExpDate',       key: 'ExpDate',        width: 14 },
    ];

    // Bold header row
    ws.getRow(1).font = { bold: true };

    // Data rows
    dumpRows.forEach(item => {
      ws.addRow({
        SoldToParty:   distCode,
        ArticleNo:     item.itemCode,
        Description:   item.itemName,
        SystemQty:     item.expectedQty,
        PrimaryDamage: 0,
        NonSaleable:   0,
        BBD:           0,
        MfgDate:       '',
        ExpDate:       '',
      });
    });

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `AuditUpload_${dist?.name || distCode}_${activeTicket?.scheduledDate || 'draft'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const setDrainageDate = async () => {
    if (!activeTicket || !drainageDateInput) return;
    
    const newSignOffs = { ...(activeTicket.signOffs || {}), drainageDate: drainageDateInput };
    await supabase.from('auditTickets').update({ signOffs: newSignOffs, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    setActiveTicket({ ...activeTicket, signOffs: newSignOffs });
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Drainage Scheduled", `Drainage date set to ${drainageDateInput} for ${dist?.name}`);
    
    alert("Drainage date saved successfully!");
  };

  const startAudit = async (ticket: AuditTicket) => {
    try {
      const { error } = await supabase.from('auditTickets').update({ 
        status: 'in_progress',
        updatedAt: new Date().toISOString()
      }).eq('id', ticket.id);
      
      if (error) throw error;
      
      logActivity(user, profile, "Audit Started", `Auditor started execution for ${distMap[ticket.distributorId]?.name}`);
      setActiveTicket({ ...ticket, status: 'in_progress' });
    } catch (error) {
      console.error("Failed to start audit:", error);
    }
  };

  const submitByAuditor = async () => {
    if (!activeTicket) return;
    
    const hasPendingItems = items.some(i => i.bbdApprovalStatus === 'pending');
    if (hasPendingItems) {
       alert("You have items marked as Expired that have future expiry dates. An Admin must approve these exceptions before you can submit the audit.");
       return;
    }

    if (!activeTicket.signOffs?.whatsappMediaApproved || !activeTicket.signOffs?.signoffDocumentApproved) {
       alert("WhatsApp Evidence and Physical Sign-off must be approved by an Admin before submitting.");
       return;
    }

    await supabase.from('auditTickets').update({ status: 'auditor_submitted', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Count Completed", `Auditor submitted count for ${dist?.name}`);

    setActiveTicket(null); alert("Audit successfully forwarded to ASE for review!");
  };

  const rejectByASE = async () => {
    if (!activeTicket || !user || !profile) return;
    
    const reason = window.prompt("Please provide a reason for rejecting this audit count (this will be logged in the Discussion):");
    if (reason === null) return; 
    if (!reason.trim()) { alert("A reason is required to reject the audit."); return; }

    try {
      const rejectionMessage = `🚨 Audit Rejected: ${reason}`;
      
      const newComment = {
        id: Math.random().toString(36).substring(7),
        userId: user.id,
        userName: profile.name,
        role: profile.role,
        text: rejectionMessage,
        message: rejectionMessage,
        content: rejectionMessage, 
        timestamp: new Date().toISOString()
      };

      const updatedComments = [...(activeTicket.comments || []), newComment];

      await supabase.from('auditTickets').update({ 
        status: 'in_progress', 
        comments: updatedComments,
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
      
      setActiveTicket({ 
        ...activeTicket, 
        status: 'in_progress',
        comments: updatedComments 
      });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Audit Rejected", `${profile.role.toUpperCase()} rejected the audit count for ${dist?.name}. Reason: "${reason}"`);

      alert("Audit rejected! The reason has been posted to the discussion board and returned to the Auditor for corrections.");
    } catch (error) {
      console.error("Error rejecting audit:", error);
      alert("Failed to reject audit.");
    }
  };

  const submitByASE = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'submitted', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Verified", `${profile?.role.toUpperCase()} verified audit for ${dist?.name} and requested sign-offs`);

    setActiveTicket(null); alert("Audit verified! It is now pending Sign-offs.");
  };

  const signOff = async (roleRequired: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    
    if (profile.role !== roleRequired && !isAdminOrSuperadmin) { 
      alert(`Action Denied: Must be an ${roleRequired.toUpperCase()} or Admin to sign.`); 
      return; 
    }
    
    const signOffData: SignOff = { userId: user.id, name: profile.name, timestamp: new Date().toISOString() };
    const signOffs = { ...(activeTicket.signOffs || {}), [roleRequired]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    
    const newStatus = allSigned ? 'drainage_pending' : activeTicket.status;

    await supabase.from('auditTickets').update({ signOffs, status: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Signed Off", `${profile.role.toUpperCase()} signed off on behalf of ${roleRequired.toUpperCase()} for ${dist?.name}`);

    if (allSigned) {
      alert("All sign-offs completed! Audit has officially moved to the Drainage phase.");
      setActiveTicket(null);
    } else {
      setActiveTicket({ ...activeTicket, signOffs });
    }
  };

  const submitDrainage = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'closed', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Closed", `Drainage phase completed and audit officially closed for ${dist?.name}`);

    setActiveTicket(null); alert("Drainage completed! The audit is now fully Closed.");
  };

  // Flush any pending saves when the user navigates away from a ticket
  const handleCloseTicket = useCallback(async () => {
    if (saveQueue.pendingCount() > 0) {
      await saveQueue.flushAll();
    }
    setActiveTicket(null);
    latestEditsRef.current = {};
  }, []);

  const filteredItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return items;
    const lowerQuery = itemSearchQuery.toLowerCase();
    return items.filter(item => 
      (item.articleNumber && item.articleNumber.toLowerCase().includes(lowerQuery)) ||
      (item.description && item.description.toLowerCase().includes(lowerQuery))
    );
  }, [items, itemSearchQuery]);


  // ── Sign-off Excel export hook — at top level per React rules of hooks ───────
  // Build distributor object explicitly so all fields (including address) are passed to export
  const activeTicketDist = activeTicket ? (() => {
    const d = distMap[activeTicket.distributorId];
    if (!d) return undefined;
    return {
      id:                  d.id,
      code:                d.code                || '',
      name:                d.name                || '',
      anchorName:          d.anchorName          || '',
      address:             d.address             || '',
      city:                d.city                || '',
      state:               d.state               || '',
      region:              d.region              || '',
      approvedValue:       d.approvedValue       || 0,
      assignment_serial_no: d.assignment_serial_no || '',
      aseIds:              d.aseIds              || [],
      asmIds:              d.asmIds              || [],
      smIds:               d.smIds               || [],
      dmIds:               d.dmIds               || [],
      hoIds:               d.hoIds               || [],
      active:              d.active,
    };
  })() : undefined;
  const { exportSignOff, isExporting, exportClaimPDF, isExportingPDF } = useSignOffExport({
    distributor: activeTicketDist,
    audit: {
      id:            activeTicket?.id ?? '',
      serialNo:      activeTicketDist?.assignment_serial_no || activeTicket?.signOffs?.auditSerialNo || activeTicket?.id || '',
      scheduledDate: activeTicket?.scheduledDate ?? null,
      // auditEndDate: last scheduled day (scheduledDate + auditDays - 1)
      auditEndDate: (() => {
        if (!activeTicket?.scheduledDate) return null;
        const days = (activeTicket as any).auditDays || 1;
        const d = new Date(activeTicket.scheduledDate);
        d.setDate(d.getDate() + days - 1);
        return d.toISOString().split('T')[0];
      })(),
      drainageDate:  activeTicket?.signOffs?.drainageDate ?? null,
      approvedValue: activeTicket?.approvedValue ?? 0,
      verifiedTotal: activeTicket?.verifiedTotal ?? 0,
      // Pull auditor name from the assigned auditors list
      auditorName: (() => {
        const ids = (activeTicket as any)?.auditorIds as string[] | undefined;
        if (!ids || ids.length === 0) return 'Singla Vishal & Co.';
        return 'Singla Vishal & Co.';
      })(),
      asmName: activeTicketDist
        ? (() => {
            // asmName not directly in ticket — leave blank for manual fill
            return '';
          })()
        : '',
    },
    items: items.map(i => {
      const qty   = (i.qtyDamaged || 0) + (i.qtyNonSaleable || 0) + (i.qtyBBD || 0) || i.quantity || 0;
      const total = qty * (i.unitValue || 0);
      return {
        articleNumber:  i.articleNumber,
        description:    i.description,
        quantity:       qty,
        totalValue:     i.totalValue || total,
        qtyDamaged:     i.qtyDamaged     || 0,
        qtyNonSaleable: i.qtyNonSaleable || 0,
        qtyBBD:         i.qtyBBD         || 0,
        qtySampling:    0,
        unitValue:      i.unitValue       || 0,
        mfgDate:        i.mfgDate    || '',
        expDate:        i.expDate    || '',
        productLife:    i.productLife || '',
        reasonCode:     i.reasonCode  || '',
        remarks:        i.remarks     || '',
        gst:            (dumpItemMap[i.articleNumber] as any)?.gst          || 0,
        standardPack:   (dumpItemMap[i.articleNumber] as any)?.standardPack || '',
        category:       (dumpItemMap[i.articleNumber] as any)?.category      || i.category || '',
      };
    }),
  });

  if (activeTicket) {
    const dist = distMap[activeTicket.distributorId];

    const approvedLogs = activeTicket.presenceLogs?.filter((l: any) => l.status === 'approved') || [];
    const hasApprovedCheckIn = approvedLogs.length > 0;

    const canUploadFiles = (isAuditor || isAdminOrSuperadmin) && (!isSubmittedPhase && !['auditor_submitted'].includes(activeTicket.status));

    // addItemApprovalGranted gates only the manual/unlisted item path inside the modal
    const addItemApprovalGranted = activeTicket.signOffs?.addItemApprovalGranted === true;
    
    // SuperAdmin has full edit access regardless of other gates
    const canEditItems = isSuperAdmin
      ? activeTicket.status === 'in_progress' && !isClosedPhase
      : (isAuditor || isAdminOrSuperadmin) && canUploadFiles && activeTicket.status === 'in_progress' && !isClosedPhase;
    const canEditDrainage = (isSuperAdmin || isAdminOrSuperadmin || isAuditor) && activeTicket.status === 'drainage_pending' && !isClosedPhase;

    // ── Sign-off export unlock condition ──────────────────────────────────────
    // Schema: auditTickets.whatsappMediaApproved is a direct bool column
    // Fall back to signOffs JSONB for backward compat with older records
    const whatsappApproved =
      (activeTicket as any).whatsappMediaApproved === true ||
      activeTicket.signOffs?.whatsappMediaApproved === true;

    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;
    
    const auditDateString = activeTicket.scheduledDate?.split('T')[0] || '';
    const canSubmitToAse = activeTicket.signOffs?.whatsappMediaApproved === true && activeTicket.signOffs?.signoffDocumentApproved === true;

    return (
      <div className="space-y-4 sm:space-y-6 pb-12 w-full min-w-0">

        {/* --- DYNAMIC HEADER WITH ADMIN FORCE STATUS DROPDOWN --- */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <button onClick={handleCloseTicket} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-black transition-colors w-fit">
            <ArrowLeft size={16} /> Back to List
          </button>
          
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {isAdminOrSuperadmin && (
              <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-sm w-full sm:w-auto">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:inline">Force Status:</span>
                <select
                  className="text-xs sm:text-sm font-bold bg-transparent outline-none cursor-pointer text-black w-full disabled:opacity-50"
                  value={activeTicket.status}
                  onChange={(e) => forceUpdateStatus(e.target.value)}
                  disabled={isClosedPhase}
                >
                  <option value="scheduled">Active (Scheduled)</option>
                  <option value="in_progress">Active (In Progress)</option>
                  <option value="auditor_submitted">Awaiting ASE Review</option>
                  <option value="submitted">Pending Sign-offs</option>
                  <option value="drainage_pending">Drainage Pending</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            )}

            <div className="flex w-full sm:w-auto gap-2 sm:gap-3">
              {isSuperAdmin && !isClosedPhase && (
                <button onClick={resetAuditTicket} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-rose-100 transition-all border border-rose-100"><RotateCcw size={16} /> <span className="hidden sm:inline">Reset</span></button>
              )}

              {/* Export Sign-Off Excel — unlocked when WhatsApp evidence approved */}
              <button
                onClick={exportSignOff}
                disabled={!whatsappApproved || isExporting || items.length === 0}
                title={!whatsappApproved ? "Unlocked after Admin approves WhatsApp Evidence" : items.length === 0 ? "No line items to export" : "Download Sign-Off Excel"}
                className={cn(
                  "flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all border",
                  whatsappApproved && items.length > 0
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                )}
              >
                {isExporting
                  ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
                  : <><FileSpreadsheet size={15} /> <span className="hidden sm:inline">Sign-Off Excel</span><span className="sm:hidden">Export</span></>
                }
              </button>

              {/* Claim Letter PDF — both distributor + anchor letter heads */}
              <button
                onClick={exportClaimPDF}
                disabled={!whatsappApproved || isExportingPDF || items.length === 0}
                title={!whatsappApproved ? "Unlocked after Admin approves WhatsApp Evidence" : "Download Claim Letter PDF (Distributor + Anchor)"}
                className={cn(
                  "flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all border",
                  whatsappApproved && items.length > 0
                    ? "bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                )}
              >
                {isExportingPDF
                  ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
                  : <><FileText size={15} /> <span className="hidden sm:inline">Claim Letter PDF</span><span className="sm:hidden">PDF</span></>
                }
              </button>

              <button onClick={() => setIsChatOpen(true)} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-indigo-100 transition-all border border-indigo-100"><MessageSquare size={16} /> Discussion {activeTicket.comments?.length ? `(${activeTicket.comments.length})` : ''}</button>
            </div>
          </div>
        </div>

        {/* --- MAIN DISTRIBUTOR & BUDGET CARD --- */}
        <div className="bg-white rounded-[1.5rem] sm:rounded-[2.5rem] p-5 sm:p-8 border border-slate-200 shadow-sm w-full">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6 sm:mb-8 w-full">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-100 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0"><Store className="text-black" size={24} /></div>
              <div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{dist?.name || 'Unknown Distributor'}</h3>
                <div className="flex items-center gap-2 mt-1 text-xs sm:text-sm text-slate-500 flex-wrap"><span className="font-mono bg-slate-100 px-2 py-0.5 rounded-md text-slate-700">{dist?.code}</span><MapPin size={14} /> {dist?.city || 'No city'}, {dist?.state}</div>
              </div>
            </div>

            {/* ASE + Auditor info panel */}
            {ticketUsers.length > 0 && (
              <div className="flex flex-col gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 min-w-[180px] max-w-[260px]">
                {(() => {
                  const ases     = ticketUsers.filter(u => u.role === 'ase');
                  const auditors = ticketUsers.filter(u => u.role === 'auditor');
                  const renderUser = (u: typeof ticketUsers[0], label: string, color: string) => (
                    <div key={u.id} className="flex flex-col">
                      <span className={`text-[9px] font-black uppercase tracking-wider ${color} mb-0.5`}>{label}</span>
                      <span className="text-sm font-bold text-slate-900 leading-tight">{u.name}</span>
                      {u.phone
                        ? <a href={`tel:${u.phone}`} className="text-[11px] font-bold text-blue-600 hover:underline mt-0.5">{u.phone}</a>
                        : <span className="text-[10px] text-slate-400 mt-0.5">No phone</span>
                      }
                    </div>
                  );
                  return (
                    <>
                      {ases.map(u => renderUser(u, 'ASE', 'text-violet-500'))}
                      {ases.length > 0 && auditors.length > 0 && <div className="border-t border-slate-200 my-0.5" />}
                      {auditors.map(u => renderUser(u, 'Auditor', 'text-emerald-600'))}
                    </>
                  );
                })()}
              </div>
            )}
            
            <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto bg-slate-50 md:bg-transparent p-4 md:p-0 rounded-2xl md:rounded-none border md:border-none border-slate-100">
              <div className="text-left md:text-right w-full">
                <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Total Verified Value</p>
                <p className="text-2xl sm:text-3xl font-black text-emerald-600">₹{(activeTicket.verifiedTotal || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
              </div>
              <div className="w-full max-w-full md:max-w-[200px] h-2 bg-slate-200 md:bg-slate-100 rounded-full overflow-hidden mt-1">
                <div className={cn("h-full rounded-full transition-all", percentUsed > 100 ? "bg-rose-500" : percentUsed > 90 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(percentUsed, 100)}%` }} />
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 font-medium">of ₹{activeTicket.approvedValue.toLocaleString()} limit</p>
            </div>
          </div>

          {!isActionableDate && canUploadFiles && !isClosedPhase && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-amber-50 border border-amber-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <Lock className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <div><h4 className="font-bold text-amber-900 text-sm sm:text-base">Execution Locked</h4><p className="text-xs sm:text-sm text-amber-700 mt-1">This audit is scheduled for <strong>{activeTicket.scheduledDate}</strong>. You cannot begin before this date.</p></div>
            </div>
          )}

          {isActionableDate && canUploadFiles && !hasApprovedCheckIn && !isClosedPhase && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-indigo-50 border border-indigo-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <Lock className="text-indigo-500 shrink-0 mt-0.5" size={20} />
              <div><h4 className="font-bold text-indigo-900 text-sm sm:text-base">Awaiting Selfie Approval</h4><p className="text-xs sm:text-sm text-indigo-800 mt-1">Your check-in selfie must be <strong>approved by an Admin</strong> before you can begin counting line items.</p></div>
            </div>
          )}





          {activeTicket.status === 'auditor_submitted' && !isClosedPhase && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-indigo-50 border border-indigo-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <AlertCircle className="text-indigo-600 shrink-0 mt-0.5" size={20} />
              <div><h4 className="font-bold text-indigo-900 text-sm sm:text-base">Awaiting ASE Review</h4><p className="text-xs sm:text-sm text-indigo-800 mt-1">The Auditor has completed their count. This audit is currently locked waiting for the ASE to review the counts.</p></div>
            </div>
          )}
          
          {activeTicket.status === 'submitted' && !isClosedPhase && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-amber-50 border border-amber-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <FileText className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <div><h4 className="font-bold text-amber-900 text-sm sm:text-base">Pending Sign-offs</h4><p className="text-xs sm:text-sm text-amber-800 mt-1">The audit is verified. All parties must provide their digital sign-off below before the Drainage Phase can begin.</p></div>
            </div>
          )}

          {activeTicket.status === 'drainage_pending' && !isClosedPhase && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-cyan-50 border border-cyan-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <CalendarClock className="text-cyan-500 shrink-0 mt-0.5" size={20} />
              <div className="w-full">
                <h4 className="font-bold text-cyan-900 text-sm sm:text-base">Drainage Phase Active</h4>
                {isAdminOrSuperadmin ? (
                  <>
                    <p className="text-xs sm:text-sm text-cyan-800 mt-1 mb-3 sm:mb-4">Original counts are frozen. The <strong>Drained Qty</strong> column is unlocked. Confirm the scheduled drainage date below to finalize.</p>
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 max-w-sm">
                      <input type="date" className="w-full sm:flex-1 px-4 py-3 sm:py-2 rounded-xl border border-cyan-200 outline-none focus:ring-2 focus:ring-cyan-500 text-sm font-bold bg-white shadow-sm" value={drainageDateInput || activeTicket.signOffs?.drainageDate || ''} onChange={(e) => setDrainageDateInput(e.target.value)} />
                      <button onClick={setDrainageDate} disabled={!drainageDateInput} className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-cyan-600 text-white font-bold rounded-xl hover:bg-cyan-700 transition-colors disabled:opacity-50 shadow-sm">Save Date</button>
                    </div>
                    {!isDrainageToday && activeTicket.signOffs?.drainageDate && (
                      <p className="mt-3 text-[11px] sm:text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle size={14} /> Inputs are currently locked. The Drainage Date must be set to today ({todayStr}) to edit quantities.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs sm:text-sm text-cyan-800 mt-1 mb-3 sm:mb-4">Original counts are frozen. <strong>Drainage Date: {activeTicket.signOffs?.drainageDate || 'Pending Admin to schedule'}</strong></p>
                    {!isDrainageToday && activeTicket.signOffs?.drainageDate && (
                      <p className="mt-3 text-[11px] sm:text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle size={14} /> Drained Qty inputs are locked because the drainage date is not today.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {!isSubmittedPhase && activeTicket.status !== 'auditor_submitted' && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrSuperadmin) && (
            <CheckInBlock activeTicket={activeTicket} setActiveTicket={setActiveTicket} user={user} profile={profile} isAdminOrSuperadmin={isAdminOrSuperadmin} isActionableDate={isActionableDate} />
          )}

          <div className="space-y-6 sm:space-y-8 w-full min-w-0">
            <div className="w-full min-w-0">
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 mb-4 w-full">
                <h4 className="font-bold text-base sm:text-lg flex items-center gap-2 shrink-0 text-slate-900"><ClipboardCheck className="text-indigo-600" size={20} /> Audit Line Items</h4>
                
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto flex-1 md:justify-end">
                  <div className="relative w-full sm:w-64 md:w-72">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text" 
                      placeholder="Search article no or desc..." 
                      className="w-full pl-9 pr-3 py-2 sm:py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm placeholder:text-slate-400"
                      value={itemSearchQuery}
                      onChange={(e) => setItemSearchQuery(e.target.value)}
                    />
                  </div>
                  {/* Bulk upload + Add Item buttons */}
                  {canEditItems && (
                    <>
                      {/* Hidden file input */}
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        ref={bulkUploadRef}
                        onChange={handleBulkUpload}
                      />
                      {/* Download template */}
                      <button
                        onClick={downloadBulkTemplate}
                        className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 whitespace-nowrap bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                        title="Download Excel template pre-filled with this distributor's items"
                      >
                        <Download size={16} /> Template
                      </button>
                      {/* Upload Excel */}
                      <button
                        onClick={() => bulkUploadRef.current?.click()}
                        disabled={isBulkUploading}
                        className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 whitespace-nowrap bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                        title="Upload Excel with ArticleNo + quantities to bulk-fill items"
                      >
                        {isBulkUploading
                          ? <><Loader2 size={16} className="animate-spin" /> Uploading…</>
                          : <><FileUp size={16} /> Upload Excel</>
                        }
                      </button>
                      {/* Manual Add */}
                      <button 
                        onClick={() => setIsAddModalOpen(true)} 
                        className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 py-2.5 sm:py-2.5 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 whitespace-nowrap bg-slate-900 text-white hover:bg-slate-800"
                      >
                        <Plus size={18} /> Add Item
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              {/* Bulk upload result banner */}
              {bulkUploadResult && (
                <div className={cn(
                  'flex items-start justify-between gap-3 p-3.5 rounded-xl mb-3 border text-sm font-bold',
                  bulkUploadResult.errors.length > 0
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                )}>
                  <div className="flex items-start gap-2">
                    {bulkUploadResult.errors.length > 0
                      ? <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-500" />
                      : <CheckCheck size={16} className="shrink-0 mt-0.5 text-emerald-600" />
                    }
                    <div>
                      <p>
                        {bulkUploadResult.inserted > 0 && `✅ ${bulkUploadResult.inserted} articles inserted. `}
                        {bulkUploadResult.skipped  > 0 && `⏭ ${bulkUploadResult.skipped} rows skipped (zero qty or different distributor). `}
                        {bulkUploadResult.errors.map((e, i) => <span key={i} className="text-rose-700">❌ {e}</span>)}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setBulkUploadResult(null)} className="shrink-0 p-0.5 hover:bg-black/10 rounded-lg transition-colors">
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* --- RESPONSIVE TABLE WRAPPER --- */}
              <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl overflow-hidden shadow-sm w-full">
                <div className="w-full overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs sm:text-sm min-w-[1100px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 sm:py-4 text-left font-bold text-slate-500 sticky left-0 bg-slate-50 z-10 border-r sm:border-r-0 border-slate-200 uppercase tracking-wider text-[11px]">Article & Desc</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-slate-500 bg-slate-100/50 border-x border-slate-200 uppercase tracking-wider text-[11px]">Sys Qty</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-indigo-600 bg-indigo-50/50 border-r border-indigo-100 uppercase tracking-wider text-[11px]">Primary Damage</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-rose-600 bg-rose-50/50 border-r border-rose-100 uppercase tracking-wider text-[11px]">Non-Saleable</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-amber-600 bg-amber-50/50 border-r border-amber-100 uppercase tracking-wider text-[11px]">BBD (Expired)</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-black text-slate-900 bg-slate-100/50 border-r border-slate-200 uppercase tracking-wider text-[11px]">Total Count</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-indigo-600 bg-indigo-50/50 border-r border-indigo-100 uppercase tracking-wider text-[11px]">Mfg Date</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-indigo-600 bg-indigo-50/50 border-r border-indigo-100 uppercase tracking-wider text-[11px]">Exp Date</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-indigo-600 bg-indigo-50/50 border-r border-indigo-100 uppercase tracking-wider text-[11px]">Life</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-cyan-600 bg-cyan-50/50 border-r border-cyan-100 uppercase tracking-wider text-[11px]">Drained Qty</th>
                        <th className="px-4 py-3 sm:py-4 text-right font-bold text-slate-500 uppercase tracking-wider text-[11px]">Rate</th>
                        <th className="px-4 py-3 sm:py-4 text-right font-bold text-slate-500 uppercase tracking-wider text-[11px]">Total Value</th>
                        <th className="px-3 py-3 sm:py-4 text-left font-bold text-slate-500 uppercase tracking-wider text-[11px]">Remarks</th>
                        {canEditItems && <th className="px-3 py-3 sm:py-4 text-center font-bold text-slate-500 uppercase tracking-wider text-[11px]">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 relative">
                      {filteredItems.map((item, index) => {
                        const dumpMatch = dumpItemMap[item.articleNumber];
                        const systemQty = dumpMatch ? dumpMatch.expectedQty : 0;
                        const isFirstInstance = filteredItems.findIndex(i => i.articleNumber === item.articleNumber) === index;

                        return (
                          <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="px-4 py-3 sm:py-4 sticky left-0 bg-white group-hover:bg-slate-50/80 z-10 border-r sm:border-r-0 border-slate-100">
                              <p className="font-bold text-slate-900">{item.articleNumber}</p>
                              <p className="text-[9px] sm:text-[10px] text-slate-500 truncate max-w-[120px] sm:max-w-[150px] font-medium">{item.description}</p>
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-slate-50/30 border-x border-slate-100">
                              {isFirstInstance ? (
                                <span className="font-mono text-slate-500 font-semibold">{systemQty}</span>
                              ) : (
                                <span className="font-mono text-slate-300 font-bold" title="Split Row">↳</span>
                              )}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-indigo-50/10 border-r border-indigo-50">
                              {canEditItems ? <input type="number" min="0" value={item.qtyDamaged || ''} onChange={(e) => handleInlineChange(item.id, 'qtyDamaged', e.target.value, e)} onBlur={() => saveInlineEdit(item.id)} className="w-12 text-center bg-white border border-slate-200 text-xs font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-700 shadow-sm" placeholder="0" /> : <span className="font-bold text-indigo-700">{item.qtyDamaged}</span>}
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-rose-50/10 border-r border-rose-50">
                              {canEditItems ? <input type="number" min="0" value={item.qtyNonSaleable || ''} onChange={(e) => handleInlineChange(item.id, 'qtyNonSaleable', e.target.value, e)} onBlur={() => saveInlineEdit(item.id)} className="w-12 text-center bg-white border border-slate-200 text-xs font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:ring-2 focus:ring-rose-500 outline-none text-rose-700 shadow-sm" placeholder="0" /> : <span className="font-bold text-rose-700">{item.qtyNonSaleable}</span>}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-amber-50/10 border-r border-amber-50 relative align-top">
                              {canEditItems ? (
                                 <input 
                                    type="number" min="0" value={item.qtyBBD || ''} 
                                    onChange={(e) => handleInlineChange(item.id, 'qtyBBD', e.target.value, e)} 
                                    onBlur={() => saveInlineEdit(item.id)} 
                                    className={cn("w-12 text-center bg-white border text-xs font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:outline-none transition-colors shadow-sm", item.bbdApprovalStatus === 'pending' ? "border-rose-400 ring-2 ring-rose-400 text-rose-700" : "border-slate-200 focus:ring-2 focus:ring-amber-500 text-amber-700")} 
                                    placeholder="0"
                                 />
                              ) : (
                                 <span className="font-bold text-amber-700">{item.qtyBBD}</span>
                              )}
                              
                              {item.bbdApprovalStatus === 'pending' && <div className="mt-1.5 flex flex-col items-center justify-center gap-1 text-[9px] leading-tight text-rose-600 font-black uppercase tracking-wider"><AlertCircle size={10}/> Pending Admin</div>}
                              {item.bbdApprovalStatus === 'rejected' && <div className="mt-1.5 flex items-center justify-center gap-1 text-[9px] text-rose-600 font-black uppercase tracking-wider"><X size={10}/> Rejected</div>}
                              {item.bbdApprovalStatus === 'approved' && <div className="mt-1.5 flex items-center justify-center gap-1 text-[9px] text-emerald-600 font-black uppercase tracking-wider"><CheckCircle2 size={10}/> Approved</div>}
                              
                              {isAdminOrSuperadmin && item.bbdApprovalStatus === 'pending' && !isClosedPhase && (
                                 <div className="flex gap-1.5 justify-center mt-2.5">
                                    <button onClick={() => approveBBDItem(item)} className="text-emerald-600 bg-white hover:bg-emerald-50 p-1.5 rounded-md border border-emerald-200 shadow-sm transition-colors" title="Approve Exception"><CheckCircle2 size={12}/></button>
                                    <button onClick={() => rejectBBDItem(item)} className="text-rose-600 bg-white hover:bg-rose-50 p-1.5 rounded-md border border-rose-200 shadow-sm transition-colors" title="Reject Exception"><X size={12}/></button>
                                 </div>
                              )}
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-slate-50/50 border-r border-slate-100">
                              <span className={cn("font-black", item.quantity !== systemQty && item.reasonCode !== 'Surprise Find' ? "text-rose-600" : "text-slate-900")}>{item.quantity}</span>
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-indigo-50/10 border-r border-indigo-50">
                              {canEditItems ? (
                                <input type="date" max={!isAdminOrSuperadmin ? auditDateString : undefined} value={item.mfgDate || ''} onChange={(e) => handleInlineChange(item.id, 'mfgDate', e.target.value, e)} onBlur={() => saveInlineEdit(item.id)} className="w-[100px] sm:w-[110px] text-center bg-white border border-slate-200 text-[10px] font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-700 cursor-pointer shadow-sm" />
                              ) : (
                                <span className="font-bold text-indigo-700 text-[10px]">{item.mfgDate || '-'}</span>
                              )}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-indigo-50/10 border-r border-indigo-50">
                              {canEditItems ? (
                                <input type="date" max={!isAdminOrSuperadmin ? auditDateString : undefined} value={item.expDate || ''} onChange={(e) => handleInlineChange(item.id, 'expDate', e.target.value, e)} onBlur={() => saveInlineEdit(item.id)} className="w-[100px] sm:w-[110px] text-center bg-white border border-slate-200 text-[10px] font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-700 cursor-pointer shadow-sm" />
                              ) : (
                                <span className="font-bold text-indigo-700 text-[10px]">{item.expDate || '-'}</span>
                              )}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-indigo-50/10 border-r border-indigo-50">
                              <span className="font-bold text-indigo-900 text-[10px] sm:text-xs whitespace-nowrap">{item.productLife || '-'}</span>
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-cyan-50/10 border-r border-cyan-50">
                              {canEditDrainage ? (
                                <input type="number" min="0" max={item.quantity} value={item.qtyDrained ?? ''} onChange={(e) => handleDrainageChange(item.id, e.target.value)} onBlur={() => saveInlineDrainage(item.id)} className="w-14 text-center bg-white border border-slate-200 text-xs font-bold rounded-lg px-1 py-2 sm:py-1.5 focus:ring-2 focus:ring-cyan-500 outline-none text-cyan-800 shadow-sm" placeholder="0" />
                              ) : (
                                <span className="font-bold text-cyan-700">{item.qtyDrained || 0}</span>
                              )}
                            </td>

                            <td className="px-4 py-3 sm:py-4 text-right text-slate-500 text-[10px] sm:text-xs font-medium">
                              {isAdminOrSuperadmin ? (
                                <div className="flex items-center justify-end gap-0.5">
                                  <span className="text-[10px] text-slate-400">₹</span>
                                  <input
                                    type="number" min="0" step="0.01"
                                    value={item.unitValue || ''}
                                    onChange={e => handleInlineChange(item.id, 'unitValue', e.target.value, e)}
                                    onBlur={() => saveInlineEdit(item.id)}
                                    className="w-16 text-center bg-white border border-slate-200 text-xs font-bold rounded-lg px-1 py-1.5 focus:ring-2 focus:ring-emerald-500 outline-none text-emerald-700 shadow-sm"
                                    placeholder="0.00"
                                  />
                                </div>
                              ) : (
                                <span>₹{item.unitValue.toFixed(2)}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 sm:py-4 text-right font-black text-slate-900">₹{item.totalValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>

                            {/* Remarks — editable for auditor and superadmin only */}
                            <td className="px-3 py-3 sm:py-4 text-left min-w-[140px]">
                              {(canEditItems || isSuperAdmin) && !isClosedPhase ? (
                                <input
                                  type="text"
                                  placeholder="Add remark..."
                                  value={item.remarks || ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, remarks: val } : i));
                                    latestEditsRef.current[item.id] = { ...(latestEditsRef.current[item.id] || item), remarks: val };
                                  }}
                                  onBlur={() => {
                                    const toSave = latestEditsRef.current[item.id] || item;
                                    saveQueue.schedule(item.id, { remarks: toSave.remarks || '' });
                                  }}
                                  className="w-full min-w-[120px] px-2 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none text-slate-700 placeholder:text-slate-300"
                                />
                              ) : (
                                <span className="text-xs text-slate-600 font-medium">{item.remarks || <span className="text-slate-300 italic">—</span>}</span>
                              )}
                            </td>

                            {canEditItems && (
                              <td className="px-2 py-3 sm:py-4 text-center align-middle">
                                <div className="flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => deleteItem(item)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="Delete Row"><Trash2 size={16} /></button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                      {items.length === 0 && (
                        <tr><td colSpan={canEditItems ? 14 : 13} className="px-4 py-16 text-center text-slate-400"><PackageSearch size={32} className="mx-auto mb-3 opacity-30 text-indigo-500" /><p className="font-bold text-sm text-slate-500">No items counted yet.</p></td></tr>
                      )}
                      {items.length > 0 && filteredItems.length === 0 && (
                        <tr><td colSpan={canEditItems ? 14 : 13} className="px-4 py-16 text-center text-slate-400"><Search size={32} className="mx-auto mb-3 opacity-30 text-indigo-500" /><p className="font-bold text-sm text-slate-500">No items match your search.</p></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* --- EVIDENCE AND SIGN OFFS --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pt-4 border-t border-slate-100 w-full">
              
              <div className="space-y-3 sm:space-y-4">
                <h4 className="font-bold text-base sm:text-lg text-slate-900">Verification Evidence</h4>

                {/* ─── NEW: Allow Adding Items toggle (admin only, shows during in_progress) ── */}
                {(isAdminOrSuperadmin || isAuditor) && activeTicket.status === 'in_progress' && !isClosedPhase && (
                  <div className="p-4 sm:p-5 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] flex items-center justify-center shrink-0 border", addItemApprovalGranted ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-500 border-slate-200")}>
                        {addItemApprovalGranted ? <CheckCircle2 size={20} /> : <Plus size={20} />}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Allow Unlisted Items</h5>
                        <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Admin approval to enable the "Add Unlisted Item" option</p>
                      </div>
                    </div>
                    
                    {isAdminOrSuperadmin ? (
                      <button
                        onClick={toggleAddItemApproval}
                        className={cn("w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", addItemApprovalGranted ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-slate-900 text-white hover:bg-slate-800 shadow-md")}
                      >
                        {addItemApprovalGranted ? 'Approved' : 'Approve'}
                      </button>
                    ) : (
                      <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", addItemApprovalGranted ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                        {addItemApprovalGranted ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    )}
                  </div>
                )}
                
                <div className="p-4 sm:p-5 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] flex items-center justify-center shrink-0 border", activeTicket.signOffs?.whatsappMediaApproved ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-500 border-slate-200")}>
                      {activeTicket.signOffs?.whatsappMediaApproved ? <CheckCircle2 size={20} /> : <MessageSquare size={20} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs sm:text-sm">WhatsApp Evidence</h5>
                      <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Stock images & large videos</p>
                    </div>
                  </div>
                  
                  {isAdminOrSuperadmin && !isClosedPhase ? (
                    <button onClick={toggleWhatsappApproval} className={cn("w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.signOffs?.whatsappMediaApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-slate-900 text-white hover:bg-slate-800 shadow-md")}>
                      {activeTicket.signOffs?.whatsappMediaApproved ? 'Approved' : 'Mark Received'}
                    </button>
                  ) : (
                    <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.signOffs?.whatsappMediaApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                      {activeTicket.signOffs?.whatsappMediaApproved ? 'Approved by Admin' : 'Pending Admin'}
                    </span>
                  )}
                </div>

                {isDrainagePhase && (
                  <div className="p-4 sm:p-5 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] flex items-center justify-center shrink-0 border", activeTicket.signOffs?.drainageMediaApproved ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-500 border-slate-200")}>
                        {activeTicket.signOffs?.drainageMediaApproved ? <CheckCircle2 size={20} /> : <Droplets size={20} />}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Drainage Evidence</h5>
                        <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Photos/videos of destruction</p>
                      </div>
                    </div>
                    {isAdminOrSuperadmin && !isClosedPhase ? (
                      <button onClick={toggleDrainageMediaApproval} className={cn("w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.signOffs?.drainageMediaApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-slate-900 text-white hover:bg-slate-800 shadow-md")}>
                        {activeTicket.signOffs?.drainageMediaApproved ? 'Approved' : 'Mark Received'}
                      </button>
                    ) : (
                      <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.signOffs?.drainageMediaApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                        {activeTicket.signOffs?.drainageMediaApproved ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    )}
                  </div>
                )}

                <div className="p-4 sm:p-5 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] flex items-center justify-center shrink-0 border", activeTicket.signOffs?.signoffDocumentApproved ? "bg-emerald-50 text-emerald-600 border-emerald-100" : activeTicket.signOffs?.signoffDocumentUrl ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-slate-50 text-slate-500 border-slate-200")}>
                      {activeTicket.signOffs?.signoffDocumentApproved ? <CheckCircle2 size={20} /> : <FileText size={20} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Physical Sign-off</h5>
                      {activeTicket.signOffs?.signoffDocumentUrl ? (
                        <a href={activeTicket.signOffs.signoffDocumentUrl} target="_blank" rel="noreferrer" className="text-[10px] sm:text-xs text-indigo-600 hover:underline font-bold flex items-center gap-1 mt-0.5">View Document</a>
                      ) : (
                        <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Scanned sheet</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {!activeTicket.signOffs?.signoffDocumentUrl && (isAuditor || isASE || isAdminOrSuperadmin) && !isClosedPhase && (
                      <>
                        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" ref={signoffFileRef} onChange={handleSignoffUpload} />
                        <button onClick={() => signoffFileRef.current?.click()} disabled={isUploadingSignoff} className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all shadow-sm">
                          {isUploadingSignoff ? <Loader2 className="animate-spin inline" size={14} /> : 'Upload'}
                        </button>
                      </>
                    )}
                    
                    {activeTicket.signOffs?.signoffDocumentUrl && isAdminOrSuperadmin && !isClosedPhase ? (
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        {!activeTicket.signOffs?.signoffDocumentApproved && (
                           <button onClick={rejectSignoffDocument} className="flex-1 sm:flex-none px-3 py-2 text-xs font-bold rounded-xl transition-all active:scale-95 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 shadow-sm">Reject</button>
                        )}
                        <button onClick={toggleSignoffApproval} className={cn("flex-1 sm:flex-none px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.signOffs?.signoffDocumentApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-slate-900 text-white hover:bg-slate-800 shadow-md")}>
                          {activeTicket.signOffs?.signoffDocumentApproved ? 'Approved' : 'Approve'}
                        </button>
                      </div>
                    ) : activeTicket.signOffs?.signoffDocumentUrl ? (
                      <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.signOffs?.signoffDocumentApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-amber-50 border border-amber-200 text-amber-700")}>
                        {activeTicket.signOffs?.signoffDocumentApproved ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <h4 className="font-bold text-base sm:text-lg text-slate-900">Digital Sign-offs</h4>
                {(isSubmittedPhase || isAuditor || isSuperAdmin) && (
                  <div className="space-y-2 sm:space-y-3">
                    {['auditor', 'ase', 'distributor'].map((role) => {
                      const signedData = activeTicket.signOffs?.[role as keyof SignOff];
                      const isMyRole = profile?.role === role || isAdminOrSuperadmin;
                      return (
                        <div key={role} className="flex items-center justify-between p-3 sm:p-4 bg-white shadow-sm rounded-xl sm:rounded-2xl border border-slate-200">
                          <div><span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-600">{role}</span></div>
                          {signedData ? <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl border border-emerald-100/50"><CheckCircle2 size={12} className="sm:w-[14px] sm:h-[14px]" /> Signed</span>
                           : <button onClick={() => signOff(role as any)} disabled={!isMyRole || activeTicket.status !== 'submitted' || isClosedPhase} className={cn("px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold rounded-lg sm:rounded-xl shadow-sm transition-all", (isMyRole && activeTicket.status === 'submitted' && !isClosedPhase) ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-100 text-slate-400 border border-slate-200/50")}>{isMyRole && !isClosedPhase ? 'Sign Off' : 'Awaiting'}</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* --- ACTION BUTTONS --- */}
            {(isAuditor || isAdminOrSuperadmin) && activeTicket.status === 'in_progress' && items.length > 0 && (
              <div className="pt-6 sm:pt-8 flex flex-col items-end border-t border-slate-200 w-full gap-3">
                {!canSubmitToAse && (
                  <div className="flex items-start sm:items-center gap-2 p-3 sm:p-4 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 w-full sm:w-auto text-left sm:text-center text-xs sm:text-sm font-bold shadow-sm">
                    <AlertCircle size={18} className="shrink-0 mt-0.5 sm:mt-0" />
                    <p>WhatsApp Evidence and Physical Sign-off must be approved by Admin before submitting.</p>
                  </div>
                )}
                <button 
                  onClick={submitByAuditor} 
                  disabled={!canSubmitToAse}
                  className={cn("w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold transition-all shadow-xl active:scale-95 text-sm sm:text-base", canSubmitToAse ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/20" : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none border border-slate-200")}
                >
                  <Send size={18} /> Submit Audit to ASE
                </button>
              </div>
            )}

            {(isASE || isAdminOrSuperadmin) && activeTicket.status === 'auditor_submitted' && (
              <div className="pt-6 sm:pt-8 flex flex-col-reverse sm:flex-row justify-end gap-3 border-t border-slate-200 w-full">
                <button onClick={rejectByASE} className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-white border border-rose-200 text-rose-600 rounded-xl sm:rounded-2xl font-bold hover:bg-rose-50 transition-all shadow-sm active:scale-95 text-sm sm:text-base">
                  <RotateCcw size={18} /> Reject & Return to Auditor
                </button>
                <button onClick={submitByASE} className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-indigo-600 text-white rounded-xl sm:rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 active:scale-95 text-sm sm:text-base">
                  <CheckCircle2 size={18} /> Verify & Request Sign-offs
                </button>
              </div>
            )}

            {(isAuditor || isAdminOrSuperadmin) && activeTicket.status === 'drainage_pending' && (
              <div className="pt-6 sm:pt-8 flex justify-end border-t border-slate-200 w-full">
                <button 
                  onClick={submitDrainage} 
                  disabled={!activeTicket.signOffs?.drainageDate || !isDrainageToday}
                  title={!activeTicket.signOffs?.drainageDate ? "Please wait for an Admin to set a Drainage Date first" : !isDrainageToday ? "Drainage can only be completed on the exact scheduled date" : ""}
                  className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-cyan-600 text-white rounded-xl sm:rounded-2xl font-bold hover:bg-cyan-700 transition-all shadow-xl shadow-cyan-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                  <CheckCircle2 size={18} /> Complete Drainage & Close Audit
                </button>
              </div>
            )}

          </div>
        </div>

        <AddItemModal 
          isOpen={isAddModalOpen} 
          onClose={() => setIsAddModalOpen(false)} 
          activeTicket={activeTicket} 
          distributor={distMap[activeTicket.distributorId]} 
          availableDumpItems={availableDumpItems} 
          existingItemCodes={items.map(i => i.articleNumber)} 
          user={user}
          profile={profile}
          addItemApprovalGranted={addItemApprovalGranted}
        />
        <AnimatePresence>
          {isChatOpen && <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} activeTicket={activeTicket} user={user} profile={profile} />}
        </AnimatePresence>
      </div>
    );
  }

  const activeTickets = tickets.filter(t => ['scheduled', 'in_progress', 'auditor_submitted'].includes(t.status));
  const signoffTickets = tickets.filter(t => t.status === 'submitted');
  const drainageTickets = tickets.filter(t => t.status === 'drainage_pending');
  const completedTickets = tickets.filter(t => t.status === 'closed' && t.updatedAt?.startsWith(todayStr));

  let baseDisplayTickets: AuditTicket[] = [];
  if (activeTab === 'active') baseDisplayTickets = activeTickets;
  else if (activeTab === 'signoff') baseDisplayTickets = signoffTickets;
  else if (activeTab === 'drainage') baseDisplayTickets = drainageTickets;
  else if (activeTab === 'completed') baseDisplayTickets = completedTickets;

  // ── Search filter across all assignment fields ───────────────────────────
  const displayTickets = listSearch.trim()
    ? baseDisplayTickets.filter(t => {
        const dist = distMap[t.distributorId];
        if (!dist) return false;
        const q = listSearch.toLowerCase();
        return (
          // Assignment / serial no
          (dist.assignment_serial_no || '').toLowerCase().includes(q) ||
          // Distributor code
          (dist.code || '').toLowerCase().includes(q) ||
          // Anchor code
          (dist.anchorName || '').toLowerCase().includes(q) ||
          // Distributor name
          (dist.name || '').toLowerCase().includes(q) ||
          // City / State / Region
          (dist.city || '').toLowerCase().includes(q) ||
          (dist.state || '').toLowerCase().includes(q) ||
          (dist.region || '').toLowerCase().includes(q) ||
          // Address
          (dist.address || '').toLowerCase().includes(q) ||
          // Status
          t.status.replace(/_/g, ' ').toLowerCase().includes(q) ||
          // Scheduled date
          (t.scheduledDate || '').includes(q) ||
          // Ticket id
          t.id.toLowerCase().includes(q)
        );
      })
    : baseDisplayTickets;

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">

      {/* Tabs row + Status Report download button */}
      <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex bg-slate-100/80 p-1.5 rounded-xl sm:rounded-2xl overflow-x-auto w-full sm:w-fit custom-scrollbar scroll-smooth">
          <button onClick={() => { setActiveTab('active');    setListSearch(''); }} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'active' ? "bg-white text-indigo-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900")}>
            Active <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px]", activeTab === 'active' ? "bg-indigo-50 text-indigo-700" : "bg-slate-200/50 text-slate-500")}>{activeTickets.length}</span>
          </button>
          <button onClick={() => { setActiveTab('signoff');   setListSearch(''); }} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'signoff' ? "bg-white text-indigo-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900")}>
            Sign-off <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px]", activeTab === 'signoff' ? "bg-indigo-50 text-indigo-700" : "bg-slate-200/50 text-slate-500")}>{signoffTickets.length}</span>
          </button>
          <button onClick={() => { setActiveTab('drainage');  setListSearch(''); }} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'drainage' ? "bg-white text-indigo-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900")}>
            Drainage <span className="hidden sm:inline">Pending</span> <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px]", activeTab === 'drainage' ? "bg-indigo-50 text-indigo-700" : "bg-slate-200/50 text-slate-500")}>{drainageTickets.length}</span>
          </button>
          <button onClick={() => { setActiveTab('completed'); setListSearch(''); }} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'completed' ? "bg-white text-indigo-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-900")}>
            Completed <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px]", activeTab === 'completed' ? "bg-indigo-50 text-indigo-700" : "bg-slate-200/50 text-slate-500")}>{completedTickets.length}</span>
          </button>
        </div>

        {/* Download Status Report — all assignments in one Excel sheet */}
        {isAdminOrSuperadmin && (
          <button
            onClick={downloadStatusReport}
            disabled={isStatusExporting || tickets.length === 0}
            title="Download all assignments as Reporting Format - Audit Status Excel"
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border shadow-sm active:scale-95 whitespace-nowrap shrink-0",
              tickets.length > 0
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
            )}
          >
            {isStatusExporting
              ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
              : <><Download size={16} /> Status Report</>
            }
          </button>
        )}
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div className="relative group">
        <Search
          size={17}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors pointer-events-none"
        />
        <input
          type="text"
          placeholder="Search by Assignment No., Distributor Code, Anchor Code, Name, City, Status…"
          className="w-full pl-11 pr-10 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm text-sm text-slate-700 placeholder:text-slate-400"
          value={listSearch}
          onChange={e => setListSearch(e.target.value)}
        />
        {listSearch && (
          <button
            onClick={() => setListSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Assignment list table ────────────────────────────────────────── */}
      <div className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden w-full">
        {displayTickets.length === 0 ? (
          <div className="p-8 sm:p-16 text-center flex flex-col items-center justify-center">
            <ClipboardCheck size={40} className="text-slate-200 mb-3" />
            <h3 className="text-base font-bold text-slate-900">
              {listSearch ? 'No Matches Found' : 'No Audits Found'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {listSearch
                ? `No assignments match "${listSearch}". Try a different search term.`
                : 'There are currently no audits in this category.'}
            </p>
            {listSearch && (
              <button
                onClick={() => setListSearch('')}
                className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto w-full custom-scrollbar">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                {listSearch && (
                  <tr>
                    <td colSpan={7} className="px-5 py-2 bg-indigo-50 border-b border-indigo-100">
                      <p className="text-xs font-bold text-indigo-700">
                        {displayTickets.length} result{displayTickets.length !== 1 ? 's' : ''} for "{listSearch}"
                        <button onClick={() => setListSearch('')} className="ml-3 text-indigo-500 hover:text-indigo-700 underline font-bold">Clear</button>
                      </p>
                    </td>
                  </tr>
                )}
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Distributor</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Assignment No.</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Scheduled</th>
                  <th className="px-5 py-3.5 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Verified Value</th>
                  <th className="px-5 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayTickets.map(ticket => {
                  const dist = distMap[ticket.distributorId];

                  // Status badge config
                  const statusConfig: Record<string, { label: string; cls: string }> = {
                    scheduled:         { label: 'Scheduled',        cls: 'bg-blue-50 text-blue-700 border-blue-100' },
                    in_progress:       { label: 'In Progress',      cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
                    auditor_submitted: { label: 'ASE Review',       cls: 'bg-amber-50 text-amber-700 border-amber-100' },
                    submitted:         { label: 'Pending Sign-off', cls: 'bg-purple-50 text-purple-700 border-purple-100' },
                    drainage_pending:  { label: 'Drainage Pending', cls: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
                    closed:            { label: 'Closed',           cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                  };
                  const sc = statusConfig[ticket.status] || { label: ticket.status.replace(/_/g, ' '), cls: 'bg-slate-100 text-slate-600 border-slate-200' };

                  return (
                    <tr
                      key={ticket.id}
                      className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                      onClick={() => setActiveTicket(ticket)}
                    >
                      {/* Distributor */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-indigo-50 flex items-center justify-center shrink-0 transition-colors">
                            <Store size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm leading-tight">{dist?.name || '—'}</p>
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">{dist?.code || ''}</p>
                          </div>
                        </div>
                      </td>

                      {/* Assignment No */}
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          {dist?.assignment_serial_no || <span className="text-slate-400 font-normal">—</span>}
                        </span>
                      </td>

                      {/* Location */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-slate-600 flex items-center gap-1">
                          <MapPin size={11} className="text-slate-400 shrink-0" />
                          <span className="truncate max-w-[120px]">{[dist?.city, dist?.state].filter(Boolean).join(', ') || '—'}</span>
                        </p>
                      </td>

                      {/* Scheduled date */}
                      <td className="px-5 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                        {ticket.scheduledDate
                          ? new Date(ticket.scheduledDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                          : <span className="text-slate-400">—</span>}
                      </td>

                      {/* Verified value */}
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-sm font-bold text-slate-900">
                          ₹{(ticket.verifiedTotal || 0).toLocaleString('en-IN')}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">of ₹{(ticket.approvedValue || 0).toLocaleString('en-IN')}</p>
                      </td>

                      {/* Status badge */}
                      <td className="px-5 py-3.5 text-center">
                        <span className={cn('px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border', sc.cls)}>
                          {sc.label}
                        </span>
                      </td>

                      {/* Action button */}
                      <td className="px-5 py-3.5 text-center" onClick={e => e.stopPropagation()}>
                        {ticket.status === 'scheduled' && (isAuditor || isAdminOrSuperadmin) ? (
                          <button
                            onClick={() => startAudit(ticket)}
                            className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-all active:scale-95 shadow-sm"
                          >
                            Start
                          </button>
                        ) : (
                          <button
                            onClick={() => setActiveTicket(ticket)}
                            className="px-4 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-bold rounded-lg hover:bg-indigo-600 hover:text-white transition-all active:scale-95"
                          >
                            {['auditor', 'ase', 'admin', 'superadmin', 'ho'].includes(profile?.role || '') ? 'Open' : 'View'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
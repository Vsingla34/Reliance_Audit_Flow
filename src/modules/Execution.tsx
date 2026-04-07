import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase, logActivity } from '../supabase';
import { Distributor, SignOff, AuditTicket as BaseTicket, AuditLineItem as BaseItem } from '../types';
import { ClipboardCheck, Plus, Store, MapPin, CheckCircle2, ArrowLeft, AlertCircle, MessageSquare, PackageSearch, Lock, Trash2, Send, RotateCcw, CalendarClock, FileText, Upload, Loader2, User as UserIcon } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

import { CheckInBlock } from '../components/Execution/CheckInBlock';
import { AddItemModal } from '../components/Execution/AddItemModal';
import { ChatModal } from '../components/Execution/ChatModal';

const BUCKET_NAME = 'audit-media'; 

export interface AuditTicket extends BaseTicket { 
  drainageDate?: string; 
  whatsappMediaApproved?: boolean; 
  signoffDocumentUrl?: string;
  signoffDocumentApproved?: boolean;
  fieldAuditors?: { name: string; phone: string }[];
}
export interface AuditLineItem extends BaseItem { qtyDrained?: number; }

export interface CombinedDumpItem {
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string;
  billingDate?: string; plant?: string; billingDoc?: string; gst?: number; approxShelfLife?: string; standardPack?: string;
}

export function ExecutionModule() {
  const { profile, user } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [activeTicket, setActiveTicket] = useState<AuditTicket | null>(null);
  const [items, setItems] = useState<AuditLineItem[]>([]);
  const [availableDumpItems, setAvailableDumpItems] = useState<CombinedDumpItem[]>([]);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [drainageDateInput, setDrainageDateInput] = useState('');
  
  const [isUploadingSignoff, setIsUploadingSignoff] = useState(false);
  const signoffFileRef = useRef<HTMLInputElement>(null);

  // New states for Field Auditor Form
  const [auditorNameInput, setAuditorNameInput] = useState('');
  const [auditorPhoneInput, setAuditorPhoneInput] = useState('');

  const distMap = useMemo(() => {
    const map = new Map<string, Distributor>();
    distributors.forEach(d => map.set(d.id, d));
    return map;
  }, [distributors]);

  const dumpItemMap = useMemo(() => {
    const map = new Map<string, CombinedDumpItem>();
    availableDumpItems.forEach(d => map.set(d.itemCode, d));
    return map;
  }, [availableDumpItems]);

  const fetchData = async () => {
    if (!profile) return;
    try {
      let dQuery = supabase.from('distributors').select('*');
      if (profile.role === 'ase') dQuery = dQuery.eq('aseId', profile.uid);
      else if (profile.role === 'asm') dQuery = dQuery.eq('asmId', profile.uid);
      else if (profile.role === 'sm') dQuery = dQuery.eq('smId', profile.uid);
      else if (profile.role === 'dm') dQuery = dQuery.eq('dmId', profile.uid);

      const { data: dData } = await dQuery;
      const fetchedDistributors = (dData || []) as Distributor[];
      setDistributors(fetchedDistributors);

      let tQuery = supabase.from('auditTickets').select('*').in('status', ['scheduled', 'in_progress', 'auditor_submitted', 'drainage_pending', 'submitted', 'evidence_uploaded', 'signed']);
      if (profile.role === 'auditor') {
        tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
      }
      else if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
        const distIds = fetchedDistributors.map(d => d.id);
        if (distIds.length > 0) tQuery = tQuery.in('distributorId', distIds);
        else return setTickets([]);
      }

      const { data: tData } = await tQuery;
      if (tData) setTickets(tData as AuditTicket[]);
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('execution-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const fetchItems = async (ticketId: string) => {
    const { data } = await supabase.from('auditLineItems').select('*').eq('ticketId', ticketId).order('articleNumber', { ascending: true });
    if (data) setItems(data as AuditLineItem[]);
  };

  const loadDumpData = async (distCode: string) => {
    try {
      const { data: dump } = await supabase.from('salesDump').select('*').ilike('distributorCode', distCode.trim());
      if (dump && dump.length > 0) {
        const combined = dump.map(d => {
          return { 
            id: d.id, itemCode: d.itemCode, itemName: d.itemName || 'Unknown Item', expectedQty: d.quantity, rate: d.rate, category: d.category || 'Uncategorized',
            billingDate: d.billingDate, plant: d.plant, billingDoc: d.billingDoc, gst: d.gst, approxShelfLife: d.approxShelfLife, standardPack: d.standardPack
          };
        });
        setAvailableDumpItems(combined);
      } else { setAvailableDumpItems([]); }
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    if (activeTicket) {
      fetchItems(activeTicket.id);
      const dist = distributors.find(d => d.id === activeTicket.distributorId);
      if (dist) loadDumpData(dist.code);
      const channel = supabase.channel(`items-${activeTicket.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'auditLineItems', filter: `ticketId=eq.${activeTicket.id}` }, () => fetchItems(activeTicket.id)).subscribe();
      return () => { supabase.removeChannel(channel); };
    } else { setItems([]); setAvailableDumpItems([]); }
  }, [activeTicket?.id, distributors]); 

  useEffect(() => {
    if (activeTicket) {
      const updated = tickets.find(t => t.id === activeTicket.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(activeTicket)) {
        setActiveTicket(updated);
      }
    }
  }, [tickets, activeTicket]);

  const resetAuditTicket = async () => {
    if (!activeTicket) return;
    if (!window.confirm("Are you sure you want to completely clear this ticket? It will be removed from Execution and sent back to the Scheduler as a blank request.")) return;

    try {
      await supabase.from('auditLineItems').delete().eq('ticketId', activeTicket.id);
      await supabase.from('auditTickets').update({ 
        status: 'tentative', scheduledDate: null as any, drainageDate: null, whatsappMediaApproved: false, signoffDocumentUrl: null, signoffDocumentApproved: false, fieldAuditors: [], auditorId: null as any, auditorIds: [], presenceLogs: [], media: [], signOffs: {}, comments: [], dateProposals: [], verifiedTotal: 0, updatedAt: new Date().toISOString()
      }).eq('id', activeTicket.id);
      
      const dist = distMap.get(activeTicket.distributorId);
      logActivity(user, profile, "Audit Reset", `Admin reset the audit for ${dist?.name} back to Scheduler`);

      setTickets(prev => prev.filter(t => t.id !== activeTicket.id)); setActiveTicket(null);
      alert("Ticket cleared successfully! It is now back in the Scheduler page.");
    } catch (error) { console.error("Error resetting audit ticket:", error); alert("Failed to reset ticket."); }
  };

  const handleAddFieldAuditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !auditorNameInput || !auditorPhoneInput) return;
    
    const newList = [...(activeTicket.fieldAuditors || []), { name: auditorNameInput, phone: auditorPhoneInput }];
    try {
      await supabase.from('auditTickets').update({ fieldAuditors: newList, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, fieldAuditors: newList });
      setAuditorNameInput('');
      setAuditorPhoneInput('');
    } catch (error) { console.error("Failed to add field auditor:", error); }
  };

  const handleRemoveFieldAuditor = async (index: number) => {
    if (!activeTicket) return;
    const newList = [...(activeTicket.fieldAuditors || [])];
    newList.splice(index, 1);
    try {
      await supabase.from('auditTickets').update({ fieldAuditors: newList, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, fieldAuditors: newList });
    } catch (error) { console.error("Failed to remove field auditor:", error); }
  };

  const toggleWhatsappApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.whatsappMediaApproved;
    try {
      await supabase.from('auditTickets').update({ whatsappMediaApproved: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, whatsappMediaApproved: newStatus });
      
      const dist = distMap.get(activeTicket.distributorId);
      logActivity(user, profile, "WhatsApp Media Confirmed", `Admin marked WhatsApp evidence as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update WhatsApp approval:", error); }
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

      await supabase.from('auditTickets').update({ signoffDocumentUrl: publicUrl, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signoffDocumentUrl: publicUrl });
    } catch (error: any) { alert(`Upload failed: ${error.message}`); } 
    finally { setIsUploadingSignoff(false); if (signoffFileRef.current) signoffFileRef.current.value = ''; }
  };

  const toggleSignoffApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.signoffDocumentApproved;
    try {
      await supabase.from('auditTickets').update({ signoffDocumentApproved: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, signoffDocumentApproved: newStatus });
      
      const dist = distMap.get(activeTicket.distributorId);
      logActivity(user, profile, "Sign-off Document Confirmed", `Admin marked physical sign-off sheet as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update Sign-off approval:", error); }
  };

  const deleteItem = async (item: AuditLineItem) => {
    if (!activeTicket) return;
    try {
      await supabase.from('auditLineItems').delete().eq('id', item.id);
      await supabase.from('auditTickets').update({ verifiedTotal: (activeTicket.verifiedTotal || 0) - item.totalValue, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error) { console.error(error); }
  };

  const handleInlineChange = (id: string, field: 'qtyNonSaleable' | 'qtyBBD' | 'qtyDamaged' | 'mfgDate' | 'expDate', value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        
        if (['qtyNonSaleable', 'qtyBBD', 'qtyDamaged'].includes(field)) {
           updatedItem.quantity = (Number(updatedItem.qtyNonSaleable) || 0) + (Number(updatedItem.qtyBBD) || 0) + (Number(updatedItem.qtyDamaged) || 0);
           updatedItem.totalValue = updatedItem.quantity * updatedItem.unitValue;
        }

        if (field === 'mfgDate' || field === 'expDate') {
           if (updatedItem.mfgDate && updatedItem.expDate) {
             const m = new Date(updatedItem.mfgDate);
             const e = new Date(updatedItem.expDate);
             if (!isNaN(m.getTime()) && !isNaN(e.getTime())) {
               const diffDays = Math.ceil((e.getTime() - m.getTime()) / (1000 * 60 * 60 * 24));
               updatedItem.productLife = `${diffDays} Days`;
             } else { updatedItem.productLife = '-'; }
           } else { updatedItem.productLife = '-'; }
        }
        
        return updatedItem;
      }
      return item;
    }));
  };

  const saveInlineEdit = async (itemToSave: AuditLineItem) => {
    if (!activeTicket) return;
    const newVerifiedTotal = items.reduce((sum, item) => sum + item.totalValue, 0);
    
    if (newVerifiedTotal > activeTicket.maxAllowedValue) { 
      alert(`Changes reverted. This update exceeds the absolute 5% maximum limit (₹${activeTicket.maxAllowedValue.toLocaleString()}).`); 
      fetchItems(activeTicket.id); 
      return; 
    }

    try {
      if (newVerifiedTotal > activeTicket.approvedValue && (activeTicket.verifiedTotal || 0) <= activeTicket.approvedValue) {
        const dist = distMap.get(activeTicket.distributorId);
        logActivity(user, profile, "Buffer Zone Triggered", `Audit for ${dist?.name} exceeded the primary limit of ₹${activeTicket.approvedValue.toLocaleString()} and entered the 5% buffer zone.`);
      }

      await supabase.from('auditLineItems').update({ 
        quantity: itemToSave.quantity, 
        qtyNonSaleable: itemToSave.qtyNonSaleable,
        qtyBBD: itemToSave.qtyBBD,
        qtyDamaged: itemToSave.qtyDamaged,
        totalValue: itemToSave.totalValue,
        mfgDate: itemToSave.mfgDate,
        expDate: itemToSave.expDate,
        productLife: itemToSave.productLife
      }).eq('id', itemToSave.id);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error) { console.error(error); }
  };

  const setDrainageDate = async () => {
    if (!activeTicket || !drainageDateInput) return;
    await supabase.from('auditTickets').update({ drainageDate: drainageDateInput, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    setActiveTicket({ ...activeTicket, drainageDate: drainageDateInput });
    
    const dist = distMap.get(activeTicket.distributorId);
    logActivity(user, profile, "Drainage Scheduled", `Drainage date set to ${drainageDateInput} for ${dist?.name}`);
    
    alert("Drainage date saved successfully!");
  };

  const handleDrainageChange = (id: string, value: string) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        let val: number | string = parseInt(value);
        if (isNaN(val)) val = '';
        else if (val > item.quantity) val = item.quantity; 
        else if (val < 0) val = 0;
        return { ...item, qtyDrained: val as number };
      }
      return item;
    }));
  };

  const saveInlineDrainage = async (itemToSave: AuditLineItem) => {
    if (!activeTicket) return;
    try {
      await supabase.from('auditLineItems').update({ qtyDrained: itemToSave.qtyDrained || 0 }).eq('id', itemToSave.id);
    } catch (error) { console.error(error); }
  };

  const submitByAuditor = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'auditor_submitted', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap.get(activeTicket.distributorId);
    logActivity(user, profile, "Audit Count Completed", `Auditor submitted count for ${dist?.name}`);

    setActiveTicket(null); alert("Audit successfully forwarded to ASE for review!");
  };

  const submitByASE = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'drainage_pending', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap.get(activeTicket.distributorId);
    logActivity(user, profile, "Audit Verified", `ASE verified audit for ${dist?.name} and moved it to Drainage Phase`);

    setActiveTicket(null); alert("Audit verified! It is now pending Drainage scheduling.");
  };

  const submitDrainage = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'submitted', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap.get(activeTicket.distributorId);
    logActivity(user, profile, "Drainage Completed", `Drainage phase completed and audit officially submitted for ${dist?.name}`);

    setActiveTicket(null); alert("Drainage completed! Audit officially submitted for sign-offs.");
  };

  const signOff = async (roleRequired: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    if (profile.role !== roleRequired && !['admin', 'ho'].includes(profile.role)) { alert(`Action Denied: Must be an ${roleRequired.toUpperCase()} to sign.`); return; }
    const signOffData: SignOff = { userId: user.id, name: profile.name, timestamp: new Date().toISOString() };
    const signOffs = { ...(activeTicket.signOffs || {}), [roleRequired]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    await supabase.from('auditTickets').update({ signOffs, status: allSigned ? 'signed' : activeTicket.status, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap.get(activeTicket.distributorId);
    logActivity(user, profile, "Audit Signed Off", `${roleRequired.toUpperCase()} signed off on the audit for ${dist?.name}`);
  };

  if (activeTicket) {
    const dist = distMap.get(activeTicket.distributorId);
    const isAdminOrHO = ['admin', 'ho'].includes(profile?.role || '');
    const isAuditor = profile?.role === 'auditor';
    const isASE = profile?.role === 'ase';
    const isSubmitted = ['submitted', 'signed', 'evidence_uploaded', 'closed'].includes(activeTicket.status);
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    const isActionableDate = activeTicket.scheduledDate ? (activeTicket.scheduledDate <= todayStr || activeTicket.status === 'in_progress') : false;

    const approvedLogs = activeTicket.presenceLogs?.filter((l: any) => l.status === 'approved') || [];
    const hasApprovedCheckIn = approvedLogs.length > 0;

    const canUploadFiles = (isAuditor || isAdminOrHO) && (!isSubmitted && !['auditor_submitted', 'drainage_pending'].includes(activeTicket.status));
    
    const canEditItems = canUploadFiles && isActionableDate && hasApprovedCheckIn && activeTicket.status === 'in_progress'; 
    const canEditDrainage = (isAuditor || isAdminOrHO) && activeTicket.status === 'drainage_pending';

    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;
    const isOverBudget = (activeTicket.verifiedTotal || 0) > activeTicket.approvedValue;
    const isMaxedOut = (activeTicket.verifiedTotal || 0) >= activeTicket.maxAllowedValue;
    
    return (
      <div className="space-y-6 pb-12 w-full min-w-0">

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <button onClick={() => setActiveTicket(null)} className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors w-fit">
            <ArrowLeft size={16} /> Back to Schedule
          </button>
          
          <div className="flex items-center gap-3">
            {isAdminOrHO && (
              <button onClick={resetAuditTicket} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all border border-red-100"><RotateCcw size={16} /> Reset to Scheduler</button>
            )}
            <button onClick={() => setIsChatOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-sm font-bold hover:bg-blue-100 transition-all border border-blue-100"><MessageSquare size={16} /> Discussion {activeTicket.comments?.length ? `(${activeTicket.comments.length})` : ''}</button>
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-200 shadow-sm w-full">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 w-full">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0"><Store className="text-black" size={24} /></div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{dist?.name || 'Unknown Distributor'}</h3>
                <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500"><span className="font-mono bg-zinc-100 px-2 py-0.5 rounded text-xs">{dist?.code}</span><MapPin size={14} /> {dist?.city || 'No city'}, {dist?.state}</div>
              </div>
            </div>
            <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
              <div className="text-left md:text-right w-full">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Total Verified Value</p>
                <p className="text-3xl font-black text-emerald-600">₹{(activeTicket.verifiedTotal || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
              </div>
              <div className="w-full max-w-full md:max-w-[200px] h-2 bg-zinc-100 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", percentUsed > 100 ? "bg-red-500" : percentUsed > 90 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(percentUsed, 100)}%` }} />
              </div>
              <p className="text-xs text-zinc-400">of ₹{activeTicket.approvedValue.toLocaleString()} limit</p>
            </div>
          </div>

          {!isActionableDate && canUploadFiles && (
            <div className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-4">
              <Lock className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-amber-900">Execution Locked</h4>
                <p className="text-sm text-amber-700 mt-1">This audit is scheduled for <strong>{activeTicket.scheduledDate}</strong>. You cannot begin before this date.</p>
              </div>
            </div>
          )}

          {/* --- FIELD AUDITORS BLOCK --- */}
          {(activeTicket.fieldAuditors?.length || (!isSubmitted && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrHO))) ? (
            <div className="mb-8 p-6 bg-zinc-50 border border-zinc-200 rounded-[2rem] shadow-sm">
              <h4 className="font-bold text-lg mb-4 flex items-center gap-2"><UserIcon className="text-blue-500" size={20} /> Field Auditor Details</h4>
              
              {!isSubmitted && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrHO) && (
                <form onSubmit={handleAddFieldAuditor} className="flex flex-col sm:flex-row gap-3 mb-4">
                  <input type="text" required placeholder="Auditor Name" value={auditorNameInput} onChange={e=>setAuditorNameInput(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none text-sm font-medium shadow-sm" />
                  <input type="tel" required placeholder="Phone Number" value={auditorPhoneInput} onChange={e=>setAuditorPhoneInput(e.target.value)} className="flex-1 px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none text-sm font-medium shadow-sm" />
                  <button type="submit" className="px-6 py-3 bg-black text-white font-bold rounded-xl hover:bg-zinc-800 transition-colors whitespace-nowrap shadow-md active:scale-95 text-sm">Add Detail</button>
                </form>
              )}

              {activeTicket.fieldAuditors && activeTicket.fieldAuditors.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {activeTicket.fieldAuditors.map((fa, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 bg-white border border-zinc-200 shadow-sm rounded-2xl">
                      <div>
                        <p className="font-bold text-zinc-900 text-sm">{fa.name}</p>
                        <p className="text-xs text-zinc-500 font-medium mt-0.5">{fa.phone}</p>
                      </div>
                      {!isSubmitted && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrHO) && (
                        <button onClick={()=>handleRemoveFieldAuditor(idx)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16}/></button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 italic">No field auditors added yet.</p>
              )}
            </div>
          ) : null}

          {isActionableDate && canUploadFiles && !hasApprovedCheckIn && (
            <div className="mb-8 p-5 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-4">
              <Lock className="text-blue-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-blue-900">Awaiting Selfie Approval</h4>
                <p className="text-sm text-blue-800 mt-1">Your check-in selfie must be <strong>approved by an Admin</strong> before you can begin counting line items.</p>
              </div>
            </div>
          )}

          {isOverBudget && !isMaxedOut && (
            <div className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-4">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-amber-900">Budget Warning</h4>
                <p className="text-sm text-amber-800 mt-1">The verified total has exceeded the approved limit of <strong>₹{activeTicket.approvedValue.toLocaleString()}</strong>. You are currently utilizing the 5% emergency buffer.</p>
              </div>
            </div>
          )}

          {isMaxedOut && (
            <div className="mb-8 p-5 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-4">
              <Lock className="text-red-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-red-900">Maximum Limit Reached</h4>
                <p className="text-sm text-red-800 mt-1">The verified total has reached the hard limit of <strong>₹{activeTicket.maxAllowedValue.toLocaleString()}</strong> (Approved + 5%). You cannot add any more items to this audit.</p>
              </div>
            </div>
          )}

          {activeTicket.status === 'auditor_submitted' && (
            <div className="mb-8 p-5 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-4">
              <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-blue-900">Awaiting ASE Review</h4>
                <p className="text-sm text-blue-800 mt-1">The Auditor has completed their count. This audit is currently locked waiting for the ASE to review and move it to Drainage.</p>
              </div>
            </div>
          )}

          {activeTicket.status === 'drainage_pending' && (
            <div className="mb-8 p-5 bg-teal-50 border border-teal-100 rounded-2xl flex items-start gap-4">
              <CalendarClock className="text-teal-500 shrink-0 mt-0.5" size={24} />
              <div className="w-full">
                <h4 className="font-bold text-teal-900">Drainage Phase Active</h4>
                <p className="text-sm text-teal-800 mt-1 mb-3">
                  Original line item counts are completely frozen. The <strong>Drained Qty</strong> column is now unlocked for the auditor. Please confirm the scheduled drainage date below.
                </p>
                <div className="flex gap-3 max-w-sm">
                  <input type="date" className="flex-1 px-4 py-2 rounded-xl border border-teal-200 outline-none focus:ring-2 focus:ring-teal-500 text-sm font-bold bg-white" value={drainageDateInput || activeTicket.drainageDate || ''} onChange={(e) => setDrainageDateInput(e.target.value)} />
                  <button onClick={setDrainageDate} disabled={!drainageDateInput} className="px-6 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-50">Save Date</button>
                </div>
              </div>
            </div>
          )}

          {!isSubmitted && activeTicket.status !== 'auditor_submitted' && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrHO) && (
            <CheckInBlock activeTicket={activeTicket} setActiveTicket={setActiveTicket} user={user} profile={profile} isAdminOrHO={isAdminOrHO} isActionableDate={isActionableDate} />
          )}

          <div className="space-y-8 w-full min-w-0">
            <div className="w-full min-w-0">
              <div className="flex items-center justify-between gap-4 mb-4 w-full">
                <h4 className="font-bold text-lg flex items-center gap-2"><ClipboardCheck className="text-zinc-400" size={20} /> Audit Line Items</h4>
                
                <button 
                  onClick={() => setIsAddModalOpen(true)} 
                  disabled={!canEditItems || isMaxedOut}
                  className={cn("flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg active:scale-95 whitespace-nowrap", (canEditItems && !isMaxedOut) ? "bg-black text-white hover:bg-zinc-800 shadow-black/10" : "bg-zinc-200 text-zinc-400 cursor-not-allowed")}
                >
                  <Plus size={18} /> Add Item
                </button>
              </div>
              
              <div className="bg-white border border-zinc-200 rounded-3xl overflow-hidden shadow-sm w-full">
                <div className="w-full overflow-x-auto custom-scrollbar">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead className="bg-zinc-50 border-b border-zinc-200">
                      <tr>
                        <th className="px-4 py-4 text-left font-bold text-zinc-500">Article & Desc</th>
                        <th className="px-3 py-4 text-center font-bold text-zinc-500 bg-zinc-100 border-x border-zinc-200">Sys Qty</th>
                        <th className="px-3 py-4 text-center font-bold text-red-500 bg-red-50 border-r border-red-100">Non-Saleable</th>
                        <th className="px-3 py-4 text-center font-bold text-amber-500 bg-amber-50 border-r border-amber-100">BBD</th>
                        <th className="px-3 py-4 text-center font-bold text-purple-500 bg-purple-50 border-r border-purple-100">Damaged</th>
                        <th className="px-3 py-4 text-center font-black text-zinc-900 bg-zinc-100 border-r border-zinc-200">Total Count</th>
                        
                        <th className="px-3 py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Mfg Date</th>
                        <th className="px-3 py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Exp Date</th>
                        <th className="px-3 py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Life</th>
                        
                        <th className="px-3 py-4 text-center font-bold text-teal-600 bg-teal-50 border-r border-teal-100">Drained Qty</th>

                        <th className="px-4 py-4 text-right font-bold text-zinc-500">Rate</th>
                        <th className="px-4 py-4 text-right font-bold text-zinc-500">Total Value</th>
                        {canEditItems && <th className="px-3 py-4"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {items.map(item => {
                        const dumpMatch = dumpItemMap.get(item.articleNumber);
                        const systemQty = dumpMatch ? dumpMatch.expectedQty : 0;
                        return (
                          <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors group">
                            <td className="px-4 py-4">
                              <p className="font-bold text-zinc-900">{item.articleNumber}</p>
                              <p className="text-[10px] text-zinc-500 truncate max-w-[150px]">{item.description}</p>
                            </td>
                            <td className="px-3 py-4 text-center bg-zinc-50/50 border-x border-zinc-100"><span className="font-mono text-zinc-500">{systemQty}</span></td>
                            
                            <td className="px-3 py-4 text-center bg-red-50/30 border-r border-red-100">
                              {canEditItems ? <input type="number" min="0" value={item.qtyNonSaleable} onChange={(e) => handleInlineChange(item.id, 'qtyNonSaleable', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-12 text-center bg-white border text-xs font-bold rounded px-1 py-1 focus:ring-2 focus:ring-red-500 outline-none text-red-700 border-red-200" /> : <span className="font-bold text-red-700">{item.qtyNonSaleable}</span>}
                            </td>
                            <td className="px-3 py-4 text-center bg-amber-50/30 border-r border-amber-100">
                              {canEditItems ? <input type="number" min="0" value={item.qtyBBD} onChange={(e) => handleInlineChange(item.id, 'qtyBBD', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-12 text-center bg-white border text-xs font-bold rounded px-1 py-1 focus:ring-2 focus:ring-amber-500 outline-none text-amber-700 border-amber-200" /> : <span className="font-bold text-amber-700">{item.qtyBBD}</span>}
                            </td>
                            <td className="px-3 py-4 text-center bg-purple-50/30 border-r border-purple-100">
                              {canEditItems ? <input type="number" min="0" value={item.qtyDamaged} onChange={(e) => handleInlineChange(item.id, 'qtyDamaged', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-12 text-center bg-white border text-xs font-bold rounded px-1 py-1 focus:ring-2 focus:ring-purple-500 outline-none text-purple-700 border-purple-200" /> : <span className="font-bold text-purple-700">{item.qtyDamaged}</span>}
                            </td>
                            <td className="px-3 py-4 text-center bg-zinc-50 border-r border-zinc-100">
                              <span className={cn("font-black", item.quantity !== systemQty && item.reasonCode !== 'Surprise Find' ? "text-red-600" : "text-zinc-900")}>{item.quantity}</span>
                            </td>

                            <td className="px-3 py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              {canEditItems ? <input type="date" value={item.mfgDate || ''} onChange={(e) => handleInlineChange(item.id, 'mfgDate', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-[110px] text-center bg-white border text-[10px] font-bold rounded px-1 py-1 focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 border-blue-200" /> : <span className="font-bold text-blue-700 text-[10px]">{item.mfgDate || '-'}</span>}
                            </td>
                            <td className="px-3 py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              {canEditItems ? <input type="date" value={item.expDate || ''} onChange={(e) => handleInlineChange(item.id, 'expDate', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-[110px] text-center bg-white border text-[10px] font-bold rounded px-1 py-1 focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 border-blue-200" /> : <span className="font-bold text-blue-700 text-[10px]">{item.expDate || '-'}</span>}
                            </td>
                            <td className="px-3 py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              <span className="font-bold text-blue-900 text-xs whitespace-nowrap">{item.productLife || '-'}</span>
                            </td>

                            <td className="px-3 py-4 text-center bg-teal-50/30 border-r border-teal-100">
                              {canEditDrainage ? (
                                <input 
                                  type="number" 
                                  min="0" 
                                  max={item.quantity} 
                                  value={item.qtyDrained ?? ''} 
                                  onChange={(e) => handleDrainageChange(item.id, e.target.value)} 
                                  onBlur={() => saveInlineDrainage(item)} 
                                  className="w-14 text-center bg-white border text-xs font-bold rounded px-1 py-1.5 focus:ring-2 focus:ring-teal-500 outline-none text-teal-800 border-teal-200 shadow-sm" 
                                  placeholder="0"
                                />
                              ) : (
                                <span className="font-bold text-teal-700">{item.qtyDrained || 0}</span>
                              )}
                            </td>

                            <td className="px-4 py-4 text-right text-zinc-500 text-xs">₹{item.unitValue.toFixed(2)}</td>
                            <td className="px-4 py-4 text-right font-black text-zinc-900">₹{item.totalValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>

                            {canEditItems && <td className="px-3 py-4 text-right"><button onClick={() => deleteItem(item)} className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button></td>}
                          </tr>
                        )
                      })}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={canEditItems ? 13 : 12} className="px-6 py-12 text-center text-zinc-400">
                            <PackageSearch size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="font-bold text-zinc-600">No items counted yet.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-100 w-full">
              
              <div className="space-y-4">
                <h4 className="font-bold text-lg">Verification Evidence</h4>
                
                <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner", activeTicket.whatsappMediaApproved ? "bg-emerald-100 text-emerald-600" : "bg-zinc-200 text-zinc-500")}>
                      {activeTicket.whatsappMediaApproved ? <CheckCircle2 size={24} /> : <MessageSquare size={24} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-zinc-900 text-sm">WhatsApp Evidence</h5>
                      <p className="text-xs text-zinc-500">Stock images & large videos</p>
                    </div>
                  </div>
                  
                  {isAdminOrHO ? (
                    <button
                      onClick={toggleWhatsappApproval}
                      className={cn("px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.whatsappMediaApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-black text-white hover:bg-zinc-800 shadow-md")}
                    >
                      {activeTicket.whatsappMediaApproved ? 'Approved' : 'Mark as Received'}
                    </button>
                  ) : (
                    <span className={cn("px-3 py-1.5 text-xs font-bold rounded-xl", activeTicket.whatsappMediaApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-zinc-100 text-zinc-500")}>
                      {activeTicket.whatsappMediaApproved ? 'Approved by Admin' : 'Pending Admin Approval'}
                    </span>
                  )}
                </div>

                <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner", activeTicket.signoffDocumentApproved ? "bg-emerald-100 text-emerald-600" : activeTicket.signoffDocumentUrl ? "bg-amber-100 text-amber-600" : "bg-zinc-200 text-zinc-500")}>
                      {activeTicket.signoffDocumentApproved ? <CheckCircle2 size={24} /> : <FileText size={24} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-zinc-900 text-sm">Physical Sign-off</h5>
                      {activeTicket.signoffDocumentUrl ? (
                        <a href={activeTicket.signoffDocumentUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline font-bold flex items-center gap-1 mt-0.5">View Document</a>
                      ) : (
                        <p className="text-xs text-zinc-500">Scanned sheet</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {!activeTicket.signoffDocumentUrl && (isAuditor || isASE || isAdminOrHO) && activeTicket.status !== 'signed' && (
                      <>
                        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" ref={signoffFileRef} onChange={handleSignoffUpload} />
                        <button onClick={() => signoffFileRef.current?.click()} disabled={isUploadingSignoff} className="px-4 py-2 bg-white border border-zinc-200 text-zinc-700 text-xs font-bold rounded-xl hover:bg-zinc-50 transition-all shadow-sm">
                          {isUploadingSignoff ? <Loader2 className="animate-spin inline" size={14} /> : 'Upload'}
                        </button>
                      </>
                    )}
                    
                    {activeTicket.signoffDocumentUrl && isAdminOrHO ? (
                      <div className="flex items-center gap-2">
                        {!activeTicket.signoffDocumentApproved && (
                           <button onClick={() => signoffFileRef.current?.click()} className="p-2 text-zinc-400 hover:text-zinc-900 bg-white border border-zinc-200 rounded-xl transition-all" title="Re-upload Document"><Upload size={14}/></button>
                        )}
                        <input type="file" accept="image/*,application/pdf" className="hidden" ref={signoffFileRef} onChange={handleSignoffUpload} />
                        
                        <button
                          onClick={toggleSignoffApproval}
                          className={cn("px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.signoffDocumentApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-black text-white hover:bg-zinc-800 shadow-md")}
                        >
                          {activeTicket.signoffDocumentApproved ? 'Approved' : 'Approve'}
                        </button>
                      </div>
                    ) : activeTicket.signoffDocumentUrl && !isAdminOrHO ? (
                      <span className={cn("px-3 py-1.5 text-xs font-bold rounded-xl", activeTicket.signoffDocumentApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-amber-50 border border-amber-200 text-amber-700")}>
                        {activeTicket.signoffDocumentApproved ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-lg">Digital Sign-offs</h4>
                {(isSubmitted || isAuditor) && (
                  <div className="space-y-3">
                    {['auditor', 'ase', 'distributor'].map((role) => {
                      const signedData = activeTicket.signOffs?.[role as keyof SignOff];
                      const isMyRole = profile?.role === role || ['admin', 'ho'].includes(profile?.role || '');
                      return (
                        <div key={role} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <div><span className="text-sm font-bold uppercase tracking-wider text-zinc-600">{role}</span></div>
                          {signedData ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl"><CheckCircle2 size={14} /> Signed</span>
                           : <button onClick={() => signOff(role as any)} disabled={!isMyRole || !isSubmitted} className={cn("px-4 py-2 text-xs font-bold rounded-xl", (isMyRole && isSubmitted) ? "bg-black text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-400")}>{isMyRole ? 'Sign Off' : 'Awaiting'}</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {(isAuditor || isAdminOrHO) && activeTicket.status === 'in_progress' && items.length > 0 && (
              <div className="pt-8 flex justify-end border-t border-zinc-100 w-full">
                <button onClick={submitByAuditor} className="flex items-center gap-2 px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"><Send size={18} /> Submit Audit to ASE</button>
              </div>
            )}

            {(isASE || isAdminOrHO) && activeTicket.status === 'auditor_submitted' && (
              <div className="pt-8 flex justify-end border-t border-zinc-100 w-full">
                <button onClick={submitByASE} className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 active:scale-95"><CheckCircle2 size={18} /> Verify & Move to Drainage</button>
              </div>
            )}

            {(isAuditor || isAdminOrHO) && activeTicket.status === 'drainage_pending' && (
              <div className="pt-8 flex justify-end border-t border-zinc-100 w-full">
                <button 
                  onClick={submitDrainage} 
                  disabled={!activeTicket.drainageDate}
                  title={!activeTicket.drainageDate ? "Please set a Drainage Date first" : ""}
                  className="flex items-center gap-2 px-8 py-4 bg-teal-600 text-white rounded-2xl font-bold hover:bg-teal-700 transition-all shadow-xl shadow-teal-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 size={18} /> Complete Drainage & Finalize
                </button>
              </div>
            )}

          </div>
        </div>

        <AddItemModal 
          isOpen={isAddModalOpen} 
          onClose={() => setIsAddModalOpen(false)} 
          activeTicket={activeTicket} 
          distributor={dist} 
          availableDumpItems={availableDumpItems} 
          existingItemCodes={items.map(i => i.articleNumber)} 
          user={user}
          profile={profile}
        />
        <AnimatePresence>
          {isChatOpen && <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} activeTicket={activeTicket} user={user} profile={profile} />}
        </AnimatePresence>
      </div>
    );
  }

  const activeStatuses = ['scheduled', 'in_progress', 'auditor_submitted', 'drainage_pending', 'submitted', 'signed'];
  const relevantTickets = tickets.filter(t => activeStatuses.includes(t.status));

  return (
    <div className="space-y-8 pb-12 w-full min-w-0">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {relevantTickets.map(ticket => {
          const dist = distMap.get(ticket.distributorId);
          return (
            <motion.div layout key={ticket.id} onClick={() => setActiveTicket(ticket)} className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm hover:shadow-md hover:border-black transition-all cursor-pointer group flex flex-col w-full">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center"><Store className="text-zinc-600" size={20} /></div>
                <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-zinc-100 text-zinc-600")}>{ticket.status.replace('_', ' ')}</span>
              </div>
              <h4 className="text-lg font-bold tracking-tight mb-1">{dist?.name || 'Loading...'}</h4>
              <p className="text-sm text-zinc-500 flex items-center gap-2 mb-6"><MapPin size={14} /> {dist?.city}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
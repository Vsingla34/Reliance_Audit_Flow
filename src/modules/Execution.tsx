import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase, logActivity } from '../supabase';
import { Distributor, SignOff, AuditTicket as BaseTicket, AuditLineItem as BaseItem } from '../types';
import { ClipboardCheck, Plus, Store, MapPin, CheckCircle2, ArrowLeft, AlertCircle, MessageSquare, PackageSearch, Lock, Trash2, Send, RotateCcw, CalendarClock, FileText, Upload, Loader2, User as UserIcon, X, Droplets } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

import { CheckInBlock } from '../components/Execution/CheckInBlock';
import { AddItemModal } from '../components/Execution/AddItemModal';
import { ChatModal } from '../components/Execution/ChatModal';

const BUCKET_NAME = 'audit-media'; 

export interface AuditTicket extends BaseTicket { 
  drainageDate?: string; 
  whatsappMediaApproved?: boolean; 
  drainageMediaApproved?: boolean; 
  signoffDocumentUrl?: string;
  signoffDocumentApproved?: boolean;
}

export interface AuditLineItem extends BaseItem { 
  qtyDrained?: number; 
  bbdApprovalStatus?: 'none' | 'pending' | 'approved' | 'rejected';
}

export interface CombinedDumpItem {
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string;
  billingDate?: string; plant?: string; billingDoc?: string; gst?: number; approxShelfLife?: string; standardPack?: string;
}

export function ExecutionModule() {
  const { profile, user } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<any[]>([]); 
  const [activeTicket, setActiveTicket] = useState<AuditTicket | null>(null);
  const [items, setItems] = useState<AuditLineItem[]>([]);
  const [availableDumpItems, setAvailableDumpItems] = useState<CombinedDumpItem[]>([]);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [drainageDateInput, setDrainageDateInput] = useState('');
  
  const [isUploadingSignoff, setIsUploadingSignoff] = useState(false);
  const signoffFileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'active' | 'drainage' | 'signoff' | 'completed'>('active');

  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');
  const isAdminOrSuperadmin = ['superadmin', 'admin'].includes(profile?.role || '');

  const distMap = useMemo(() => {
    const map: Record<string, any> = {};
    distributors.forEach(d => { map[d.id] = d; });
    return map;
  }, [distributors]);

  const dumpItemMap = useMemo(() => {
    const map: Record<string, CombinedDumpItem> = {};
    availableDumpItems.forEach(d => { map[d.itemCode] = d; });
    return map;
  }, [availableDumpItems]);

  const fetchData = async () => {
    if (!profile) return;
    try {
      let tQuery = supabase.from('auditTickets')
        .select('*')
        .in('status', ['scheduled', 'in_progress', 'auditor_submitted', 'submitted', 'drainage_pending', 'signed', 'evidence_uploaded', 'closed']);
      
      if (profile.role === 'auditor') {
        tQuery = tQuery.or(`auditorId.eq.${profile.uid},auditorIds.cs.{${profile.uid}}`);
      }

      const { data: tData, error: tError } = await tQuery;
      if (tError) throw tError;
      const fetchedTickets = (tData || []) as AuditTicket[];

      let dQuery = supabase.from('distributors').select('*');
      
      if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
        if (profile.role === 'ase') dQuery = dQuery.contains('aseIds', [profile.uid]);
        else if (profile.role === 'asm') dQuery = dQuery.contains('asmIds', [profile.uid]);
        else if (profile.role === 'sm') dQuery = dQuery.contains('smIds', [profile.uid]);
        else if (profile.role === 'dm') dQuery = dQuery.contains('dmIds', [profile.uid]);
      } else if (profile.role === 'auditor' && fetchedTickets.length > 0) {
        const distIds = Array.from(new Set(fetchedTickets.map(t => t.distributorId)));
        dQuery = dQuery.in('id', distIds);
      }

      const { data: dData, error: dError } = await dQuery;
      if (dError) throw dError;
      const fetchedDistributors = (dData || []) as any[];

      setDistributors(fetchedDistributors);

      if (['ase', 'asm', 'sm', 'dm'].includes(profile.role)) {
         const distIds = fetchedDistributors.map(d => d.id);
         const validTickets = fetchedTickets.filter(t => distIds.includes(t.distributorId));
         setTickets(validTickets);
      } else {
         const validTickets = fetchedTickets.filter(t => fetchedDistributors.some(d => d.id === t.distributorId));
         setTickets(validTickets);
      }

    } catch (error) {
      console.error("Execution Data Fetch Error:", error);
    }
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

  const forceUpdateStatus = async (newStatus: string) => {
    if (!activeTicket || !user || !profile) return;
    if (!window.confirm(`Are you sure you want to force change the status to: ${newStatus.replace('_', ' ').toUpperCase()}?`)) return;

    try {
      await supabase.from('auditTickets').update({ status: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, status: newStatus as any });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Status Overridden", `Admin manually changed status to ${newStatus.replace('_', ' ')} for ${dist?.name}`);
    } catch (error) {
      console.error("Failed to force update status:", error);
    }
  };

  const resetAuditTicket = async () => {
    if (!activeTicket) return;
    if (!window.confirm("Are you sure you want to completely clear this ticket? It will be removed from Execution and sent back to the Scheduler as a blank request.")) return;

    try {
      await supabase.from('auditLineItems').delete().eq('ticketId', activeTicket.id);
      await supabase.from('auditTickets').update({ 
        status: 'tentative', scheduledDate: null as any, drainageDate: null, whatsappMediaApproved: false, drainageMediaApproved: false, signoffDocumentUrl: null, signoffDocumentApproved: false, auditorId: null as any, auditorIds: [], presenceLogs: [], media: [], signOffs: {}, comments: [], dateProposals: [], verifiedTotal: 0, updatedAt: new Date().toISOString()
      }).eq('id', activeTicket.id);
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Audit Reset", `Admin reset the audit for ${dist?.name} back to Scheduler`);

      setTickets(prev => prev.filter(t => t.id !== activeTicket.id)); setActiveTicket(null);
      alert("Ticket cleared successfully! It is now back in the Scheduler page.");
    } catch (error) { console.error("Error resetting audit ticket:", error); alert("Failed to reset ticket."); }
  };

  const toggleWhatsappApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.whatsappMediaApproved;
    try {
      await supabase.from('auditTickets').update({ whatsappMediaApproved: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, whatsappMediaApproved: newStatus });
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "WhatsApp Media Confirmed", `Admin marked WhatsApp audit evidence as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update WhatsApp approval:", error); }
  };

  const toggleDrainageMediaApproval = async () => {
    if (!activeTicket || !user || !profile) return;
    const newStatus = !activeTicket.drainageMediaApproved;
    try {
      await supabase.from('auditTickets').update({ drainageMediaApproved: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      setActiveTicket({ ...activeTicket, drainageMediaApproved: newStatus });
      
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
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Sign-off Document Confirmed", `Admin marked physical sign-off sheet as ${newStatus ? 'Approved' : 'Pending'} for ${dist?.name}`);
    } catch (error) { console.error("Failed to update Sign-off approval:", error); }
  };

  const deleteItem = async (item: AuditLineItem) => {
    if (!activeTicket) return;
    try {
      await supabase.from('auditLineItems').delete().eq('id', item.id);
    } catch (error) { console.error(error); }
  };

  const handleInlineChange = (id: string, field: 'qtyNonSaleable' | 'qtyBBD' | 'qtyDamaged' | 'mfgDate' | 'expDate', value: any, e?: React.ChangeEvent<HTMLInputElement>) => {
    setItems(prev => {
      const itemIndex = prev.findIndex(i => i.id === id);
      if (itemIndex === -1) return prev;

      const oldItem = prev[itemIndex];
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
              return [...prev];
          }
      }

      const currentExp = field === 'expDate' ? value : updatedItem.expDate;
      
      if (currentExp && activeTicket?.scheduledDate) {
          const expDateObj = new Date(currentExp);
          const auditDateObj = new Date(activeTicket.scheduledDate);
          
          expDateObj.setHours(0,0,0,0);
          auditDateObj.setHours(0,0,0,0);
          
          if (expDateObj > auditDateObj) {
              if (isAdminOrHO) {
                updatedItem.bbdApprovalStatus = 'approved';
              } else if (oldItem.bbdApprovalStatus !== 'pending' && oldItem.bbdApprovalStatus !== 'approved') {
                const confirmMsg = `WARNING: You selected a date (${currentExp}) that is BEYOND the scheduled audit date.\n\nFuture dates cannot be recorded without Admin Approval.\n\nDo you want to request special Admin Approval to allow this exception? Click OK to request, or Cancel to revert.`;
                
                if (!window.confirm(confirmMsg)) {
                   if (e && e.target) e.target.value = oldItem[field] || ''; 
                   return [...prev]; 
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

      const newItems = [...prev];
      newItems[itemIndex] = updatedItem;
      return newItems;
    });
  };

  const saveInlineEdit = async (itemToSave: AuditLineItem) => {
    if (!activeTicket) return;
    
    const latestItemState = items.find(i => i.id === itemToSave.id) || itemToSave;
    
    const originalItem = items.find(i => i.id === itemToSave.id);
    const valueDifference = latestItemState.totalValue - (originalItem ? originalItem.totalValue : 0);
    
    if ((activeTicket.verifiedTotal || 0) + valueDifference > activeTicket.maxAllowedValue) { 
      alert(`Changes reverted. This update exceeds the absolute 5% maximum limit (₹${activeTicket.maxAllowedValue.toLocaleString()}).`); 
      fetchItems(activeTicket.id); 
      return; 
    }

    try {
      if ((activeTicket.verifiedTotal || 0) + valueDifference > activeTicket.approvedValue && (activeTicket.verifiedTotal || 0) <= activeTicket.approvedValue) {
        const dist = distMap[activeTicket.distributorId];
        logActivity(user, profile, "Buffer Zone Triggered", `Audit for ${dist?.name} exceeded the primary limit of ₹${activeTicket.approvedValue.toLocaleString()} and entered the 5% buffer zone.`);
      }

      await supabase.from('auditLineItems').update({ 
        quantity: latestItemState.quantity, 
        qtyNonSaleable: latestItemState.qtyNonSaleable,
        qtyBBD: latestItemState.qtyBBD,
        qtyDamaged: latestItemState.qtyDamaged,
        totalValue: latestItemState.totalValue,
        mfgDate: latestItemState.mfgDate,
        expDate: latestItemState.expDate,
        productLife: latestItemState.productLife,
        bbdApprovalStatus: latestItemState.bbdApprovalStatus || 'none'
      }).eq('id', latestItemState.id);
      
    } catch (error) { console.error(error); }
  };

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

  const setDrainageDate = async () => {
    if (!activeTicket || !drainageDateInput) return;
    await supabase.from('auditTickets').update({ drainageDate: drainageDateInput, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    setActiveTicket({ ...activeTicket, drainageDate: drainageDateInput });
    
    const dist = distMap[activeTicket.distributorId];
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
    
    const hasPendingItems = items.some(i => i.bbdApprovalStatus === 'pending');
    if (hasPendingItems) {
       alert("You have items marked as Expired that have future expiry dates. An Admin must approve these exceptions before you can submit the audit.");
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

    try {
      const rejectionMessage = `🚨 Audit Rejected by ASE: ${reason || 'No reason provided.'}`;
      
      // Inject rejection with multiple keys to ensure the Chat Modal reads it regardless of how it's structured
      const newComment = {
        id: Math.random().toString(36).substring(7),
        userId: user.id,
        userName: profile.name,
        role: profile.role,
        text: rejectionMessage,
        message: rejectionMessage, // Added to fix rendering
        content: rejectionMessage, // Added to fix rendering
        timestamp: new Date().toISOString()
      };

      const updatedComments = [...(activeTicket.comments || []), newComment];

      await supabase.from('auditTickets').update({ 
        status: 'in_progress', 
        comments: updatedComments,
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
      
      const dist = distMap[activeTicket.distributorId];
      logActivity(user, profile, "Audit Rejected", `ASE rejected the audit count for ${dist?.name} and returned it to in_progress.`);

      setActiveTicket(null); 
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
    logActivity(user, profile, "Audit Verified", `ASE verified audit for ${dist?.name} and requested sign-offs`);

    setActiveTicket(null); alert("Audit verified! It is now pending Sign-offs.");
  };

  const signOff = async (roleRequired: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    
    if (profile.role !== roleRequired && !['superadmin', 'admin', 'ho'].includes(profile.role)) { 
      alert(`Action Denied: Must be an ${roleRequired.toUpperCase()} to sign.`); 
      return; 
    }
    
    const signOffData: SignOff = { userId: user.id, name: profile.name, timestamp: new Date().toISOString() };
    const signOffs = { ...(activeTicket.signOffs || {}), [roleRequired]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    
    const newStatus = allSigned ? 'drainage_pending' : activeTicket.status;

    await supabase.from('auditTickets').update({ signOffs, status: newStatus, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Signed Off", `${roleRequired.toUpperCase()} signed off on the audit for ${dist?.name}`);

    if (allSigned) {
      alert("All sign-offs completed! Audit has officially moved to the Drainage phase.");
      setActiveTicket(null);
    }
  };

  const submitDrainage = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'closed', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    
    const dist = distMap[activeTicket.distributorId];
    logActivity(user, profile, "Audit Closed", `Drainage phase completed and audit officially closed for ${dist?.name}`);

    setActiveTicket(null); alert("Drainage completed! The audit is now fully Closed.");
  };

  if (activeTicket) {
    const dist = distMap[activeTicket.distributorId];
    
    const isAuditor = profile?.role === 'auditor';
    const isASE = profile?.role === 'ase';
    
    const isSubmittedPhase = ['submitted', 'drainage_pending', 'signed', 'evidence_uploaded', 'closed'].includes(activeTicket.status);
    const isClosedPhase = activeTicket.status === 'closed';
    const isDrainagePhase = ['drainage_pending', 'closed'].includes(activeTicket.status);
    
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const localToday = new Date(today.getTime() - (offset*60*1000));
    const todayStr = localToday.toISOString().split('T')[0];
    
    const isActionableDate = activeTicket.scheduledDate ? (activeTicket.scheduledDate <= todayStr || activeTicket.status === 'in_progress') : false;

    const approvedLogs = activeTicket.presenceLogs?.filter((l: any) => l.status === 'approved') || [];
    const hasApprovedCheckIn = approvedLogs.length > 0;

    const canUploadFiles = (isAuditor || isAdminOrHO) && (!isSubmittedPhase && !['auditor_submitted'].includes(activeTicket.status));
    
    const canEditItems = (isAuditor || isAdminOrSuperadmin) && canUploadFiles && isActionableDate && hasApprovedCheckIn && activeTicket.status === 'in_progress'; 
    const canEditDrainage = (isAuditor || isAdminOrSuperadmin) && activeTicket.status === 'drainage_pending';

    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;
    const isOverBudget = (activeTicket.verifiedTotal || 0) > activeTicket.approvedValue;
    const isMaxedOut = (activeTicket.verifiedTotal || 0) >= activeTicket.maxAllowedValue;
    
    const auditDateString = activeTicket.scheduledDate?.split('T')[0] || '';
    
    return (
      <div className="space-y-4 sm:space-y-6 pb-12 w-full min-w-0">

        {/* --- DYNAMIC HEADER WITH ADMIN FORCE STATUS DROPDOWN --- */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <button onClick={() => setActiveTicket(null)} className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors w-fit">
            <ArrowLeft size={16} /> Back to List
          </button>
          
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {isAdminOrHO && (
              <div className="flex items-center gap-2 bg-white border border-zinc-200 px-3 py-2 rounded-xl shadow-sm w-full sm:w-auto">
                <span className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider hidden md:inline">Force Status:</span>
                <select
                  className="text-xs sm:text-sm font-bold bg-transparent outline-none cursor-pointer text-black w-full"
                  value={activeTicket.status}
                  onChange={(e) => forceUpdateStatus(e.target.value)}
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
              {profile?.role === 'superadmin' && (
                <button onClick={resetAuditTicket} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-red-100 transition-all border border-red-100"><RotateCcw size={16} /> <span className="hidden sm:inline">Reset</span></button>
              )}
              <button onClick={() => setIsChatOpen(true)} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 sm:px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-100 transition-all border border-blue-100"><MessageSquare size={16} /> Discussion {activeTicket.comments?.length ? `(${activeTicket.comments.length})` : ''}</button>
            </div>
          </div>
        </div>

        {/* --- MAIN DISTRIBUTOR & BUDGET CARD --- */}
        <div className="bg-white rounded-[1.5rem] sm:rounded-[2.5rem] p-5 sm:p-8 border border-zinc-200 shadow-sm w-full">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6 sm:mb-8 w-full">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-zinc-100 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0"><Store className="text-black" size={24} /></div>
              <div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{dist?.name || 'Unknown Distributor'}</h3>
                <div className="flex items-center gap-2 mt-1 text-xs sm:text-sm text-zinc-500 flex-wrap"><span className="font-mono bg-zinc-100 px-2 py-0.5 rounded">{dist?.code}</span><MapPin size={14} /> {dist?.city || 'No city'}, {dist?.state}</div>
              </div>
            </div>
            
            <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto bg-zinc-50 md:bg-transparent p-4 md:p-0 rounded-2xl md:rounded-none border md:border-none border-zinc-100">
              <div className="text-left md:text-right w-full">
                <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Total Verified Value</p>
                <p className="text-2xl sm:text-3xl font-black text-emerald-600">₹{(activeTicket.verifiedTotal || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
              </div>
              <div className="w-full max-w-full md:max-w-[200px] h-2 bg-zinc-200 md:bg-zinc-100 rounded-full overflow-hidden mt-1">
                <div className={cn("h-full rounded-full transition-all", percentUsed > 100 ? "bg-red-500" : percentUsed > 90 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(percentUsed, 100)}%` }} />
              </div>
              <p className="text-[10px] sm:text-xs text-zinc-500">of ₹{activeTicket.approvedValue.toLocaleString()} limit</p>
            </div>
          </div>

          {!isActionableDate && canUploadFiles && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-amber-50 border border-amber-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <Lock className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm sm:text-base">Execution Locked</h4>
                <p className="text-xs sm:text-sm text-amber-700 mt-1">This audit is scheduled for <strong>{activeTicket.scheduledDate}</strong>. You cannot begin before this date.</p>
              </div>
            </div>
          )}

          {isActionableDate && canUploadFiles && !hasApprovedCheckIn && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-blue-50 border border-blue-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <Lock className="text-blue-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-blue-900 text-sm sm:text-base">Awaiting Selfie Approval</h4>
                <p className="text-xs sm:text-sm text-blue-800 mt-1">Your check-in selfie must be <strong>approved by an Admin</strong> before you can begin counting line items.</p>
              </div>
            </div>
          )}

          {isOverBudget && !isMaxedOut && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-amber-50 border border-amber-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm sm:text-base">Budget Warning</h4>
                <p className="text-xs sm:text-sm text-amber-800 mt-1">The verified total has exceeded the approved limit of <strong>₹{activeTicket.approvedValue.toLocaleString()}</strong>. You are currently utilizing the 5% emergency buffer.</p>
              </div>
            </div>
          )}

          {isMaxedOut && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-red-50 border border-red-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <Lock className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-red-900 text-sm sm:text-base">Maximum Limit Reached</h4>
                <p className="text-xs sm:text-sm text-red-800 mt-1">The verified total has reached the hard limit of <strong>₹{activeTicket.maxAllowedValue.toLocaleString()}</strong> (Approved + 5%). You cannot add any more items to this audit.</p>
              </div>
            </div>
          )}

          {activeTicket.status === 'auditor_submitted' && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-blue-50 border border-blue-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-blue-900 text-sm sm:text-base">Awaiting ASE Review</h4>
                <p className="text-xs sm:text-sm text-blue-800 mt-1">The Auditor has completed their count. This audit is currently locked waiting for the ASE to review the counts.</p>
              </div>
            </div>
          )}
          
          {activeTicket.status === 'submitted' && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-amber-50 border border-amber-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <FileText className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm sm:text-base">Pending Sign-offs</h4>
                <p className="text-xs sm:text-sm text-amber-800 mt-1">The audit is verified. All parties must provide their digital sign-off below before the Drainage Phase can begin.</p>
              </div>
            </div>
          )}

          {activeTicket.status === 'drainage_pending' && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-teal-50 border border-teal-100 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
              <CalendarClock className="text-teal-500 shrink-0 mt-0.5" size={20} />
              <div className="w-full">
                <h4 className="font-bold text-teal-900 text-sm sm:text-base">Drainage Phase Active</h4>
                <p className="text-xs sm:text-sm text-teal-800 mt-1 mb-3 sm:mb-4">
                  Original counts are frozen. The <strong>Drained Qty</strong> column is unlocked. Confirm the scheduled drainage date below to finalize.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 max-w-sm">
                  <input type="date" className="w-full sm:flex-1 px-4 py-3 sm:py-2 rounded-xl border border-teal-200 outline-none focus:ring-2 focus:ring-teal-500 text-sm font-bold bg-white" value={drainageDateInput || activeTicket.drainageDate || ''} onChange={(e) => setDrainageDateInput(e.target.value)} />
                  <button onClick={setDrainageDate} disabled={!drainageDateInput} className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-50">Save Date</button>
                </div>
              </div>
            </div>
          )}

          {!isSubmittedPhase && activeTicket.status !== 'auditor_submitted' && activeTicket.status !== 'drainage_pending' && (isAuditor || isAdminOrHO) && (
            <CheckInBlock activeTicket={activeTicket} setActiveTicket={setActiveTicket} user={user} profile={profile} isAdminOrHO={isAdminOrHO} isActionableDate={isActionableDate} />
          )}

          <div className="space-y-6 sm:space-y-8 w-full min-w-0">
            <div className="w-full min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 w-full">
                <h4 className="font-bold text-base sm:text-lg flex items-center gap-2"><ClipboardCheck className="text-zinc-400" size={20} /> Audit Line Items</h4>
                
                <button 
                  onClick={() => setIsAddModalOpen(true)} 
                  disabled={!canEditItems || isMaxedOut}
                  className={cn("w-full sm:w-auto flex justify-center items-center gap-2 px-6 py-3 sm:py-2.5 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 whitespace-nowrap", (canEditItems && !isMaxedOut) ? "bg-black text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-400 cursor-not-allowed")}
                >
                  <Plus size={18} /> Add Item
                </button>
              </div>
              
              {/* --- RESPONSIVE TABLE WRAPPER --- */}
              <div className="bg-white border border-zinc-200 rounded-2xl sm:rounded-3xl overflow-hidden shadow-sm w-full">
                <div className="w-full overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs sm:text-sm min-w-[1100px]">
                    <thead className="bg-zinc-50 border-b border-zinc-200">
                      <tr>
                        <th className="px-4 py-3 sm:py-4 text-left font-bold text-zinc-500 sticky left-0 bg-zinc-50 z-10 border-r sm:border-r-0 border-zinc-200">Article & Desc</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-zinc-500 bg-zinc-100 border-x border-zinc-200">Sys Qty</th>
                        
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-purple-500 bg-purple-50 border-r border-purple-100">Primary Damage</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-red-500 bg-red-50 border-r border-red-100">Non-Saleable</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-amber-500 bg-amber-50 border-r border-amber-100">BBD (Expired)</th>
                        
                        <th className="px-3 py-3 sm:py-4 text-center font-black text-zinc-900 bg-zinc-100 border-r border-zinc-200">Total Count</th>
                        
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Mfg Date</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Exp Date</th>
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-blue-600 bg-blue-50 border-r border-blue-100">Life</th>
                        
                        <th className="px-3 py-3 sm:py-4 text-center font-bold text-teal-600 bg-teal-50 border-r border-teal-100">Drained Qty</th>

                        <th className="px-4 py-3 sm:py-4 text-right font-bold text-zinc-500">Rate</th>
                        <th className="px-4 py-3 sm:py-4 text-right font-bold text-zinc-500">Total Value</th>
                        {canEditItems && <th className="px-3 py-3 sm:py-4"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 relative">
                      {items.map(item => {
                        const dumpMatch = dumpItemMap[item.articleNumber];
                        const systemQty = dumpMatch ? dumpMatch.expectedQty : 0;
                        return (
                          <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors group">
                            <td className="px-4 py-3 sm:py-4 sticky left-0 bg-white group-hover:bg-zinc-50/50 z-10 border-r sm:border-r-0 border-zinc-100">
                              <p className="font-bold text-zinc-900">{item.articleNumber}</p>
                              <p className="text-[9px] sm:text-[10px] text-zinc-500 truncate max-w-[120px] sm:max-w-[150px]">{item.description}</p>
                            </td>
                            <td className="px-3 py-3 sm:py-4 text-center bg-zinc-50/50 border-x border-zinc-100"><span className="font-mono text-zinc-500">{systemQty}</span></td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-purple-50/30 border-r border-purple-100">
                              {canEditItems ? <input type="number" min="0" value={item.qtyDamaged} onChange={(e) => handleInlineChange(item.id, 'qtyDamaged', e.target.value, e)} onBlur={() => saveInlineEdit(item)} className="w-12 text-center bg-white border text-xs font-bold rounded px-1 py-2 sm:py-1 focus:ring-2 focus:ring-purple-500 outline-none text-purple-700 border-purple-200" /> : <span className="font-bold text-purple-700">{item.qtyDamaged}</span>}
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-red-50/30 border-r border-red-100">
                              {canEditItems ? <input type="number" min="0" value={item.qtyNonSaleable} onChange={(e) => handleInlineChange(item.id, 'qtyNonSaleable', e.target.value, e)} onBlur={() => saveInlineEdit(item)} className="w-12 text-center bg-white border text-xs font-bold rounded px-1 py-2 sm:py-1 focus:ring-2 focus:ring-red-500 outline-none text-red-700 border-red-200" /> : <span className="font-bold text-red-700">{item.qtyNonSaleable}</span>}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-amber-50/30 border-r border-amber-100 relative align-top">
                              {canEditItems ? (
                                 <input 
                                    type="number" min="0" value={item.qtyBBD} 
                                    onChange={(e) => handleInlineChange(item.id, 'qtyBBD', e.target.value, e)} 
                                    onBlur={() => saveInlineEdit(item)} 
                                    className={cn("w-12 text-center bg-white border text-xs font-bold rounded px-1 py-2 sm:py-1 focus:outline-none transition-colors", item.bbdApprovalStatus === 'pending' ? "border-red-400 ring-2 ring-red-400 text-red-700" : "border-amber-200 focus:ring-2 focus:ring-amber-500 text-amber-700")} 
                                 />
                              ) : (
                                 <span className="font-bold text-amber-700">{item.qtyBBD}</span>
                              )}
                              
                              {item.bbdApprovalStatus === 'pending' && <div className="mt-1.5 flex flex-col items-center justify-center gap-1 text-[9px] leading-tight text-red-600 font-black uppercase tracking-wider"><AlertCircle size={10}/> Pending Admin</div>}
                              {item.bbdApprovalStatus === 'rejected' && <div className="mt-1.5 flex items-center justify-center gap-1 text-[9px] text-red-600 font-black uppercase tracking-wider"><X size={10}/> Rejected</div>}
                              {item.bbdApprovalStatus === 'approved' && <div className="mt-1.5 flex items-center justify-center gap-1 text-[9px] text-emerald-600 font-black uppercase tracking-wider"><CheckCircle2 size={10}/> Approved</div>}
                              
                              {isAdminOrHO && item.bbdApprovalStatus === 'pending' && (
                                 <div className="flex gap-1.5 justify-center mt-2.5">
                                    <button onClick={() => approveBBDItem(item)} className="text-emerald-600 bg-white hover:bg-emerald-50 p-1.5 rounded border border-emerald-200 shadow-sm transition-colors" title="Approve Exception"><CheckCircle2 size={12}/></button>
                                    <button onClick={() => rejectBBDItem(item)} className="text-red-600 bg-white hover:bg-red-50 p-1.5 rounded border border-red-200 shadow-sm transition-colors" title="Reject Exception"><X size={12}/></button>
                                 </div>
                              )}
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-zinc-50 border-r border-zinc-100">
                              <span className={cn("font-black", item.quantity !== systemQty && item.reasonCode !== 'Surprise Find' ? "text-red-600" : "text-zinc-900")}>{item.quantity}</span>
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              {canEditItems ? (
                                <input 
                                  type="date" 
                                  max={!isAdminOrSuperadmin ? auditDateString : undefined} 
                                  value={item.mfgDate || ''} 
                                  onChange={(e) => handleInlineChange(item.id, 'mfgDate', e.target.value, e)} 
                                  onBlur={() => saveInlineEdit(item)} 
                                  className="w-[100px] sm:w-[110px] text-center bg-white border text-[10px] font-bold rounded px-1 py-2 sm:py-1 focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 border-blue-200 cursor-pointer" 
                                />
                              ) : (
                                <span className="font-bold text-blue-700 text-[10px]">{item.mfgDate || '-'}</span>
                              )}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              {canEditItems ? (
                                <input 
                                  type="date" 
                                  max={!isAdminOrSuperadmin ? auditDateString : undefined} 
                                  value={item.expDate || ''} 
                                  onChange={(e) => handleInlineChange(item.id, 'expDate', e.target.value, e)} 
                                  onBlur={() => saveInlineEdit(item)} 
                                  className="w-[100px] sm:w-[110px] text-center bg-white border text-[10px] font-bold rounded px-1 py-2 sm:py-1 focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 border-blue-200 cursor-pointer" 
                                />
                              ) : (
                                <span className="font-bold text-blue-700 text-[10px]">{item.expDate || '-'}</span>
                              )}
                            </td>
                            
                            <td className="px-3 py-3 sm:py-4 text-center bg-blue-50/30 border-r border-blue-100">
                              <span className="font-bold text-blue-900 text-[10px] sm:text-xs whitespace-nowrap">{item.productLife || '-'}</span>
                            </td>

                            <td className="px-3 py-3 sm:py-4 text-center bg-teal-50/30 border-r border-teal-100">
                              {canEditDrainage ? (
                                <input 
                                  type="number" 
                                  min="0" 
                                  max={item.quantity} 
                                  value={item.qtyDrained ?? ''} 
                                  onChange={(e) => handleDrainageChange(item.id, e.target.value)} 
                                  onBlur={() => saveInlineDrainage(item)} 
                                  className="w-14 text-center bg-white border text-xs font-bold rounded px-1 py-2 focus:ring-2 focus:ring-teal-500 outline-none text-teal-800 border-teal-200 shadow-sm" 
                                  placeholder="0"
                                />
                              ) : (
                                <span className="font-bold text-teal-700">{item.qtyDrained || 0}</span>
                              )}
                            </td>

                            <td className="px-4 py-3 sm:py-4 text-right text-zinc-500 text-[10px] sm:text-xs">₹{item.unitValue.toFixed(2)}</td>
                            <td className="px-4 py-3 sm:py-4 text-right font-black text-zinc-900">₹{item.totalValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>

                            {canEditItems && <td className="px-3 py-3 sm:py-4 text-right"><button onClick={() => deleteItem(item)} className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button></td>}
                          </tr>
                        )
                      })}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={canEditItems ? 13 : 12} className="px-4 py-12 text-center text-zinc-400">
                            <PackageSearch size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="font-bold text-sm text-zinc-600">No items counted yet.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* --- EVIDENCE AND SIGN OFFS --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pt-4 border-t border-zinc-100 w-full">
              
              <div className="space-y-3 sm:space-y-4">
                <h4 className="font-bold text-base sm:text-lg">Verification Evidence</h4>
                
                <div className="p-4 sm:p-5 bg-zinc-50 border border-zinc-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner", activeTicket.whatsappMediaApproved ? "bg-emerald-100 text-emerald-600" : "bg-zinc-200 text-zinc-500")}>
                      {activeTicket.whatsappMediaApproved ? <CheckCircle2 size={20} /> : <MessageSquare size={20} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-zinc-900 text-xs sm:text-sm">WhatsApp Evidence</h5>
                      <p className="text-[10px] sm:text-xs text-zinc-500">Stock images & large videos</p>
                    </div>
                  </div>
                  
                  {isAdminOrHO ? (
                    <button
                      onClick={toggleWhatsappApproval}
                      className={cn("w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.whatsappMediaApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-black text-white hover:bg-zinc-800 shadow-md")}
                    >
                      {activeTicket.whatsappMediaApproved ? 'Approved' : 'Mark Received'}
                    </button>
                  ) : (
                    <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.whatsappMediaApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-zinc-100 text-zinc-500")}>
                      {activeTicket.whatsappMediaApproved ? 'Approved by Admin' : 'Pending Admin'}
                    </span>
                  )}
                </div>

                {/* --- DRAINAGE EVIDENCE CARD (ONLY VISIBLE POST-AUDIT) --- */}
                {isDrainagePhase && (
                  <div className="p-4 sm:p-5 bg-zinc-50 border border-zinc-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner", activeTicket.drainageMediaApproved ? "bg-emerald-100 text-emerald-600" : "bg-zinc-200 text-zinc-500")}>
                        {activeTicket.drainageMediaApproved ? <CheckCircle2 size={20} /> : <Droplets size={20} />}
                      </div>
                      <div>
                        <h5 className="font-bold text-zinc-900 text-xs sm:text-sm">Drainage Evidence</h5>
                        <p className="text-[10px] sm:text-xs text-zinc-500">Photos/videos of destruction</p>
                      </div>
                    </div>
                    
                    {isAdminOrHO ? (
                      <button
                        onClick={toggleDrainageMediaApproval}
                        className={cn("w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.drainageMediaApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-black text-white hover:bg-zinc-800 shadow-md")}
                      >
                        {activeTicket.drainageMediaApproved ? 'Approved' : 'Mark Received'}
                      </button>
                    ) : (
                      <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.drainageMediaApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-zinc-100 text-zinc-500")}>
                        {activeTicket.drainageMediaApproved ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    )}
                  </div>
                )}

                <div className="p-4 sm:p-5 bg-zinc-50 border border-zinc-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner", activeTicket.signoffDocumentApproved ? "bg-emerald-100 text-emerald-600" : activeTicket.signoffDocumentUrl ? "bg-amber-100 text-amber-600" : "bg-zinc-200 text-zinc-500")}>
                      {activeTicket.signoffDocumentApproved ? <CheckCircle2 size={20} /> : <FileText size={20} />}
                    </div>
                    <div>
                      <h5 className="font-bold text-zinc-900 text-xs sm:text-sm">Physical Sign-off</h5>
                      {activeTicket.signoffDocumentUrl ? (
                        <a href={activeTicket.signoffDocumentUrl} target="_blank" rel="noreferrer" className="text-[10px] sm:text-xs text-blue-600 hover:underline font-bold flex items-center gap-1 mt-0.5">View Document</a>
                      ) : (
                        <p className="text-[10px] sm:text-xs text-zinc-500">Scanned sheet</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {!activeTicket.signoffDocumentUrl && (isAuditor || isASE || isAdminOrHO) && !isClosedPhase && (
                      <>
                        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" ref={signoffFileRef} onChange={handleSignoffUpload} />
                        <button onClick={() => signoffFileRef.current?.click()} disabled={isUploadingSignoff} className="w-full sm:w-auto px-4 py-2 bg-white border border-zinc-200 text-zinc-700 text-xs font-bold rounded-xl hover:bg-zinc-50 transition-all shadow-sm">
                          {isUploadingSignoff ? <Loader2 className="animate-spin inline" size={14} /> : 'Upload'}
                        </button>
                      </>
                    )}
                    
                    {activeTicket.signoffDocumentUrl && isAdminOrHO ? (
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        {!activeTicket.signoffDocumentApproved && (
                           <button onClick={() => signoffFileRef.current?.click()} className="flex-1 sm:flex-none p-2 text-zinc-400 hover:text-zinc-900 bg-white border border-zinc-200 rounded-xl transition-all flex justify-center" title="Re-upload Document"><Upload size={14}/></button>
                        )}
                        <input type="file" accept="image/*,application/pdf" className="hidden" ref={signoffFileRef} onChange={handleSignoffUpload} />
                        
                        <button
                          onClick={toggleSignoffApproval}
                          className={cn("flex-1 sm:flex-none px-4 py-2 text-xs font-bold rounded-xl transition-all active:scale-95", activeTicket.signoffDocumentApproved ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-black text-white hover:bg-zinc-800 shadow-md")}
                        >
                          {activeTicket.signoffDocumentApproved ? 'Approved' : 'Approve'}
                        </button>
                      </div>
                    ) : activeTicket.signoffDocumentUrl && !isAdminOrHO ? (
                      <span className={cn("w-full sm:w-auto text-center px-3 py-2 sm:py-1.5 text-[10px] sm:text-xs font-bold rounded-xl", activeTicket.signoffDocumentApproved ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-amber-50 border border-amber-200 text-amber-700")}>
                        {activeTicket.signoffDocumentApproved ? 'Approved by Admin' : 'Pending Admin'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <h4 className="font-bold text-base sm:text-lg">Digital Sign-offs</h4>
                {(isSubmittedPhase || isAuditor) && (
                  <div className="space-y-2 sm:space-y-3">
                    {['auditor', 'ase', 'distributor'].map((role) => {
                      const signedData = activeTicket.signOffs?.[role as keyof SignOff];
                      const isMyRole = profile?.role === role || ['superadmin', 'admin', 'ho'].includes(profile?.role || '');
                      return (
                        <div key={role} className="flex items-center justify-between p-3 sm:p-4 bg-zinc-50 rounded-xl sm:rounded-2xl border border-zinc-100">
                          <div><span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-zinc-600">{role}</span></div>
                          {signedData ? <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-emerald-600 bg-emerald-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl"><CheckCircle2 size={12} className="sm:w-[14px] sm:h-[14px]" /> Signed</span>
                           : <button onClick={() => signOff(role as any)} disabled={!isMyRole || activeTicket.status !== 'submitted'} className={cn("px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold rounded-lg sm:rounded-xl", (isMyRole && activeTicket.status === 'submitted') ? "bg-black text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-400")}>{isMyRole ? 'Sign Off' : 'Awaiting'}</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* --- ACTION BUTTONS --- */}
            {(isAuditor || isAdminOrSuperadmin) && activeTicket.status === 'in_progress' && items.length > 0 && (
              <div className="pt-6 sm:pt-8 flex justify-end border-t border-zinc-100 w-full">
                <button onClick={submitByAuditor} className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-black text-white rounded-xl sm:rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 text-sm sm:text-base"><Send size={18} /> Submit Audit to ASE</button>
              </div>
            )}

            {(isASE || isAdminOrHO) && activeTicket.status === 'auditor_submitted' && (
              <div className="pt-6 sm:pt-8 flex flex-col-reverse sm:flex-row justify-end gap-3 border-t border-zinc-100 w-full">
                <button onClick={rejectByASE} className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-white border border-red-200 text-red-600 rounded-xl sm:rounded-2xl font-bold hover:bg-red-50 transition-all shadow-sm active:scale-95 text-sm sm:text-base">
                  <RotateCcw size={18} /> Reject & Return to Auditor
                </button>
                <button onClick={submitByASE} className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-blue-600 text-white rounded-xl sm:rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 active:scale-95 text-sm sm:text-base">
                  <CheckCircle2 size={18} /> Verify & Request Sign-offs
                </button>
              </div>
            )}

            {(isAuditor || isAdminOrSuperadmin) && activeTicket.status === 'drainage_pending' && (
              <div className="pt-6 sm:pt-8 flex justify-end border-t border-zinc-100 w-full">
                <button 
                  onClick={submitDrainage} 
                  disabled={!activeTicket.drainageDate}
                  title={!activeTicket.drainageDate ? "Please set a Drainage Date first" : ""}
                  className="w-full sm:w-auto flex justify-center items-center gap-2 px-6 sm:px-8 py-3.5 sm:py-4 bg-teal-600 text-white rounded-xl sm:rounded-2xl font-bold hover:bg-teal-700 transition-all shadow-xl shadow-teal-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
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
        />
        <AnimatePresence>
          {isChatOpen && <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} activeTicket={activeTicket} user={user} profile={profile} />}
        </AnimatePresence>
      </div>
    );
  }

  const todayDate = new Date();
  const offset = todayDate.getTimezoneOffset();
  const localToday = new Date(todayDate.getTime() - (offset*60*1000));
  const todayStr = localToday.toISOString().split('T')[0];

  const activeTickets = tickets.filter(t => ['scheduled', 'in_progress', 'auditor_submitted'].includes(t.status));
  const signoffTickets = tickets.filter(t => t.status === 'submitted');
  const drainageTickets = tickets.filter(t => t.status === 'drainage_pending');
  const completedTickets = tickets.filter(t => t.status === 'closed' && t.updatedAt?.startsWith(todayStr));

  let displayTickets: AuditTicket[] = [];
  if (activeTab === 'active') displayTickets = activeTickets;
  else if (activeTab === 'signoff') displayTickets = signoffTickets;
  else if (activeTab === 'drainage') displayTickets = drainageTickets;
  else if (activeTab === 'completed') displayTickets = completedTickets;

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 w-full min-w-0">
      
      {/* Scrollable Tabs */}
      <div className="-mx-4 sm:mx-0 px-4 sm:px-0">
        <div className="flex bg-zinc-100 p-1.5 rounded-xl sm:rounded-2xl overflow-x-auto w-full md:w-fit custom-scrollbar scroll-smooth">
          <button onClick={() => setActiveTab('active')} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'active' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black")}>
            Active <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px]", activeTab === 'active' ? "bg-zinc-100 text-zinc-900" : "bg-zinc-200 text-zinc-500")}>{activeTickets.length}</span>
          </button>
          <button onClick={() => setActiveTab('signoff')} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'signoff' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black")}>
            Sign-off <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px]", activeTab === 'signoff' ? "bg-zinc-100 text-zinc-900" : "bg-zinc-200 text-zinc-500")}>{signoffTickets.length}</span>
          </button>
          <button onClick={() => setActiveTab('drainage')} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'drainage' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black")}>
            Drainage <span className="hidden sm:inline">Pending</span> <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px]", activeTab === 'drainage' ? "bg-zinc-100 text-zinc-900" : "bg-zinc-200 text-zinc-500")}>{drainageTickets.length}</span>
          </button>
          <button onClick={() => setActiveTab('completed')} className={cn("px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'completed' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black")}>
            Completed <span className={cn("px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px]", activeTab === 'completed' ? "bg-zinc-100 text-zinc-900" : "bg-zinc-200 text-zinc-500")}>{completedTickets.length}</span>
          </button>
        </div>
      </div>

      {displayTickets.length === 0 ? (
        <div className="p-8 sm:p-16 text-center bg-white rounded-[1.5rem] sm:rounded-[2.5rem] border border-zinc-200 shadow-sm flex flex-col items-center justify-center mx-4 sm:mx-0">
          <ClipboardCheck size={40} className="text-zinc-300 mb-3 sm:mb-4 sm:w-12 sm:h-12" />
          <h3 className="text-base sm:text-lg font-bold text-zinc-900">No Audits Found</h3>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">There are currently no audits in this category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full px-4 sm:px-0">
          {displayTickets.map(ticket => {
            const dist = distMap[ticket.distributorId];
            return (
              <motion.div layout key={ticket.id} onClick={() => setActiveTicket(ticket)} className="bg-white p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border border-zinc-200 shadow-sm hover:shadow-md hover:border-black transition-all cursor-pointer group flex flex-col w-full">
                <div className="flex justify-between items-start mb-3 sm:mb-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-100 rounded-xl sm:rounded-2xl flex items-center justify-center"><Store className="text-zinc-600" size={18} /></div>
                  <span className={cn("px-2.5 py-1 rounded-md text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-zinc-100 text-zinc-600")}>{ticket.status.replace('_', ' ')}</span>
                </div>
                <h4 className="text-base sm:text-lg font-bold tracking-tight mb-1 line-clamp-1">{dist?.name || 'Loading...'}</h4>
                <p className="text-xs sm:text-sm text-zinc-500 flex items-center gap-1.5 mb-4 sm:mb-6"><MapPin size={12} className="shrink-0" /> <span className="truncate">{dist?.city}</span></p>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
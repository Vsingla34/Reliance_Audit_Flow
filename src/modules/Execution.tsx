import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor, AuditLineItem, SignOff, MediaUpload } from '../types';
import { ClipboardCheck, Plus, Store, MapPin, CheckCircle2, ArrowLeft, AlertCircle, MessageSquare, PackageSearch, Lock, Camera, Video, Trash2, ChevronRight, Send, Loader2 } from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

import { CheckInBlock } from '../components/Execution/CheckInBlock';
import { AddItemModal } from '../components/Execution/AddItemModal';
import { ChatModal } from '../components/Execution/ChatModal';

// 👉 CHANGE THIS TO YOUR EXACT SUPABASE BUCKET NAME! 
const BUCKET_NAME = 'audit-attachments'; 

interface CombinedDumpItem {
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string;
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
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  
  const evidenceImageRef = useRef<HTMLInputElement>(null);
  const evidenceVideoRef = useRef<HTMLInputElement>(null);

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

      let tQuery = supabase.from('auditTickets').select('*').in('status', ['scheduled', 'in_progress', 'submitted', 'evidence_uploaded', 'signed']);
      if (profile.role === 'auditor') tQuery = tQuery.eq('auditorId', profile.uid);
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
        const itemCodes = dump.map(d => d.itemCode);
        const { data: master } = await supabase.from('itemMaster').select('*').in('itemCode', itemCodes);
        const combined = dump.map(d => {
          const m = master?.find(x => x.itemCode === d.itemCode);
          return { id: d.id, itemCode: d.itemCode, itemName: m?.itemName || 'Unknown Item', expectedQty: d.quantity, rate: d.rate, category: m?.category || 'Uncategorized' };
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
  }, [activeTicket, distributors]);

  useEffect(() => {
    if (activeTicket) {
      const updated = tickets.find(t => t.id === activeTicket.id);
      if (updated) setActiveTicket(updated);
    }
  }, [tickets]);

  const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
    const file = e.target.files?.[0];
    if (!file || !activeTicket || !user) return;
    setIsUploadingEvidence(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${activeTicket.id}-evidence-${Date.now()}.${fileExt}`;
      const filePath = `evidence/${fileName}`;
      
      // Using the central variable here
      const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(filePath, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

      const media: MediaUpload = { id: Math.random().toString(36).substring(7), type, url: publicUrl, uploadedBy: user.id, timestamp: new Date().toISOString() };
      const mediaList = [...(activeTicket.media || []), media];
      await supabase.from('auditTickets').update({ media: mediaList, status: 'evidence_uploaded', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error: any) { alert(error.message); } 
    finally { setIsUploadingEvidence(false); if (evidenceImageRef.current) evidenceImageRef.current.value = ''; if (evidenceVideoRef.current) evidenceVideoRef.current.value = ''; }
  };

  const deleteItem = async (item: AuditLineItem) => {
    if (!activeTicket) return;
    try {
      await supabase.from('auditLineItems').delete().eq('id', item.id);
      await supabase.from('auditTickets').update({ verifiedTotal: (activeTicket.verifiedTotal || 0) - item.totalValue, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error) { console.error(error); }
  };

  const handleInlineChange = (id: string, field: 'quantity' | 'reasonCode', value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'quantity') {
          updatedItem.totalValue = (parseInt(value) || 0) * updatedItem.unitValue;
          if (updatedItem.reasonCode === 'Verified / OK') updatedItem.reasonCode = 'Missing / Shortage'; 
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const saveInlineEdit = async (itemToSave: AuditLineItem) => {
    if (!activeTicket) return;
    const newVerifiedTotal = items.reduce((sum, item) => sum + item.totalValue, 0);
    if (newVerifiedTotal > activeTicket.maxAllowedValue) { alert(`Changes reverted. Exceeds max limit.`); fetchItems(activeTicket.id); return; }
    try {
      await supabase.from('auditLineItems').update({ quantity: itemToSave.quantity, reasonCode: itemToSave.reasonCode, totalValue: itemToSave.totalValue }).eq('id', itemToSave.id);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    } catch (error) { console.error(error); }
  };

  const submitForReview = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ status: 'submitted', updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
    setActiveTicket(null); alert("Audit submitted successfully!");
  };

  const signOff = async (roleRequired: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    if (profile.role !== roleRequired && !['admin', 'ho'].includes(profile.role)) { alert(`Action Denied: Must be an ${roleRequired.toUpperCase()} to sign.`); return; }
    const signOffData: SignOff = { userId: user.id, name: profile.name, timestamp: new Date().toISOString() };
    const signOffs = { ...(activeTicket.signOffs || {}), [roleRequired]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    await supabase.from('auditTickets').update({ signOffs, status: allSigned ? 'signed' : activeTicket.status, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
  };

  if (activeTicket) {
    const dist = distributors.find(d => d.id === activeTicket.distributorId);
    const isAdminOrHO = ['admin', 'ho'].includes(profile?.role || '');
    const isAuditor = profile?.role === 'auditor';
    const isSubmitted = ['submitted', 'signed', 'evidence_uploaded', 'closed'].includes(activeTicket.status);
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const isActionableDate = activeTicket.scheduledDate ? (activeTicket.scheduledDate <= todayStr || activeTicket.status === 'in_progress') : false;

    const validLogs = activeTicket.presenceLogs?.filter((l: any) => l.status !== 'rejected') || [];
    const hasAnyValidCheckIn = validLogs.length > 0;

    const canUploadFiles = (isAuditor || isAdminOrHO) && !isSubmitted;
    const canEditItems = canUploadFiles && isActionableDate && hasAnyValidCheckIn; 
    
    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;
    
    return (
      <div className="space-y-6 pb-12">
        <div className="flex items-center justify-between">
          <button onClick={() => setActiveTicket(null)} className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors">
            <ArrowLeft size={16} /> Back to Schedule
          </button>
          <button onClick={() => setIsChatOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-sm font-bold hover:bg-blue-100 transition-all border border-blue-100">
            <MessageSquare size={16} /> Discussion {activeTicket.comments?.length ? `(${activeTicket.comments.length})` : ''}
          </button>
        </div>

        {/* HEADER BLOCK */}
        <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0"><Store className="text-black" size={24} /></div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{dist?.name || 'Unknown Distributor'}</h3>
                <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                  <span className="font-mono bg-zinc-100 px-2 py-0.5 rounded text-xs">{dist?.code}</span>
                  <MapPin size={14} /> {dist?.city || 'No city'}, {dist?.state}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Total Verified Value</p>
                <p className="text-3xl font-black text-emerald-600">₹{(activeTicket.verifiedTotal || 0).toLocaleString()}</p>
              </div>
              <div className="w-full max-w-[200px] h-2 bg-zinc-100 rounded-full overflow-hidden">
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

          {/* CHECK-IN COMPONENT (NOW MULTI-DAY) */}
          {!isSubmitted && (isAuditor || isAdminOrHO) && (
            <CheckInBlock 
              activeTicket={activeTicket} 
              setActiveTicket={setActiveTicket} 
              user={user} 
              profile={profile} 
              isAdminOrHO={isAdminOrHO} 
              isActionableDate={isActionableDate} 
            />
          )}

          {/* LINE ITEMS */}
          <div className="space-y-8">
            <div>
              <div className="flex items-center justify-between gap-4 mb-4">
                <h4 className="font-bold text-lg flex items-center gap-2"><ClipboardCheck className="text-zinc-400" size={20} /> Audit Line Items</h4>
                {canEditItems && (
                  <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 px-6 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-black/10 active:scale-95">
                    <Plus size={18} /> Add Item
                  </button>
                )}
              </div>
              
              <div className="bg-white border border-zinc-200 rounded-3xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b border-zinc-200">
                    <tr>
                      <th className="px-6 py-4 text-left font-bold text-zinc-500">Article & Desc</th>
                      <th className="px-6 py-4 text-center font-bold text-zinc-500">System Qty</th>
                      <th className="px-6 py-4 text-center font-bold text-zinc-500">Physical Qty</th>
                      <th className="px-6 py-4 text-right font-bold text-zinc-500">Rate</th>
                      <th className="px-6 py-4 text-right font-bold text-zinc-500">Total</th>
                      <th className="px-6 py-4 text-center font-bold text-zinc-500">Status</th>
                      {canEditItems && <th className="px-6 py-4"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {items.map(item => {
                      const dumpMatch = availableDumpItems.find(d => d.itemCode === item.articleNumber);
                      const systemQty = dumpMatch ? dumpMatch.expectedQty : 0;
                      return (
                        <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors group">
                          <td className="px-6 py-4">
                            <p className="font-bold text-zinc-900">{item.articleNumber}</p>
                            <p className="text-xs text-zinc-500 truncate max-w-[150px]">{item.description}</p>
                          </td>
                          <td className="px-6 py-4 text-center"><span className="font-mono text-zinc-500 bg-zinc-100 px-2 py-1 rounded">{systemQty}</span></td>
                          <td className="px-6 py-4 text-center">
                            {canEditItems ? (
                              <input type="number" min="0" value={item.quantity} onChange={(e) => handleInlineChange(item.id, 'quantity', e.target.value)} onBlur={() => saveInlineEdit(item)} className="w-16 text-center bg-white border text-sm font-bold rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-black outline-none shadow-sm border-zinc-200" />
                            ) : <span className="font-bold text-zinc-900">{item.quantity}</span>}
                          </td>
                          <td className="px-6 py-4 text-right text-zinc-500">₹{item.unitValue}</td>
                          <td className="px-6 py-4 text-right font-black text-zinc-900">₹{item.totalValue.toLocaleString()}</td>
                          <td className="px-6 py-4 text-center">
                            {canEditItems ? (
                              <select value={item.reasonCode} onChange={(e) => handleInlineChange(item.id, 'reasonCode', e.target.value)} onBlur={() => saveInlineEdit(item)} className="border text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1.5 outline-none shadow-sm cursor-pointer">
                                {['Verified / OK', 'Missing / Shortage', 'Damage - Transit', 'Surprise Find'].map(code => <option key={code}>{code}</option>)}
                              </select>
                            ) : <span className="px-2 py-1 rounded text-[10px] font-bold uppercase">{item.reasonCode}</span>}
                          </td>
                          {canEditItems && <td className="px-6 py-4 text-right"><button onClick={() => deleteItem(item)} className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button></td>}
                        </tr>
                      )
                    })}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={canEditItems ? 7 : 6} className="px-6 py-12 text-center text-zinc-400">
                          <PackageSearch size={32} className="mx-auto mb-3 opacity-30" />
                          <p className="font-bold text-zinc-600">No items counted yet.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* EVIDENCE & SIGN-OFFS COMPONENT */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-100">
              <div className="space-y-4">
                <h4 className="font-bold text-lg flex items-center justify-between">Media Evidence {isUploadingEvidence && <Loader2 className="animate-spin text-zinc-400" size={16} />}</h4>
                {canUploadFiles && (
                  <div className="flex gap-4">
                    <input type="file" accept="image/*" capture="environment" className="hidden" ref={evidenceImageRef} onChange={(e) => handleEvidenceUpload(e, 'image')} />
                    <button onClick={() => evidenceImageRef.current?.click()} disabled={isUploadingEvidence} className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl hover:border-black transition-all"><Camera className="text-zinc-400 mb-2" size={24} /><span className="text-sm font-bold text-zinc-600">Upload Photos</span></button>
                    
                    <input type="file" accept="video/*" capture="environment" className="hidden" ref={evidenceVideoRef} onChange={(e) => handleEvidenceUpload(e, 'video')} />
                    <button onClick={() => evidenceVideoRef.current?.click()} disabled={isUploadingEvidence} className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl hover:border-black transition-all"><Video className="text-zinc-400 mb-2" size={24} /><span className="text-sm font-bold text-zinc-600">Upload Video</span></button>
                  </div>
                )}
                {/* LARGER EVIDENCE PREVIEW GRID */}
                {activeTicket.media && activeTicket.media.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                    {activeTicket.media.map(m => (
                       <a href={m.url} target="_blank" rel="noreferrer" key={m.id} className="w-full aspect-square rounded-xl border border-zinc-200 overflow-hidden hover:opacity-80 transition-opacity">
                         <img src={m.url} alt="Evidence" className="w-full h-full object-cover" />
                       </a>
                    ))}
                  </div>
                ) : <p className="text-sm text-zinc-500 italic">No media uploaded.</p>}
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-lg">Sign-offs</h4>
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
              <div className="pt-8 flex justify-end border-t border-zinc-100">
                <button onClick={submitForReview} className="flex items-center gap-2 px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"><Send size={18} /> Submit Audit</button>
              </div>
            )}
          </div>
        </div>

        {/* --- MODALS --- */}
        <AddItemModal 
          isOpen={isAddModalOpen} 
          onClose={() => setIsAddModalOpen(false)} 
          activeTicket={activeTicket} 
          distributor={dist} 
          availableDumpItems={availableDumpItems} 
          existingItemCodes={items.map(i => i.articleNumber)} 
        />
        
        <AnimatePresence>
          {isChatOpen && <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} activeTicket={activeTicket} user={user} profile={profile} />}
        </AnimatePresence>

      </div>
    );
  }

  const activeStatuses = ['scheduled', 'in_progress', 'submitted', 'signed'];
  const relevantTickets = tickets.filter(t => activeStatuses.includes(t.status));

  return (
    <div className="space-y-8 pb-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {relevantTickets.map(ticket => {
          const dist = distributors.find(d => d.id === ticket.distributorId);
          return (
            <motion.div layout key={ticket.id} onClick={() => setActiveTicket(ticket)} className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm hover:shadow-md hover:border-black transition-all cursor-pointer group flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center">
                  <Store className="text-zinc-600" size={20} />
                </div>
                <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-zinc-100 text-zinc-600")}>
                  {ticket.status.replace('_', ' ')}
                </span>
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
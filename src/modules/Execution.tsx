import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor, AuditLineItem, PresenceLog, SignOff, MediaUpload } from '../types';
import { 
  ClipboardCheck, 
  Plus, 
  Store, 
  MapPin, 
  Clock, 
  CheckCircle2, 
  X, 
  Send, 
  Lock, 
  Camera, 
  Video, 
  Trash2, 
  ChevronRight, 
  ShieldCheck,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function ExecutionModule() {
  const { profile, user } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  
  // Execution State
  const [activeTicket, setActiveTicket] = useState<AuditTicket | null>(null);
  const [items, setItems] = useState<AuditLineItem[]>([]);
  
  // Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [newItem, setNewItem] = useState<Partial<AuditLineItem>>({
    articleNumber: '',
    description: '',
    category: '',
    quantity: 0,
    unitValue: 0,
    reasonCode: 'Expiry Non-salable'
  });

  const fetchData = async () => {
    try {
      // Fetch relevant tickets (assigned to current user if auditor, or all if admin)
      let tQuery = supabase.from('auditTickets').select('*');
      if (profile?.role === 'auditor') {
        tQuery = tQuery.eq('auditorId', profile.uid);
      }
      
      const [tRes, dRes] = await Promise.all([
        tQuery,
        supabase.from('distributors').select('*')
      ]);

      if (tRes.data) setTickets(tRes.data as AuditTicket[]);
      if (dRes.data) setDistributors(dRes.data as Distributor[]);
    } catch (error) {
      console.error("Error fetching execution data:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('execution-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditTickets' }, fetchData)
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const fetchItems = async (ticketId: string) => {
    const { data } = await supabase
      .from('auditLineItems')
      .select('*')
      .eq('ticketId', ticketId);
    if (data) setItems(data as AuditLineItem[]);
  };

  // Realtime subscription for items of the active ticket
  useEffect(() => {
    if (activeTicket) {
      fetchItems(activeTicket.id);
      
      const channel = supabase.channel(`items-${activeTicket.id}`)
        .on(
          'postgres_changes', 
          { event: '*', schema: 'public', table: 'auditLineItems', filter: `ticketId=eq.${activeTicket.id}` }, 
          () => fetchItems(activeTicket.id)
        )
        .subscribe();
        
      return () => { supabase.removeChannel(channel); };
    } else {
      setItems([]);
    }
  }, [activeTicket]);

  // Keep the local activeTicket in sync if the master list updates
  useEffect(() => {
    if (activeTicket) {
      const updated = tickets.find(t => t.id === activeTicket.id);
      if (updated) setActiveTicket(updated);
    }
  }, [tickets]);

  const checkIn = async (ticket: AuditTicket) => {
    if (!user || !profile) return;
    
    const log: PresenceLog = { 
      userId: user.id, 
      role: profile.role, 
      timestamp: new Date().toISOString() 
    };

    const performCheckIn = async (finalLog: PresenceLog) => {
      const presenceLogs = [...(ticket.presenceLogs || []), finalLog];
      await supabase
        .from('auditTickets')
        .update({ 
          presenceLogs, 
          status: 'in_progress', 
          updatedAt: new Date().toISOString() 
        })
        .eq('id', ticket.id);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performCheckIn({ 
          ...log, 
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude } 
        }),
        () => performCheckIn(log) // Fallback if location denied
      );
    } else {
      performCheckIn(log);
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket) return;

    const totalValue = (newItem.quantity || 0) * (newItem.unitValue || 0);
    const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + totalValue;

    if (newVerifiedTotal > activeTicket.maxAllowedValue) {
      alert(`Cannot add item. Total audit value (₹${newVerifiedTotal.toLocaleString()}) would exceed the 105% maximum limit (₹${activeTicket.maxAllowedValue.toLocaleString()}).`);
      return;
    }

    try {
      const id = Math.random().toString(36).substring(7);
      
      // 1. Insert the line item
      await supabase.from('auditLineItems').insert([{ 
        ...newItem, 
        id, 
        ticketId: activeTicket.id, 
        totalValue 
      }]);
      
      // 2. Update the ticket's running total
      await supabase.from('auditTickets').update({ 
        verifiedTotal: newVerifiedTotal, 
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
      
      setIsItemModalOpen(false);
      setNewItem({ articleNumber: '', description: '', category: '', quantity: 0, unitValue: 0, reasonCode: 'Expiry Non-salable' });
    } catch (error) {
      console.error("Error adding item:", error);
    }
  };

  const deleteItem = async (item: AuditLineItem) => {
    if (!activeTicket) return;
    try {
      await supabase.from('auditLineItems').delete().eq('id', item.id);
      await supabase.from('auditTickets').update({ 
        verifiedTotal: (activeTicket.verifiedTotal || 0) - item.totalValue, 
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
    } catch (error) {
      console.error("Error deleting item:", error);
    }
  };

  const submitForReview = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ 
      status: 'submitted', 
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
    setActiveTicket(null);
  };

  const signOff = async (role: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    
    const signOffData: SignOff = { 
      userId: user.id, 
      name: profile.name, 
      timestamp: new Date().toISOString() 
    };
    
    const signOffs = { ...(activeTicket.signOffs || {}), [role]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    
    await supabase.from('auditTickets').update({ 
      signOffs, 
      status: allSigned ? 'signed' : activeTicket.status, 
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
  };

  const uploadMedia = async (type: 'image' | 'video') => {
    if (!activeTicket || !user) return;
    
    // In a real app, you would upload the file to Supabase Storage and get the public URL here.
    // For now, we simulate a successful upload.
    const media: MediaUpload = {
      id: Math.random().toString(36).substring(7),
      type,
      url: `https://picsum.photos/seed/${Math.random()}/800/600`, // Placeholder
      uploadedBy: user.id,
      timestamp: new Date().toISOString()
    };
    
    const mediaList = [...(activeTicket.media || []), media];
    await supabase.from('auditTickets').update({ 
      media: mediaList, 
      status: 'evidence_uploaded', // Progressing the status
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
  };

  // --- Render Active Ticket View ---
  if (activeTicket) {
    const dist = distributors.find(d => d.id === activeTicket.distributorId);
    const hasCheckedIn = activeTicket.presenceLogs?.some(log => log.userId === user?.id);
    const canEdit = activeTicket.status === 'in_progress';
    const isSubmitted = activeTicket.status === 'submitted';
    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;

    return (
      <div className="space-y-6 pb-12">
        <button 
          onClick={() => setActiveTicket(null)}
          className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors"
        >
          <ArrowLeft size={16} /> Back to Schedule
        </button>

        <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0">
                <Store className="text-black" size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{dist?.name}</h3>
                <p className="text-zinc-500 flex items-center gap-2 mt-1">
                  <MapPin size={14} /> {dist?.city}, {dist?.state}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Total Verified Value</p>
                <p className="text-3xl font-black text-emerald-600">₹{(activeTicket.verifiedTotal || 0).toLocaleString()}</p>
              </div>
              <div className="w-full max-w-[200px] h-2 bg-zinc-100 rounded-full overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all", percentUsed > 100 ? "bg-red-500" : percentUsed > 90 ? "bg-amber-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(percentUsed, 100)}%` }}
                />
              </div>
              <p className="text-xs text-zinc-400">of ₹{activeTicket.approvedValue.toLocaleString()} approved limit</p>
            </div>
          </div>

          {!hasCheckedIn && activeTicket.status === 'scheduled' ? (
            <div className="bg-zinc-50 rounded-3xl p-8 text-center border border-zinc-100">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-zinc-200">
                <MapPin className="text-black" size={24} />
              </div>
              <h4 className="text-lg font-bold mb-2">Location Check-in Required</h4>
              <p className="text-zinc-500 mb-6 max-w-md mx-auto text-sm">
                You must verify your physical presence at the distributor's location before you can begin adding audit line items.
              </p>
              <button 
                onClick={() => checkIn(activeTicket)}
                className="px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95"
              >
                Check In & Start Audit
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Line Items Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-lg flex items-center gap-2">
                    <ClipboardCheck className="text-zinc-400" size={20} /> Audit Line Items
                  </h4>
                  {canEdit && (
                    <button 
                      onClick={() => setIsItemModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95"
                    >
                      <Plus size={16} /> Add Item
                    </button>
                  )}
                </div>
                
                <div className="bg-white border border-zinc-200 rounded-3xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 border-b border-zinc-200">
                      <tr>
                        <th className="px-6 py-4 text-left font-bold text-zinc-500">Article</th>
                        <th className="px-6 py-4 text-left font-bold text-zinc-500">Reason</th>
                        <th className="px-6 py-4 text-right font-bold text-zinc-500">Qty</th>
                        <th className="px-6 py-4 text-right font-bold text-zinc-500">Rate</th>
                        <th className="px-6 py-4 text-right font-bold text-zinc-500">Total</th>
                        {canEdit && <th className="px-6 py-4"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {items.map(item => (
                        <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-zinc-900">{item.articleNumber}</p>
                            <p className="text-xs text-zinc-500">{item.description}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className="bg-zinc-100 px-2 py-1 rounded text-xs font-medium text-zinc-600">
                              {item.reasonCode}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-medium">{item.quantity}</td>
                          <td className="px-6 py-4 text-right text-zinc-500">₹{item.unitValue}</td>
                          <td className="px-6 py-4 text-right font-bold text-zinc-900">₹{item.totalValue.toLocaleString()}</td>
                          {canEdit && (
                            <td className="px-6 py-4 text-right">
                              <button onClick={() => deleteItem(item)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 italic">No items added yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Evidence & Signoff (Only visible once submitted or during submission) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-100">
                <div className="space-y-4">
                  <h4 className="font-bold text-lg">Media Evidence</h4>
                  <div className="flex gap-4">
                    <button onClick={() => uploadMedia('image')} className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl hover:border-black hover:bg-zinc-100 transition-all cursor-pointer">
                      <Camera className="text-zinc-400 mb-2" size={24} />
                      <span className="text-sm font-bold text-zinc-600">Upload Photos</span>
                    </button>
                    <button onClick={() => uploadMedia('video')} className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl hover:border-black hover:bg-zinc-100 transition-all cursor-pointer">
                      <Video className="text-zinc-400 mb-2" size={24} />
                      <span className="text-sm font-bold text-zinc-600">Upload Video</span>
                    </button>
                  </div>
                  {activeTicket.media && activeTicket.media.length > 0 && (
                    <p className="text-xs font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14}/> {activeTicket.media.length} files uploaded</p>
                  )}
                </div>

                <div className="space-y-4">
                  <h4 className="font-bold text-lg">Sign-offs</h4>
                  <div className="space-y-3">
                    {['auditor', 'ase', 'distributor'].map((role) => {
                      const signed = activeTicket.signOffs?.[role as keyof SignOff];
                      return (
                        <div key={role} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <span className="text-sm font-bold uppercase tracking-wider text-zinc-600">{role}</span>
                          {signed ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} /> Signed</span>
                          ) : (
                            <button onClick={() => signOff(role as any)} className="px-4 py-2 bg-black text-white text-xs font-bold rounded-xl hover:bg-zinc-800 transition-colors">
                              Sign Off
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              {canEdit && (
                <div className="pt-8 flex justify-end">
                  <button 
                    onClick={submitForReview}
                    disabled={items.length === 0}
                    className="flex items-center gap-2 px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={18} /> Submit Audit for Review
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add Item Modal */}
        <AnimatePresence>
          {isItemModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsItemModalOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold">Add Line Item</h3>
                  <button onClick={() => setIsItemModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl"><X size={20}/></button>
                </div>
                <form onSubmit={addItem} className="space-y-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Article Number</label>
                    <input required className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={newItem.articleNumber} onChange={e => setNewItem({...newItem, articleNumber: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Description</label>
                    <input required className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={newItem.description} onChange={e => setNewItem({...newItem, description: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Quantity</label>
                      <input required type="number" min="1" className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={newItem.quantity || ''} onChange={e => setNewItem({...newItem, quantity: parseInt(e.target.value)})} />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Unit Value (₹)</label>
                      <input required type="number" min="0.01" step="0.01" className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={newItem.unitValue || ''} onChange={e => setNewItem({...newItem, unitValue: parseFloat(e.target.value)})} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Reason Code</label>
                    <select className="w-full mt-1 px-4 py-3 bg-zinc-50 border-none rounded-xl focus:ring-2 focus:ring-black transition-all" value={newItem.reasonCode} onChange={e => setNewItem({...newItem, reasonCode: e.target.value})}>
                      <option>Expiry Non-salable</option>
                      <option>Damage - Transit</option>
                      <option>Damage - Warehouse</option>
                    </select>
                  </div>
                  <button type="submit" className="w-full mt-4 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10">Add to Audit</button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // --- Render Master List View ---
  const activeStatuses = ['scheduled', 'in_progress', 'submitted', 'signed'];
  const relevantTickets = tickets.filter(t => activeStatuses.includes(t.status));

  return (
    <div className="space-y-8 pb-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {relevantTickets.map(ticket => {
          const dist = distributors.find(d => d.id === ticket.distributorId);
          return (
            <motion.div 
              layout 
              key={ticket.id}
              onClick={() => setActiveTicket(ticket)}
              className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm hover:shadow-md hover:border-black transition-all cursor-pointer group flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center">
                  <Store className="text-zinc-600" size={20} />
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                  ticket.status === 'scheduled' && "bg-blue-50 text-blue-600",
                  ticket.status === 'in_progress' && "bg-amber-50 text-amber-600",
                  ticket.status === 'submitted' && "bg-purple-50 text-purple-600",
                  ticket.status === 'signed' && "bg-emerald-50 text-emerald-600",
                )}>
                  {ticket.status.replace('_', ' ')}
                </span>
              </div>
              
              <h4 className="text-lg font-bold tracking-tight mb-1">{dist?.name || 'Loading...'}</h4>
              <p className="text-sm text-zinc-500 flex items-center gap-2 mb-6">
                <MapPin size={14} /> {dist?.city || 'Unknown Location'}
              </p>

              <div className="mt-auto pt-4 border-t border-zinc-100 flex items-center justify-between">
                <div className="text-sm">
                  <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Date</p>
                  <p className="font-medium">{ticket.scheduledDate}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-300">
                  <ChevronRight size={16} />
                </div>
              </div>
            </motion.div>
          );
        })}
        {relevantTickets.length === 0 && (
          <div className="col-span-full py-12 text-center text-zinc-500">
            <ClipboardCheck size={48} className="mx-auto mb-4 text-zinc-300" />
            <p className="font-medium text-lg text-zinc-900">No active audits</p>
            <p>You don't have any audits scheduled or in progress right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}
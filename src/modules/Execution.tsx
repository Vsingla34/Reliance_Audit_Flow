import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor, AuditLineItem, PresenceLog, SignOff, MediaUpload, AuditComment } from '../types';
import { 
  ClipboardCheck, 
  Plus, 
  Store, 
  MapPin, 
  Clock, 
  CheckCircle2, 
  X, 
  Send, 
  Camera, 
  Video, 
  Trash2, 
  ChevronRight, 
  ArrowLeft,
  AlertCircle,
  MessageSquare,
  Upload,
  Download,
  Lock
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function ExecutionModule() {
  const { profile, user } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  
  const [activeTicket, setActiveTicket] = useState<AuditTicket | null>(null);
  const [items, setItems] = useState<AuditLineItem[]>([]);
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [newItem, setNewItem] = useState<Partial<AuditLineItem>>({
    articleNumber: '',
    description: '',
    category: '',
    quantity: 0,
    unitValue: 0,
    reasonCode: 'Expiry Non-salable'
  });

  const fetchData = async () => {
    if (!profile) return;

    try {
      let dQuery = supabase.from('distributors').select('*');
      if (profile.role === 'ase') {
        dQuery = dQuery.eq('aseId', profile.uid);
      } else if (profile.role === 'distributor') {
        dQuery = dQuery.eq('email', profile.email);
      }

      const { data: dData, error: dError } = await dQuery;
      if (dError) throw dError;
      const fetchedDistributors = (dData || []) as Distributor[];
      setDistributors(fetchedDistributors);

      let tQuery = supabase.from('auditTickets').select('*');
      
      // NEW PERF OPTIMIZATION: Only fetch actionable/visible tickets, skip 'closed' histories
      tQuery = tQuery.in('status', ['scheduled', 'in_progress', 'submitted', 'evidence_uploaded', 'signed']);
      
      if (profile.role === 'auditor') {
        tQuery = tQuery.eq('auditorId', profile.uid);
      } else if (['ase', 'distributor'].includes(profile.role)) {
        const distIds = fetchedDistributors.map(d => d.id);
        if (distIds.length > 0) {
          tQuery = tQuery.in('distributorId', distIds);
        } else {
          setTickets([]);
          return;
        }
      }

      const { data: tData, error: tError } = await tQuery;
      if (tError) throw tError;
      if (tData) setTickets(tData as AuditTicket[]);

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

  useEffect(() => {
    if (activeTicket) {
      const updated = tickets.find(t => t.id === activeTicket.id);
      if (updated) setActiveTicket(updated);
    }
  }, [tickets]);

  // --- ACTIONS ---

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
        (pos) => performCheckIn({ ...log, location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
        () => performCheckIn(log) 
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
      alert(`Cannot add item. Total audit value (₹${newVerifiedTotal.toLocaleString()}) would exceed the maximum limit (₹${activeTicket.maxAllowedValue.toLocaleString()}).`);
      return;
    }

    try {
      const id = Math.random().toString(36).substring(7);
      await supabase.from('auditLineItems').insert([{ ...newItem, id, ticketId: activeTicket.id, totalValue }]);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      
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

  const handleInlineChange = (id: string, field: 'quantity' | 'reasonCode', value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'quantity') {
          updatedItem.totalValue = (parseInt(value) || 0) * updatedItem.unitValue;
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
      alert(`Changes reverted. This edit would push the audit total to ₹${newVerifiedTotal.toLocaleString()}, which exceeds the max limit of ₹${activeTicket.maxAllowedValue.toLocaleString()}.`);
      fetchItems(activeTicket.id); 
      return;
    }

    try {
      await supabase.from('auditLineItems').update({ 
        quantity: itemToSave.quantity, 
        reasonCode: itemToSave.reasonCode, 
        totalValue: itemToSave.totalValue 
      }).eq('id', itemToSave.id);
      
      await supabase.from('auditTickets').update({ 
        verifiedTotal: newVerifiedTotal, 
        updatedAt: new Date().toISOString() 
      }).eq('id', activeTicket.id);
    } catch (error) {
      console.error("Error saving inline edit:", error);
    }
  };

  const downloadTemplate = () => {
    const csvContent = "ArticleNumber,Description,Category,Quantity,UnitValue,ReasonCode\n1001,Sample Product A,FMCG,10,150.50,Expiry Non-salable\n1002,Sample Product B,Electronics,5,2000.00,Damage - Transit";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "Audit_LineItems_Template.csv";
    link.click();
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTicket) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== ''); 
        
        let newTotalValueToAdd = 0;
        
        const newItems = lines.slice(1).map(line => {
          const [articleNumber, description, category, qtyStr, rateStr, reasonCode] = line.split(',');
          if (!articleNumber || !qtyStr || !rateStr) return null;
          
          const quantity = parseInt(qtyStr.trim());
          const unitValue = parseFloat(rateStr.trim());
          const totalValue = quantity * unitValue;
          
          if (isNaN(quantity) || isNaN(unitValue)) return null;

          newTotalValueToAdd += totalValue;

          return {
            id: Math.random().toString(36).substring(7),
            ticketId: activeTicket.id,
            articleNumber: articleNumber.trim(),
            description: description?.trim() || 'No Description',
            category: category?.trim() || 'Uncategorized',
            quantity,
            unitValue,
            reasonCode: reasonCode?.trim() || 'Expiry Non-salable',
            totalValue
          };
        }).filter(Boolean) as AuditLineItem[];

        if (newItems.length === 0) {
          alert("No valid items found in the CSV. Please ensure you are using the correct template format.");
          return;
        }

        const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + newTotalValueToAdd;
        
        if (newVerifiedTotal > activeTicket.maxAllowedValue) {
          alert(`Cannot upload CSV. Adding these items brings the total to ₹${newVerifiedTotal.toLocaleString()}, which exceeds the max limit of ₹${activeTicket.maxAllowedValue.toLocaleString()}.`);
          return;
        }

        const { error: insertError } = await supabase.from('auditLineItems').insert(newItems);
        if (insertError) throw insertError;

        await supabase.from('auditTickets').update({ 
          verifiedTotal: newVerifiedTotal, 
          updatedAt: new Date().toISOString() 
        }).eq('id', activeTicket.id);
        
        alert(`Successfully imported ${newItems.length} items from CSV!`);
      } catch (error) {
        console.error("Error importing items:", error);
        alert("Failed to parse CSV. Please ensure the file matches the template.");
      }
    };
    
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };


  const submitForReview = async () => {
    if (!activeTicket) return;
    await supabase.from('auditTickets').update({ 
      status: 'submitted', 
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
    setActiveTicket(null);
    alert("Audit submitted successfully! It is now waiting for ASE and Distributor sign-offs.");
  };

  const signOff = async (roleRequired: 'auditor' | 'ase' | 'distributor') => {
    if (!activeTicket || !user || !profile) return;
    
    if (profile.role !== roleRequired && !['admin', 'ho'].includes(profile.role)) {
      alert(`Action Denied: You must be an ${roleRequired.toUpperCase()} to sign this section.`);
      return;
    }
    
    const signOffData: SignOff = { 
      userId: user.id, 
      name: profile.name, 
      timestamp: new Date().toISOString() 
    };
    
    const signOffs = { ...(activeTicket.signOffs || {}), [roleRequired]: signOffData };
    const allSigned = signOffs.auditor && signOffs.ase && signOffs.distributor;
    
    await supabase.from('auditTickets').update({ 
      signOffs, 
      status: allSigned ? 'signed' : activeTicket.status, 
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
  };

  const uploadMedia = async (type: 'image' | 'video') => {
    if (!activeTicket || !user) return;
    const media: MediaUpload = {
      id: Math.random().toString(36).substring(7),
      type,
      url: `https://picsum.photos/seed/${Math.random()}/800/600`, 
      uploadedBy: user.id,
      timestamp: new Date().toISOString()
    };
    
    const mediaList = [...(activeTicket.media || []), media];
    await supabase.from('auditTickets').update({ 
      media: mediaList, 
      status: 'evidence_uploaded',
      updatedAt: new Date().toISOString() 
    }).eq('id', activeTicket.id);
  };

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !user || !profile || !chatMessage.trim()) return;

    try {
      const newComment: AuditComment = {
        id: Math.random().toString(36).substring(7),
        userId: user.id,
        userName: profile.name,
        userRole: profile.role,
        message: chatMessage.trim(),
        timestamp: new Date().toISOString()
      };

      const updatedComments = [...(activeTicket.comments || []), newComment];

      await supabase
        .from('auditTickets')
        .update({ 
          comments: updatedComments,
          updatedAt: new Date().toISOString()
        })
        .eq('id', activeTicket.id);

      setChatMessage('');
    } catch (error) {
      console.error("Error sending comment:", error);
    }
  };

  if (activeTicket) {
    const dist = distributors.find(d => d.id === activeTicket.distributorId);
    
    const isAuditor = profile?.role === 'auditor';
    const isAdminOrHO = ['admin', 'ho'].includes(profile?.role || '');
    const hasCheckedIn = activeTicket.presenceLogs?.some(log => log.role === 'auditor');
    const isSubmitted = ['submitted', 'signed', 'evidence_uploaded', 'closed'].includes(activeTicket.status);
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const isActionableDate = activeTicket.scheduledDate === todayStr;

    const canUploadFiles = (isAuditor || isAdminOrHO) && !isSubmitted;
    const canEditItems = canUploadFiles && isActionableDate; 
    
    const percentUsed = ((activeTicket.verifiedTotal || 0) / activeTicket.approvedValue) * 100;
    const commentCount = activeTicket.comments?.length || 0;

    return (
      <div className="space-y-6 pb-12">
        <div className="flex items-center justify-between">
          <button 
            onClick={() => setActiveTicket(null)}
            className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors"
          >
            <ArrowLeft size={16} /> Back to Schedule
          </button>
          
          <button 
            onClick={() => setIsChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-sm font-bold hover:bg-blue-100 transition-all active:scale-95 border border-blue-100"
          >
            <MessageSquare size={16} /> Discussion {commentCount > 0 && `(${commentCount})`}
          </button>
        </div>

        <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-200 shadow-sm">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0">
                <Store className="text-black" size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{dist?.name || 'Unknown Distributor'}</h3>
                <p className="text-zinc-500 flex items-center gap-2 mt-1">
                  <MapPin size={14} /> {dist?.city || 'No city'}, {dist?.state}
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
              <p className="text-xs text-zinc-400">of ₹{activeTicket.approvedValue.toLocaleString()} limit</p>
            </div>
          </div>

          {!isActionableDate && canUploadFiles && (
            <div className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-4">
              <Lock className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-amber-900">Editing Locked</h4>
                <p className="text-sm text-amber-700 mt-1">
                  This audit is scheduled for <strong>{activeTicket.scheduledDate}</strong>. Inline editing and manual item deletion are locked today, but you can still upload CSV files and media evidence.
                </p>
              </div>
            </div>
          )}

          {isAuditor && !hasCheckedIn && !isSubmitted && (
            <div className="bg-zinc-50 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 border border-zinc-200 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm border border-zinc-200 shrink-0">
                  <MapPin className="text-black" size={20} />
                </div>
                <div>
                  <h4 className="font-bold">Location Check-in Required</h4>
                  <p className="text-sm text-zinc-500">You must verify your physical presence to officially submit the audit.</p>
                </div>
              </div>
              
              {!isActionableDate ? (
                <div className="px-4 py-2 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-sm font-bold flex items-center gap-2">
                  <Lock size={16} /> Check-in Locked
                </div>
              ) : (
                <button 
                  onClick={() => checkIn(activeTicket)}
                  className="px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 whitespace-nowrap"
                >
                  Check In Now
                </button>
              )}
            </div>
          )}

          <div className="space-y-8">
            <div>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <h4 className="font-bold text-lg flex items-center gap-2">
                  <ClipboardCheck className="text-zinc-400" size={20} /> Audit Line Items
                </h4>
                
                {canUploadFiles && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button 
                      onClick={downloadTemplate}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all"
                      title="Download CSV Template"
                    >
                      <Download size={14} /> Template
                    </button>
                    
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-100 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all"
                    >
                      <Upload size={14} /> Upload CSV
                    </button>
                    <input 
                      type="file" 
                      accept=".csv" 
                      ref={fileInputRef} 
                      onChange={handleCsvUpload} 
                      className="hidden" 
                    />

                    {canEditItems && (
                      <button 
                        onClick={() => setIsItemModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95"
                      >
                        <Plus size={16} /> Add Item
                      </button>
                    )}
                  </div>
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
                      {canEditItems && <th className="px-6 py-4"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {items.map(item => (
                      <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <p className="font-bold text-zinc-900">{item.articleNumber}</p>
                          <p className="text-xs text-zinc-500">{item.description}</p>
                        </td>
                        <td className="px-6 py-4">
                          {canEditItems ? (
                            <select 
                              value={item.reasonCode}
                              onChange={(e) => handleInlineChange(item.id, 'reasonCode', e.target.value)}
                              onBlur={() => saveInlineEdit(item)}
                              className="w-full bg-white border border-zinc-200 text-xs font-medium text-zinc-700 rounded-lg px-2 py-1 focus:ring-2 focus:ring-black outline-none transition-all shadow-sm"
                            >
                              <option>Expiry Non-salable</option>
                              <option>Damage - Transit</option>
                              <option>Damage - Warehouse</option>
                            </select>
                          ) : (
                            <span className="bg-zinc-100 px-2 py-1 rounded text-xs font-medium text-zinc-600">
                              {item.reasonCode}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {canEditItems ? (
                            <input 
                              type="number" 
                              min="1"
                              value={item.quantity || ''}
                              onChange={(e) => handleInlineChange(item.id, 'quantity', e.target.value)}
                              onBlur={() => saveInlineEdit(item)}
                              className="w-20 text-right bg-white border border-zinc-200 text-sm font-medium rounded-lg px-2 py-1 focus:ring-2 focus:ring-black outline-none transition-all shadow-sm"
                            />
                          ) : (
                            <span className="font-medium">{item.quantity}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right text-zinc-500">₹{item.unitValue}</td>
                        <td className="px-6 py-4 text-right font-bold text-zinc-900">₹{item.totalValue.toLocaleString()}</td>
                        {canEditItems && (
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => deleteItem(item)} className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={canEditItems ? 6 : 5} className="px-6 py-12 text-center text-zinc-400 italic">
                          {isAuditor ? "No items added yet. Click 'Upload CSV' to begin." : "Auditor has not added any items yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-100">
              <div className="space-y-4">
                <h4 className="font-bold text-lg">Media Evidence</h4>
                {canUploadFiles && (
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
                )}
                {activeTicket.media && activeTicket.media.length > 0 ? (
                  <p className="text-xs font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14}/> {activeTicket.media.length} evidence files uploaded</p>
                ) : (
                  <p className="text-sm text-zinc-500 italic">No media uploaded yet.</p>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-lg">Digital Sign-offs</h4>
                {!isSubmitted && !isAuditor && (
                  <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl border border-amber-100 flex items-start gap-3">
                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">Waiting for the Auditor to complete the field count and submit the audit before you can sign off.</p>
                  </div>
                )}

                {(isSubmitted || isAuditor) && (
                  <div className="space-y-3">
                    {['auditor', 'ase', 'distributor'].map((role) => {
                      const signedData = activeTicket.signOffs?.[role as keyof SignOff];
                      const isMyRole = profile?.role === role || isAdminOrHO;
                      
                      return (
                        <div key={role} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                          <div>
                            <span className="text-sm font-bold uppercase tracking-wider text-zinc-600">{role}</span>
                            {signedData && <p className="text-[10px] text-zinc-400 mt-1">Signed by {signedData.name}</p>}
                          </div>
                          
                          {signedData ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl"><CheckCircle2 size={14} /> Signed</span>
                          ) : (
                            <button 
                              onClick={() => signOff(role as any)} 
                              disabled={!isMyRole || !isSubmitted}
                              className={cn(
                                "px-4 py-2 text-xs font-bold rounded-xl transition-colors",
                                isMyRole && isSubmitted ? "bg-black text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                              )}
                            >
                              {isMyRole ? 'Sign Off' : 'Awaiting'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {isAuditor && activeTicket.status === 'in_progress' && (
              <div className="pt-8 flex justify-end border-t border-zinc-100">
                <button 
                  onClick={submitForReview}
                  disabled={!hasCheckedIn || items.length === 0}
                  className="flex items-center gap-2 px-8 py-4 bg-black text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!hasCheckedIn ? "You must check-in to submit" : ""}
                >
                  <Send size={18} /> Submit Audit for Sign-offs
                </button>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {isChatOpen && (
            <div className="fixed inset-0 z-50 flex justify-end p-6">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChatOpen(false)} className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-full">
                
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <MessageSquare size={20} className="text-blue-500"/> Audit Discussion
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">{dist?.name}</p>
                  </div>
                  <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl"><X size={20}/></button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50 space-y-4 custom-scrollbar">
                  {(!activeTicket.comments || activeTicket.comments.length === 0) ? (
                    <div className="text-center py-12 text-zinc-400">
                      <MessageSquare size={32} className="mx-auto mb-3 opacity-50" />
                      <p className="text-sm font-medium">No comments yet.</p>
                      <p className="text-xs mt-1">Start the discussion regarding this audit here.</p>
                    </div>
                  ) : (
                    activeTicket.comments.map((comment) => {
                      const isMe = comment.userId === user?.id;
                      
                      const getBubbleColor = (role: string) => {
                        if (role === 'admin' || role === 'ho') return 'bg-zinc-800 text-white';
                        if (role === 'auditor') return 'bg-emerald-500 text-white';
                        if (role === 'ase') return 'bg-blue-500 text-white';
                        if (role === 'distributor') return 'bg-amber-500 text-white';
                        return 'bg-zinc-500 text-white'; 
                      };

                      const getBadgeColor = (role: string) => {
                        if (role === 'admin' || role === 'ho') return 'bg-zinc-200 text-zinc-800';
                        if (role === 'auditor') return 'bg-emerald-100 text-emerald-800';
                        if (role === 'ase') return 'bg-blue-100 text-blue-800';
                        if (role === 'distributor') return 'bg-amber-100 text-amber-800';
                        return 'bg-zinc-200 text-zinc-800'; 
                      };

                      return (
                        <div key={comment.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          <div className={cn("flex items-center gap-2 mb-1", isMe ? "flex-row-reverse" : "flex-row")}>
                            <span className="text-[10px] font-bold text-zinc-500">{comment.userName}</span>
                            <span className={cn("text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded", getBadgeColor(comment.userRole))}>
                              {comment.userRole}
                            </span>
                          </div>
                          <div className={cn(
                            "px-4 py-3 rounded-2xl max-w-[85%] text-sm shadow-sm",
                            isMe ? "rounded-tr-sm" : "rounded-tl-sm",
                            getBubbleColor(comment.userRole)
                          )}>
                            {comment.message}
                          </div>
                          <span className="text-[9px] text-zinc-400 mt-1">
                            {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="p-4 border-t border-zinc-100 bg-white shrink-0">
                  <form onSubmit={sendComment} className="relative">
                    <input 
                      type="text"
                      placeholder="Type a message..."
                      className="w-full pl-4 pr-12 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                    />
                    <button 
                      type="submit" 
                      disabled={!chatMessage.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:bg-zinc-400"
                    >
                      <Send size={14} />
                    </button>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

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
            <p className="font-medium text-lg text-zinc-900">No active audits found</p>
            <p className="text-sm mt-1">
              {profile?.role === 'ase' ? "You don't have any active audits scheduled for your distributors." : 
               profile?.role === 'distributor' ? "You don't have any audits scheduled right now." :
               "You don't have any audits scheduled or in progress right now."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
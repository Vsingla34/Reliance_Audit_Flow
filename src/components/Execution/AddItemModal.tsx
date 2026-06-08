import React, { useState, useEffect } from 'react';
import { supabase, logActivity } from '../../supabase';
import { AuditTicket, Distributor } from '../../types';
import { Box, X, Search, ChevronDown, Info, ArrowLeft, Package } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../App';

interface CombinedDumpItem { 
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string; 
  billingDate?: string; plant?: string; billingDoc?: string; gst?: number; approxShelfLife?: string; standardPack?: string;
}

interface ItemMasterEntry {
  id: string;
  itemCode: string;
  itemName: string;
  gst?: number;
  category?: string;
  approxShelfLife?: string;
  standardPack?: string;
}

interface AddItemModalProps {
  isOpen: boolean; onClose: () => void; activeTicket: AuditTicket; distributor: Distributor | undefined; availableDumpItems: CombinedDumpItem[]; existingItemCodes: string[];
  user: any; profile: any;
  addItemApprovalGranted: boolean;
}

export function AddItemModal({ isOpen, onClose, activeTicket, distributor, availableDumpItems, user, profile, addItemApprovalGranted }: AddItemModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedDumpItem, setSelectedDumpItem] = useState<CombinedDumpItem | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  
  const [qtyNonSaleable, setQtyNonSaleable] = useState<number | ''>('');
  const [qtyBBD, setQtyBBD] = useState<number | ''>('');
  const [qtyDamaged, setQtyDamaged] = useState<number | ''>('');
  
  const [mfgDate, setMfgDate] = useState('');
  const [expDate, setExpDate] = useState('');
  const [productLife, setProductLife] = useState('-');
  const [remarks, setRemarks] = useState('');
  const [manualRate, setManualRate] = useState<number | ''>('');

  // --- MANUAL MODE: item master state ---
  const [masterSearch, setMasterSearch] = useState('');
  const [masterList, setMasterList] = useState<ItemMasterEntry[]>([]);
  const [isMasterLoading, setIsMasterLoading] = useState(false);
  const [selectedMasterItem, setSelectedMasterItem] = useState<ItemMasterEntry | null>(null);

  const totalQty = (Number(qtyNonSaleable) || 0) + (Number(qtyBBD) || 0) + (Number(qtyDamaged) || 0);

  // Fetch item master when manual mode is opened
  useEffect(() => {
    if (!isManualMode) return;
    setIsMasterLoading(true);
    supabase
      .from('itemMaster')
      .select('id, itemCode, itemName, gst, category, approxShelfLife, standardPack')
      .order('itemName', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setMasterList(data as ItemMasterEntry[]);
        setIsMasterLoading(false);
      });
  }, [isManualMode]);

  useEffect(() => {
    if (mfgDate && expDate) {
      const m = new Date(mfgDate);
      const e = new Date(expDate);
      if (!isNaN(m.getTime()) && !isNaN(e.getTime())) {
        const diffDays = Math.ceil((e.getTime() - m.getTime()) / (1000 * 60 * 60 * 24));
        setProductLife(`${diffDays} Days`);
      } else { setProductLife('-'); }
    } else { setProductLife('-'); }
  }, [mfgDate, expDate]);

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setSearchQuery(''); setVisibleCount(50); setSelectedDumpItem(null); setIsManualMode(false);
      setQtyNonSaleable(''); setQtyBBD(''); setQtyDamaged('');
      setMfgDate(''); setExpDate(''); setProductLife('-'); setRemarks(''); setManualRate('');
      setMasterSearch(''); setMasterList([]); setSelectedMasterItem(null);
    }, 200);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setVisibleCount(50); };

  // Core save logic
  const saveItemToDatabase = async (articleNumber: string, description: string, unitValue: number, qNonSaleable: number, qBBD: number, qDamaged: number, reason: string, category: string, systemQty = 0) => {
    const finalQty = qNonSaleable + qBBD + qDamaged;
    if (finalQty === 0) return alert("Total quantity cannot be zero.");

    // Rule 1: Exp date cannot be before Mfg date
    if (mfgDate && expDate && expDate < mfgDate) {
      return alert(`Expiry date (${expDate}) cannot be before Manufacturing date (${mfgDate}) for ${description}.`);
    }

    // Rule: Gap between Mfg and Exp must be more than 60 days
    if (mfgDate && expDate) {
      const gapDays = Math.ceil((new Date(expDate).getTime() - new Date(mfgDate).getTime()) / 86400000);
      if (gapDays <= 60) {
        return alert(`Gap between Mfg date and Exp date is only ${gapDays} days. It must be more than 60 days.`);
      }
    }

    // Rule 4: Exp date cannot be after audit date EXCEPT for Primary Damage & Non-Saleable
    // BBD items MUST have exp date on or before audit date
    const auditDate = activeTicket.scheduledDate?.split('T')[0] || '';
    if (auditDate && expDate && expDate > auditDate) {
      if (qBBD > 0) {
        return alert(`Expiry date (${expDate}) is after the audit date (${auditDate}) for ${description}. BBD/Expired items must have expiry on or before the audit date.`);
      }
    }

    const totalValue = finalQty * unitValue;
    const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + totalValue;

    try {

      const inserts = [];
      const itemRemarks = remarks.trim();

      if (qDamaged > 0) {
        inserts.push({
          id: Math.random().toString(36).substring(7), ticketId: activeTicket.id, articleNumber, description, category, 
          quantity: qDamaged, qtyNonSaleable: 0, qtyBBD: 0, qtyDamaged: qDamaged,
          unitValue, totalValue: qDamaged * unitValue, reasonCode: reason, mfgDate, expDate, productLife,
          bbdApprovalStatus: 'none', qtyDrained: 0, remarks: itemRemarks
        });
      }
      if (qNonSaleable > 0) {
        inserts.push({
          id: Math.random().toString(36).substring(7), ticketId: activeTicket.id, articleNumber, description, category, 
          quantity: qNonSaleable, qtyNonSaleable: qNonSaleable, qtyBBD: 0, qtyDamaged: 0,
          unitValue, totalValue: qNonSaleable * unitValue, reasonCode: reason, mfgDate, expDate, productLife,
          bbdApprovalStatus: 'none', qtyDrained: 0, remarks: itemRemarks
        });
      }
      if (qBBD > 0) {
        inserts.push({
          id: Math.random().toString(36).substring(7), ticketId: activeTicket.id, articleNumber, description, category, 
          quantity: qBBD, qtyNonSaleable: 0, qtyBBD: qBBD, qtyDamaged: 0,
          unitValue, totalValue: qBBD * unitValue, reasonCode: reason, mfgDate, expDate, productLife,
          bbdApprovalStatus: 'none', qtyDrained: 0, remarks: itemRemarks
        });
      }

      await supabase.from('auditLineItems').insert(inserts);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      resetAndClose();
    } catch (error) {
      console.error("Error saving item:", error); alert("Failed to save item.");
    }
  };

  const handleDumpItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDumpItem) saveItemToDatabase(
      selectedDumpItem.itemCode, selectedDumpItem.itemName, selectedDumpItem.rate,
      Number(qtyNonSaleable)||0, Number(qtyBBD)||0, Number(qtyDamaged)||0,
      'Verified / OK', selectedDumpItem.category,
      selectedDumpItem.expectedQty || 0   // system qty cap
    );
  };

  // Manual mode submit — now uses selected item master item
  const handleManualItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMasterItem) return;
    saveItemToDatabase(
      selectedMasterItem.itemCode,
      selectedMasterItem.itemName,
      Number(manualRate) || 0,
      Number(qtyNonSaleable)||0,
      Number(qtyBBD)||0,
      Number(qtyDamaged)||0,
      'Surprise Find',
      selectedMasterItem.category || 'Manual Entry'
    );
  };

  if (!isOpen) return null;

  const searchResults = availableDumpItems.filter(i => i.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) || i.itemName.toLowerCase().includes(searchQuery.toLowerCase()));
  const displayedSearchResults = searchResults.slice(0, visibleCount);

  // Item master filtered results
  const masterResults = masterList.filter(i =>
    i.itemCode.toLowerCase().includes(masterSearch.toLowerCase()) ||
    i.itemName.toLowerCase().includes(masterSearch.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(masterSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={resetAndClose}/>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
          <div className="flex items-center gap-3">
            {/* Back arrow when in manual mode after selecting a master item */}
            {isManualMode && selectedMasterItem && (
              <button type="button" onClick={() => setSelectedMasterItem(null)} className="p-1.5 hover:bg-zinc-100 rounded-xl transition-colors text-zinc-500">
                <ArrowLeft size={18} />
              </button>
            )}
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Box size={20} className="text-blue-600"/>
              {!isManualMode ? 'Add Line Item' : selectedMasterItem ? 'Enter Count' : 'Add Unlisted Item'}
            </h3>
          </div>
          <button type="button" onClick={resetAndClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X size={20}/></button>
        </div>

        {/* ── STEP 1A: Sales dump search (original, unchanged) ──────────────── */}
        {!selectedDumpItem && !isManualMode && (
          <div className="flex flex-col flex-1 overflow-hidden bg-zinc-50">
            <div className="p-4 shrink-0 bg-white shadow-sm z-10 border-b border-zinc-100">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                <input type="text" autoFocus placeholder="Search Item Code or Name..." className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-medium transition-all" value={searchQuery} onChange={handleSearchChange} />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              {availableDumpItems.length === 0 ? (
                <div className="text-center py-8 text-zinc-400">
                  <p className="font-bold text-zinc-700">No expected inventory found.</p>
                  <p className="text-xs mt-1">The Sales Dump does not contain any items <br/>for distributor code: <strong className="text-black">{distributor?.code}</strong></p>
                </div>
              ) : displayedSearchResults.length > 0 ? (
                <>
                  {displayedSearchResults.map(item => (
                    <button key={item.id} onClick={() => setSelectedDumpItem(item)} className="w-full text-left p-4 bg-white border border-zinc-200 rounded-2xl hover:border-black hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-zinc-900 group-hover:text-blue-600 transition-colors">{item.itemCode}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">Sys Qty: <span className="text-zinc-900 font-black">{item.expectedQty}</span></span>
                      </div>
                      <p className="text-sm text-zinc-600 truncate mb-2">{item.itemName}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-medium text-zinc-500">
                         {item.category && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{item.category}</span>}
                         {item.plant && <span className="bg-zinc-100 px-1.5 py-0.5 rounded">Plant: {item.plant}</span>}
                         {item.billingDoc && <span className="bg-zinc-100 px-1.5 py-0.5 rounded">Inv: {item.billingDoc}</span>}
                      </div>
                      <div className="flex justify-between items-center mt-3 pt-2 border-t border-zinc-100">
                         <span className="text-[10px] text-zinc-400">Std Pack: {item.standardPack || '-'}</span>
                         <span className="text-xs text-zinc-600 font-bold">Rate: ₹{item.rate.toFixed(2)}</span>
                      </div>
                    </button>
                  ))}
                  {searchResults.length > visibleCount && (
                    <div className="pt-4 pb-2 flex justify-center">
                      <button type="button" onClick={() => setVisibleCount(prev => prev + 50)} className="flex items-center gap-1 px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-xs font-bold rounded-full transition-colors">
                        Load More Items <ChevronDown size={14} />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-zinc-400"><p className="font-medium text-zinc-600">No matching items found in dump.</p></div>
              )}
            </div>

            <div className="p-6 bg-white border-t border-zinc-100 shrink-0 text-center">
              <p className="text-xs text-zinc-500 mb-3">Item not listed in the distributor's expected inventory?</p>
              {addItemApprovalGranted ? (
                <button onClick={() => setIsManualMode(true)} className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-bold rounded-xl transition-colors border border-zinc-200">+ Add Unlisted Item</button>
              ) : (
                <div className="w-full py-3 bg-zinc-50 border border-zinc-200 rounded-xl flex items-center justify-center gap-2 text-zinc-400 text-sm font-bold cursor-not-allowed" title="Admin must approve 'Allow Unlisted Items' in the Verification Evidence section">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Add Unlisted Item (Admin Approval Required)
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 1B (unchanged): Dump item selected → quantity form ─────── */}
        {selectedDumpItem && !isManualMode && (
          <form onSubmit={handleDumpItemSubmit} className="p-6 space-y-6 overflow-y-auto bg-white custom-scrollbar">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold text-zinc-900">Enter Physical Count</h4>
              <button type="button" onClick={() => setSelectedDumpItem(null)} className="text-xs font-bold text-blue-600 hover:underline">Change Item</button>
            </div>
            
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <span className="font-black text-blue-900 block mb-1">{selectedDumpItem.itemCode}</span>
              <p className="text-sm text-blue-800 mb-3 leading-snug">{selectedDumpItem.itemName}</p>
              <div className="flex gap-4 text-xs font-bold text-blue-700/70 uppercase tracking-wider">
                <span>System Qty: <span className="text-blue-900 bg-blue-100 px-2 py-0.5 rounded">{selectedDumpItem.expectedQty}</span></span>
                <span>Rate: <span className="text-blue-900">₹{selectedDumpItem.rate.toFixed(2)}</span></span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Mfg Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date" required
                  className={cn("w-full mt-1 px-3 py-2 text-sm font-bold bg-white border text-zinc-900 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all", !mfgDate ? "border-red-300 bg-red-50/30" : "border-zinc-200")}
                  value={mfgDate} onChange={e => setMfgDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Exp Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date" required
                  className={cn("w-full mt-1 px-3 py-2 text-sm font-bold bg-white border text-zinc-900 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all", !expDate ? "border-red-300 bg-red-50/30" : "border-zinc-200")}
                  value={expDate} onChange={e => setExpDate(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-purple-500">Primary Damage</label>
                <input autoFocus type="number" min="0" className="w-full mt-1 px-2 py-3 text-lg font-black bg-purple-50 border border-purple-200 text-purple-700 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" value={qtyDamaged} onChange={e => setQtyDamaged(parseInt(e.target.value) || '')} placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-red-500">Non-Saleable</label>
                <input type="number" min="0" className="w-full mt-1 px-2 py-3 text-lg font-black bg-red-50 border border-red-200 text-red-700 rounded-xl focus:ring-2 focus:ring-red-500 outline-none" value={qtyNonSaleable} onChange={e => setQtyNonSaleable(parseInt(e.target.value) || '')} placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-amber-500">BBD (Expired)</label>
                <input type="number" min="0" className="w-full mt-1 px-2 py-3 text-lg font-black bg-amber-50 border border-amber-200 text-amber-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none" value={qtyBBD} onChange={e => setQtyBBD(parseInt(e.target.value) || '')} placeholder="0" />
              </div>
            </div>

            <div className="bg-zinc-100 p-4 rounded-xl flex justify-between items-center border border-zinc-200">
              <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Count:</span>
              <div className="text-right">
                <p className="text-2xl font-black text-black leading-none">{totalQty}</p>
                <p className="text-[10px] font-bold text-zinc-400 mt-1 uppercase">Life: {productLife}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Remarks (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Leakage observed, packaging damage..."
                className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none text-sm transition-all"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
              />
            </div>

            <button type="submit" disabled={totalQty === 0 || !mfgDate || !expDate} className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg disabled:opacity-50">{!mfgDate || !expDate ? "Fill Mfg & Exp Dates to Save" : "Save & Split Rows"}</button>
          </form>
        )}

        {/* ── MANUAL MODE ───────────────────────────────────────────────────── */}
        {isManualMode && (
          <div className="flex flex-col flex-1 overflow-hidden">

            {/* ── 2A: Item master search (no master item selected yet) ──────── */}
            {!selectedMasterItem && (
              <div className="flex flex-col flex-1 overflow-hidden bg-zinc-50">
                <div className="p-4 shrink-0 bg-white shadow-sm z-10 border-b border-zinc-100">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 mb-3">
                    <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs font-medium text-amber-800">
                      This item is not in the distributor's sales dump. Select it from the <strong>Item Master</strong> — rate will default to <strong>₹0</strong>.
                    </p>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search item code, name or category..."
                      className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-medium transition-all"
                      value={masterSearch}
                      onChange={e => setMasterSearch(e.target.value)}
                    />
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400 mt-2 ml-1">
                    {isMasterLoading ? 'Loading item master…' : `${masterResults.length} item${masterResults.length !== 1 ? 's' : ''} found`}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                  {isMasterLoading ? (
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 bg-white border border-zinc-100 rounded-2xl animate-pulse" />
                      ))}
                    </div>
                  ) : masterResults.length > 0 ? (
                    masterResults.slice(0, 60).map(item => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedMasterItem(item)}
                        className="w-full text-left p-4 bg-white border border-zinc-200 rounded-2xl hover:border-black hover:shadow-md transition-all group"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-zinc-900 group-hover:text-blue-600 transition-colors">{item.itemCode}</span>
                          {item.category && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">{item.category}</span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-600 truncate">{item.itemName}</p>
                        <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-medium text-zinc-400">
                          {item.standardPack && <span>Pack: {item.standardPack}</span>}
                          {item.approxShelfLife && <span>Shelf: {item.approxShelfLife}</span>}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-10 text-zinc-400 flex flex-col items-center">
                      <Package size={28} className="mb-3 opacity-30" />
                      <p className="font-bold text-zinc-600 text-sm">
                        {masterSearch ? 'No items match your search.' : 'Item master is empty.'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-white border-t border-zinc-100 shrink-0">
                  <button type="button" onClick={() => setIsManualMode(false)} className="text-xs font-bold text-blue-600 hover:underline">← Back to Sales Dump</button>
                </div>
              </div>
            )}

            {/* ── 2B: Master item selected → quantity form ─────────────────── */}
            {selectedMasterItem && (
              <form onSubmit={handleManualItemSubmit} className="p-6 space-y-5 overflow-y-auto bg-white custom-scrollbar flex-1">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-bold text-zinc-900">Enter Physical Count</h4>
                  <button type="button" onClick={() => { setSelectedMasterItem(null); setManualRate(''); }} className="text-xs font-bold text-blue-600 hover:underline">Change Item</button>
                </div>

                {/* Selected master item card */}
                <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                  <span className="font-black text-zinc-900 block mb-1">{selectedMasterItem.itemCode}</span>
                  <p className="text-sm text-zinc-700 mb-3 leading-snug">{selectedMasterItem.itemName}</p>
                  <div className="flex flex-wrap gap-3 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                    {selectedMasterItem.category && <span className="bg-zinc-100 px-2 py-0.5 rounded">{selectedMasterItem.category}</span>}
                    <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Not in sales dump</span>
                  </div>
                </div>

                {/* Rate field — required for master items since no rate in sales dump */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Rate per Unit (₹) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.0000000001"
                      required
                      placeholder="0.00"
                      className={cn(
                        "w-full pl-7 pr-3 py-2 text-sm font-bold bg-white border text-zinc-900 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all",
                        !manualRate ? "border-amber-300 bg-amber-50/30" : "border-zinc-200"
                      )}
                      value={manualRate}
                      onChange={e => setManualRate(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    />
                  </div>
                  {manualRate ? (
                    <p className="text-[10px] text-emerald-600 font-bold mt-1">
                      Total value = ₹{((Number(manualRate)||0) * ((Number(qtyDamaged)||0)+(Number(qtyNonSaleable)||0)+(Number(qtyBBD)||0))).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                    </p>
                  ) : (
                    <p className="text-[10px] text-amber-600 font-bold mt-1">Enter the rate per unit to calculate audited value</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Mfg Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date" required
                      className={cn("w-full mt-1 px-3 py-2 text-sm font-bold bg-white border text-zinc-900 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all", !mfgDate ? "border-red-300 bg-red-50/30" : "border-zinc-200")}
                      value={mfgDate} onChange={e => setMfgDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Exp Date <span className="text-red-500">*</span>
                    </label>
                    {(() => {
                      const auditDate = activeTicket.scheduledDate?.split('T')[0] || '';
                      const isAfterAudit = auditDate && expDate && expDate > auditDate;
                      const isBeforeMfg  = mfgDate && expDate && expDate < mfgDate;
                      const gapDays = mfgDate && expDate ? Math.ceil((new Date(expDate).getTime() - new Date(mfgDate).getTime()) / 86400000) : null;
                      const isTooClose   = gapDays !== null && gapDays <= 60;
                      // Future exp allowed for Primary Damage + Non-Saleable; BBD must be <= audit date
                      const hasBBD       = (Number(qtyBBD)||0) > 0;
                      const hasError = isBeforeMfg || isTooClose || (isAfterAudit && hasBBD);
                      return (
                        <>
                          <input
                            type="date" required
                            min={mfgDate || undefined}
                            className={cn("w-full mt-1 px-3 py-2 text-sm font-bold bg-white border text-zinc-900 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all",
                              !expDate ? "border-red-300 bg-red-50/30" : hasError ? "border-red-400 bg-red-50" : "border-zinc-200")}
                            value={expDate} onChange={e => setExpDate(e.target.value)}
                          />
                          {isBeforeMfg && <p className="text-[10px] text-red-600 font-bold mt-1">⚠ Exp date cannot be before Mfg date</p>}
                          {!isBeforeMfg && isTooClose && <p className="text-[10px] text-red-600 font-bold mt-1">⚠ Gap is only {gapDays} days — must be more than 60 days</p>}
                          {isAfterAudit && !isBeforeMfg && !isTooClose && hasBBD && <p className="text-[10px] text-red-600 font-bold mt-1">⚠ BBD items must have exp date on or before audit date ({auditDate}).</p>}
                          {isAfterAudit && !isBeforeMfg && !isTooClose && !hasBBD && <p className="text-[10px] text-amber-600 font-bold mt-1">✓ Exp after audit date — allowed for Primary Damage &amp; Non-Saleable items.</p>}
                        </>
                      );
                    })()}
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider text-purple-500">Primary Damage</label>
                    <input autoFocus type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-purple-50 border border-purple-200 text-purple-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" value={qtyDamaged} onChange={e => setQtyDamaged(parseInt(e.target.value) || '')} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider text-red-500">Non-Saleable</label>
                    <input type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-red-50 border border-red-200 text-red-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none" value={qtyNonSaleable} onChange={e => setQtyNonSaleable(parseInt(e.target.value) || '')} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider text-amber-500">BBD (Expired)</label>
                    <input type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-amber-50 border border-amber-200 text-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none" value={qtyBBD} onChange={e => setQtyBBD(parseInt(e.target.value) || '')} placeholder="0" />
                  </div>
                </div>

                {/* System qty warning */}
                <div className="bg-zinc-100 p-4 rounded-xl flex justify-between items-center border border-zinc-200">
                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Count:</span>
                  <div className="text-right">
                    <p className="text-2xl font-black text-black leading-none">{totalQty}</p>
                    <p className="text-[10px] font-bold text-zinc-400 mt-1 uppercase">Life: {productLife}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Remarks (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Leakage observed, packaging damage..."
                    className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none text-sm transition-all"
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                  />
                </div>

                <button type="submit" disabled={totalQty === 0 || !mfgDate || !expDate} className="w-full mt-2 py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg disabled:opacity-50">{!mfgDate || !expDate ? "Fill Mfg & Exp Dates to Save" : "Save & Split Rows"}</button>
              </form>
            )}
          </div>
        )}

      </motion.div>
    </div>
  );
}
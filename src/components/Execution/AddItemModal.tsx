import React, { useState } from 'react';
import { supabase } from '../../supabase';
import { AuditTicket, Distributor } from '../../types';
import { Box, X, Search, ChevronDown, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


interface CombinedDumpItem { 
  id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string; 
  billingDate?: string; plant?: string; billingDoc?: string; gst?: number; approxShelfLife?: string; standardPack?: string;
}

interface AddItemModalProps {
  isOpen: boolean; onClose: () => void; activeTicket: AuditTicket; distributor: Distributor | undefined; availableDumpItems: CombinedDumpItem[]; existingItemCodes: string[];
}

export function AddItemModal({ isOpen, onClose, activeTicket, distributor, availableDumpItems, existingItemCodes }: AddItemModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedDumpItem, setSelectedDumpItem] = useState<CombinedDumpItem | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  
  const [qtyNonSaleable, setQtyNonSaleable] = useState<number | ''>(0);
  const [qtyBBD, setQtyBBD] = useState<number | ''>(0);
  const [qtyDamaged, setQtyDamaged] = useState<number | ''>(0);
  
  const [reasonCode, setReasonCode] = useState('Verified / OK');
  const [manualItem, setManualItem] = useState({ articleNumber: '', description: '', unitValue: '' });

  const totalQty = (Number(qtyNonSaleable) || 0) + (Number(qtyBBD) || 0) + (Number(qtyDamaged) || 0);

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setSearchQuery(''); setVisibleCount(50); setSelectedDumpItem(null); setIsManualMode(false);
      setQtyNonSaleable(0); setQtyBBD(0); setQtyDamaged(0);
      setReasonCode('Verified / OK'); setManualItem({ articleNumber: '', description: '', unitValue: '' });
    }, 200);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setVisibleCount(50); };

  const saveItemToDatabase = async (articleNumber: string, description: string, unitValue: number, qNonSaleable: number, qBBD: number, qDamaged: number, reason: string, category: string) => {
    const finalQty = qNonSaleable + qBBD + qDamaged;
    if (finalQty === 0) return alert("Total quantity cannot be zero.");

    const totalValue = finalQty * unitValue;
    const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + totalValue;

    if (newVerifiedTotal > activeTicket.maxAllowedValue) {
      alert(`Error: This item pushes the total to ₹${newVerifiedTotal.toLocaleString()}, exceeding the approved limit.`);
      return;
    }

    try {
      const id = Math.random().toString(36).substring(7);
      await supabase.from('auditLineItems').insert([{ 
        id, ticketId: activeTicket.id, articleNumber, description, category, 
        quantity: finalQty, qtyNonSaleable: qNonSaleable, qtyBBD: qBBD, qtyDamaged: qDamaged,
        unitValue, totalValue, reasonCode: reason 
      }]);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      resetAndClose();
    } catch (error) {
      console.error("Error saving item:", error); alert("Failed to save item.");
    }
  };

  const handleDumpItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDumpItem) saveItemToDatabase(selectedDumpItem.itemCode, selectedDumpItem.itemName, selectedDumpItem.rate, Number(qtyNonSaleable)||0, Number(qtyBBD)||0, Number(qtyDamaged)||0, reasonCode, selectedDumpItem.category);
  };

  const handleManualItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualItem.articleNumber && manualItem.description && manualItem.unitValue) {
      saveItemToDatabase(manualItem.articleNumber, manualItem.description, parseFloat(manualItem.unitValue), Number(qtyNonSaleable)||0, Number(qtyBBD)||0, Number(qtyDamaged)||0, 'Surprise Find', 'Manual Entry');
    }
  };

  if (!isOpen) return null;

  const uncountedDumpItems = availableDumpItems.filter(d => !existingItemCodes.includes(d.itemCode));
  const searchResults = uncountedDumpItems.filter(i => i.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) || i.itemName.toLowerCase().includes(searchQuery.toLowerCase()));
  const displayedSearchResults = searchResults.slice(0, visibleCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={resetAndClose}/>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white z-10">
          <h3 className="text-xl font-bold flex items-center gap-2"><Box size={20} className="text-blue-600"/> Add Line Item</h3>
          <button type="button" onClick={resetAndClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X size={20}/></button>
        </div>

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
                      
                      {/* --- NEW: Display Rich Details in Search --- */}
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
              <button onClick={() => setIsManualMode(true)} className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-bold rounded-xl transition-colors border border-zinc-200">+ Add Manual Item</button>
            </div>
          </div>
        )}

        {selectedDumpItem && !isManualMode && (
          <form onSubmit={handleDumpItemSubmit} className="p-6 space-y-6 overflow-y-auto bg-white custom-scrollbar">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold text-zinc-900">Enter Physical Count</h4>
              <button type="button" onClick={() => setSelectedDumpItem(null)} className="text-xs font-bold text-blue-600 hover:underline">Change Item</button>
            </div>
            
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <span className="font-black text-blue-900 block mb-1">{selectedDumpItem.itemCode}</span>
              <p className="text-sm text-blue-800 mb-3 leading-snug">{selectedDumpItem.itemName}</p>
              
              {/* --- NEW: Extensive Item Details Grid --- */}
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-4 pb-4 border-b border-blue-200/50 text-[10px] font-medium text-blue-800">
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">Category:</span>
                  <span className="font-bold text-blue-900 text-right truncate max-w-[80px]">{selectedDumpItem.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">Plant:</span>
                  <span className="font-bold text-blue-900">{selectedDumpItem.plant || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">Invoice:</span>
                  <span className="font-bold text-blue-900">{selectedDumpItem.billingDoc || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">Std Pack:</span>
                  <span className="font-bold text-blue-900">{selectedDumpItem.standardPack || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">GST:</span>
                  <span className="font-bold text-blue-900">{selectedDumpItem.gst ? `${selectedDumpItem.gst}%` : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70 uppercase tracking-wider">Shelf Life:</span>
                  <span className="font-bold text-blue-900 text-right truncate max-w-[70px]">{selectedDumpItem.approxShelfLife || 'N/A'}</span>
                </div>
              </div>

              <div className="flex gap-4 text-xs font-bold text-blue-700/70 uppercase tracking-wider">
                <span>System Qty: <span className="text-blue-900 bg-blue-100 px-2 py-0.5 rounded">{selectedDumpItem.expectedQty}</span></span>
                <span>Rate: <span className="text-blue-900">₹{selectedDumpItem.rate.toFixed(2)}</span></span>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-red-500">Non-Saleable</label>
                <input autoFocus type="number" min="0" className="w-full mt-1 px-3 py-3 text-lg font-black bg-red-50 border border-red-200 text-red-700 rounded-xl focus:ring-2 focus:ring-red-500 outline-none" value={qtyNonSaleable} onChange={e => setQtyNonSaleable(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-amber-500">BBD Qty</label>
                <input type="number" min="0" className="w-full mt-1 px-3 py-3 text-lg font-black bg-amber-50 border border-amber-200 text-amber-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none" value={qtyBBD} onChange={e => setQtyBBD(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-purple-500">Damaged Qty</label>
                <input type="number" min="0" className="w-full mt-1 px-3 py-3 text-lg font-black bg-purple-50 border border-purple-200 text-purple-700 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none" value={qtyDamaged} onChange={e => setQtyDamaged(parseInt(e.target.value))} />
              </div>
            </div>

            <div className="bg-zinc-100 p-4 rounded-xl flex justify-between items-center border border-zinc-200">
              <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Count:</span>
              <span className="text-2xl font-black text-black">{totalQty}</span>
            </div>

            <button type="submit" disabled={totalQty === 0} className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg disabled:opacity-50">Save Item</button>
          </form>
        )}

        {isManualMode && (
          <form onSubmit={handleManualItemSubmit} className="p-6 space-y-5 overflow-y-auto bg-white custom-scrollbar">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold text-zinc-900">Add Manual Item</h4>
              <button type="button" onClick={() => setIsManualMode(false)} className="text-xs font-bold text-blue-600 hover:underline">Back to Search</button>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs font-medium text-blue-800 mb-2 flex gap-2 items-start">
               <Info size={16} className="shrink-0 mt-0.5" />
               <p>This item was not found in the ERP dump. The <strong>System Quantity will be 0</strong>.</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Article Number / Code *</label>
              <input required autoFocus className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all" value={manualItem.articleNumber} onChange={e => setManualItem({...manualItem, articleNumber: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Description *</label>
              <input required className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all" value={manualItem.description} onChange={e => setManualItem({...manualItem, description: e.target.value})} />
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] font-bold uppercase tracking-wider text-red-500">Non-Saleable</label>
                <input type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-red-50 border border-red-200 text-red-700 rounded-lg focus:ring-2 focus:ring-red-500 outline-none" value={qtyNonSaleable} onChange={e => setQtyNonSaleable(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase tracking-wider text-amber-500">BBD Qty</label>
                <input type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-amber-50 border border-amber-200 text-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none" value={qtyBBD} onChange={e => setQtyBBD(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase tracking-wider text-purple-500">Damaged Qty</label>
                <input type="number" min="0" className="w-full mt-1 px-2 py-2 text-sm font-black bg-purple-50 border border-purple-200 text-purple-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" value={qtyDamaged} onChange={e => setQtyDamaged(parseInt(e.target.value))} />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="space-y-2 flex-1">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Rate (₹) *</label>
                <input required type="number" min="0" step="0.01" className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-black transition-all" value={manualItem.unitValue} onChange={e => setManualItem({...manualItem, unitValue: e.target.value})} />
              </div>
              <div className="bg-zinc-100 p-3 rounded-xl flex flex-col justify-center items-center shrink-0 min-w-[100px] border border-zinc-200">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Qty</span>
                <span className="text-xl font-black text-black">{totalQty}</span>
              </div>
            </div>

            <button type="submit" disabled={totalQty === 0} className="w-full mt-2 py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg disabled:opacity-50">Save Manual Item</button>
          </form>
        )}
      </motion.div>
    </div>
  );6
}
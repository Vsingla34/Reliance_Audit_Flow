import React, { useState } from 'react';
import { supabase } from '../../supabase';
import { AuditTicket, Distributor } from '../../types';
import { Box, X, Search, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CombinedDumpItem { id: string; itemCode: string; itemName: string; expectedQty: number; rate: number; category: string; }

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTicket: AuditTicket;
  distributor: Distributor | undefined;
  availableDumpItems: CombinedDumpItem[];
  existingItemCodes: string[];
}

export function AddItemModal({ isOpen, onClose, activeTicket, distributor, availableDumpItems, existingItemCodes }: AddItemModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedDumpItem, setSelectedDumpItem] = useState<CombinedDumpItem | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const [physicalQty, setPhysicalQty] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('Verified / OK');
  const [manualItem, setManualItem] = useState({ articleNumber: '', description: '', unitValue: '' });

  const reasonCodes = ['Verified / OK', 'Missing / Shortage', 'Expiry Non-salable', 'Damage - Transit', 'Damage - Warehouse'];

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setSearchQuery(''); setVisibleCount(50); setSelectedDumpItem(null); setIsManualMode(false);
      setPhysicalQty(''); setReasonCode('Verified / OK'); setManualItem({ articleNumber: '', description: '', unitValue: '' });
    }, 200);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setVisibleCount(50); };

  const saveItemToDatabase = async (articleNumber: string, description: string, unitValue: number, qty: number, reason: string, category: string) => {
    const totalValue = qty * unitValue;
    const newVerifiedTotal = (activeTicket.verifiedTotal || 0) + totalValue;

    if (newVerifiedTotal > activeTicket.maxAllowedValue) {
      alert(`Error: This item pushes the total to ₹${newVerifiedTotal.toLocaleString()}, exceeding the approved limit.`);
      return;
    }

    try {
      const id = Math.random().toString(36).substring(7);
      await supabase.from('auditLineItems').insert([{ id, ticketId: activeTicket.id, articleNumber, description, category, quantity: qty, unitValue, totalValue, reasonCode: reason }]);
      await supabase.from('auditTickets').update({ verifiedTotal: newVerifiedTotal, updatedAt: new Date().toISOString() }).eq('id', activeTicket.id);
      resetAndClose();
    } catch (error) {
      console.error("Error saving item:", error);
      alert("Failed to save item.");
    }
  };

  const handleDumpItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDumpItem && physicalQty !== '') saveItemToDatabase(selectedDumpItem.itemCode, selectedDumpItem.itemName, selectedDumpItem.rate, physicalQty as number, reasonCode, selectedDumpItem.category);
  };

  const handleManualItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (physicalQty !== '' && manualItem.articleNumber && manualItem.description && manualItem.unitValue) {
      saveItemToDatabase(manualItem.articleNumber, manualItem.description, parseFloat(manualItem.unitValue), physicalQty as number, 'Surprise Find', 'Manual Entry');
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
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
          <h3 className="text-xl font-bold flex items-center gap-2"><Box size={20} className="text-blue-600"/> Add Line Item</h3>
          <button onClick={resetAndClose} className="p-2 hover:bg-zinc-100 rounded-xl"><X size={20}/></button>
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
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">System Qty: {item.expectedQty}</span>
                      </div>
                      <p className="text-sm text-zinc-600 truncate mb-1">{item.itemName}</p>
                      <p className="text-xs text-zinc-400 font-medium">Rate: ₹{item.rate}</p>
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
          <form onSubmit={handleDumpItemSubmit} className="p-6 space-y-6 overflow-y-auto bg-white">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold text-zinc-900">Enter Physical Count</h4>
              <button type="button" onClick={() => setSelectedDumpItem(null)} className="text-xs font-bold text-blue-600 hover:underline">Change Item</button>
            </div>
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <span className="font-black text-blue-900 block mb-1">{selectedDumpItem.itemCode}</span>
              <p className="text-sm text-blue-800 mb-3">{selectedDumpItem.itemName}</p>
              <div className="flex gap-4 text-xs font-bold text-blue-700/70 uppercase tracking-wider">
                <span>System Qty: <span className="text-blue-900 bg-blue-100 px-2 py-0.5 rounded">{selectedDumpItem.expectedQty}</span></span>
                <span>Rate: <span className="text-blue-900">₹{selectedDumpItem.rate}</span></span>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Physical Quantity *</label>
                <input required autoFocus type="number" min="0" className="w-full mt-2 px-4 py-4 text-lg font-black bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none" value={physicalQty} onChange={e => setPhysicalQty(parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Item Status</label>
                <select className="w-full mt-2 px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl font-medium focus:ring-2 focus:ring-black outline-none" value={reasonCode} onChange={e => setReasonCode(e.target.value)}>
                  {reasonCodes.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg">Save Item</button>
          </form>
        )}

        {isManualMode && (
          <form onSubmit={handleManualItemSubmit} className="p-6 space-y-5 overflow-y-auto bg-white">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold text-zinc-900">Add Manual Item</h4>
              <button type="button" onClick={() => setIsManualMode(false)} className="text-xs font-bold text-blue-600 hover:underline">Back to Search</button>
            </div>
            <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl text-xs font-medium text-purple-800 mb-2">This item was not found in the ERP dump. The <strong>System Quantity will be set to 0</strong>.</div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Article Number / Code *</label>
              <input required autoFocus className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none" value={manualItem.articleNumber} onChange={e => setManualItem({...manualItem, articleNumber: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Description *</label>
              <input required className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none" value={manualItem.description} onChange={e => setManualItem({...manualItem, description: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Physical Qty *</label>
                <input required type="number" min="1" className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-black" value={physicalQty} onChange={e => setPhysicalQty(parseInt(e.target.value))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Rate (₹) *</label>
                <input required type="number" min="0" step="0.01" className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-black outline-none font-black" value={manualItem.unitValue} onChange={e => setManualItem({...manualItem, unitValue: e.target.value})} />
              </div>
            </div>
            <button type="submit" className="w-full mt-2 py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 text-lg">Save Manual Item</button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
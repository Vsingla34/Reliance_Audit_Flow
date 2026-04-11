import React, { useRef, useState } from 'react';
import { supabase } from '../supabase';
import { 
  Database, 
  Upload, 
  Download, 
  FileSpreadsheet, 
  Trash2, 
  Loader2,
} from 'lucide-react';
import { useAuth } from '../App';
import { motion } from 'motion/react';

const BATCH_SIZE = 2000; 

export function MastersModule() {
  const { profile } = useAuth();
  
  const [isUploadingItem, setIsUploadingItem] = useState(false);
  const [itemProgress, setItemProgress] = useState({ current: 0, total: 0 });
  const [isUploadingSales, setIsUploadingSales] = useState(false);
  const [salesProgress, setSalesProgress] = useState({ current: 0, total: 0 });

  const [isClearingSales, setIsClearingSales] = useState(false);
  const [isClearingItems, setIsClearingItems] = useState(false);
  
  const itemFileRef = useRef<HTMLInputElement>(null);
  const salesFileRef = useRef<HTMLInputElement>(null);

  const downloadItemTemplate = () => {
    const csv = "ItemCode,ItemName,GST,Category,ApproxShelfLife,StandardPack\nITM-001,Premium Shampoo 500ml,18,Personal Care,24 Months,12";
    triggerDownload(csv, "Item_Master_Template.csv");
  };

  const downloadSalesTemplate = () => {
    const csv = "BillingDate,SoldToParty,MaterialNo,ItemName,Plant,BillingDoc,Category,TotalValue,TotalQty,GST,ApproxShelfLife,StandardPack\n2023-10-01,DIST-001,ITM-001,Premium Shampoo,PLNT1,INV-1001,Personal Care,37575.00,150,18,24 Months,12";
    triggerDownload(csv, "Sales_Dump_Template.csv");
  };

  const triggerDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  };

  // --- SMART HEADER PARSER HELPER ---
  const getColValue = (headers: string[], rowVals: string[], possibleNames: string[]) => {
    for (const name of possibleNames) {
      const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase() || h.toLowerCase().replace(/\s/g, '') === name.toLowerCase().replace(/\s/g, ''));
      if (idx !== -1) return rowVals[idx]?.trim() || '';
    }
    return '';
  };

  const handleItemMasterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingItem(true); setItemProgress({ current: 0, total: 0 });
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) throw new Error("File is empty or missing headers");

        const headers = lines[0].split(',').map(h => h.trim().replace(/['"\r]/g, ''));
        
        const items = lines.slice(1).map(line => {
          const cols = line.split(',');
          
          const itemCode = getColValue(headers, cols, ['ItemCode', 'MaterialNo']);
          const itemName = getColValue(headers, cols, ['ItemName', 'Description']);
          const gst = getColValue(headers, cols, ['GST']);
          const category = getColValue(headers, cols, ['Category']);
          const approxShelfLife = getColValue(headers, cols, ['ApproxShelfLife', 'ShelfLife']);
          const standardPack = getColValue(headers, cols, ['StandardPack']);

          if (!itemCode || !itemName) return null;
          
          return { 
            id: Math.random().toString(36).substring(7), 
            itemCode, 
            itemName, 
            gst: parseFloat(gst) || 0, 
            category: category || 'Uncategorized', 
            approxShelfLife: approxShelfLife || 'N/A', 
            standardPack: standardPack || 'N/A' 
          };
        }).filter(Boolean);

        if (items.length === 0) throw new Error("No valid data found in CSV.");
        setItemProgress({ current: 0, total: items.length });

        let processed = 0;
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          const { error } = await supabase.from('itemMaster').upsert(batch, { onConflict: 'itemCode' });
          if (error) throw error;
          processed += batch.length; setItemProgress({ current: processed, total: items.length });
        }
        alert(`Success! ${items.length} items uploaded to the Master.`);
      } catch (error: any) { alert(`Upload failed: ${error.message || 'Invalid CSV format'}`); } 
      finally { setIsUploadingItem(false); setItemProgress({ current: 0, total: 0 }); if (itemFileRef.current) itemFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  const handleSalesDumpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingSales(true); setSalesProgress({ current: 0, total: 0 });
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) throw new Error("File is empty or missing headers");

        const headers = lines[0].split(',').map(h => h.trim().replace(/['"\r]/g, ''));
        
        const dumpItems = lines.slice(1).map(line => {
          const cols = line.split(',');

          // SMART PARSING: Finds the column regardless of where it is in the CSV
          const soldToParty = getColValue(headers, cols, ['SoldToParty', 'DistributorCode']);
          const materialNo = getColValue(headers, cols, ['MaterialNo', 'ItemCode']);
          
          const totalQtyStr = getColValue(headers, cols, ['TotalQty', 'Quantity', 'Qty']);
          const totalValueStr = getColValue(headers, cols, ['TotalValue', 'Value', 'Total Value']);
          
          if (!soldToParty || !materialNo) return null;
          
          const totalQty = parseInt(totalQtyStr) || 0;
          const totalValue = parseFloat(totalValueStr) || 0;
          
          // Calculates the Rate dynamically for the execution form
          const rate = totalQty > 0 ? (totalValue / totalQty) : 0;
          
          return {
            id: Math.random().toString(36).substring(7),
            distributorCode: soldToParty,
            itemCode: materialNo,
            quantity: totalQty,
            rate: rate,
            billingDate: getColValue(headers, cols, ['BillingDate', 'Date']),
            soldToParty: soldToParty,
            materialNo: materialNo,
            plant: getColValue(headers, cols, ['Plant']),
            billingDoc: getColValue(headers, cols, ['BillingDoc', 'InvoiceNo']),
            category: getColValue(headers, cols, ['Category']),
            totalValue: totalValue,
            totalQty: totalQty,
            itemName: getColValue(headers, cols, ['ItemName', 'Description']),
            gst: parseFloat(getColValue(headers, cols, ['GST'])) || 0,
            approxShelfLife: getColValue(headers, cols, ['ApproxShelfLife', 'ShelfLife']),
            standardPack: getColValue(headers, cols, ['StandardPack'])
          };
        }).filter(Boolean);

        if (dumpItems.length === 0) throw new Error("No valid data found in CSV.");
        setSalesProgress({ current: 0, total: dumpItems.length });

        let processed = 0;
        for (let i = 0; i < dumpItems.length; i += BATCH_SIZE) {
          const batch = dumpItems.slice(i, i + BATCH_SIZE);
          const { error } = await supabase.from('salesDump').insert(batch);
          if (error) throw error;
          processed += batch.length; setSalesProgress({ current: processed, total: dumpItems.length });
        }
        alert(`Success! ${dumpItems.length} records appended to the Sales Dump.`);
      } catch (error: any) { alert(`Upload failed: ${error.message || 'Invalid CSV format'}`); } 
      finally { setIsUploadingSales(false); setSalesProgress({ current: 0, total: 0 }); if (salesFileRef.current) salesFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  const clearSalesDump = async () => {
    if (window.confirm("WARNING: This will permanently delete ALL data in the Sales Dump. Do you want to continue?")) {
      setIsClearingSales(true);
      try {
        const { error } = await supabase.from('salesDump').delete().neq('id', '0');
        if (error) throw error; alert("Sales Dump has been completely cleared.");
      } catch (error) { alert("Failed to clear Sales Dump."); } 
      finally { setIsClearingSales(false); }
    }
  };

  const clearItemMaster = async () => {
    if (window.confirm("WARNING: This will permanently delete ALL products in the Item Master. Do you want to continue?")) {
      setIsClearingItems(true);
      try {
        const { error } = await supabase.from('itemMaster').delete().neq('id', '0');
        if (error) throw error; alert("Item Master has been completely cleared.");
      } catch (error) { alert("Failed to clear Item Master."); } 
      finally { setIsClearingItems(false); }
    }
  };

  // SUPERADMIN UPDATE HERE
  if (!['superadmin', 'admin', 'ho'].includes(profile?.role || '')) return <div className="p-8 text-center text-red-500 font-bold">Access Denied. Admins & HO only.</div>;

  return (
    <div className="space-y-8 pb-12">
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2"><Database className="text-black" /> Master Data Management</h2>
        <p className="text-zinc-500">Upload and manage the central data repositories that power the Execution audits.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* ITEM MASTER CARD */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm p-8 flex flex-col h-full relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-blue-500" />
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0"><FileSpreadsheet className="text-blue-600" size={24} /></div>
            <div><h3 className="text-xl font-bold">Item Master</h3><p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mt-1">Global Product Catalog</p></div>
          </div>
          <div className="flex-1 space-y-4 mb-8 text-sm text-zinc-600">
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100"><p className="font-bold text-zinc-900 mb-2 text-xs uppercase">Required Columns:</p><code className="text-xs text-blue-600">ItemCode, ItemName, GST, Category, ApproxShelfLife, StandardPack</code></div>
          </div>
          <div className="space-y-3 mt-auto">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={downloadItemTemplate} disabled={isUploadingItem} className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"><Download size={16} /> Template</button>
              <button onClick={clearItemMaster} disabled={isClearingItems || isUploadingItem} className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50">{isClearingItems ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />} Clear Master</button>
            </div>
            <input type="file" accept=".csv" ref={itemFileRef} onChange={handleItemMasterUpload} className="hidden" />
            <button onClick={() => itemFileRef.current?.click()} disabled={isUploadingItem} className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-black/10 flex items-center justify-center gap-2 disabled:opacity-90 relative overflow-hidden">
              {isUploadingItem ? (<div className="flex flex-col items-center gap-1 z-10 relative"><span className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} /> Processing Batches...</span><span className="text-[10px] text-zinc-300 font-mono tracking-wider">{itemProgress.current.toLocaleString()} / {itemProgress.total.toLocaleString()} Rows</span></div>) : (<><Upload size={18} /> Upload Item Master CSV</>)}
              {isUploadingItem && (<div className="absolute left-0 bottom-0 h-1 bg-blue-500 transition-all duration-300" style={{ width: `${(itemProgress.current / itemProgress.total) * 100}%` }} />)}
            </button>
          </div>
        </motion.div>

        {/* SALES DUMP CARD */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm p-8 flex flex-col h-full relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0"><Database className="text-emerald-600" size={24} /></div>
              <div><h3 className="text-xl font-bold">Sales Dump</h3><p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mt-1">Distributor Inventory Mapping</p></div>
            </div>
          </div>
          <div className="flex-1 space-y-4 mb-8 text-sm text-zinc-600">
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
              <p className="font-bold text-zinc-900 mb-2 text-xs uppercase">Required Columns:</p>
              <code className="text-[10px] sm:text-[11px] text-emerald-600 leading-relaxed block break-words">BillingDate, SoldToParty, MaterialNo, ItemName, Plant, BillingDoc, Category, TotalValue, TotalQty, GST, ApproxShelfLife, StandardPack</code>
            </div>
          </div>
          <div className="space-y-3 mt-auto">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={downloadSalesTemplate} disabled={isUploadingSales} className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"><Download size={16} /> Template</button>
              <button onClick={clearSalesDump} disabled={isClearingSales || isUploadingSales} className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50">{isClearingSales ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />} Clear Dump</button>
            </div>
            <input type="file" accept=".csv" ref={salesFileRef} onChange={handleSalesDumpUpload} className="hidden" />
            <button onClick={() => salesFileRef.current?.click()} disabled={isUploadingSales} className="w-full py-4 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-black/10 flex items-center justify-center gap-2 disabled:opacity-90 relative overflow-hidden">
              {isUploadingSales ? (<div className="flex flex-col items-center gap-1 z-10 relative"><span className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} /> Processing Batches...</span><span className="text-[10px] text-zinc-300 font-mono tracking-wider">{salesProgress.current.toLocaleString()} / {salesProgress.total.toLocaleString()} Rows</span></div>) : (<><Upload size={18} /> Append to Sales Dump</>)}
              {isUploadingSales && (<div className="absolute left-0 bottom-0 h-1 bg-emerald-500 transition-all duration-300" style={{ width: `${(salesProgress.current / salesProgress.total) * 100}%` }} />)}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
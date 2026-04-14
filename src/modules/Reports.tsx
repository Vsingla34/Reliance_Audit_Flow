import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AuditTicket, Distributor, SalesDumpItem } from '../types';
import { 
  BarChart3, 
  Download, 
  FileText, 
  Info, 
  CheckCircle2, 
  AlertCircle,
  IndianRupee,
  RefreshCw,
  Upload,
  X,
  ShieldAlert
} from 'lucide-react';
import { cn, useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

export function ReportsModule() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [salesDump, setSalesDump] = useState<SalesDumpItem[]>([]);
  
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeReport, setActiveReport] = useState<'consolidated' | 'credit_note'>('consolidated');

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // --- STRICT SECURITY CHECK ---
  // Blocks field users (ASE, Auditor) from forcing their browser to /reports
  const allowedRoles = ['superadmin', 'admin', 'ho', 'dm', 'sm', 'asm'];
  const hasAccess = allowedRoles.includes(profile?.role || '');

  // Only Admin, SuperAdmin, and HO can upload the Master Dump from the reports page
  const isAdminOrHO = ['superadmin', 'admin', 'ho'].includes(profile?.role || '');

  const fetchReportData = async () => {
    if (!hasAccess) return;
    
    setLoading(true);
    try {
      const [tRes, dRes, sRes] = await Promise.all([
        supabase.from('auditTickets').select('*').in('status', ['signed', 'evidence_uploaded', 'closed']),
        supabase.from('distributors').select('*'),
        supabase.from('salesDump').select('*')
      ]);
      
      if (tRes.error) throw tRes.error;
      if (dRes.error) throw dRes.error;
      if (sRes.error) throw sRes.error;

      if (tRes.data) setTickets(tRes.data as AuditTicket[]);
      if (dRes.data) setDistributors(dRes.data as Distributor[]);
      if (sRes.data) setSalesDump(sRes.data as SalesDumpItem[]);
    } catch (error) {
      console.error("Error fetching base report data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [hasAccess]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const allItems: any[] = [];
      const ticketIds = tickets.map(t => t.id);
      
      if (ticketIds.length > 0) {
        const { data: itemsData, error } = await supabase
          .from('auditLineItems')
          .select('*')
          .in('ticketId', ticketIds);
          
        if (error) throw error;
        
        if (itemsData) {
          itemsData.forEach(item => {
            const ticket = tickets.find(t => t.id === item.ticketId);
            const dist = distributors.find(d => d.id === ticket?.distributorId);
            
            // If the user is a manager (DM, SM, ASM), only show data for their specific distributors
            if (!isAdminOrHO) {
              if (profile?.role === 'dm' && dist?.dmId !== profile?.uid) return;
              if (profile?.role === 'sm' && dist?.smId !== profile?.uid) return;
              if (profile?.role === 'asm' && dist?.asmId !== profile?.uid) return;
            }

            let matchedArticle = salesDump.find(s => s.articleNumber === item.articleNumber);
            let matchType = 'Exact';
            
            if (!matchedArticle) {
              matchedArticle = salesDump.find(s => s.category === item.category);
              matchType = matchedArticle ? 'Fallback (Category)' : 'Unmatched';
            }

            const requestedValue = item.quantity * item.unitValue;
            const creditNoteValue = matchedArticle ? (item.quantity * matchedArticle.rate) : 0;

            allItems.push({
              ...item,
              distributorName: dist?.name || 'Unknown',
              distributorCode: dist?.code || 'N/A',
              status: ticket?.status,
              matchType,
              matchedArticle: matchedArticle?.articleNumber || 'N/A',
              requestedValue,
              creditNoteRate: matchedArticle?.rate || 0,
              creditNoteValue,
              variance: creditNoteValue - requestedValue
            });
          });
        }
      }
      setReportData(allItems);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tickets.length > 0 && distributors.length > 0) {
      generateReport();
    } else {
      setReportData([]);
    }
  }, [tickets, distributors, salesDump]);

  // --- Sales Dump Upload Logic ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim() !== ''); // Skip empty lines
        
        const newDumpItems = lines.slice(1).map(line => {
          const [articleNumber, description, category, rate] = line.split(',');
          if (!articleNumber || !rate) return null;
          
          return {
            id: Math.random().toString(36).substring(7),
            articleNumber: articleNumber.trim(),
            description: description?.trim() || 'No Description',
            category: category?.trim() || 'Uncategorized',
            rate: parseFloat(rate) || 0
          };
        }).filter(Boolean);

        if (newDumpItems.length > 0) {
          // 1. Wipe the old sales dump to keep it fresh
          await supabase.from('salesDump').delete().not('id', 'is', null);
          
          // 2. Insert the new master rates
          const { error } = await supabase.from('salesDump').insert(newDumpItems);
          if (error) throw error;
          
          alert(`Successfully uploaded ${newDumpItems.length} articles to the master dump!`);
          
          fetchReportData(); 
        }
      } catch (error) {
        console.error("Error uploading sales dump:", error);
        alert("Failed to upload sales dump. Please ensure it is a valid CSV.");
      } finally {
        setIsUploading(false);
        setIsUploadModalOpen(false);
      }
    };
    reader.readAsText(file);
  };

  const downloadCSV = () => {
    if (reportData.length === 0) return;

    const headers = activeReport === 'consolidated' 
      ? ['Distributor Code', 'Distributor Name', 'Article Number', 'Description', 'Reason', 'Qty', 'Auditor Rate', 'Requested Value', 'Status']
      : ['Distributor Code', 'Distributor Name', 'Article Number', 'Match Type', 'Qty', 'Sales Dump Rate', 'Final CN Value', 'Variance (CN - Req)'];

    const csvContent = [
      headers.join(','),
      ...reportData.map(row => {
        if (activeReport === 'consolidated') {
          return `"${row.distributorCode}","${row.distributorName}","${row.articleNumber}","${row.description}","${row.reasonCode}",${row.quantity},${row.unitValue},${row.requestedValue},"${row.status}"`;
        } else {
          return `"${row.distributorCode}","${row.distributorName}","${row.articleNumber}","${row.matchType}",${row.quantity},${row.creditNoteRate},${row.creditNoteValue},${row.variance}`;
        }
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Audit_Report_${activeReport}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalRequested = reportData.reduce((acc, row) => acc + (row.requestedValue || 0), 0);
  const totalCN = reportData.reduce((acc, row) => acc + (row.creditNoteValue || 0), 0);

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] w-full p-4">
        <div className="bg-red-50 border border-red-100 p-8 rounded-[2rem] max-w-md w-full text-center shadow-sm">
          <ShieldAlert className="text-red-500 w-16 h-16 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-red-700 font-medium">Financial Reports are restricted to Management and Admin personnel.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex bg-zinc-100 p-1.5 rounded-2xl overflow-x-auto custom-scrollbar">
          <button 
            onClick={() => setActiveReport('consolidated')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
              activeReport === 'consolidated' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            )}
          >
            Consolidated Field Data
          </button>
          <button 
            onClick={() => setActiveReport('credit_note')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
              activeReport === 'credit_note' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            )}
          >
            Credit Note Issuance
          </button>
        </div>

        <div className="flex gap-4">
          <button 
            onClick={fetchReportData}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-100 text-zinc-900 rounded-xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50"
            title="Refresh Report Data"
          >
            <RefreshCw size={18} className={cn(loading && "animate-spin")} />
          </button>

          {isAdminOrHO && (
            <button 
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-100 text-zinc-900 rounded-xl font-bold hover:bg-zinc-200 transition-all active:scale-95 whitespace-nowrap"
            >
              <Upload size={18} /> <span className="hidden sm:inline">Master Dump</span>
            </button>
          )}

          <button 
            onClick={downloadCSV}
            disabled={reportData.length === 0}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Download size={18} /> <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0">
            <FileText className="text-zinc-600" size={24} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider truncate">Total Line Items</p>
            <p className="text-2xl font-black text-zinc-900 truncate">{reportData.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-blue-600" size={24} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400 uppercase tracking-wider truncate">Requested Value</p>
            <p className="text-2xl font-black text-zinc-900 truncate">₹{totalRequested.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-emerald-600" size={24} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-emerald-500 uppercase tracking-wider truncate">Credit Note Value</p>
            <p className="text-2xl font-black text-zinc-900 truncate">₹{totalCN.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden">
        {activeReport === 'consolidated' ? (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Distributor</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Article</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Reason</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Qty</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Rate</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Requested Value</th>
                  <th className="px-6 py-4 text-center font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="font-bold text-zinc-900">{row.distributorName}</p>
                      <p className="text-xs text-zinc-400 font-mono">{row.distributorCode}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-zinc-900">{row.articleNumber}</p>
                      <p className="text-xs text-zinc-400 line-clamp-1 min-w-[150px]">{row.description}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-zinc-100 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider text-zinc-600">
                        {row.reasonCode}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-zinc-900">{row.quantity}</td>
                    <td className="px-6 py-4 text-right text-zinc-500">₹{row.unitValue}</td>
                    <td className="px-6 py-4 text-right font-black text-zinc-900">₹{row.requestedValue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      <span className={cn(
                        "px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider",
                        row.status === 'closed' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-purple-50 text-purple-600 border border-purple-100"
                      )}>
                        {row.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Distributor</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Article</th>
                  <th className="px-6 py-4 text-center font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Match Status</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Qty</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Dump Rate</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Final CN Value</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs whitespace-nowrap">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="font-bold text-zinc-900">{row.distributorName}</p>
                      <p className="text-xs text-zinc-400 font-mono">{row.distributorCode}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-zinc-900">{row.articleNumber}</p>
                      {row.matchType !== 'Exact' && <p className="text-[10px] font-bold text-amber-600 mt-0.5">Matched: {row.matchedArticle}</p>}
                    </td>
                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      <span className={cn(
                        "inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border",
                        row.matchType === 'Exact' ? "text-emerald-700 bg-emerald-50 border-emerald-100" : 
                        row.matchType === 'Unmatched' ? "text-red-700 bg-red-50 border-red-100" : "text-amber-700 bg-amber-50 border-amber-100"
                      )}>
                        {row.matchType === 'Exact' ? <CheckCircle2 size={12}/> : row.matchType === 'Unmatched' ? <AlertCircle size={12}/> : <Info size={12}/>}
                        {row.matchType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-zinc-900">{row.quantity}</td>
                    <td className="px-6 py-4 text-right text-zinc-500">
                      {row.creditNoteRate ? `₹${row.creditNoteRate}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-black text-emerald-600">
                      ₹{row.creditNoteValue.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={cn(
                        "font-bold text-sm",
                        row.variance > 0 ? "text-emerald-600" : row.variance < 0 ? "text-red-600" : "text-zinc-400"
                      )}>
                        {row.variance > 0 ? '+' : ''}₹{row.variance.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportData.length === 0 && !loading && (
          <div className="p-16 text-center text-zinc-500">
            <BarChart3 size={48} className="mx-auto mb-4 text-zinc-300" />
            <p className="font-bold text-lg text-zinc-900">No report data available</p>
            <p className="text-sm mt-1">There are no signed or closed audits in your purview to generate a report from.</p>
          </div>
        )}
      </div>

      {/* Upload Master Dump Modal */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              onClick={() => !isUploading && setIsUploadModalOpen(false)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Upload className="text-blue-600" size={24} />
              </div>
              <h4 className="text-2xl font-bold tracking-tight mb-2">Update Master Sales Dump</h4>
              <p className="text-sm text-zinc-500 mb-6">
                Uploading a new CSV will <strong className="text-red-500">overwrite</strong> the existing master rates.
              </p>

              <div className="text-left bg-zinc-50 p-4 rounded-2xl mb-6">
                <p className="text-xs font-bold text-zinc-900 uppercase tracking-wider mb-2">Required CSV Format:</p>
                <code className="text-[11px] text-zinc-600 block bg-white p-2 border border-zinc-200 rounded-lg">
                  ArticleNumber, Description, Category, Rate<br/>
                  1001, Sample Item A, Electronics, 250.50<br/>
                  1002, Sample Item B, FMCG, 45.00
                </code>
              </div>
              
              <div className="relative">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait"
                />
                <div className={cn(
                  "w-full py-4 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 transition-colors",
                  isUploading ? "border-blue-200 bg-blue-50" : "border-zinc-200 hover:border-black hover:bg-zinc-50"
                )}>
                  {isUploading ? (
                    <RefreshCw className="text-blue-500 animate-spin" size={24} />
                  ) : (
                    <>
                      <span className="font-bold text-zinc-900">Click to browse or drag CSV file</span>
                      <span className="text-xs text-zinc-400">CSV format only</span>
                    </>
                  )}
                </div>
              </div>
              
              <button 
                onClick={() => setIsUploadModalOpen(false)} 
                disabled={isUploading}
                className="mt-6 text-sm font-bold text-zinc-400 hover:text-black transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
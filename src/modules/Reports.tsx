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
  RefreshCw
} from 'lucide-react';
import { cn } from '../App';
import { motion } from 'motion/react';

export function ReportsModule() {
  const [tickets, setTickets] = useState<AuditTicket[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [salesDump, setSalesDump] = useState<SalesDumpItem[]>([]);
  
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeReport, setActiveReport] = useState<'consolidated' | 'credit_note'>('consolidated');

  const fetchReportData = async () => {
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
  }, []);

  const generateReport = async () => {
    setLoading(true);
    try {
      const allItems: any[] = [];
      const ticketIds = tickets.map(t => t.id);
      
      if (ticketIds.length > 0) {
        // Fetch all line items for the relevant tickets in one efficient query
        const { data: itemsData, error } = await supabase
          .from('auditLineItems')
          .select('*')
          .in('ticketId', ticketIds);
          
        if (error) throw error;
        
        if (itemsData) {
          itemsData.forEach(item => {
            const ticket = tickets.find(t => t.id === item.ticketId);
            const dist = distributors.find(d => d.id === ticket?.distributorId);
            
            // Look for exact match in sales dump
            let matchedArticle = salesDump.find(s => s.articleNumber === item.articleNumber);
            let matchType = 'Exact';
            
            // Fallback to category average if exact article not found
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

  // Re-generate the report anytime the base data changes
  useEffect(() => {
    if (tickets.length > 0 && distributors.length > 0) {
      generateReport();
    } else {
      setReportData([]);
    }
  }, [tickets, distributors, salesDump]);

  const downloadCSV = () => {
    if (reportData.length === 0) return;

    // Define columns based on active report type
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

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex bg-zinc-100 p-1.5 rounded-2xl">
          <button 
            onClick={() => setActiveReport('consolidated')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all",
              activeReport === 'consolidated' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            )}
          >
            Consolidated Field Data
          </button>
          <button 
            onClick={() => setActiveReport('credit_note')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all",
              activeReport === 'credit_note' ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            )}
          >
            Credit Note Issuance
          </button>
        </div>

        <div className="flex gap-4">
          <button 
            onClick={generateReport}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-3 bg-zinc-100 text-zinc-900 rounded-xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50"
          >
            <RefreshCw size={18} className={cn(loading && "animate-spin")} />
          </button>
          <button 
            onClick={downloadCSV}
            disabled={reportData.length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-zinc-100 rounded-2xl flex items-center justify-center shrink-0">
            <FileText className="text-zinc-600" size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Total Line Items</p>
            <p className="text-2xl font-black text-zinc-900">{reportData.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-blue-600" size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-400 uppercase tracking-wider">Requested Value</p>
            <p className="text-2xl font-black text-zinc-900">₹{totalRequested.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0">
            <IndianRupee className="text-emerald-600" size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-500 uppercase tracking-wider">Credit Note Value</p>
            <p className="text-2xl font-black text-zinc-900">₹{totalCN.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-zinc-200 shadow-sm overflow-hidden">
        {activeReport === 'consolidated' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs">Distributor</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs">Article</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs">Reason</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Qty</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Rate</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Requested Value</th>
                  <th className="px-6 py-4 text-center font-bold text-zinc-500 uppercase tracking-wider text-xs">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold">{row.distributorName}</p>
                      <p className="text-xs text-zinc-400">{row.distributorCode}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium">{row.articleNumber}</p>
                      <p className="text-xs text-zinc-400 truncate max-w-[200px]">{row.description}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-zinc-100 px-2 py-1 rounded text-xs font-medium text-zinc-600">
                        {row.reasonCode}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">{row.quantity}</td>
                    <td className="px-6 py-4 text-right text-zinc-500">₹{row.unitValue}</td>
                    <td className="px-6 py-4 text-right font-bold text-zinc-900">₹{row.requestedValue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-bold uppercase tracking-wider",
                        row.status === 'closed' ? "bg-emerald-50 text-emerald-600" : "bg-purple-50 text-purple-600"
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs">Distributor</th>
                  <th className="px-6 py-4 text-left font-bold text-zinc-500 uppercase tracking-wider text-xs">Article</th>
                  <th className="px-6 py-4 text-center font-bold text-zinc-500 uppercase tracking-wider text-xs">Match Status</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Qty</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Dump Rate</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Final CN Value</th>
                  <th className="px-6 py-4 text-right font-bold text-zinc-500 uppercase tracking-wider text-xs">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold">{row.distributorName}</p>
                      <p className="text-xs text-zinc-400">{row.distributorCode}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium">{row.articleNumber}</p>
                      {row.matchType !== 'Exact' && <p className="text-xs text-amber-500">Matched to: {row.matchedArticle}</p>}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-bold",
                        row.matchType === 'Exact' ? "text-emerald-600 bg-emerald-50" : 
                        row.matchType === 'Unmatched' ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50"
                      )}>
                        {row.matchType === 'Exact' ? <CheckCircle2 size={12}/> : row.matchType === 'Unmatched' ? <AlertCircle size={12}/> : <Info size={12}/>}
                        {row.matchType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">{row.quantity}</td>
                    <td className="px-6 py-4 text-right text-zinc-500">
                      {row.creditNoteRate ? `₹${row.creditNoteRate}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-black text-emerald-600">
                      ₹{row.creditNoteValue.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={cn(
                        "font-bold",
                        row.variance > 0 ? "text-emerald-500" : row.variance < 0 ? "text-red-500" : "text-zinc-400"
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
            <p className="font-medium text-lg text-zinc-900">No report data available</p>
            <p className="text-sm mt-1">There are no completed or submitted audits to generate a report from.</p>
          </div>
        )}
      </div>
    </div>
  );
}
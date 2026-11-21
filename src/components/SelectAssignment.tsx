import React, { useState, useEffect, useMemo } from 'react';
import { supabase, logActivity } from '../supabase';
import { getCachedData, setCachedData, fetchCachedDistributors, fetchCachedUsers } from '../supabaseOptimized';
import { Assignment, UserProfile } from '../types';
import { cn } from '../App';
import {
  Building2, Plus, Search, ArrowRight, Edit2, Trash2, X,
  Loader2, LogOut, FolderKanban, Store, CalendarClock, Sparkles,
  Layers, CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import logo from '../public/favicon.png';

interface SelectAssignmentProps {
  user: any;
  profile: UserProfile;
  onSelectAssignment: (assignment: Assignment) => void;
  onSignOut: () => Promise<void>;
}

const DEFAULT_ASSIGNMENT_1: Assignment = {
  id: 'assignment-1',
  name: 'Assignment 1',
  company_name: 'Reliance Consumer Products',
  description: 'Historical & current audit data till today',
  active: true,
  created_at: new Date().toISOString(),
};

const EASE = [0.22, 1, 0.36, 1] as const;

export function SelectAssignment({
  user,
  profile,
  onSelectAssignment,
  onSignOut,
}: SelectAssignmentProps) {
  const [assignments, setAssignments] = useState<Assignment[]>(
    () => getCachedData<Assignment[]>('assignments-list') || [DEFAULT_ASSIGNMENT_1]
  );
  const [countsMap, setCountsMap] = useState<Record<string, { distributors: number; tickets: number }>>(
    () => getCachedData<Record<string, { distributors: number; tickets: number }>>('assignments-counts') || {}
  );
  const [loading, setLoading] = useState(() => !getCachedData('assignments-list'));
  const [searchTerm, setSearchTerm] = useState('');

  // Create / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    company_name: '',
    description: '',
    active: true,
  });

  const canManageAssignments = ['superadmin', 'admin'].includes(profile.role);

  const fetchAssignments = async () => {
    if (!getCachedData('assignments-list')) setLoading(true);
    try {
      fetchCachedUsers().catch(() => { });

      const { data, error } = await supabase
        .from('assignments')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('Assignments table not found or error fetching, falling back to Assignment 1:', error.message);
        setAssignments([DEFAULT_ASSIGNMENT_1]);
        setLoading(false);
        return;
      }

      let list = (data || []) as Assignment[];
      if (list.length === 0) {
        const { data: inserted } = await supabase
          .from('assignments')
          .upsert([DEFAULT_ASSIGNMENT_1], { onConflict: 'id' })
          .select();
        list = (inserted as Assignment[]) || [DEFAULT_ASSIGNMENT_1];
      }

      setAssignments(list);
      setCachedData('assignments-list', list);
      setLoading(false);

      Promise.all(
        list.map(async a => {
          const [{ count: distCount }, { count: ticketCount }] = await Promise.all([
            supabase
              .from('distributors')
              .select('id', { count: 'exact', head: true })
              .eq('assignment_id', a.id),
            supabase
              .from('auditTickets')
              .select('id', { count: 'exact', head: true })
              .eq('assignment_id', a.id),
          ]);
          return {
            id: a.id,
            distributors: distCount || 0,
            tickets: ticketCount || 0,
          };
        })
      )
        .then(countQueries => {
          const counts: Record<string, { distributors: number; tickets: number }> = {};
          countQueries.forEach(c => {
            counts[c.id] = { distributors: c.distributors, tickets: c.tickets };
          });
          setCountsMap(counts);
          setCachedData('assignments-counts', counts);
        })
        .catch(() => { });
    } catch (err) {
      console.error('Error loading assignments:', err);
      setAssignments([DEFAULT_ASSIGNMENT_1]);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, []);

  const visibleAssignments = useMemo(() => {
    return assignments.filter(a => {
      if (!canManageAssignments && !a.active) return false;
      const q = searchTerm.toLowerCase().trim();
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.company_name.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
      );
    });
  }, [assignments, searchTerm, canManageAssignments]);

  const openCreateModal = () => {
    setEditingAssignment(null);
    const nextNumber = assignments.length + 1;
    setFormData({
      name: `Assignment ${nextNumber}`,
      company_name: '',
      description: '',
      active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (e: React.MouseEvent, assignment: Assignment) => {
    e.stopPropagation();
    setEditingAssignment(assignment);
    setFormData({
      name: assignment.name,
      company_name: assignment.company_name,
      description: assignment.description || '',
      active: assignment.active,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent, assignment: Assignment) => {
    e.stopPropagation();
    if (!canManageAssignments) return;
    if (assignment.id === 'assignment-1') {
      alert('Assignment 1 contains historical audit data and cannot be deleted.');
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to delete "${assignment.name}" (${assignment.company_name})?\n\nWARNING: All distributors, tickets, and data inside this assignment will be permanently removed.`
      )
    ) {
      return;
    }

    try {
      const { error } = await supabase.from('assignments').delete().eq('id', assignment.id);
      if (error) throw error;
      logActivity(
        user,
        profile,
        'Assignment Deleted',
        `Deleted assignment "${assignment.name}" (${assignment.company_name})`,
        'assignment-1'
      );
      fetchAssignments();
    } catch (err: any) {
      alert(`Failed to delete assignment: ${err.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAssignments) return;
    if (!formData.name.trim() || !formData.company_name.trim()) {
      alert('Please provide both Assignment Name and Company Name.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingAssignment) {
        const { error } = await supabase
          .from('assignments')
          .update({
            name: formData.name.trim(),
            company_name: formData.company_name.trim(),
            description: formData.description.trim(),
            active: formData.active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingAssignment.id);

        if (error) throw error;
        logActivity(
          user,
          profile,
          'Assignment Updated',
          `Updated assignment "${formData.name}" (${formData.company_name})`,
          editingAssignment.id
        );
      } else {
        const slug = formData.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        const newId = `${slug || 'assignment'}-${Math.random().toString(36).substring(2, 7)}`;

        const newAssignment: Assignment = {
          id: newId,
          name: formData.name.trim(),
          company_name: formData.company_name.trim(),
          description: formData.description.trim(),
          active: formData.active,
          created_by: user?.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase.from('assignments').insert([newAssignment]);
        if (error) throw error;

        logActivity(
          user,
          profile,
          'Assignment Created',
          `Created new assignment "${formData.name}" for company "${formData.company_name}"`,
          newId
        );
      }

      setIsModalOpen(false);
      fetchAssignments();
    } catch (err: any) {
      alert(
        `Failed to save assignment: ${err.message}\n\nMake sure you have run the supabase_multitenant_migration.sql script in your Supabase SQL Editor.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 bg-enterprise-grid flex flex-col font-sans text-slate-900 dark:text-slate-100 relative transition-colors">
      {/* Subtle Ambient Top Glow */}
      <div className="absolute top-0 inset-x-0 h-80 bg-gradient-to-b from-indigo-50/70 dark:from-indigo-950/30 via-slate-50/40 dark:via-slate-950/20 to-transparent pointer-events-none" />

      {/* Top Navbar */}
      <header className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-slate-200/80 dark:border-slate-700 p-1.5 bg-white dark:bg-slate-800 shadow-xs">
            <img src={logo} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-base sm:text-lg tracking-tight leading-none text-slate-900 dark:text-white">
                Reliance <span className="text-indigo-600 dark:text-indigo-400">Audit Flow</span>
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700">
                Enterprise
              </span>
            </div>
            <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500 block mt-0.5">
              Multi-Tenant Workspace Architecture
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 bg-white dark:bg-slate-800 pl-2 pr-3.5 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
            <div
              className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0',
                profile.role === 'superadmin'
                  ? 'bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-700 dark:text-fuchsia-300'
                  : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
              )}
            >
              {profile.name.charAt(0)}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-slate-900 dark:text-white leading-none truncate max-w-[140px]">
                {profile.name}
              </p>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-0.5">
                {profile.role.replace('_', ' ')}
              </p>
            </div>
          </div>

          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50/80 dark:hover:bg-rose-950/40 border border-slate-200/80 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-900 font-semibold text-xs rounded-xl transition-all shadow-2xs active:scale-95"
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 relative z-10">
        {/* Hero Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8"
        >
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold mb-3 shadow-2xs">
              <Layers size={13} /> Workspace Directory
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Select Assignment Workspace
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
              Each assignment operates as an isolated tenant with dedicated distributors, product masters, sales dumps, schedules, and financial audit reports.
            </p>
          </div>

          {canManageAssignments && (
            <button
              onClick={openCreateModal}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 dark:bg-indigo-600 hover:bg-indigo-600 dark:hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-sm hover:shadow-indigo-600/20 active:scale-[0.98] text-xs sm:text-sm whitespace-nowrap shrink-0"
            >
              <Plus size={16} /> New Assignment
            </button>
          )}
        </motion.div>

        {/* Search & Count Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: EASE }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7"
        >
          <div className="relative max-w-md w-full">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              placeholder="Filter assignments by name or company..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none shadow-2xs transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Showing <span className="font-bold text-slate-900 dark:text-white">{visibleAssignments.length}</span> active workspace{visibleAssignments.length !== 1 ? 's' : ''}
          </div>
        </motion.div>

        {/* Grid of Assignments */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(n => (
              <div
                key={n}
                className="h-60 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 animate-pulse flex flex-col justify-between"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3.5 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                    <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-800 rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded" />
                  <div className="h-2.5 w-2/3 bg-slate-100 dark:bg-slate-800 rounded" />
                </div>
                <div className="h-9 w-full bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
            ))}
          </div>
        ) : visibleAssignments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-12 text-center max-w-md mx-auto shadow-xs"
          >
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto mb-3">
              <Building2 size={24} />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">No Assignments Found</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {searchTerm
                ? `No workspaces match "${searchTerm}".`
                : 'No active assignments are currently configured.'}
            </p>
            {canManageAssignments && !searchTerm && (
              <button
                onClick={openCreateModal}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 transition-all"
              >
                <Plus size={15} /> Create First Assignment
              </button>
            )}
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleAssignments.map((assignment, idx) => {
              const stats = countsMap[assignment.id] || { distributors: 0, tickets: 0 };
              const isPrimary = assignment.id === 'assignment-1';

              return (
                <motion.div
                  key={assignment.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ delay: idx * 0.04, duration: 0.32, ease: EASE }}
                  onMouseEnter={() => {
                    fetchCachedDistributors(assignment.id, profile).catch(() => { });
                  }}
                  onClick={() => onSelectAssignment(assignment)}
                  className={cn(
                    'group relative bg-white dark:bg-slate-900 rounded-2xl border p-6 shadow-[0_1px_3px_rgba(15,23,42,0.03)] hover:shadow-[0_12px_30px_-8px_rgba(79,70,229,0.12)] transition-all cursor-pointer flex flex-col justify-between overflow-hidden',
                    assignment.active
                      ? 'border-slate-200/90 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                      : 'border-slate-200 dark:border-slate-800 opacity-70 bg-slate-50 dark:bg-slate-900/50'
                  )}
                >
                  <div>
                    {/* Top Row: Icon + Status Badges + Admin Controls */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div
                        className={cn(
                          'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border transition-colors',
                          isPrimary
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600'
                        )}
                      >
                        <Building2 size={20} />
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isPrimary ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-900">
                            <Sparkles size={10} /> Primary Tenant
                          </span>
                        ) : assignment.active ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900">
                            <CheckCircle2 size={10} /> Active
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900">
                            Archived
                          </span>
                        )}

                        {canManageAssignments && (
                          <div className="flex items-center gap-0.5 ml-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={e => openEditModal(e, assignment)}
                              className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                              title="Edit Assignment"
                            >
                              <Edit2 size={14} />
                            </button>
                            {!isPrimary && (
                              <button
                                type="button"
                                onClick={e => handleDelete(e, assignment)}
                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                                title="Delete Assignment"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Title & Company Badge */}
                    <div className="mb-5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                        {assignment.company_name}
                      </span>
                      <h3 className="text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
                        {assignment.name}
                      </h3>
                      {assignment.description ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {assignment.description}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          Isolated company audit workspace
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-2 py-3 px-3.5 bg-slate-50/80 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                          <Store size={13} />
                        </div>
                        <div>
                          <p className="text-xs font-extrabold text-slate-900 dark:text-white leading-none">
                            {stats.distributors.toLocaleString('en-IN')}
                          </p>
                          <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                            Distributors
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 border-l border-slate-200/70 dark:border-slate-700 pl-3">
                        <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                          <CalendarClock size={13} />
                        </div>
                        <div>
                          <p className="text-xs font-extrabold text-slate-900 dark:text-white leading-none">
                            {stats.tickets.toLocaleString('en-IN')}
                          </p>
                          <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                            Audits
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 pt-1 transition-colors">
                      <span>Enter Workspace</span>
                      <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center transition-all">
                        <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create / Edit Assignment Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => !isSubmitting && setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/45 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden z-10"
            >
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      {editingAssignment ? 'Edit Assignment' : 'Create New Assignment'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Configure an isolated multi-tenant workspace for a company or phase.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !isSubmitting && setIsModalOpen(false)}
                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                    Assignment Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Assignment 2 — Phase VI"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                    Company / Client Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Reliance Consumer Products"
                    value={formData.company_name}
                    onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                    className="w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                    Description / Scope
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Optional description of audit scope, financial year, or division..."
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    className="w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all resize-none"
                  />
                </div>

                <label className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-700/70 transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={e => setFormData({ ...formData, active: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white block">
                      Active Workspace
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Visible to team members on the workspace directory screen
                    </span>
                  </div>
                </label>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 transition-all shadow-sm shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-60"
                  >
                    {isSubmitting && <Loader2 size={15} className="animate-spin" />}
                    {editingAssignment ? 'Save Changes' : 'Create Assignment'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Users,
  ArrowLeft,
  Loader2,
  Clock,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  FileText,
  DollarSign,
  CheckCircle,
  XCircle,
  ListFilter,
  Download,
  Search,
  X
} from "lucide-react";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
}

interface Phonebook {
  id: string;
  name: string;
}

interface Campaign {
  id: string;
  name: string;
  agent_id: string;
  phonebook_id?: string;
  status: string; // running, paused, completed
  created_at: string;
  agents?: { name: string } | null;
  phonebooks?: { name: string } | null;
  total_contacts?: number;
  completed_contacts?: number;
  failed_contacts?: number;
  total_duration?: number;
  total_cost?: number;
}

export default function CampaignsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [phonebooks, setPhonebooks] = useState<Phonebook[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New Campaign Form State
  const [newCampaignName, setNewCampaignName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedPhonebookId, setSelectedPhonebookId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);

  // Stats aggregate
  const [stats, setStats] = useState({
    completed: 0,
    failed: 0,
    totalCalls: 0,
    totalDuration: 0,
    activeAgents: 0
  });

  // Get user organization and agents/phonebooks list
  const fetchOrgAndData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("profile_id", user.id)
        .single();

      if (!membership) return;
      setOrgId(membership.organization_id);

      // Fetch agents
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, name")
        .eq("organization_id", membership.organization_id);
      setAgents(agentsData || []);
      if (agentsData && agentsData.length > 0) {
        setSelectedAgentId(agentsData[0].id);
      }

      // Fetch phonebooks
      const { data: pbData } = await supabase
        .from("phonebooks")
        .select("id, name")
        .eq("organization_id", membership.organization_id);
      setPhonebooks(pbData || []);
      if (pbData && pbData.length > 0) {
        setSelectedPhonebookId(pbData[0].id);
      }
    } catch (err) {
      console.error("Error fetching core campaign dependencies:", err);
    }
  }, [supabase]);

  // Fetch campaigns and compute stats aggregates
  const fetchCampaigns = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data: campaignsData, error } = await supabase
        .from("campaigns")
        .select("*, agents(name), phonebooks(name)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      let aggregateCompleted = 0;
      let aggregateFailed = 0;
      let aggregateTotalCalls = 0;
      let aggregateDuration = 0;
      let uniqueActiveAgents = new Set<string>();

      const campaignsWithStats = await Promise.all(
        (campaignsData || []).map(async (camp) => {
          // Fetch stats from campaign_contacts
          const { count: total } = await supabase
            .from("campaign_contacts")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", camp.id);

          const { count: completed } = await supabase
            .from("campaign_contacts")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", camp.id)
            .in("status", ["completed", "answered"]);

          const { count: failed } = await supabase
            .from("campaign_contacts")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", camp.id)
            .in("status", ["failed", "no-answer", "busy", "voicemail"]);

          const { data: durationRows } = await supabase
            .from("campaign_contacts")
            .select("duration_seconds")
            .eq("campaign_id", camp.id);

          const totalDuration = (durationRows || []).reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
          const totalCost = totalDuration * (3.5 / 60);

          aggregateCompleted += completed || 0;
          aggregateFailed += failed || 0;
          aggregateTotalCalls += total || 0;
          aggregateDuration += totalDuration;
          if (camp.status === "running" && camp.agent_id) {
            uniqueActiveAgents.add(camp.agent_id);
          }

          return {
            ...camp,
            total_contacts: total || 0,
            completed_contacts: completed || 0,
            failed_contacts: failed || 0,
            total_duration: totalDuration,
            total_cost: totalCost
          };
        })
      );

      setCampaigns(campaignsWithStats);
      setStats({
        completed: aggregateCompleted,
        failed: aggregateFailed,
        totalCalls: aggregateTotalCalls,
        totalDuration: aggregateDuration,
        activeAgents: uniqueActiveAgents.size
      });
    } catch (err) {
      console.error("Error fetching campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrgAndData();
  }, [fetchOrgAndData]);

  useEffect(() => {
    if (orgId) {
      fetchCampaigns();
    }
  }, [orgId, fetchCampaigns]);

  // Start campaign dialing
  const handleStartCampaign = async (id: string) => {
    setActionLoading(id);
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "running" })
        .eq("id", id);
      if (error) throw error;
      
      // Programmatically trigger outbound dials
      await fetch("/api/campaigns/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id })
      });

      fetchCampaigns();
    } catch (err) {
      console.error("Error starting campaign:", err);
    } finally {
      setActionLoading(null);
    }
  };

  // Pause campaign
  const handlePauseCampaign = async (id: string) => {
    setActionLoading(id);
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "paused" })
        .eq("id", id);
      if (error) throw error;

      await fetch("/api/campaigns/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id })
      });

      fetchCampaigns();
    } catch (err) {
      console.error("Error pausing campaign:", err);
    } finally {
      setActionLoading(null);
    }
  };

  // Delete campaign
  const handleDeleteCampaign = async (id: string) => {
    if (!confirm("Are you sure you want to delete this outreach campaign?")) return;
    setActionLoading(id);
    try {
      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", id);
      if (error) throw error;
      fetchCampaigns();
    } catch (err) {
      console.error("Error deleting campaign:", err);
    } finally {
      setActionLoading(null);
    }
  };

  // Create Campaign
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newCampaignName.trim() || !selectedAgentId || !selectedPhonebookId) return;
    setCreating(true);

    try {
      // 1. Create Campaign
      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .insert({
          name: newCampaignName.trim(),
          agent_id: selectedAgentId,
          phonebook_id: selectedPhonebookId,
          organization_id: orgId,
          status: "paused"
        })
        .select()
        .single();

      if (campErr) throw campErr;

      // 2. Fetch contacts from selected Phonebook
      const { data: pbContacts, error: contactsErr } = await supabase
        .from("phonebook_contacts")
        .select("name, phone_number, lead_type, lead_source, lead_temperature, category")
        .eq("phonebook_id", selectedPhonebookId);

      if (contactsErr) throw contactsErr;

      // 3. Clone contacts into campaign_contacts
      if (pbContacts && pbContacts.length > 0) {
        const contactRows = pbContacts.map(c => ({
          campaign_id: campaign.id,
          name: c.name,
          phone_number: c.phone_number,
          lead_type: (c as any).lead_type || "Outbound",
          lead_source: (c as any).lead_source || "Imported",
          lead_temperature: (c as any).lead_temperature || "Cold",
          category: (c as any).category || "General Business",
          status: "pending"
        }));

        const { error: insertContactsErr } = await supabase
          .from("campaign_contacts")
          .insert(contactRows);

        if (insertContactsErr) throw insertContactsErr;
      }

      setIsCreateModalOpen(false);
      setNewCampaignName("");
      fetchCampaigns();
    } catch (err) {
      console.error("Error creating campaign:", err);
      const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
      alert("Failed to provision campaign: " + errMsg);
    } finally {
      setCreating(false);
    }
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const filteredCampaigns = campaigns.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.agents?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Calculations
  const totalPages = Math.ceil(filteredCampaigns.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Campaigns</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{campaigns.length} campaigns</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer">
            Select Date
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            + New Campaign
          </button>
        </div>
      </div>

      {/* Aggregate Stats Cards (Exactly like Screen 3) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="glass-panel p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/20 text-center space-y-1">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Completed</span>
          <div className="text-lg font-extrabold text-white flex items-center justify-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            {stats.completed}
          </div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/20 text-center space-y-1">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Failed</span>
          <div className="text-lg font-extrabold text-white flex items-center justify-center gap-1.5">
            <XCircle className="w-4 h-4 text-rose-500" />
            {stats.failed}
          </div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/20 text-center space-y-1">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Total Calls</span>
          <div className="text-lg font-extrabold text-white">{stats.totalCalls}</div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/20 text-center space-y-1">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Total Duration</span>
          <div className="text-xs font-bold text-zinc-200 mt-1">{formatDuration(stats.totalDuration)}</div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-zinc-900/60 bg-zinc-950/20 text-center space-y-1 col-span-2 md:col-span-1">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Active Agent</span>
          <div className="text-lg font-extrabold text-violet-400">{stats.activeAgents}</div>
        </div>
      </div>

      {/* Filter and search controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-zinc-950/40 border border-zinc-900 rounded-xl p-4">
        <div className="relative max-w-sm w-full">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search campaigns..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={fetchCampaigns} className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Campaigns Listing Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                <th className="px-6 py-4">Identify & Phonebook</th>
                <th className="px-6 py-4">Call Volume</th>
                <th className="px-6 py-4">Time & Duration</th>
                <th className="px-6 py-4">Economics & CPL</th>
                <th className="px-6 py-4">Time & Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                    <p className="text-zinc-500 font-mono text-xs">Loading campaigns...</p>
                  </td>
                </tr>
              ) : paginatedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-500 font-mono">
                    No outreach campaigns launched yet.
                  </td>
                </tr>
              ) : (
                paginatedCampaigns.map((camp) => (
                  <tr key={camp.id} className="hover:bg-zinc-900/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span className="font-bold text-zinc-200 block text-xs">{camp.name}</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] font-mono text-zinc-400">
                            Agent: {camp.agents?.name || "Unknown"}
                          </span>
                          {camp.phonebooks?.name && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-900 border border-zinc-850 text-[9px] font-mono text-violet-400">
                              List: {camp.phonebooks.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-zinc-200">{camp.completed_contacts}</span>
                          <span className="text-zinc-500">/</span>
                          <span className="text-zinc-400">{camp.total_contacts}</span>
                          {camp.failed_contacts !== undefined && camp.failed_contacts > 0 && (
                            <span className="text-rose-500 text-[9px] font-bold">+{camp.failed_contacts}</span>
                          )}
                        </div>
                        <div className="w-24 h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                          <div
                            className="h-full bg-violet-600 rounded-full"
                            style={{ width: `${camp.total_contacts ? ((camp.completed_contacts || 0) / camp.total_contacts) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5 font-mono">
                        <span className="text-zinc-300 block">{formatDuration(camp.total_duration || 0)}</span>
                        <span className="text-[9px] text-zinc-500 block">Billed: {formatDuration(camp.total_duration || 0)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5 font-mono">
                        <span className="text-emerald-400 block font-bold">₹{Number(camp.total_cost || 0).toFixed(2)}</span>
                        <span className="text-[9px] text-zinc-500 block">Rate: ₹3.5/min</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                          camp.status === "running"
                            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                            : camp.status === "completed"
                            ? "bg-violet-600/10 border border-violet-500/20 text-violet-400"
                            : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {camp.status}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-500 block">
                          {new Date(camp.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right space-x-1.5">
                      {camp.status === "running" ? (
                        <button
                          onClick={() => handlePauseCampaign(camp.id)}
                          disabled={actionLoading === camp.id}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartCampaign(camp.id)}
                          disabled={actionLoading === camp.id || camp.status === "completed"}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteCampaign(camp.id)}
                        disabled={actionLoading === camp.id}
                        className="p-2 rounded-lg bg-zinc-900/40 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/30 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination & Show Entries */}
      {!loading && totalPages > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-300 focus:outline-none focus:border-violet-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
            <span>per page</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentPage(idx + 1)}
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                  currentPage === idx + 1
                    ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-600/25"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {idx + 1}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                Launch New Outreach Campaign
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Target Campaign - 07/07/2026"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Select Voice Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Select Phonebook List</label>
                <select
                  value={selectedPhonebookId}
                  onChange={(e) => setSelectedPhonebookId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50"
                >
                  {phonebooks.map((pb) => (
                    <option key={pb.id} value={pb.id}>{pb.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newCampaignName.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Campaign</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

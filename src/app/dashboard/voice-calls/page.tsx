"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PhoneCall,
  ArrowLeft,
  Search,
  Plus,
  Calendar,
  Download,
  Filter,
  RefreshCw,
  Clock,
  Eye,
  Loader2,
  X,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle
} from "lucide-react";
import Link from "next/link";

interface CallLog {
  id: string;
  from_phone_number: string;
  to_phone_number: string;
  status: string;
  duration_seconds: number;
  created_at: string;
  agent_name?: string;
  campaign_name?: string;
  phonebook_name?: string;
}

interface Agent {
  id: string;
  name: string;
}

export default function VoiceCallsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // Modals / Trigger Call state
  const [isPlaceCallOpen, setIsPlaceCallOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [targetNumber, setTargetNumber] = useState("");
  const [targetName, setTargetName] = useState("");
  const [calling, setCalling] = useState(false);
  const [callSuccess, setCallSuccess] = useState(false);
  const [callError, setCallError] = useState("");

  // Fetch organization and agent configurations
  const fetchOrgAndAgents = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("profile_id", user.id)
        .single();

      if (membership) {
        setOrgId(membership.organization_id);

        // Fetch active agents for triggering calls
        const { data: agentsData } = await supabase
          .from("agents")
          .select("id, name")
          .eq("organization_id", membership.organization_id)
          .eq("active", true);

        setAgents(agentsData || []);
        if (agentsData && agentsData.length > 0) {
          setSelectedAgentId(agentsData[0].id);
        }
      }
    } catch (err) {
      console.error("Error fetching org:", err);
    }
  }, [supabase]);

  // Fetch Call Logs and resolve campaign/phonebook associations
  const fetchCallLogs = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data: logs, error } = await supabase
        .from("call_logs")
        .select("*, agents(name)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // For each log, resolve campaign/phonebook by joining campaign_contacts
      const enrichedLogs = await Promise.all(
        (logs || []).map(async (log) => {
          let campaignName = "Direct Outbound";
          let phonebookName = "Manual Test";

          if (log.to_phone_number) {
            // Find last 10 digits to match
            const cleanNum = log.to_phone_number.replace(/[^\d]/g, "").slice(-10);
            if (cleanNum.length === 10) {
              const { data: contactRow } = await supabase
                .from("campaign_contacts")
                .select("campaign_id, campaigns(name, phonebooks(name))")
                .ilike("phone_number", `%${cleanNum}%`)
                .limit(1)
                .maybeSingle();

              if (contactRow && contactRow.campaigns) {
                const camp = Array.isArray(contactRow.campaigns)
                  ? contactRow.campaigns[0]
                  : (contactRow.campaigns as any);

                if (camp) {
                  campaignName = camp.name || campaignName;
                  const pb = Array.isArray(camp.phonebooks)
                    ? camp.phonebooks[0]
                    : camp.phonebooks;
                  if (pb) {
                    phonebookName = pb.name || phonebookName;
                  }
                }
              }
            }
          }

          return {
            id: log.id,
            from_phone_number: log.from_phone_number || "Voice Aura",
            to_phone_number: log.to_phone_number || "Unknown",
            status: log.status || "completed",
            duration_seconds: log.duration_seconds || 0,
            created_at: log.created_at,
            agent_name: log.agents?.name || "Default Agent",
            campaign_name: campaignName,
            phonebook_name: phonebookName
          };
        })
      );

      setCallLogs(enrichedLogs);
    } catch (err) {
      console.error("Error fetching call logs:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrgAndAgents();
  }, [fetchOrgAndAgents]);

  useEffect(() => {
    if (orgId) {
      fetchCallLogs();
    }
  }, [orgId, fetchCallLogs]);

  // Trigger Outbound Telephony Call
  const handlePlaceCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !targetNumber.trim()) return;
    setCalling(true);
    setCallSuccess(false);
    setCallError("");

    try {
      const formatted = targetNumber.replace(/[^\d+]/g, "").trim();
      const res = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: formatted,
          name: targetName.trim() || "Test Lead",
          agentId: selectedAgentId
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCallSuccess(true);
        setTargetNumber("");
        setTargetName("");
        setTimeout(() => {
          setIsPlaceCallOpen(false);
          setCallSuccess(false);
          fetchCallLogs();
        }, 1500);
      } else {
        setCallError(data.error || "Failed to trigger outbound call.");
      }
    } catch (err) {
      console.error("Outbound trigger error:", err);
      setCallError("Could not connect to dispatch gateway.");
    } finally {
      setCalling(false);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const filteredLogs = callLogs.filter(log => {
    const matchesSearch =
      log.to_phone_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.from_phone_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" ||
      log.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area (Matches Screen 2) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <PhoneCall className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Voice calls</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Place and track voice calls</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsPlaceCallOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all cursor-pointer"
          >
            Place Call
          </button>
          <button className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer">
            Select Date
          </button>
          <button className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer">
            Export
          </button>
          <button className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer">
            Filter
          </button>
        </div>
      </div>

      {/* Toolbar Filters Panel (Matches Screen 2) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-zinc-950/40 border border-zinc-900 rounded-xl p-4">
        <div className="relative max-w-sm w-full">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search by number, call ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-550 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50"
          >
            <option value="All">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="busy">Busy</option>
            <option value="no-answer">No Answer</option>
          </select>

          <button
            onClick={fetchCallLogs}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Call Logs Table View */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                <th className="px-6 py-4">Call</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Agent Info</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4">Started</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                    <p className="text-zinc-500 font-mono text-xs">Loading call logs...</p>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500 font-mono">
                    No calls recorded matching criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-900/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        <span className="font-bold text-zinc-200 block text-xs">{log.to_phone_number}</span>
                        <span className="text-[10px] text-zinc-550 block font-mono">From: {log.from_phone_number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-400 uppercase">
                        Campaign
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        <span className="font-semibold text-zinc-300 block">{log.agent_name}</span>
                        <div className="flex gap-1.5 text-[9px] text-zinc-550 font-mono">
                          <span className="hover:text-violet-400 transition-colors cursor-pointer">{log.campaign_name}</span>
                          <span>•</span>
                          <span className="hover:text-violet-400 transition-colors cursor-pointer">{log.phonebook_name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        log.status === "completed" || log.status === "answered"
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {log.status === "completed" || log.status === "answered" ? "Completed" : log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                        {formatDuration(log.duration_seconds)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-zinc-500">
                      {new Date(log.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}, {new Date(log.created_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true
                      })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href="/dashboard/logs"
                        className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 font-semibold cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PLACE CALL POPUP MODAL */}
      {isPlaceCallOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-violet-400" />
                Place Outbound Voice Call
              </h2>
              <button onClick={() => setIsPlaceCallOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePlaceCall} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Assign AI Agent</label>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +91XXXXXXXXXX"
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-violet-500/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Lead/Customer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Abhinav"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-655 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>

              {callSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>Outbound call triggered successfully!</span>
                </div>
              )}

              {callError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-400 text-xs font-semibold">
                  <span>{callError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsPlaceCallOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={calling || !targetNumber.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {calling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Trigger Outbound Call</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

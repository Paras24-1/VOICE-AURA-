"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Mic,
  Plus,
  Search,
  Globe2,
  Trash2,
  Settings,
  Zap,
  Play,
  Volume2,
  ShieldCheck,
  Clock,
  FileText,
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  PhoneCall
} from "lucide-react";
import WebRTCCallModal from "@/components/WebRTCCallModal";

interface VoiceAgent {
  id: string;
  name: string;
  language: string;
  lang_code: string;
  voice_profile: string;
  active: boolean;
  system_prompt: string;
  avg_latency: number;
  avatar_url?: string;
  description?: string;
}

interface CallLog {
  id: string;
  agent_id: string | null;
  agents?: { name: string } | null;
  from_phone_number: string | null;
  to_phone_number: string | null;
  duration_seconds: number;
  status: string;
  cost: number;
  created_at: string;
  transcript: string | null;
}

export default function AgentsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCall, setActiveCall] = useState<{ id: string; name: string } | null>(null);
  const supabase = createClient();

  const [agents, setAgents] = useState<VoiceAgent[]>([]);
  const [loading, setLoading] = useState(true);

  // Call Logs state
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [logsSearchTerm, setLogsSearchTerm] = useState("");

  const fetchAgents = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id)
        .single();
      if (!membership) {
        setAgents([]);
        return;
      }
      const { data: agentsData, error } = await supabase
        .from('agents')
        .select('id, name, language, lang_code, voice_profile, active, avatar_url, description, system_prompt, avg_latency')
        .eq('organization_id', membership.organization_id);
      if (error) {
        console.error('Fetch agents error:', error);
      }
      setAgents(agentsData ?? []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchCallLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id)
        .single();
      if (!membership) {
        setCallLogs([]);
        return;
      }
      const { data: logs, error } = await supabase
        .from('call_logs')
        .select('*, agents(name)')
        .eq('organization_id', membership.organization_id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        console.error('Fetch call logs error:', error);
      }
      setCallLogs(logs ?? []);
    } catch (err) {
      console.error('Failed to fetch call logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchAgents();
      fetchCallLogs();
    });
  }, [fetchAgents, fetchCallLogs]);

  const toggleAgent = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id)
        .single();
      if (!membership) return;
      const agent = agents.find(a => a.id === id);
      if (!agent) return;
      await supabase
        .from('agents')
        .update({ active: !agent.active })
        .eq('id', id)
        .eq('organization_id', membership.organization_id);
      await fetchAgents();
    } catch (err) {
      console.error('Failed to toggle agent:', err);
    }
  };

  const deleteAgent = async (id: string) => {
    if (confirm("Are you sure you want to deprecate and delete this AI voice agent container?")) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: membership } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('profile_id', user.id)
          .single();
        if (!membership) return;
        await supabase
          .from('agents')
          .delete()
          .eq('id', id)
          .eq('organization_id', membership.organization_id);
        await fetchAgents();
      } catch (err) {
        console.error('Failed to delete agent:', err);
      }
    }
  };

  const filteredAgents = agents.filter((agent) =>
    agent.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    agent.language?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (agent.voice_profile || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Container */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
            Voice Agent Node Registry
          </span>
          <h1 className="font-heading text-3xl font-extrabold text-white tracking-tight mt-2.5">
            AI Voice Agents
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Build, test, and instantly deploy ultra-realistic multilingual conversational AI agents in seconds.
          </p>
        </div>

        {/* Add Agent Button */}
        <Link
          href="/dashboard/agents/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Provision New Agent
        </Link>
      </div>

      {/* Control Filters and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-zinc-950/60 border border-zinc-900 rounded-xl p-4">
        {/* Search */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search voice agents by name, primary language, voice profile..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        {/* Status Count Panel */}
        <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 border-t border-zinc-900 pt-3 sm:pt-0 sm:border-t-0 sm:border-l sm:pl-6 border-zinc-800">
          <div>
            Total Pools: <span className="text-zinc-200 font-bold">{agents.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Active:{" "}
            <span className="text-emerald-400 font-bold">
              {agents.filter((a) => a.active).length}
            </span>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center h-32">
          <span className="text-zinc-400 animate-pulse text-sm">Loading agents...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 glass-panel rounded-2xl border border-zinc-800 space-y-3">
          <Mic className="w-8 h-8 text-zinc-600" />
          <p className="text-sm text-zinc-500">No agents yet. Provision your first AI voice agent!</p>
          <Link
            href="/dashboard/agents/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Agent
          </Link>
        </div>
      )}

      {/* Agents Grid List */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              className={`glass-panel glass-panel-hover rounded-2xl p-6 border relative overflow-hidden flex flex-col justify-between min-h-[300px] ${
                agent.active ? "border-zinc-800" : "border-zinc-900 bg-zinc-950/30 opacity-75"
              }`}
            >
              {/* Top Info Area */}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  {/* Active Indicator & Avatar */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-violet-500/30 flex items-center justify-center bg-zinc-900">
                      {agent.avatar_url ? (
                        <img src={agent.avatar_url} alt={agent.name} className="w-full h-full object-cover" />
                      ) : (
                        <Mic className="w-5 h-5 text-violet-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-heading font-extrabold text-sm text-zinc-100 line-clamp-1">
                        {agent.name}
                      </h3>
                      <span className="text-[10px] text-zinc-500 font-mono block mt-0.5">
                        ID: {agent.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  {/* Status Toggle Switch */}
                  <button
                    onClick={() => toggleAgent(agent.id)}
                    className={`w-10 h-6 rounded-full p-1 transition-colors relative cursor-pointer outline-none ${
                      agent.active ? "bg-emerald-500" : "bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        agent.active ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Language and Voice Badge */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-[10px] font-mono text-zinc-300">
                    <Globe2 className="w-3 h-3 text-violet-400" />
                    {agent.language} ({agent.lang_code || "—"})
                  </span>
                  {agent.voice_profile && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-[10px] font-mono text-zinc-300">
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      {agent.voice_profile.split(" - ")[0]}
                    </span>
                  )}
                </div>

                {/* System instructions preview */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">
                    Instruction Set
                  </span>
                  <p className="text-xs text-zinc-400 leading-relaxed italic bg-zinc-950/50 p-3 rounded-lg border border-zinc-900 line-clamp-2">
                    &ldquo;{agent.system_prompt}&rdquo;
                  </p>
                  {agent.description && (
                    <p className="mt-2 text-xs text-zinc-300 italic">
                      {agent.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Bottom Actions Area */}
              <div className="border-t border-zinc-900/60 pt-4 mt-6 flex items-center justify-between">
                {/* Latency badge */}
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[11px] font-mono text-zinc-400">
                    Avg Latency: <span className="text-zinc-200 font-bold">{agent.avg_latency || 0}ms</span>
                  </span>
                </div>

                {/* Core buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setActiveCall({ id: agent.id, name: agent.name })}
                    title="Test Live Call stream"
                    className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <Link
                    href={`/dashboard/agents/${agent.id}`}
                    title="Configure Agent Settings"
                    className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    onClick={() => deleteAgent(agent.id)}
                    title="Deprovision Container"
                    className="p-2 rounded-lg bg-zinc-900/40 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/30 text-zinc-500 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Call Logs & Transcripts Section */}
      <div className="space-y-6 pt-6 border-t border-zinc-900">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
              Agent Call Logs & Free Transcripts
            </span>
            <h2 className="font-heading text-xl font-bold text-white tracking-tight mt-2.5">
              Recent Call Logs
            </h2>
            <p className="text-xs text-zinc-500">
              Select any call to view its full conversation transcript and metrics in real-time.
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <button
              onClick={fetchCallLogs}
              className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-2 text-xs cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? "animate-spin" : ""}`} />
              <span>Refresh Logs</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Logs Table */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                placeholder="Search call logs by agent, phone, status or transcript text..."
                value={logsSearchTerm}
                onChange={(e) => setLogsSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Agent Name / Caller</th>
                      <th className="px-6 py-4">Duration</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Time</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/60 text-xs">
                    {logsLoading ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                          <p className="text-zinc-500 font-mono text-xs">Loading call logs from database...</p>
                        </td>
                      </tr>
                    ) : callLogs.filter(log => 
                      (log.agents?.name || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                      (log.from_phone_number || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                      (log.status || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                      (log.transcript || "").toLowerCase().includes(logsSearchTerm.toLowerCase())
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-zinc-500 font-mono">
                          <Activity className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                          <p>No call logs found matching your filter.</p>
                          <p className="text-[10px] mt-1 text-zinc-600">Calls will appear here once your agents receive calls.</p>
                        </td>
                      </tr>
                    ) : (
                      callLogs
                        .filter(log => 
                          (log.agents?.name || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                          (log.from_phone_number || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                          (log.status || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
                          (log.transcript || "").toLowerCase().includes(logsSearchTerm.toLowerCase())
                        )
                        .map((log) => (
                          <tr 
                            key={log.id} 
                            onClick={() => setSelectedCall(log)}
                            className={`hover:bg-zinc-900/20 transition-colors cursor-pointer ${selectedCall?.id === log.id ? "bg-violet-500/5" : ""}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center font-bold text-[10px] text-violet-300">
                                  {(log.agents?.name || "??").substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <span className="font-semibold text-zinc-200 block">{log.agents?.name || "Unknown Agent"}</span>
                                  <span className="text-[10px] text-zinc-500 font-mono">{log.from_phone_number || log.id.substring(0, 8)}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 font-mono text-zinc-400">{formatDuration(log.duration_seconds)}</td>
                            <td className="px-6 py-4">
                              {log.status === "completed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[9px] uppercase">
                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Ended
                                </span>
                              ) : log.status === "failed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono text-[9px] uppercase">
                                  <XCircle className="w-2.5 h-2.5" /> Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-[9px] uppercase">
                                  <AlertTriangle className="w-2.5 h-2.5" /> {log.status}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-zinc-500 font-mono text-[10px]">{formatTime(log.created_at)}</td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCall(log);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors font-medium text-[11px] cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Transcript / Inspector Card */}
          <div className="space-y-4">
            <h3 className="font-heading text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              Conversation Inspector
            </h3>

            {selectedCall ? (
              <div className="glass-panel rounded-2xl p-6 border border-violet-500/20 bg-gradient-to-b from-zinc-950 to-violet-950/5 space-y-5 flex flex-col justify-between h-[500px] overflow-hidden">
                <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                  <div className="flex items-start gap-3 border-b border-zinc-900 pb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center font-bold text-sm text-violet-300">
                      {(selectedCall.agents?.name || "??").substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-200 text-sm">{selectedCall.agents?.name || "Unknown Agent"}</h4>
                      <p className="text-[10px] font-mono text-zinc-500 mt-0.5">ID: {selectedCall.id.slice(0, 18)}...</p>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-900/60 text-[11px]">
                    <div>
                      <span className="text-[9px] font-mono text-zinc-500 uppercase block">Duration</span>
                      <span className="font-semibold text-zinc-300 block mt-0.5">{formatDuration(selectedCall.duration_seconds)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-zinc-500 uppercase block">Caller / Node</span>
                      <span className="font-semibold text-zinc-300 block mt-0.5 truncate">{selectedCall.from_phone_number || "WebRTC Client"}</span>
                    </div>
                  </div>

                  {/* Transcript Bubbles */}
                  <div className="space-y-3 pt-2">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">
                      Chat Transcript (Free AI logging)
                    </span>
                    <div className="space-y-3 pr-1">
                      {parseTranscript(selectedCall.transcript).length === 0 ? (
                        <p className="text-zinc-600 text-xs italic text-center py-6">No transcript text captured during this call.</p>
                      ) : (
                        parseTranscript(selectedCall.transcript).map((bubble) => {
                          if (bubble.role === "user") {
                            return (
                              <div key={bubble.id} className="flex flex-col items-end space-y-1">
                                <span className="text-[9px] font-mono text-zinc-600">User</span>
                                <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-violet-600/10 border border-violet-500/20 p-3 text-xs text-violet-200 leading-relaxed">
                                  {bubble.text}
                                </div>
                              </div>
                            );
                          }
                          if (bubble.role === "agent") {
                            return (
                              <div key={bubble.id} className="flex flex-col items-start space-y-1">
                                <span className="text-[9px] font-mono text-zinc-600">AI Agent</span>
                                <div className="max-w-[85%] rounded-2xl rounded-tl-none bg-zinc-900 border border-zinc-800 p-3 text-xs text-zinc-300 leading-relaxed">
                                  {bubble.text}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={bubble.id} className="text-center py-1">
                              <span className="inline-block px-2.5 py-0.5 rounded bg-zinc-900/60 text-[9px] font-mono text-zinc-500 leading-normal border border-zinc-900">
                                {bubble.text}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedCall(null)}
                  className="w-full text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded-lg py-2 hover:bg-zinc-900 transition-colors flex-shrink-0 cursor-pointer"
                >
                  Close Inspector
                </button>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl border border-zinc-800 text-center py-20 px-6 space-y-4 h-[500px] flex flex-col justify-center items-center">
                <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
                  <Activity className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-semibold text-zinc-300 text-sm">No Call Selected</h4>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[200px] mx-auto">
                    Click "Inspect" or select any row in the call logs table to view conversation details.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Setup Guide / Alert Info Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-950 to-violet-950/10 flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400 flex-shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-heading font-extrabold text-sm text-zinc-200">
            Automated WebRTC & Telephony Provisioning
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed mt-1 max-w-3xl">
            Every agent provisioned is automatically configured with a worldwide WebRTC gateway endpoint. Once saved, switch to the <strong>Deployment</strong> tab to generate your custom copy-paste script or bind the agent directly to international Twilio SIP trunks.
          </p>
        </div>
      </div>

      {/* WebRTC Live Call Modal */}
      {activeCall && (
        <WebRTCCallModal
          agentId={activeCall.id}
          agentName={activeCall.name}
          onClose={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}

// Formatting and Parsing helper functions
const formatTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
};

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

const parseTranscript = (transcriptText: string | null) => {
  if (!transcriptText) return [];
  return transcriptText.split('\n').map((line, idx) => {
    const match = line.match(/^\[(USER|AGENT|SYSTEM)\]:\s*(.*)$/i);
    if (match) {
      return { id: idx, role: match[1].toLowerCase(), text: match[2] };
    }
    return { id: idx, role: 'system', text: line };
  });
};

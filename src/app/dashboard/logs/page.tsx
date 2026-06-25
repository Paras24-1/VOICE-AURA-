"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  FileText,
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Search,
  MessageSquare
} from "lucide-react";

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
  recording_url?: string | null;
}

export default function CallLogsPage() {
  const supabase = createClient();
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [logsSearchTerm, setLogsSearchTerm] = useState("");

  const fetchCallLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("profile_id", user.id)
        .single();
        
      if (!membership) {
        setCallLogs([]);
        return;
      }

      // Get the real total count (lightweight, no row data)
      const { count } = await supabase
        .from("call_logs")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id);
      setTotalCount(count ?? 0);

      // Fetch up to 500 most recent logs for the table
      const { data: logs, error } = await supabase
        .from("call_logs")
        .select("*, agents(name)")
        .eq("organization_id", membership.organization_id)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Fetch call logs error:", error);
      }
      setCallLogs(logs ?? []);
    } catch (err) {
      console.error("Failed to fetch call logs:", err);
    } finally {
      setLogsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchCallLogs();
    });
  }, [fetchCallLogs]);

  const filteredLogs = callLogs.filter(log => 
    (log.agents?.name || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
    (log.from_phone_number || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
    (log.status || "").toLowerCase().includes(logsSearchTerm.toLowerCase()) ||
    (log.transcript || "").toLowerCase().includes(logsSearchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
            Node History Registry
          </span>
          <h1 className="font-heading text-3xl font-extrabold text-white tracking-tight mt-2.5">
            Call Logs & Transcripts
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Browse through incoming calls and read free, real-time AI conversation transcripts.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {!logsLoading && (
            <span className="text-xs font-mono text-zinc-400 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-xl">
              Total: <span className="text-violet-400 font-bold">{totalCount.toLocaleString()}</span> calls
            </span>
          )}
          <button
            onClick={fetchCallLogs}
            className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-2 text-xs cursor-pointer"
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
              placeholder="Search call logs by agent name, caller ID, status, or transcript..."
              value={logsSearchTerm}
              onChange={(e) => setLogsSearchTerm(e.target.value)}
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-zinc-950/80 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
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
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-500 font-mono">
                        <Activity className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                        <p>No call logs found.</p>
                        <p className="text-[10px] mt-1 text-zinc-600">Calls will appear here once your agents process voice streams.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
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
            <div className="glass-panel rounded-2xl p-6 border border-violet-500/20 bg-gradient-to-b from-zinc-950 to-violet-950/5 space-y-5 flex flex-col justify-between h-[500px] overflow-hidden animate-in slide-in-from-right-4 duration-350">
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

                {/* Call Recording Playback */}
                {selectedCall.recording_url && (
                  <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-900/60 space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block tracking-wider">
                      Call Recording Playback
                    </span>
                    <audio
                      src={selectedCall.recording_url}
                      controls
                      className="w-full h-8 rounded-lg outline-none bg-transparent"
                    />
                  </div>
                )}

                {/* Transcript Bubbles */}
                <div className="space-y-3 pt-2">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                    Conversation (Free AI Transcribing)
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
  return transcriptText.split("\n").map((line, idx) => {
    const match = line.match(/^\[(USER|AGENT|SYSTEM)\]:\s*(.*)$/i);
    if (match) {
      return { id: idx, role: match[1].toLowerCase(), text: match[2] };
    }
    return { id: idx, role: "system", text: line };
  });
};

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TrendingUp, Clock, Activity, Search,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2
} from "lucide-react";

interface CallLog {
  id: string;
  agent_id: string | null;
  agents?: { name: string } | null;
  direction?: string;
  from_phone_number: string | null;
  to_phone_number: string | null;
  duration_seconds: number;
  status: string;
  cost: number;
  created_at: string;
  transcript: string | null;
}

interface Stats {
  totalCalls: number;
  totalMinutes: number;
  minutesLimit: number;
  avgDuration: number;
  totalCost: number;
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState("7d");
  const [searchTerm, setSearchTerm] = useState("");
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCalls: 0, totalMinutes: 0, minutesLimit: 1000, avgDuration: 0, totalCost: 0 });
  const [loading, setLoading] = useState(true);


  const supabase = createClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Get current user's organization
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("profile_id", user.id)
        .single();

      if (!membership) return;
      const currentOrgId = membership.organization_id;


      // Determine time filter
      const now = new Date();
      const daysBack = timeRange === "24h" ? 1 : timeRange === "7d" ? 7 : 30;
      const since = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      // Fetch call logs with agent names joined
      const { data: logs } = await supabase
        .from("call_logs")
        .select("*, agents(name)")
        .eq("organization_id", currentOrgId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);

      // Fetch all call logs for exact duration and cost calculation
      const { data: allLogsForBilling } = await supabase
        .from("call_logs")
        .select("duration_seconds, cost")
        .eq("organization_id", currentOrgId);

      const logsArr = logs || [];
      const totalDurationSeconds = (allLogsForBilling || []).reduce((sum: number, l) => sum + (l.duration_seconds || 0), 0);
      const totalMinutes = totalDurationSeconds / 60;
      const totalCost = (allLogsForBilling || []).reduce((sum: number, l) => sum + (Number(l.cost) || 0), 0);
      const avgDuration = logsArr.length > 0
        ? Math.round(logsArr.reduce((s: number, l: CallLog) => s + (l.duration_seconds || 0), 0) / logsArr.length)
        : 0;

      const minutesLimit = 600; // 600 free minutes limit

      setCallLogs(logsArr);
      setStats({
        totalCalls: logsArr.length,
        totalMinutes: Number(totalMinutes.toFixed(2)),
        minutesLimit,
        avgDuration,
        totalCost: Number(totalCost.toFixed(2))
      });
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [timeRange, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchData();
    });
  }, [fetchData]);

  const filtered = callLogs.filter(l =>
    (l.agents?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.transcript || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.from_phone_number || "").includes(searchTerm)
  );

  const percentUsed = Math.min((stats.totalMinutes / stats.minutesLimit) * 100, 100);

  const statusBadge = (status: string) => {
    if (status === "completed") return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[9px] uppercase">
        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Ended
      </span>
    );
    if (status === "active") return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[9px] font-bold uppercase animate-pulse">
        <span className="w-1 h-1 rounded-full bg-emerald-400" /> Live
      </span>
    );
    if (status === "failed") return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono text-[9px] uppercase">
        <XCircle className="w-2.5 h-2.5" /> Failed
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-[9px] uppercase">
        <AlertTriangle className="w-2.5 h-2.5" /> {status}
      </span>
    );
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };



  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
            Realtime Analytics Node
          </span>
          <h1 className="font-heading text-3xl font-extrabold text-white tracking-tight mt-2.5">
            Voice Stream Overview
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Live data from your Supabase database. All calls and usage are real.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800/80">
            {["24h", "7d", "30d"].map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium font-mono uppercase transition-colors ${timeRange === r ? "bg-zinc-900 text-violet-400 border border-zinc-800" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-2 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden md:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Active Calls */}
        <div className="glass-panel rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between h-44 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Total Calls</span>
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-zinc-600" /> : <Activity className="w-4 h-4 text-violet-400" />}
          </div>
          <div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl font-heading font-extrabold text-white text-glow">
                {loading ? "—" : stats.totalCalls}
              </span>
              <span className="text-xs text-zinc-500 font-mono">calls ({timeRange})</span>
            </div>
            <div className="flex items-end gap-1 h-8 mt-4">
              {[0.4, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.6, 0.9, 0.3, 0.5, 0.7, 0.2, 0.6, 0.4].map((h, i) => (
                <div
                  key={i}
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
                  className="w-[3px] bg-gradient-to-t from-violet-600 via-indigo-500 to-cyan-400 rounded-full animate-[pulse_1s_infinite_alternate]"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Minutes Gauge */}
        <div className="glass-panel rounded-2xl p-6 flex items-center gap-6 h-44 border border-zinc-800">
          <div className="relative w-24 h-24 flex items-center justify-center flex-shrink-0">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle cx="48" cy="48" r="40" className="stroke-zinc-800" strokeWidth="7" fill="transparent" />
              <circle
                cx="48" cy="48" r="40"
                className="stroke-violet-500"
                strokeWidth="7" fill="transparent"
                strokeDasharray={251.2}
                strokeDashoffset={loading ? 251.2 : 251.2 - (251.2 * percentUsed) / 100}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute text-center">
              <span className="text-lg font-heading font-extrabold text-white">
                {loading ? "—" : `${Math.round(percentUsed)}%`}
              </span>
              <p className="text-[9px] text-zinc-500 font-mono uppercase">Quota</p>
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-between h-full py-1">
            <div>
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider block">Minutes Used</span>
              <span className="text-2xl font-heading font-extrabold text-white block mt-1">
                {loading ? "—" : stats.totalMinutes.toLocaleString()}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400">
              {stats.totalCost > 0 ? (
                <span className="text-emerald-400 font-semibold font-mono">
                  Charges: ₹{stats.totalCost.toFixed(2)}
                </span>
              ) : (
                <>Of <span className="font-mono text-zinc-300 font-bold">{stats.minutesLimit.toLocaleString()}</span> free mins.</>
              )}
            </div>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between h-44 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Avg Call Duration</span>
            <Clock className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <div className="text-4xl font-heading font-extrabold text-white text-glow">
              {loading ? "—" : formatDuration(stats.avgDuration)}
            </div>
            <p className="text-xs text-zinc-400 mt-2 font-mono">per completed session</p>
          </div>
        </div>

      </div>

      {/* Call Logs Table */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-bold text-white tracking-tight">Call Logs</h2>
            <p className="text-xs text-zinc-500">Live call history from your database.</p>
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search by agent name, ID, phone number, or transcript..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Agent / Caller</th>
                  <th className="px-6 py-4">Duration</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                      <p className="text-zinc-500 font-mono text-xs">Loading call logs from database...</p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-zinc-500 font-mono">
                      <Activity className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                      <p>No call logs found.</p>
                      <p className="text-[10px] mt-1 text-zinc-600">Calls will appear here once your voice agent is deployed and receives calls.</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-900/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center font-bold text-[10px] text-violet-300">
                            {(log.agents?.name || log.from_phone_number || "??").substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-semibold text-zinc-200 block">{log.agents?.name || "Unknown Agent"}</span>
                            <span className="text-[10px] text-zinc-500 font-mono">{log.from_phone_number || log.id.substring(0, 8)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-zinc-400">{formatDuration(log.duration_seconds)}</td>
                      <td className="px-6 py-4">{statusBadge(log.status)}</td>
                      <td className="px-6 py-4 text-zinc-500 font-mono text-[10px] text-right">{formatTime(log.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const formatTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
};

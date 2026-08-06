"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart3,
  ArrowLeft,
  TrendingUp,
  Clock,
  DollarSign,
  Users,
  Activity,
  CheckCircle,
  XCircle,
  HelpCircle,
  Loader2
} from "lucide-react";
import Link from "next/link";

interface CallMetrics {
  totalCalls: number;
  totalDuration: number;
  totalCost: number;
  avgDuration: number;
  avgCostPerCall: number;
  answeredCount: number;
  failedCount: number;
}

export default function CampaignAnalyticsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics>({
    totalCalls: 0,
    totalDuration: 0,
    totalCost: 0,
    avgDuration: 0,
    avgCostPerCall: 0,
    answeredCount: 0,
    failedCount: 0
  });
  const [loading, setLoading] = useState(true);

  // Fetch organization
  const fetchOrg = useCallback(async () => {
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
      }
    } catch (err) {
      console.error("Error fetching org:", err);
    }
  }, [supabase]);

  // Fetch call logs and calculate metrics
  const fetchMetrics = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data: logs, error } = await supabase
        .from("call_logs")
        .select("duration_seconds, cost, status")
        .eq("organization_id", orgId);

      if (error) throw error;

      const totalCalls = logs?.length || 0;
      const totalDuration = (logs || []).reduce((sum, log) => sum + (log.duration_seconds || 0), 0);
      const totalCost = (logs || []).reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
      const answeredCount = (logs || []).filter(log => log.status === "completed" || log.status === "answered").length;
      const failedCount = totalCalls - answeredCount;

      setMetrics({
        totalCalls,
        totalDuration,
        totalCost,
        avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
        avgCostPerCall: totalCalls > 0 ? Number((totalCost / totalCalls).toFixed(2)) : 0,
        answeredCount,
        failedCount
      });
    } catch (err) {
      console.error("Error fetching analytics metrics:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchMetrics();
    }
  }, [orgId, fetchMetrics]);

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Campaign Analytics</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Real-time economics, CPL & call analytics</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-violet-500 mb-2" />
          <span className="text-xs text-zinc-500 font-mono">Aggregating real-time stats...</span>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Main Stats Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2 bg-gradient-to-b from-zinc-950 to-violet-950/5">
              <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">Billed Economics</span>
              <div className="text-2xl font-extrabold text-white flex items-baseline gap-1">
                <span className="text-xs text-zinc-400 font-normal">₹</span>
                {metrics.totalCost.toFixed(2)}
              </div>
              <span className="text-[9px] text-emerald-400 block font-bold">Rate: ₹3.5/min (pay-go)</span>
            </div>

            <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">Avg CPC (Per Call Cost)</span>
              <div className="text-2xl font-extrabold text-white flex items-baseline gap-1">
                <span className="text-xs text-zinc-400 font-normal">₹</span>
                {metrics.avgCostPerCall}
              </div>
              <span className="text-[9px] text-zinc-500 block">Calculated from total runtime</span>
            </div>

            <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">Billed Call Duration</span>
              <div className="text-sm font-extrabold text-zinc-200 mt-2">{formatDuration(metrics.totalDuration)}</div>
              <span className="text-[9px] text-zinc-500 block">Total connection runtime</span>
            </div>

            <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">Answer Rate</span>
              <div className="text-2xl font-extrabold text-violet-400 mt-1">
                {metrics.totalCalls > 0 ? ((metrics.answeredCount / metrics.totalCalls) * 100).toFixed(1) : "0"}%
              </div>
              <span className="text-[9px] text-zinc-500 block">{metrics.answeredCount} answered of {metrics.totalCalls} calls</span>
            </div>
          </div>

          {/* Detailed Performance Charts Panel */}
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <Activity className="w-4 h-4 text-violet-400" />
              Volume Breakdown & Latency
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <span className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">Calling Breakdown</span>
                
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">Answered Calls</span>
                      <span className="text-emerald-400 font-bold">{metrics.answeredCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${metrics.totalCalls > 0 ? (metrics.answeredCount / metrics.totalCalls) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">Failed / No Answer</span>
                      <span className="text-rose-500 font-bold">{metrics.failedCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-rose-500 rounded-full"
                        style={{ width: `${metrics.totalCalls > 0 ? (metrics.failedCount / metrics.totalCalls) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Latency information */}
              <div className="border border-zinc-900 rounded-xl p-5 bg-zinc-950/20 flex flex-col justify-between">
                <div className="space-y-2">
                  <h4 className="font-bold text-xs text-zinc-300">Average Call Duration</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Average call duration per conversation is currently <strong className="text-zinc-200 font-mono">{metrics.avgDuration} seconds</strong>.
                  </p>
                </div>
                <div className="text-[10px] text-zinc-650 italic mt-4">
                  Data aggregated across all historical outbound and inbound calls connected to your organization.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

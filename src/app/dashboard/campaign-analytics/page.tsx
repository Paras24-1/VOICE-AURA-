"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart3,
  ArrowLeft,
  RefreshCw,
  Clock,
  CheckCircle,
  Users,
  ShieldAlert,
  Loader2,
  FileText
} from "lucide-react";
import Link from "next/link";

interface RulePerformance {
  id: string;
  name: string;
  totalLeads: number;
  totalCalls: number;
  successRate: number;
}

export default function CampaignAnalyticsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rulesPerformance, setRulesPerformance] = useState<RulePerformance[]>([]);

  // Summary Metrics matching Screen 1 structure
  const [metrics, setMetrics] = useState({
    activeRules: 0,
    totalLeads: 0,
    totalCalls: 0,
    successRate: 0
  });

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

  // Fetch performance metrics
  const fetchPerformance = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      // Fetch total calls & leads from campaign contacts
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, status")
        .eq("organization_id", orgId);

      const campaignIds = (campaigns || []).map(c => c.id);

      if (campaignIds.length > 0) {
        const { data: contacts, error: contactsErr } = await supabase
          .from("campaign_contacts")
          .select("status, duration_seconds")
          .in("campaign_id", campaignIds);

        if (!contactsErr && contacts) {
          const totalLeads = contacts.length;
          const completedCount = contacts.filter(c => c.status === "completed" || c.status === "answered").length;
          const successRate = totalLeads > 0 ? Math.round((completedCount / totalLeads) * 100) : 0;

          // Simple dynamic metric mappings
          setMetrics({
            activeRules: campaigns?.filter(c => c.status === "running").length || 0,
            totalLeads,
            totalCalls: totalLeads, // Outbound outreach matching
            successRate
          });
        }
      } else {
        setMetrics({
          activeRules: 0,
          totalLeads: 0,
          totalCalls: 0,
          successRate: 0
        });
      }
    } catch (err) {
      console.error("Error aggregating performance details:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchPerformance();
    }
  }, [orgId, fetchPerformance]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area (Matches Screen 1) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Campaign Analytics</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Overview of all campaign rule performance</p>
          </div>
        </div>

        <button
          onClick={fetchPerformance}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-900 text-zinc-450 hover:text-white transition-all cursor-pointer text-xs font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* KPI metrics cards grid (Matches Screen 1) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Campaign Rules */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2 bg-zinc-950/20">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
            <BarChart3 className="w-3.5 h-3.5 text-violet-400" />
            Campaign Rules
          </div>
          <div className="text-2xl font-extrabold text-white">{metrics.activeRules}</div>
          <span className="text-[9px] text-emerald-400 block font-bold">{metrics.activeRules} active</span>
        </div>

        {/* Total Leads */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2 bg-zinc-950/20">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
            <Users className="w-3.5 h-3.5 text-violet-400" />
            Total Leads
          </div>
          <div className="text-2xl font-extrabold text-white">{metrics.totalLeads}</div>
          <span className="text-[9px] text-zinc-500 block">across all rules</span>
        </div>

        {/* Total Calls */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2 bg-zinc-950/20">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-violet-400" />
            Total Calls
          </div>
          <div className="text-2xl font-extrabold text-white">{metrics.totalCalls}</div>
          <span className="text-[9px] text-zinc-500 block">{metrics.totalCalls > 0 ? "leads dialed" : "no leads"}</span>
        </div>

        {/* Success Rate */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-2 bg-zinc-950/20">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            Success Rate
          </div>
          <div className="text-2xl font-extrabold text-white">
            {metrics.successRate > 0 ? `${metrics.successRate}%` : "—"}
          </div>
          <span className="text-[9px] text-zinc-500 block">{metrics.successRate > 0 ? "completed" : "0 completed"}</span>
        </div>
      </div>

      {/* Lead Status Distribution (Matches Screen 1 Layout) */}
      <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4">
        <h3 className="font-bold text-xs font-mono text-zinc-500 uppercase tracking-wider">Lead Status Distribution</h3>
        
        {metrics.totalLeads > 0 ? (
          <div className="h-6 rounded-full bg-zinc-900/60 overflow-hidden relative flex">
            <div className="h-full bg-violet-600" style={{ width: `${metrics.successRate}%` }} title="Answered" />
            <div className="h-full bg-zinc-800" style={{ width: `${100 - metrics.successRate}%` }} title="No Answer / Pending" />
          </div>
        ) : (
          <div className="h-2.5 rounded-full bg-zinc-900/40 w-full" />
        )}
      </div>

      {/* Details Row: Disposition Breakdown & Retry Effectiveness */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Call Disposition Breakdown */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4 min-h-[160px] flex flex-col justify-between">
          <h3 className="font-bold text-xs font-mono text-zinc-500 uppercase tracking-wider">Call Disposition Breakdown</h3>
          <p className="text-xs text-zinc-600 font-mono italic">No call data yet.</p>
        </div>

        {/* Retry Effectiveness */}
        <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4 min-h-[160px] flex flex-col justify-between">
          <h3 className="font-bold text-xs font-mono text-zinc-500 uppercase tracking-wider">Retry Effectiveness</h3>
          <p className="text-xs text-zinc-600 font-mono italic">No completed leads yet.</p>
        </div>
      </div>

      {/* Per-Rule Performance Section (Matches Screen 1) */}
      <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4">
        <h3 className="font-bold text-xs font-mono text-zinc-500 uppercase tracking-wider">Per-Rule Performance</h3>
        
        <div className="border border-zinc-900/60 rounded-xl p-8 text-center text-xs text-zinc-600 font-mono italic">
          No campaign rules found.
        </div>
      </div>
    </div>
  );
}

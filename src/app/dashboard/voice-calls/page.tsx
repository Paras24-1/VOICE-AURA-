"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PhoneCall,
  ArrowLeft,
  Mic,
  Play,
  Volume2,
  HelpCircle,
  Loader2,
  CheckCircle
} from "lucide-react";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
  language: string;
  voice_profile: string;
}

export default function VoiceCallsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [targetNumber, setTargetNumber] = useState("");
  const [targetName, setTargetName] = useState("");
  
  const [calling, setCalling] = useState(false);
  const [callSuccess, setCallSuccess] = useState(false);
  const [callError, setCallError] = useState("");

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

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("id, name, language, voice_profile")
        .eq("organization_id", orgId)
        .eq("active", true);

      if (error) throw error;
      setAgents(data || []);
      if (data && data.length > 0) {
        setSelectedAgentId(data[0].id);
      }
    } catch (err) {
      console.error("Error fetching active agents:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchAgents();
    }
  }, [orgId, fetchAgents]);

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
          name: targetName.trim() || "Test User",
          agentId: selectedAgentId
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCallSuccess(true);
        setTargetNumber("");
        setTargetName("");
      } else {
        setCallError(data.error || "Failed to trigger outbound Vobiz call.");
      }
    } catch (err) {
      console.error("Outbound call crash:", err);
      setCallError("Could not connect to voice dispatch server.");
    } finally {
      setCalling(false);
    }
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
            <PhoneCall className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Voice Calls</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Simulate outbound phone calling over Vobiz SIP trunk</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Calling trigger form */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handlePlaceCall} className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-5 bg-gradient-to-b from-zinc-950 to-violet-950/5">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <PhoneCall className="w-4 h-4 text-violet-400" />
              Outbound Telephony Trigger
            </h3>

            {loading ? (
              <div className="py-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                <span className="text-xs text-zinc-500 font-mono">Loading active agents...</span>
              </div>
            ) : agents.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                No active voice agents available to assign. Please create one first.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Assign AI Agent</label>
                  <select
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.language})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Lead/Customer Phone Number</label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. +91XXXXXXXXXX"
                      value={targetNumber}
                      onChange={(e) => setTargetNumber(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-650 focus:outline-none focus:border-violet-500/50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Customer Name (Optional)</label>
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
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Outbound Vobiz call triggered successfully! Check CRM/Logs for status updates.</span>
                  </div>
                )}

                {callError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-400 text-xs font-semibold">
                    <span>{callError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={calling || !targetNumber.trim()}
                  className="w-full inline-flex items-center justify-center gap-2.5 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {calling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Placing call via Vobiz...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Trigger Outbound Call</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </form>
        </div>

        {/* Right Side: Setup Tips & FAQ */}
        <div className="space-y-4">
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4 h-full bg-zinc-950/20">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <HelpCircle className="w-4 h-4 text-violet-400" />
              Telephony Guidelines
            </h3>

            <div className="space-y-4 text-xs text-zinc-400 leading-relaxed">
              <div className="space-y-1">
                <span className="font-bold text-zinc-300 block">1. International Format</span>
                <p>Always enter the phone number with country code (e.g. `+91` for India, `+1` for USA) without spaces or hyphens.</p>
              </div>

              <div className="space-y-1">
                <span className="font-bold text-zinc-300 block">2. Outbound Caller ID</span>
                <p>The call will be initiated from the custom Vobiz caller ID assigned to the selected agent, or your default account caller ID.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

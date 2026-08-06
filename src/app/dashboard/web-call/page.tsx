"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Globe,
  ArrowLeft,
  Mic,
  Play,
  Volume2,
  Settings,
  HelpCircle,
  Loader2
} from "lucide-react";
import Link from "next/link";
import WebRTCCallModal from "@/components/WebRTCCallModal";

interface Agent {
  id: string;
  name: string;
  language: string;
  voice_profile: string;
}

export default function WebCallPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activeCall, setActiveCall] = useState<Agent | null>(null);

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
        setSelectedAgent(data[0]);
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Web Call</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Test your AI voice agents directly inside the browser</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Agent Selection Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-5 bg-gradient-to-b from-zinc-950 to-violet-950/5">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <Mic className="w-4 h-4 text-violet-400" />
              Configure Test Instance
            </h3>

            {loading ? (
              <div className="py-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                <span className="text-xs text-zinc-500 font-mono">Loading active agents...</span>
              </div>
            ) : agents.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                No active voice agents available to call. Please create and activate an agent first.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Choose Agent Target</label>
                  <select
                    value={selectedAgent?.id || ""}
                    onChange={(e) => {
                      const found = agents.find(a => a.id === e.target.value);
                      if (found) setSelectedAgent(found);
                    }}
                    className="w-full h-11 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.language})</option>
                    ))}
                  </select>
                </div>

                {selectedAgent && (
                  <div className="border border-zinc-900 rounded-xl p-4 bg-zinc-950/50 space-y-2.5 text-xs text-zinc-400">
                    <div className="flex justify-between">
                      <span>Primary Language:</span>
                      <span className="text-zinc-200 font-mono font-semibold">{selectedAgent.language}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Voice Profile:</span>
                      <span className="text-zinc-200 font-mono font-semibold">{selectedAgent.voice_profile || "Default voice"}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (selectedAgent) setActiveCall(selectedAgent);
                  }}
                  disabled={!selectedAgent}
                  className="w-full inline-flex items-center justify-center gap-2.5 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Start Live WebRTC Session
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Setup Tips & FAQ */}
        <div className="space-y-4">
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4 h-full bg-zinc-950/20">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <HelpCircle className="w-4 h-4 text-violet-400" />
              WebRTC Tips
            </h3>

            <div className="space-y-4 text-xs text-zinc-400 leading-relaxed">
              <div className="space-y-1">
                <span className="font-bold text-zinc-300 block">1. Allow microphone access</span>
                <p>Ensure your browser is granted permission to capture microphone inputs. A popup will ask for access when you click call.</p>
              </div>

              <div className="space-y-1">
                <span className="font-bold text-zinc-300 block">2. Use headphones</span>
                <p>Using headphones avoids feedback / acoustic echo loop from the AI audio coming out of your speakers back into the mic.</p>
              </div>

              <div className="space-y-1">
                <span className="font-bold text-zinc-300 block">3. Low-latency streaming</span>
                <p>The audio stream runs through highly optimized binary buffers directly into Gemini to guarantee response time under 1.2 seconds.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WebRTC Live Call Modal popup */}
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

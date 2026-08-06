"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Network,
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  X,
  Router
} from "lucide-react";
import Link from "next/link";

interface SIPTrunk {
  id: string;
  provider: string;
  host: string;
  username?: string;
  prefix?: string;
  status: string; // active, inactive
  created_at: string;
}

export default function SIPTrunksPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<SIPTrunk[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [provider, setProvider] = useState("Vobiz.ai");
  const [host, setHost] = useState("api.vobiz.ai");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);

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

  // Fetch SIP Trunks
  const fetchTrunks = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sip_trunks")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTrunks(data || []);
    } catch (err) {
      console.error("Error fetching SIP trunks:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchTrunks();
    }
  }, [orgId, fetchTrunks]);

  // Delete SIP Trunk
  const handleDeleteTrunk = async (id: string) => {
    if (!confirm("Are you sure you want to delete this SIP trunk gateway?")) return;
    try {
      const { error } = await supabase
        .from("sip_trunks")
        .delete()
        .eq("id", id);
      if (error) throw error;
      fetchTrunks();
    } catch (err) {
      console.error("Error deleting SIP trunk:", err);
      alert("Failed to delete SIP trunk.");
    }
  };

  // Add SIP Trunk
  const handleAddTrunk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !provider.trim() || !host.trim()) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from("sip_trunks")
        .insert({
          organization_id: orgId,
          provider: provider.trim(),
          host: host.trim(),
          username: username.trim() || null,
          password: password.trim() || null,
          prefix: prefix.trim() || null,
          status: "active"
        });

      if (error) throw error;

      setIsAddModalOpen(false);
      setProvider("Vobiz.ai");
      setHost("api.vobiz.ai");
      setUsername("");
      setPassword("");
      setPrefix("");
      fetchTrunks();
    } catch (err) {
      console.error("Error adding SIP trunk:", err);
      alert("Failed to save SIP trunk configuration.");
    } finally {
      setSaving(false);
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
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">SIP Trunks</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{trunks.length} SIP Trunk gateways</p>
          </div>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Configure SIP Trunk
        </button>
      </div>

      {/* Main Grid List view */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                <th className="px-6 py-4">Provider</th>
                <th className="px-6 py-4">Host / Server IP</th>
                <th className="px-6 py-4">SIP Username</th>
                <th className="px-6 py-4">Outbound Prefix</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                    <p className="text-zinc-500 font-mono text-xs">Loading SIP trunks...</p>
                  </td>
                </tr>
              ) : trunks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-500 font-mono">
                    No SIP trunk gateways registered. Bind Vobiz or any virtual provider here.
                  </td>
                </tr>
              ) : (
                trunks.map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-900/20 transition-colors">
                    <td className="px-6 py-4 font-bold text-zinc-200">{t.provider}</td>
                    <td className="px-6 py-4 font-mono text-zinc-400">{t.host}</td>
                    <td className="px-6 py-4 text-zinc-400">{t.username || "—"}</td>
                    <td className="px-6 py-4 font-mono text-zinc-450">{t.prefix || "—"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        t.status === "active"
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {t.status === "active" ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            Inactive
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteTrunk(t.id)}
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

      {/* CONFIGURE MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Router className="w-4 h-4 text-violet-400" />
                Configure SIP Trunk gateway
              </h2>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddTrunk} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">SIP Provider Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vobiz, Tata Teleservices"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Host Server IP / Domain</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. api.vobiz.ai or 12.34.56.78"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Username</label>
                  <input
                    type="text"
                    placeholder="Optional Auth ID"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Password</label>
                  <input
                    type="password"
                    placeholder="Optional Credentials"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Outbound Prefix dialer (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 9 or 00"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !provider.trim() || !host.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Configuration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

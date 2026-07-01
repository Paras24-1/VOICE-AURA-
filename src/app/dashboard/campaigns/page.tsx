"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import WebRTCCallModal from "@/components/WebRTCCallModal";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Users,
  Phone,
  Upload,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  PhoneCall,
  Sparkles,
  Clock,
  RefreshCw,
  AlertTriangle,
  FileText
} from "lucide-react";

interface Agent {
  id: string;
  name: string;
}

interface Campaign {
  id: string;
  name: string;
  agent_id: string;
  status: string; // draft, running, paused, completed
  created_at: string;
  agents?: { name: string } | null;
  total_contacts?: number;
  completed_contacts?: number;
}

interface CampaignContact {
  id: string;
  campaign_id: string;
  name: string;
  phone_number: string;
  status: string; // pending, dialing, answered, completed, failed, busy, no-answer
  call_sid: string | null;
  duration_seconds: number;
  updated_at: string;
}

export default function CampaignsPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignContacts, setCampaignContacts] = useState<{ [campaignId: string]: CampaignContact[] }>({});
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New Campaign Form State
  const [newCampaignName, setNewCampaignName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [csvContacts, setCsvContacts] = useState<{ name: string; phone_number: string }[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvError, setCsvError] = useState("");

  // Interactive Call Simulation State
  const [activeSimulation, setActiveSimulation] = useState<{
    agentId: string;
    agentName: string;
    contactId: string;
  } | null>(null);

  // CSV Drag and Drop state
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get user organization
  const fetchOrgAndAgents = useCallback(async () => {
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
    } catch (err) {
      console.error("Error fetching org or agents:", err);
    }
  }, [supabase]);

  // Fetch campaigns
  const fetchCampaigns = useCallback(async () => {
    if (!orgId) return;

    try {
      // Fetch campaigns
      const { data: campaignsData, error } = await supabase
        .from("campaigns")
        .select("*, agents(name)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // For each campaign, fetch stats/counts
      const campaignsWithStats = await Promise.all(
        (campaignsData || []).map(async (camp) => {
          const { count: total } = await supabase
            .from("campaign_contacts")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", camp.id);

          const { count: completed } = await supabase
            .from("campaign_contacts")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", camp.id)
            .eq("status", "completed");

          return {
            ...camp,
            total_contacts: total || 0,
            completed_contacts: completed || 0
          };
        })
      );

      setCampaigns(campaignsWithStats);
    } catch (err) {
      console.error("Error fetching campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  // Fetch contacts for a specific expanded campaign
  const fetchCampaignContacts = useCallback(async (campaignId: string) => {
    try {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setCampaignContacts(prev => ({
        ...prev,
        [campaignId]: data || []
      }));
    } catch (err) {
      console.error("Error fetching campaign contacts:", err);
    }
  }, [supabase]);

  // Initial load
  useEffect(() => {
    fetchOrgAndAgents();
  }, [fetchOrgAndAgents]);

  useEffect(() => {
    if (orgId) {
      fetchCampaigns();
    }
  }, [orgId, fetchCampaigns]);

  // Auto-fetch contacts if a campaign is expanded
  useEffect(() => {
    if (expandedCampaignId) {
      fetchCampaignContacts(expandedCampaignId);
    }
  }, [expandedCampaignId, fetchCampaignContacts]);

  // Real-time polling when a campaign is running
  useEffect(() => {
    const isAnyCampaignRunning = campaigns.some(c => c.status === "running");
    if (!isAnyCampaignRunning) return;

    const interval = setInterval(() => {
      fetchCampaigns();
      if (expandedCampaignId) {
        fetchCampaignContacts(expandedCampaignId);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [campaigns, expandedCampaignId, fetchCampaigns, fetchCampaignContacts]);

  // Toggle expand campaign details
  const toggleExpandCampaign = (campaignId: string) => {
    if (expandedCampaignId === campaignId) {
      setExpandedCampaignId(null);
    } else {
      setExpandedCampaignId(campaignId);
    }
  };

  // CSV Drag & Drop Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const parseCSVText = (text: string) => {
    setCsvError("");
    const lines = text.split(/\r?\n/);
    const parsed: { name: string; phone_number: string }[] = [];

    if (lines.length === 0) {
      setCsvError("The file is empty.");
      setCsvContacts([]);
      return;
    }

    // 1. Detect delimiter of the first line
    const firstLine = lines[0];
    let delimiter = ",";
    if (firstLine.includes(";")) delimiter = ";";
    else if (firstLine.includes("\t")) delimiter = "\t";

    // 2. Parse all lines into rows
    const rows = lines
      .map(line => {
        return line.split(delimiter).map(cell => cell.replace(/^['"]|['"]$/g, "").trim());
      })
      .filter(row => row.length > 0 && row.some(cell => cell !== ""));

    if (rows.length === 0) {
      setCsvError("No readable content found in the file.");
      setCsvContacts([]);
      return;
    }

    // 3. Detect column indices for Name and Phone
    let nameColIndex = 0;
    let phoneColIndex = 1;
    let hasHeader = false;

    // Check if the first row is a header
    const firstRow = rows[0];
    const isHeaderRow = firstRow.some(cell => {
      const c = cell.toLowerCase();
      return c.includes("name") || c.includes("phone") || c.includes("number") || c.includes("contact") || c.includes("mobile");
    });

    if (isHeaderRow) {
      hasHeader = true;
      // Search for columns matching keywords
      firstRow.forEach((cell, idx) => {
        const c = cell.toLowerCase();
        if (c.includes("phone") || c.includes("number") || c.includes("mobile") || c.includes("tel") || c.includes("contact")) {
          phoneColIndex = idx;
        } else if (c.includes("name") || c.includes("first") || c.includes("last") || c.includes("user") || c.includes("person")) {
          nameColIndex = idx;
        }
      });
    } else {
      // If no header, guess columns based on the first row's content
      let foundPhoneIdx = -1;
      let foundNameIdx = -1;

      firstRow.forEach((cell, idx) => {
        const digits = cell.replace(/[^\d]/g, "");
        if (digits.length >= 7) {
          foundPhoneIdx = idx;
        } else if (cell.length > 0 && foundNameIdx === -1) {
          foundNameIdx = idx;
        }
      });

      if (foundPhoneIdx !== -1) {
        phoneColIndex = foundPhoneIdx;
        nameColIndex = foundNameIdx !== -1 ? foundNameIdx : (foundPhoneIdx === 0 ? 1 : 0);
      }
    }

    // 4. Extract data starting after header
    const dataStartIdx = hasHeader ? 1 : 0;
    for (let i = dataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      // Skip incomplete rows
      if (row.length <= Math.max(nameColIndex, phoneColIndex)) continue;

      const name = row[nameColIndex] || `Contact ${i + 1}`;
      const phone = row[phoneColIndex] || "";

      // Clean the phone number to check if it's valid
      const cleanPhone = phone.replace(/[^\d+]/g, "");
      if (cleanPhone.length >= 7) {
        parsed.push({ name, phone_number: phone });
      }
    }

    if (parsed.length === 0) {
      setCsvError("Could not find any rows with valid phone numbers (minimum 7 digits). Please check your file format.");
      setCsvContacts([]);
    } else {
      setCsvContacts(parsed);
      console.log(`Parsed ${parsed.length} contacts. Name col index: ${nameColIndex}, Phone col index: ${phoneColIndex}`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
      if (isCsv) {
        setCsvFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            parseCSVText(event.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        setCsvError("Invalid file type. Please upload a .csv file.");
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
      if (isCsv) {
        setCsvFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            parseCSVText(event.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        setCsvError("Invalid file type. Please select a .csv file.");
      }
    }
  };

  // Create Campaign
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newCampaignName || !selectedAgentId || csvContacts.length === 0) {
      return;
    }

    setCreating(true);
    try {
      // 1. Create Campaign
      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .insert({
          name: newCampaignName,
          agent_id: selectedAgentId,
          organization_id: orgId,
          status: "draft"
        })
        .select()
        .single();

      if (campErr) throw campErr;

      // 2. Insert Contacts
      const contactsToInsert = csvContacts.map(c => ({
        campaign_id: campaign.id,
        name: c.name,
        phone_number: c.phone_number,
        status: "pending"
      }));

      const { error: contactsErr } = await supabase
        .from("campaign_contacts")
        .insert(contactsToInsert);

      if (contactsErr) throw contactsErr;

      // Reset Form
      setNewCampaignName("");
      setCsvContacts([]);
      setCsvFileName("");
      
      // Refresh list
      fetchCampaigns();
    } catch (err) {
      console.error("Failed to create campaign:", err);
      alert("Error creating campaign: " + (err as any).message);
    } finally {
      setCreating(false);
    }
  };

  // Start Campaign
  const handleStartCampaign = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      const response = await fetch("/api/campaigns/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = errText;
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) {
            errMsg = parsed.error;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      await fetchCampaigns();
    } catch (err) {
      console.error("Failed to start campaign:", err);
      alert("Failed to start campaign: " + (err as any).message);
    } finally {
      setActionLoading(null);
    }
  };

  // Pause Campaign
  const handlePauseCampaign = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      const response = await fetch("/api/campaigns/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = errText;
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) {
            errMsg = parsed.error;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      await fetchCampaigns();
    } catch (err) {
      console.error("Failed to pause campaign:", err);
      alert("Failed to pause campaign: " + (err as any).message);
    } finally {
      setActionLoading(null);
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = async (campaignId: string) => {
    if (!confirm("Are you sure you want to delete this campaign? This will delete all campaign contacts and progress records.")) {
      return;
    }

    setActionLoading(campaignId);
    try {
      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaignId);

      if (error) throw error;

      await fetchCampaigns();
      if (expandedCampaignId === campaignId) {
        setExpandedCampaignId(null);
      }
    } catch (err) {
      console.error("Failed to delete campaign:", err);
      alert("Failed to delete campaign: " + (err as any).message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
            Outbound Dialer Center
          </span>
          <h1 className="font-heading text-3xl font-extrabold text-white tracking-tight mt-2.5">
            Voice Campaigns
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Upload contact lists, choose your AI agent, and dial outbound calling campaigns with real-time browser simulations.
          </p>
        </div>
        <button
          onClick={fetchCampaigns}
          className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-2 text-xs cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Dashboard</span>
        </button>
      </div>

      {/* Grid: Creator & Active Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Creator panel */}
        <div className="space-y-6 lg:col-span-1">
          <div className="glass-panel rounded-2xl p-6 border border-zinc-850 bg-gradient-to-b from-zinc-950 to-zinc-900/30 space-y-6">
            <h2 className="font-heading text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Plus className="w-4 h-4 text-violet-400" />
              Launch New Campaign
            </h2>

            <form onSubmit={handleCreateCampaign} className="space-y-5">
              {/* Campaign name */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Real Estate Follow-up June"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Agent selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">Select Dialing Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-300 focus:outline-none focus:border-violet-500/50"
                >
                  {agents.length === 0 ? (
                    <option value="">No voice agents available</option>
                  ) : (
                    agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* CSV Upload Area */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">Upload Contact List (CSV)</label>
                
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    dragActive
                      ? "border-violet-500 bg-violet-500/5"
                      : "border-zinc-800 hover:border-zinc-700 bg-zinc-950/40"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileInput}
                  />

                  <Upload className="w-8 h-8 text-zinc-500 mx-auto mb-2.5" />
                  
                  {csvFileName ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-400">{csvFileName}</p>
                      <p className="text-[10px] text-zinc-500">{csvContacts.length} contacts parsed</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-zinc-300 font-medium">Drag & drop your CSV file here</p>
                      <p className="text-[10px] text-zinc-500 mt-1">or click to browse local files</p>
                    </div>
                  )}
                </div>

                {csvError && (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1.5 bg-rose-950/20 p-2 rounded-lg border border-rose-950/40">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{csvError}</span>
                  </p>
                )}

                <div className="rounded-xl bg-zinc-950 p-3.5 border border-zinc-900 text-[10px] font-mono text-zinc-500 leading-relaxed mt-2.5">
                  <span className="text-zinc-400 block font-semibold mb-1">Expected Format:</span>
                  name, phone_number<br />
                  John Doe, +1234567890<br />
                  Jane Smith, +9876543210
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={creating || csvContacts.length === 0 || !newCampaignName}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-violet-500/10 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                <span>Create Campaign</span>
              </button>
            </form>
          </div>
        </div>

        {/* Campaign Lists */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="font-heading text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-400" />
            Active Campaigns
          </h2>

          {loading ? (
            <div className="glass-panel rounded-2xl p-12 text-center border border-zinc-850">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin mx-auto mb-3" />
              <p className="text-xs font-mono text-zinc-500">Loading dialing campaigns...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="glass-panel rounded-2xl p-16 text-center border border-zinc-850 space-y-3">
              <PhoneCall className="w-10 h-10 text-zinc-700 mx-auto" />
              <div className="space-y-1">
                <h3 className="font-bold text-sm text-zinc-400">No campaigns found</h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  Create a campaign using the form on the left. You can dial instantly using WebRTC simulator.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {campaigns.map((campaign) => {
                const isExpanded = expandedCampaignId === campaign.id;
                const progressPercent = campaign.total_contacts 
                  ? Math.round((campaign.completed_contacts || 0) / campaign.total_contacts * 100) 
                  : 0;

                return (
                  <div
                    key={campaign.id}
                    className={`glass-panel rounded-2xl border transition-all duration-200 overflow-hidden ${
                      isExpanded
                        ? "border-violet-500/30 bg-gradient-to-b from-zinc-950 to-violet-950/5"
                        : "border-zinc-850 hover:border-zinc-800 bg-zinc-950/20"
                    }`}
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => toggleExpandCampaign(campaign.id)}
                      className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 cursor-pointer select-none"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold text-zinc-200 text-sm">{campaign.name}</span>
                          {campaign.status === "running" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[9px] uppercase tracking-wider animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> running
                            </span>
                          ) : campaign.status === "paused" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-[9px] uppercase tracking-wider">
                              paused
                            </span>
                          ) : campaign.status === "completed" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[9px] uppercase tracking-wider">
                              completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-950 border border-zinc-900 text-zinc-500 font-mono text-[9px] uppercase tracking-wider">
                              draft
                            </span>
                          )}
                        </div>

                        {/* Subtitle Info */}
                        <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {campaign.total_contacts} Contacts
                          </span>
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                            Agent: {campaign.agents?.name || "Unknown"}
                          </span>
                        </div>
                      </div>

                      {/* Progress bar & Buttons */}
                      <div className="flex items-center gap-6 sm:justify-end">
                        {/* Progress Meter */}
                        <div className="w-36 hidden sm:block space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                            <span>Progress</span>
                            <span>{campaign.completed_contacts}/{campaign.total_contacts}</span>
                          </div>
                          <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {campaign.status === "running" ? (
                            <button
                              onClick={() => handlePauseCampaign(campaign.id)}
                              disabled={actionLoading === campaign.id}
                              className="p-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                              title="Pause Campaign"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartCampaign(campaign.id)}
                              disabled={actionLoading === campaign.id || campaign.status === "completed"}
                              className="p-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              title="Start Campaign"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteCampaign(campaign.id)}
                            disabled={actionLoading === campaign.id}
                            className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                            title="Delete Campaign"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          <div className="p-1 text-zinc-500 hover:text-zinc-300">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar for Mobile */}
                    <div className="px-5 pb-4 sm:hidden">
                      <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Expanded Details Table */}
                    {isExpanded && (
                      <div className="border-t border-zinc-900 bg-zinc-950/40 animate-in slide-in-from-top-4 duration-200">
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                                <th className="px-6 py-4">Name</th>
                                <th className="px-6 py-4">Phone Number</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Duration</th>
                                <th className="px-6 py-4 text-right">Interactive Simulation</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900/40 font-mono">
                              {!campaignContacts[campaign.id] ? (
                                <tr>
                                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                                    <Loader2 className="w-4 h-4 animate-spin text-violet-500 mx-auto mb-2" />
                                    Loading contacts...
                                  </td>
                                </tr>
                              ) : campaignContacts[campaign.id].length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-600">
                                    No contacts registered.
                                  </td>
                                </tr>
                              ) : (
                                campaignContacts[campaign.id].map((contact) => (
                                  <tr key={contact.id} className="hover:bg-zinc-900/10 transition-colors">
                                    <td className="px-6 py-3.5 font-sans font-semibold text-zinc-300">
                                      {contact.name}
                                    </td>
                                    <td className="px-6 py-3.5 text-zinc-500">
                                      {contact.phone_number}
                                    </td>
                                    <td className="px-6 py-3.5">
                                      {contact.status === "completed" ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] uppercase">
                                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Done
                                        </span>
                                      ) : contact.status === "dialing" ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[9px] uppercase animate-pulse">
                                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Dialing
                                        </span>
                                      ) : contact.status === "answered" ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] uppercase animate-pulse">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> active
                                        </span>
                                      ) : contact.status === "failed" ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[9px] uppercase">
                                          <XCircle className="w-2.5 h-2.5" /> Failed
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-850 text-zinc-500 text-[9px] uppercase">
                                          {contact.status}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-6 py-3.5 text-zinc-400">
                                      {contact.duration_seconds > 0 ? `${contact.duration_seconds}s` : "--"}
                                    </td>
                                    <td className="px-6 py-3.5 text-right">
                                      <button
                                        onClick={() =>
                                          setActiveSimulation({
                                            agentId: campaign.agent_id,
                                            agentName: campaign.agents?.name || "AI Agent",
                                            contactId: contact.id
                                          })
                                        }
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-zinc-750 text-zinc-400 hover:text-zinc-200 transition-colors font-medium text-[11px] cursor-pointer"
                                      >
                                        <Phone className="w-3.5 h-3.5 text-violet-400" />
                                        Simulate Call
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Interactive Call Simulation Modal */}
      {activeSimulation && (
        <WebRTCCallModal
          agentId={activeSimulation.agentId}
          agentName={activeSimulation.agentName}
          contactId={activeSimulation.contactId}
          onClose={() => {
            setActiveSimulation(null);
            fetchCampaigns();
            if (expandedCampaignId) {
              fetchCampaignContacts(expandedCampaignId);
            }
          }}
        />
      )}
    </div>
  );
}

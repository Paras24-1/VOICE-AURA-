"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Sliders,
  Code2,
  Phone,
  Play,
  Volume2,
  Copy,
  Check,
  Globe2,
  Cpu,
  Sparkles,
  Info,
  ShieldAlert,
  HelpCircle,
  Mic
} from "lucide-react";

// Frontend interface uses camelCase for React state
interface VoiceAgentData {
  id: string;
  name: string;
  language: string;
  lang_code: string;
  voice_profile: string;
  active: boolean;
  system_prompt: string;
  temperature: number;
  speech_threshold: number;
  silence_detection: number;
  telephone_number: string;
  transfer_number?: string;
  avatar_url?: string;
  description?: string;
}

export default function AgentConfiguratorPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [activeTab, setActiveTab] = useState<"settings" | "deployment">("settings");
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedIframe, setCopiedIframe] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const [agentData, setAgentData] = useState<VoiceAgentData | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);

  const handleSavePhone = async () => {
    if (!agentData) return;
    setSavingPhone(true);
    try {
      const { error } = await supabase
        .from('agents')
        .update({ telephone_number: agentData.telephone_number })
        .eq('id', agentData.id);

      if (error) {
        alert("Error saving phone number: " + error.message);
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save phone number.");
    } finally {
      setSavingPhone(false);
    }
  };

  const fetchAgent = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id)
        .single();
      if (!membership) return;
      const { data: agent, error } = await supabase
        .from('agents')
        .select('id, name, language, lang_code, voice_profile, active, system_prompt, temperature, speech_threshold, silence_detection, telephone_number, transfer_number, avatar_url, description')
        .eq('id', id)
        .eq('organization_id', membership.organization_id)
        .single();
      if (error) {
        console.error('Fetch agent error:', error);
      }
      setAgentData(agent ?? null);
    } catch (err) {
      console.error('Failed to fetch agent:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Generate a persistent UUID for new agents
  const newAgentIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (id && id !== "new") {
      Promise.resolve().then(() => {
        fetchAgent();
      });
    } else {
      Promise.resolve().then(() => {
        // New agent defaults
        setAgentData({
          id: newAgentIdRef.current,
          name: "",
          language: "English",
          lang_code: "US",
          voice_profile: "",
          active: true,
          system_prompt: "",
          temperature: 0.7,
          speech_threshold: -42,
          silence_detection: 600,
          telephone_number: "",
          transfer_number: "",
          avatar_url: undefined,
          description: undefined,
        });
        setLoading(false);
      });
    }
  }, [id, fetchAgent]);

  const languages = [
    { name: "English", code: "US" },
    { name: "Spanish", code: "ES" },
    { name: "Japanese", code: "JP" },
    { name: "French", code: "FR" },
    { name: "Hindi", code: "IN" },
    { name: "German", code: "DE" },
    { name: "Portuguese", code: "PT" },
  ];

  // Gemini Live API supported voices
  const voiceProfiles = [
    { id: "Aoede",  label: "Aoede",  gender: "Female", tone: "Bright & expressive",   emoji: "✨" },
    { id: "Kore",   label: "Kore",   gender: "Female", tone: "Warm & neutral",         emoji: "🌸" },
    { id: "Puck",   label: "Puck",   gender: "Male",   tone: "Playful & light",        emoji: "🎭" },
    { id: "Charon", label: "Charon", gender: "Male",   tone: "Deep & calm",            emoji: "🌊" },
    { id: "Fenrir", label: "Fenrir", gender: "Male",   tone: "Bold & confident",       emoji: "⚡" },
  ];

  const handleCopyScript = () => {
    if (!agentData) return;
    const scriptSnippet = `<!-- VoxAura AI Agent Embed -->
<script
  src="https://cdn.voxaura.ai/widget/v1/embed.js"
  data-agent-id="${agentData.id}"
  data-theme="dark"
  data-latency-mode="webrtc-optimal"
  async>
</script>`;
    navigator.clipboard.writeText(scriptSnippet);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleCopyIframe = () => {
    if (!agentData) return;
    const iframeSnippet = `<iframe
  src="https://widget.voxaura.ai/agent/${agentData.id}?theme=dark"
  width="380px"
  height="600px"
  style="border: none; border-radius: 16px; background: transparent;"
  allow="microphone">
</iframe>`;
    navigator.clipboard.writeText(iframeSnippet);
    setCopiedIframe(true);
    setTimeout(() => setCopiedIframe(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentData) return;
    setSaveError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Try to get existing membership
      let { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id)
        .single();

      // If no membership, create a default organization and link the user
      if (!membership) {
        const { data: org, error: orgErr } = await supabase
          .from('organizations')
          .insert({ name: 'Default Organization' })
          .select('id')
          .single();
        if (orgErr || !org?.id) throw new Error('Failed to create organization: ' + orgErr?.message);

        const { error: memErr } = await supabase
          .from('organization_members')
          .insert({ organization_id: org.id, profile_id: user.id });
        if (memErr) throw memErr;
        membership = { organization_id: org.id };
      }

      // Build the row payload with snake_case columns matching the DB schema
      const payload = {
        id: agentData.id,
        organization_id: membership.organization_id,
        name: agentData.name,
        language: agentData.language,
        lang_code: agentData.lang_code,
        voice_id: agentData.voice_profile, // also populate legacy voice_id column
        voice_profile: agentData.voice_profile,
        system_prompt: agentData.system_prompt,
        active: agentData.active,
        temperature: agentData.temperature,
        speech_threshold: agentData.speech_threshold,
        silence_detection: agentData.silence_detection,
        telephone_number: agentData.telephone_number,
        transfer_number: agentData.transfer_number || "",
        avatar_url: agentData.avatar_url || null,
        description: agentData.description || null,
      };

      const { error: upsertError } = await supabase
        .from('agents')
        .upsert(payload, { onConflict: 'id' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        setSaveError(upsertError.message);
        return; // Don't navigate away on error
      }

      // Success – show banner then navigate
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        router.push('/dashboard/agents');
      }, 1200);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Failed to save agent:', error);
      setSaveError(error?.message || 'Unknown error saving agent');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="text-zinc-400 animate-pulse">Loading agent data...</span>
      </div>
    );
  }
  if (!agentData) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Back button & header actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/agents"
            className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <span className="text-[11px] font-mono tracking-widest text-zinc-500 uppercase">
              Agent Configurator
            </span>
            <h1 className="font-heading text-2xl font-bold text-white tracking-tight mt-1">
              {id === "new" ? "Provision New Agent" : agentData.name}
            </h1>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "settings"
                ? "bg-zinc-900 text-violet-400 border border-zinc-800"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Core Settings
          </button>
          <button
            onClick={() => setActiveTab("deployment")}
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "deployment"
                ? "bg-zinc-900 text-violet-400 border border-zinc-800"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Deployment & Embeds
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4" />
          Successfully saved Voice Agent Container configuration. Synced node updates.
        </div>
      )}

      {saveError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          Error saving agent: {saveError}
        </div>
      )}

      {/* Tab 1: Settings Form */}
      {activeTab === "settings" && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form left columns: Core Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Core details Panel */}
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 space-y-6">
              <h2 className="font-heading text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <Cpu className="w-5 h-5 text-violet-400" />
                Model Specifications
              </h2>

                <div className="flex items-start justify-between">
                  {/* Active Indicator & Avatar */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-violet-500/30 flex items-center justify-center bg-zinc-900">
                      {agentData?.avatar_url ? (
                        <img src={agentData.avatar_url} alt={agentData.name} className="w-full h-full object-cover" />
                      ) : (
                        <Mic className="w-5 h-5 text-violet-400" />
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Agent Name"
                    value={agentData.name}
                    onChange={(e) => setAgentData({ ...agentData, name: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>

              {/* Language selector */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  Primary Language
                </label>
                <select
                  value={agentData.language}
                  onChange={(e) => {
                    const lang = languages.find(l => l.name === e.target.value);
                    setAgentData({
                      ...agentData,
                      language: e.target.value,
                      lang_code: lang?.code || "US"
                    });
                  }}
                  className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/50"
                >
                  {languages.map(l => (
                    <option key={l.code} value={l.name}>{l.name} ({l.code})</option>
                  ))}
                </select>
              </div>

              {/* Voice Profile picker */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                    Voice Profile
                  </label>
                  {agentData.voice_profile && (
                    <span className="text-[10px] font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                      {voiceProfiles.find(v => v.id === agentData.voice_profile)?.gender ?? ''} · Gemini Live
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {voiceProfiles.map(vp => {
                    const isSelected = agentData.voice_profile === vp.id;
                    return (
                      <button
                        key={vp.id}
                        type="button"
                        onClick={() => setAgentData({ ...agentData, voice_profile: vp.id })}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30'
                            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900'
                        }`}
                      >
                        <span className="text-xl leading-none">{vp.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${ isSelected ? 'text-violet-300' : 'text-zinc-200' }`}>
                              {vp.label}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              vp.gender === 'Female'
                                ? 'bg-pink-500/15 text-pink-400'
                                : 'bg-blue-500/15 text-blue-400'
                            }`}>
                              {vp.gender}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 truncate">{vp.tone}</p>
                        </div>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0 animate-pulse" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {!agentData.voice_profile && (
                  <p className="text-[11px] text-zinc-500">Select a voice — each tenant can have a different one.</p>
                )}
              </div>

              {/* Telephone number */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  Assigned Phone Node (Vobiz Caller ID)
                </label>
                <input
                  type="text"
                  placeholder="+918071583309"
                  value={agentData.telephone_number || ""}
                  onChange={(e) => setAgentData({ ...agentData, telephone_number: e.target.value })}
                  className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Handover / Transfer Phone Number */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  Handover / Support Transfer Number
                </label>
                <input
                  type="text"
                  placeholder="+919876543210"
                  value={agentData.transfer_number || ""}
                  onChange={(e) => setAgentData({ ...agentData, transfer_number: e.target.value })}
                  className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={agentData.description || ""}
                  onChange={(e) => setAgentData({ ...agentData, description: e.target.value })}
                  placeholder="Short description of this agent's purpose..."
                  className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* System prompt instructions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                    Core System Prompts & Instructions
                  </label>
                  <span className="text-[10px] text-zinc-500 font-mono">Max 2,000 characters</span>
                </div>
                <textarea
                  required
                  rows={6}
                  value={agentData.system_prompt}
                  onChange={(e) => setAgentData({ ...agentData, system_prompt: e.target.value })}
                  placeholder="Paste your system model instructions. Control behavior, persona, bounds, support FAQs..."
                  className="w-full p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 leading-relaxed font-sans"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 hover:shadow-violet-600/35 transition-all"
              >
                <Save className="w-4 h-4" />
                Save AI Container Changes
              </button>
              <Link
                href="/dashboard/agents"
                className="flex-1 sm:flex-initial inline-flex items-center justify-center px-6 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white text-xs font-semibold hover:bg-zinc-900 transition-all"
              >
                Cancel Configuration
              </Link>
            </div>
          </div>

          {/* Form right column: Hyperparameter Sliders */}
          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 space-y-6">
              <h2 className="font-heading text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <Sliders className="w-5 h-5 text-violet-400" />
                Core Hyperparameters
              </h2>

              {/* Sliders 1: Temperature */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-400 uppercase tracking-wider">
                    LLM Temperature
                  </span>
                  <span className="font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-bold">
                    {agentData.temperature}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={agentData.temperature}
                  onChange={(e) =>
                    setAgentData({ ...agentData, temperature: parseFloat(e.target.value) })
                  }
                  className="w-full accent-violet-500 bg-zinc-900 h-1.5 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                  <span>Concise / Precise</span>
                  <span>Creative / Chatty</span>
                </div>
              </div>

              {/* Sliders 2: Speech Threshold */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-400 uppercase tracking-wider">
                    VAD Speech Threshold
                  </span>
                  <span className="font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-bold">
                    {agentData.speech_threshold} dB
                  </span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="-20"
                  step="1"
                  value={agentData.speech_threshold}
                  onChange={(e) =>
                    setAgentData({ ...agentData, speech_threshold: parseInt(e.target.value) })
                  }
                  className="w-full accent-violet-500 bg-zinc-900 h-1.5 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                  <span>Very Sensitive (-60dB)</span>
                  <span>Loud Voices Only (-20dB)</span>
                </div>
              </div>

              {/* Sliders 3: Silence Detection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-400 uppercase tracking-wider">
                    Silence Detection Time
                  </span>
                  <span className="font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-bold">
                    {agentData.silence_detection} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="2000"
                  step="50"
                  value={agentData.silence_detection}
                  onChange={(e) =>
                    setAgentData({ ...agentData, silence_detection: parseInt(e.target.value) })
                  }
                  className="w-full accent-violet-500 bg-zinc-900 h-1.5 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                  <span>Aggressive (200ms)</span>
                  <span>Relaxed (2000ms)</span>
                </div>
              </div>
            </div>

            {/* Quick Agent Testing Sandbox */}
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 bg-gradient-to-b from-zinc-950 to-violet-950/5 space-y-4">
              <h3 className="font-heading font-extrabold text-sm text-zinc-200 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-violet-400" />
                Live Mic Sandbox
              </h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Connect your browser microphone to stream dynamic voice calls directly with Elena container model. Tested at sub-140ms.
              </p>
              <button
                type="button"
                onClick={() => alert("Connecting browser WebRTC socket... SPEAK NOW.")}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-400 hover:text-emerald-300 font-bold text-xs transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Connect Dynamic Call
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Tab 2: Deployment Details */}
      {activeTab === "deployment" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Deployment Code Blocks */}
          <div className="lg:col-span-2 space-y-6">
            {/* Embedded JavaScript Embed Script Tag */}
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-heading font-extrabold text-sm text-zinc-200">
                    High-Performance script Embed
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Insert this tag into the <code>&lt;head&gt;</code> or bottom of the HTML page. Loads dynamically.
                  </p>
                </div>

                <button
                  onClick={handleCopyScript}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {copiedScript ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Code
                    </>
                  )}
                </button>
              </div>

              {/* Code display block */}
              <pre className="p-4 rounded-xl bg-zinc-950 border border-zinc-900 text-xs text-violet-300 font-mono overflow-x-auto leading-relaxed">
                {`<!-- VoxAura AI Agent Embed -->
<script
  src="https://cdn.voxaura.ai/widget/v1/embed.js"
  data-agent-id="${agentData.id}"
  data-theme="dark"
  data-latency-mode="webrtc-optimal"
  async>
</script>`}
              </pre>
            </div>

            {/* Embedded WebRTC Iframe Tag */}
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-heading font-extrabold text-sm text-zinc-200">
                    Secure WebRTC iframe Embed
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Perfect for placing inside specific columns or custom dashboards.
                  </p>
                </div>

                <button
                  onClick={handleCopyIframe}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {copiedIframe ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Code
                    </>
                  )}
                </button>
              </div>

              <pre className="p-4 rounded-xl bg-zinc-950 border border-zinc-900 text-xs text-violet-300 font-mono overflow-x-auto leading-relaxed">
                {`<iframe
  src="https://widget.voxaura.ai/agent/${agentData.id}?theme=dark"
  width="380px"
  height="600px"
  style="border: none; border-radius: 16px; background: transparent;"
  allow="microphone">
</iframe>`}
              </pre>
            </div>
          </div>

          {/* Telephony Endpoint Binding Panel */}
          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6 border border-zinc-800 space-y-6">
              <h2 className="font-heading text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <Phone className="w-5 h-5 text-violet-400" />
                Telephony Binding
              </h2>

              <p className="text-xs text-zinc-400 leading-relaxed">
                Bind this container directly to inbound phone calls globally. We support high-density Twilio, Telnyx, and SIP endpoints.
              </p>

              {/* Assigned Number display */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-900 space-y-3">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">
                  Assigned Phone Node (Vobiz Caller ID)
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    placeholder="+918071583309"
                    value={agentData.telephone_number || ""}
                    onChange={(e) => setAgentData({ ...agentData, telephone_number: e.target.value })}
                    className="flex-1 h-10 px-3.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={handleSavePhone}
                    disabled={savingPhone}
                    className="px-3.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-xs transition-colors flex items-center justify-center"
                  >
                    {savingPhone ? "Saving..." : "Save"}
                  </button>
                </div>
                {agentData.telephone_number && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Inbound SIP Trunk Connected
                  </span>
                )}
              </div>

              {/* Outbound call trigger sandbox */}
              <div className="space-y-3 border-t border-zinc-900 pt-4">
                <label className="text-xs font-mono text-zinc-500 uppercase tracking-wider block">
                  Trigger Outbound Test Call
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    className="flex-1 h-10 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={() => alert("Initiating outbound telephonic stream...")}
                    className="px-3.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition-colors"
                  >
                    Dial Out
                  </button>
                </div>
              </div>
            </div>

            {/* Note banner */}
            <div className="glass-panel rounded-2xl p-5 border border-zinc-800 bg-amber-500/5 flex items-start gap-3">
              <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-zinc-400 leading-relaxed">
                <strong className="text-zinc-200">Microphone Permission Note:</strong> WebRTC endpoints require client browser SSL/HTTPS configurations. Microphone permissions will only trigger on secure contexts.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

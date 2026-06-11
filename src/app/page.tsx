import React from "react";
import Link from "next/link";
import { Mic, ArrowRight, ShieldCheck, Zap, Globe2, CreditCard, Play } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-hidden flex flex-col justify-between">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[150px] pointer-events-none" />

      {/* Header / Navbar */}
      <header className="max-w-7xl mx-auto w-full h-20 px-8 flex items-center justify-between sticky top-0 z-30 bg-[#030303]/80 backdrop-blur-md border-b border-zinc-900/50">
        <div className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20">
            <Mic className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#030303] animate-pulse" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              VoxAura<span className="text-violet-500">.AI</span>
            </h1>
            <span className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
              Global Stream Gateway
            </span>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition-all"
        >
          Go to Dashboard
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-8 py-20 flex flex-col items-center text-center justify-center relative z-10 space-y-12">
        <div className="space-y-6 max-w-3xl">
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-3 py-1.5 rounded-full border border-violet-500/20">
            Gemini Multimodal Live API Core
          </span>
          <h2 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-[1.1] font-heading">
            Deploy Ultra-Low Latency <br />
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent text-glow">
              AI Voice Agents
            </span>
          </h2>
          <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Build multilingual voice agents trained on your business data. Connect them to Twilio phone trunks or embed our high-fidelity WebRTC client in seconds. Tested at sub-150ms latency.
          </p>
        </div>

        {/* CTA Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full max-w-md">
          <Link
            href="/dashboard"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow-xl shadow-violet-600/20 transition-all"
          >
            Launch Free Agent
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#features"
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm font-semibold transition-all"
          >
            Explore Architectures
          </a>
        </div>

        {/* Product Visual Mockup */}
        <div className="w-full max-w-4xl p-1 rounded-2xl bg-gradient-to-r from-zinc-800 via-violet-500/25 to-indigo-500/10 border border-zinc-800 shadow-2xl relative">
          <div className="aspect-[16/9] w-full rounded-xl bg-[#080808] flex items-center justify-center p-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(#1e1b4b_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />
            <div className="relative space-y-4 max-w-md text-center">
              <div className="w-16 h-16 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 mx-auto animate-pulse">
                <Mic className="w-8 h-8" />
              </div>
              <h3 className="font-heading font-extrabold text-white text-lg">WebRTC Voice Node: Active</h3>
              <p className="text-xs text-zinc-500">
                Piping 8kHz $\mu$-law transcoding to 16kHz linear PCM buffers directly to Gemini Live gateway server node.
              </p>
              <div className="flex items-center justify-center gap-2.5">
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-mono text-[9px] uppercase tracking-wider">
                  Latency: 142ms
                </span>
                <span className="px-2 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded font-mono text-[9px] uppercase tracking-wider">
                  Region: US-EAST
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Features Anchor Section */}
      <section id="features" className="max-w-7xl mx-auto w-full px-8 py-20 border-t border-zinc-900 bg-zinc-950/20 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="glass-panel p-6 rounded-2xl border border-zinc-900 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
              <Globe2 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-zinc-200 text-sm">Multilingual Conversational Engine</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Auto-negotiate language streams in English, Spanish, Japanese, French, Hindi, and more. Gemini handles direct native audio translations.
            </p>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-zinc-900 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-zinc-200 text-sm">Direct Telephony Streams Integration</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Provision phone numbers directly. Connect voice agents to inbound Twilio SIP trunks and forward streams seamlessly using standard TwiML protocols.
            </p>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-zinc-900 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-zinc-200 text-sm">Integrated Stripe Multi-Tenancy</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Accept subscriptions out of the box. RLS policies secure tenant boundaries and Stripe webhook synchronization updates usage quotas.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto w-full px-8 py-8 border-t border-zinc-900/50 flex flex-col sm:flex-row items-center justify-between text-zinc-500 text-xs gap-4">
        <p>&copy; 2026 VoxAura.AI Node Corporation. All rights reserved.</p>
        <div className="flex gap-4">
          <a href="#" className="hover:text-zinc-300 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-zinc-300 transition-colors">SLA Agreement</a>
          <a href="#" className="hover:text-zinc-300 transition-colors">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}

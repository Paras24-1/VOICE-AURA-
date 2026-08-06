"use client";

import React, { useState } from "react";
import {
  Shield,
  ArrowLeft,
  Save,
  Clock,
  RotateCcw,
  VolumeX,
  Plus,
  Trash2,
  CheckCircle2
} from "lucide-react";
import Link from "next/link";

export default function CampaignRulesPage() {
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryInterval, setRetryInterval] = useState(30); // minutes
  const [startHour, setStartHour] = useState("09:00");
  const [endHour, setEndHour] = useState("19:00");
  const [blacklistedNumbers, setBlacklistedNumbers] = useState<string[]>([
    "+919876543210",
    "+918888888888"
  ]);
  const [newNumber, setNewNumber] = useState("");
  const [saved, setSaved] = useState(false);

  const handleAddBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = newNumber.replace(/[^\d+]/g, "").trim();
    if (formatted && !blacklistedNumbers.includes(formatted)) {
      setBlacklistedNumbers([...blacklistedNumbers, formatted]);
      setNewNumber("");
    }
  };

  const handleRemoveBlacklist = (num: string) => {
    setBlacklistedNumbers(blacklistedNumbers.filter(n => n !== num));
  };

  const handleSaveRules = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
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
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Campaign Rules</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">Define calling hours, retries and blacklists</p>
          </div>
        </div>

        <button
          onClick={handleSaveRules}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all cursor-pointer"
        >
          <Save className="w-4 h-4" />
          {saved ? "Saved successfully!" : "Save Configuration"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Core Rules configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. Retry Strategy */}
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <RotateCcw className="w-4 h-4 text-violet-400" />
              Auto-Retry Strategy
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Max Retries Per Lead</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Retry Delay Interval (Mins)</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={retryInterval}
                  onChange={(e) => setRetryInterval(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>
            </div>
          </div>

          {/* 2. Scheduling Hours */}
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <Clock className="w-4 h-4 text-violet-400" />
              Allowed Call Schedule Hours
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Calling Starts At</label>
                <input
                  type="time"
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Calling Ends At</label>
                <input
                  type="time"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Left Side: Do Not Call (DNC) list */}
        <div className="space-y-4">
          <div className="glass-panel p-6 rounded-2xl border border-zinc-800 space-y-4 h-full">
            <h3 className="font-bold text-sm text-zinc-200 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <VolumeX className="w-4 h-4 text-rose-500" />
              Do Not Call (DNC) List
            </h3>

            <form onSubmit={handleAddBlacklist} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="e.g. +919999999999"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                className="flex-1 h-9 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
              />
              <button
                type="submit"
                className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </form>

            <div className="border border-zinc-900 rounded-xl max-h-[250px] overflow-y-auto divide-y divide-zinc-950">
              {blacklistedNumbers.length === 0 ? (
                <p className="text-zinc-650 text-xs italic text-center py-6">No blacklisted numbers.</p>
              ) : (
                blacklistedNumbers.map((num) => (
                  <div key={num} className="flex items-center justify-between p-3 bg-zinc-950/30 text-xs">
                    <span className="font-mono text-zinc-300">{num}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBlacklist(num)}
                      className="p-1 rounded hover:bg-rose-950/20 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mic,
  CreditCard,
  Search,
  Bell,
  ChevronDown,
  Menu,
  X,
  LogOut,
  Settings,
  Shield,
  Activity,
  Command,
  Sparkles,
  FileText,
  PhoneCall
} from "lucide-react";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
  description: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications, setNotifications] = useState(3);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setIsProfileOpen(false);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  const navigation: SidebarItem[] = [
    {
      name: "Overview",
      href: "/dashboard",
      icon: LayoutDashboard,
      description: "Real-time analytics & KPIs",
    },
    {
      name: "Voice Agents",
      href: "/dashboard/agents",
      icon: Mic,
      description: "Configure conversational AI",
    },
    {
      name: "Campaigns",
      href: "/dashboard/campaigns",
      icon: PhoneCall,
      description: "Outbound voice campaigns",
    },
    {
      name: "Call Logs",
      href: "/dashboard/logs",
      icon: FileText,
      description: "Transcripts & conversation history",
    },
    {
      name: "Billing & Plans",
      href: "/dashboard/billing",
      icon: CreditCard,
      description: "Stripe flows & subscriptions",
    },
  ];

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 flex relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/10 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[150px] pointer-events-none" />

      {/* Mobile Sidebar Toggle Overlay */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="fixed top-4 left-4 z-40 lg:hidden p-2 rounded-lg bg-zinc-900/80 border border-zinc-800 text-zinc-400 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 glass-panel border-r border-zinc-800/80 transition-all duration-300 transform lg:static lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } flex flex-col justify-between`}
      >
        <div>
          {/* Logo Brand Header */}
          <div className="h-20 flex items-center justify-between px-6 border-b border-zinc-900/80">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20">
                <Mic className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#030303] animate-pulse" />
              </div>
              <div>
                <h1 className="font-heading font-bold text-lg tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                  AuraVoice<span className="text-violet-500">.AI</span>
                </h1>
                <span className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
                  Enterprise Node
                </span>
              </div>
            </Link>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <div className="px-3 mb-2 text-[11px] font-mono tracking-widest text-zinc-500 uppercase">
              Core Platform
            </div>
            {navigation.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-start gap-4 p-3 rounded-xl transition-all duration-200 relative ${
                    isActive
                      ? "bg-gradient-to-r from-violet-600/10 to-indigo-600/5 border border-violet-500/30 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                      : "border border-transparent hover:bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/4 bottom-1/4 w-[3px] rounded-r bg-violet-500" />
                  )}
                  <item.icon
                    className={`w-5 h-5 mt-0.5 transition-transform group-hover:scale-105 ${
                      isActive ? "text-violet-400" : "text-zinc-500 group-hover:text-zinc-300"
                    }`}
                  />
                  <div>
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors mt-0.5 line-clamp-1">
                      {item.description}
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Workspace Info & Profile */}
        <div className="p-4 border-t border-zinc-900/80 bg-zinc-950/40">
          {/* Quick Node Status */}
          <div className="flex items-center justify-between p-2.5 mb-4 rounded-lg bg-zinc-900/30 border border-zinc-800/40">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-[11px] font-mono text-zinc-400">WebRTC Gateway</span>
            </div>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono">
              99.98%
            </span>
          </div>

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsProfileOpen(!isProfileOpen);
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl border border-zinc-800/50 hover:bg-zinc-900/50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md">
                    AM
                  </div>
                  <span className="absolute bottom-[-2px] right-[-2px] w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-zinc-950" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-zinc-200">Alex Mercer</div>
                  <div className="text-[10px] text-zinc-500 font-medium">Enterprise Admin</div>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-zinc-500" />
            </button>

            {/* Profile Dropdown Menu */}
            {isProfileOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 p-1.5 glass-panel border border-zinc-800 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="px-3 py-2 border-b border-zinc-900/60 mb-1">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                    Subscription Tier
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-violet-400 text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5" />
                    Pro Premium Plan
                  </div>
                </div>
                <button
                  onClick={() => alert("Redirecting to profile settings...")}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900/80 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Account Settings
                </button>
                <button
                  onClick={() => alert("Redirecting to API Console...")}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900/80 rounded-lg transition-colors"
                >
                  <Shield className="w-4 h-4" />
                  API Keys & Secrets
                </button>
                <div className="h-px bg-zinc-900/60 my-1" />
                <button
                  onClick={() => alert("Signing out of node...")}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out Node
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen relative">
        {/* Top Navbar */}
        <header className="h-20 flex items-center justify-between px-8 border-b border-zinc-900/80 glass-panel sticky top-0 z-30">
          {/* Advanced Search Panel */}
          <div className="relative max-w-md w-full hidden md:block">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search conversations, agents, and billing logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-12 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-sans"
            />
            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
              <span className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Command className="w-2.5 h-2.5" />K
              </span>
            </div>
          </div>

          {/* Quick Stats Banner / Title for Mobile */}
          <div className="flex items-center gap-3 md:hidden">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white">
              <Mic className="w-4 h-4" />
            </div>
            <span className="font-heading font-bold text-sm tracking-tight text-white">
              AuraVoice
            </span>
          </div>

          {/* Top Actions Profile */}
          <div className="flex items-center gap-4">
            {/* System Pulse */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-[11px] font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Node: US-EAST-1 Active
            </div>

            {/* Notification Hub */}
            <button className="relative p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors">
              <Bell className="w-4 h-4" />
              {notifications > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-violet-600 text-[10px] font-bold text-white rounded-full flex items-center justify-center border-2 border-[#030303]">
                  {notifications}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Dashboard Dynamic Child Viewport */}
        <main className="flex-1 p-8 max-w-7xl mx-auto w-full relative z-10">
          {children}
        </main>
      </div>
    </div>
  );
}

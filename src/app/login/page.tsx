"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Mic, Mail, Lock, User, ArrowRight, Loader2, Check } from "lucide-react";
import Link from "next/link";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom") || "/dashboard";

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (isSignUp) {
        // Sign Up Flow
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              organization_name: `${fullName}'s Org`,
            },
          },
        });

        if (error) {
          setErrorMsg(error.message);
        } else if (data.user && data.session) {
          // Auto-signed in immediately (depends on Supabase project config)
          setSuccessMsg("Account created successfully! Redirecting...");
          setTimeout(() => {
            router.push(redirectedFrom);
          }, 1500);
        } else {
          // Email verification link sent
          setSuccessMsg("Registration successful! Check your email to verify your account.");
        }
      } else {
        // Sign In Flow
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setErrorMsg(error.message);
        } else if (data.user) {
          setSuccessMsg("Welcome back! Loading your voice node...");
          setTimeout(() => {
            router.push(redirectedFrom);
          }, 1500);
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || "An unexpected authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 glass-panel rounded-2xl border border-zinc-800 bg-[#080808]/80 shadow-2xl relative z-10 space-y-6">
      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-600/5 rounded-full blur-2xl pointer-events-none" />

      {/* Brand Header */}
      <div className="text-center space-y-2">
        <Link href="/" className="inline-flex items-center gap-2 group justify-center">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20">
            <Mic className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#030303] animate-pulse" />
          </div>
          <h1 className="font-heading font-extrabold text-xl tracking-tight text-white">
            AuraVoice<span className="text-violet-500">.AI</span>
          </h1>
        </Link>
        <p className="text-xs text-zinc-400">
          {isSignUp ? "Register your tenant workspace node" : "Log in to manage your voice agents"}
        </p>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold leading-relaxed">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleAuth} className="space-y-4">
        {isSignUp && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">
              Full Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-zinc-600">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full h-11 pl-10 pr-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">
            Email Address
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center text-zinc-600">
              <Mail className="w-4 h-4" />
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider">
              Password
            </label>
            {!isSignUp && (
              <a href="#" className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
                Forgot password?
              </a>
            )}
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center text-zinc-600">
              <Lock className="w-4 h-4" />
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Syncing credentials...
            </>
          ) : (
            <>
              {isSignUp ? "Provision Account" : "Access Workspace"}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <div className="h-px bg-zinc-900" />

      {/* Switch mode */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setErrorMsg("");
            setSuccessMsg("");
          }}
          className="text-xs text-zinc-400 hover:text-white transition-colors font-medium"
        >
          {isSignUp ? (
            <>
              Already have a workspace? <span className="text-violet-400 font-bold">Sign In</span>
            </>
          ) : (
            <>
              New to AuraVoice? <span className="text-violet-400 font-bold">Create an account</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-hidden flex items-center justify-center p-6">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[150px] pointer-events-none" />
      
      <Suspense fallback={
        <div className="w-full max-w-md p-8 glass-panel rounded-2xl border border-zinc-800 bg-[#080808]/80 flex flex-col items-center justify-center min-h-[350px]">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
          <span className="text-xs text-zinc-500 mt-4">Initializing Security Node...</span>
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import {
  CreditCard,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Zap,
  TrendingUp,
  Clock,
  Sparkles,
  HelpCircle,
  ArrowRight,
  Download,
  AlertCircle
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
interface PricingTier {
  id: string;
  name: string;
  price: string;
  frequency: string;
  badge?: string;
  description: string;
  features: string[];
  ctaText: string;
  popular: boolean;
  stripePriceId: string;
}

interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: "paid" | "failed" | "pending";
  tierName: string;
}

export default function BillingPage() {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [currentPlan, setCurrentPlan] = useState("pro"); // Mock current user plan: "pro"

  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      // Fetch pricing tiers (subscriptions) for current user organization
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Get organization id via membership
      const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('profile_id', user.id).single();
      if (!membership) return;
      const { data: subs, error: subsErr } = await supabase.from('subscriptions').select('id, price_id, status, created_at').eq('organization_id', membership.organization_id);
      if (subsErr) {
        console.error('Failed to fetch subscriptions', subsErr);
        return;
      }
      // Map to PricingTier shape (placeholder mapping)
      const tiers = subs.map((sub) => ({
        id: sub.id,
        name: sub.price_id ?? 'Custom',
        price: `$${sub.price_id?.replace('price_', '') ?? '0'}`,
        frequency: 'month',
        description: 'Your subscription details',
        features: [],
        ctaText: 'Manage Subscription',
        popular: false,
        stripePriceId: sub.price_id,
        badge: undefined,
      }));
      setPricingTiers(tiers);
      // Fetch recent invoices (assuming a view exists)
      const { data: invoices, error: invErr } = await supabase.from('invoices').select('id, created_at, total_amount, status, subscription_id').eq('organization_id', membership.organization_id).order('created_at', { ascending: false }).limit(5);
      if (invErr) {
        console.error('Failed to fetch invoices', invErr);
        return;
      }
      const invoiceList = invoices.map((inv) => ({
        id: inv.id,
        date: new Date(inv.created_at).toLocaleDateString(),
        amount: `$${inv.total_amount}`,
        status: inv.status,
        tierName: inv.subscription_id,
      }));
      setRecentInvoices(invoiceList);
    };
    fetchData();
  }, []);


  



  const handleSubscribe = async (tier: PricingTier) => {
    if (tier.id === currentPlan) {
      handlePortalRedirect();
      return;
    }
    
    setLoadingTier(tier.id);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: tier.stripePriceId, tierId: tier.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Simulating redirect to Stripe Checkout flow for price: " + tier.stripePriceId);
      }
    } catch (err) {
      console.error(err);
      alert("Error initiating checkout session.");
    } finally {
      setLoadingTier(null);
    }
  };

  const handlePortalRedirect = async () => {
    setLoadingPortal(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Simulating redirect to Stripe Customer Billing Portal for subscription management.");
      }
    } catch (err) {
      console.error(err);
      alert("Error initiating billing portal session.");
    } finally {
      setLoadingPortal(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono tracking-widest text-violet-400 uppercase bg-violet-500/10 px-2.5 py-1 rounded-full border border-violet-500/20">
            Node Billing Infrastructure
          </span>
          <h1 className="font-heading text-3xl font-extrabold text-white tracking-tight mt-2.5">
            Billing & Usage
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Manage your subscription tier, track API active minutes quotas, and download receipts.
          </p>
        </div>

        {/* Current plan badge and Portal access */}
        <button
          onClick={handlePortalRedirect}
          disabled={loadingPortal}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold shadow-lg hover:border-zinc-700 transition-all self-start sm:self-auto disabled:opacity-50"
        >
          <CreditCard className="w-4 h-4 text-violet-400" />
          {loadingPortal ? "Accessing billing node..." : "Stripe Customer Portal"}
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Usage Analytics Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Usage Quota Block */}
        <div className="glass-panel rounded-2xl p-6 border border-zinc-800 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm font-bold text-zinc-300 uppercase tracking-widest">
              Active Billing Node Quota Usage
            </h2>
            <span className="text-xs text-zinc-400 font-mono">
              Renews on <strong className="text-zinc-200">June 15, 2026</strong>
            </span>
          </div>

          <div className="space-y-4">
            {/* Minutes quota */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-zinc-300 flex items-center gap-1.5">
                  Voice Agent Streaming Minutes
                </span>
                <span className="font-mono text-zinc-400">
                  <strong className="text-white">4,210</strong> / 5,000 mins (84.2%)
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-zinc-950 rounded-full h-2.5 border border-zinc-900 overflow-hidden">
                <div className="bg-gradient-to-r from-violet-600 to-indigo-500 h-full w-[84.2%] rounded-full" />
              </div>
            </div>

            {/* Custom clone models */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-zinc-300">Active Custom Voice Clones</span>
                <span className="font-mono text-zinc-400">
                  <strong className="text-white">3</strong> / 5 Clones (60%)
                </span>
              </div>
              <div className="w-full bg-zinc-950 rounded-full h-2.5 border border-zinc-900 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full w-[60%] rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick summary stats */}
        <div className="glass-panel rounded-2xl p-6 border border-zinc-800 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">
              Active Tier Profile
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-heading font-extrabold text-white">
                Pro Premium Plan
              </span>
              <span className="text-[10px] font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full font-bold">
                Active Node
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t border-zinc-900 pt-4 mt-4">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Next Renewal Cost:</span>
              <span className="font-mono text-zinc-200 font-bold">$199.00 USD</span>
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span>WebRTC Server Regions:</span>
              <span className="text-zinc-200">Global (US/EU/AP)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Cards Tiers */}
      <div className="space-y-6">
        <div>
          <h2 className="font-heading text-xl font-bold text-white tracking-tight">
            Subscription Pricing Tiers
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Upgrade your minutes allocation and access premium low-latency WebRTC speech pipelines instantly.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {pricingTiers.map((tier) => {
            const isCurrent = tier.id === currentPlan;

            return (
              <div
                key={tier.id}
                className={`glass-panel rounded-2xl p-8 border flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${
                  tier.popular
                    ? "border-violet-500/40 shadow-xl shadow-violet-500/5 bg-gradient-to-b from-zinc-950 via-zinc-950 to-violet-950/5"
                    : "border-zinc-800"
                } ${isCurrent ? "ring-2 ring-violet-500/30" : ""}`}
              >
                {/* Popular Badge */}
                {tier.popular && (
                  <span className="absolute top-4 right-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-mono font-bold text-[9px] px-2.5 py-1 rounded-full uppercase tracking-wider shadow">
                    {tier.badge}
                  </span>
                )}

                {/* Card Top Info */}
                <div className="space-y-6">
                  <div>
                    <h3 className="font-heading font-extrabold text-lg text-white">
                      {tier.name}
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed mt-2.5">
                      {tier.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-1 pt-2">
                    <span className="text-4xl font-heading font-extrabold text-white tracking-tight">
                      {tier.price}
                    </span>
                    {tier.frequency && (
                      <span className="text-xs font-mono text-zinc-500">/{tier.frequency}</span>
                    )}
                  </div>

                  <div className="h-px bg-zinc-900" />

                  {/* Features list */}
                  <ul className="space-y-3.5 text-xs text-zinc-400">
                    {tier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                        <span className="leading-tight">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA Action */}
                <div className="mt-8 pt-4">
                  <button
                    onClick={() => handleSubscribe(tier)}
                    disabled={loadingTier === tier.id}
                    className={`w-full py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      isCurrent
                        ? "bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white"
                        : tier.popular
                        ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/25"
                        : "bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {loadingTier === tier.id ? (
                      "Initializing Stripe Gateway..."
                    ) : isCurrent ? (
                      <>
                        Active Profile
                        <Sparkles className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
                      </>
                    ) : (
                      <>
                        {tier.ctaText}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Invoice Transaction Logs */}
      <div className="space-y-6">
        <h2 className="font-heading text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Clock className="w-5 h-5 text-zinc-400" />
          Receipt Billing Log History
        </h2>

        <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Invoice Reference ID</th>
                  <th className="px-6 py-4">Transaction Date</th>
                  <th className="px-6 py-4">Tier Subscribed</th>
                  <th className="px-6 py-4">Amount Charged</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Receipt Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/60 text-xs">
                {recentInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-zinc-900/10 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-zinc-300">
                      {inv.id}
                    </td>
                    <td className="px-6 py-4 font-medium text-zinc-400">
                      {inv.date}
                    </td>
                    <td className="px-6 py-4 text-zinc-300">
                      {inv.tierName}
                    </td>
                    <td className="px-6 py-4 font-mono text-zinc-400">
                      {inv.amount}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[9px] font-bold uppercase">
                        Paid Node
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => alert("Downloading PDF Invoice...")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors font-medium text-[11px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Invoice PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stripe compliance information */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-950/40 border border-zinc-900 text-xs text-zinc-500 max-w-4xl">
        <ShieldCheck className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
        <p className="leading-relaxed">
          Payments are secured and processed using Stripe Customer Portals via SSL encryption. We never retain bank or credit card data within our active container nodes. For customized SLA agreements or enterprise custom pricing plans, contact our global team directly.
        </p>
      </div>
    </div>
  );
}

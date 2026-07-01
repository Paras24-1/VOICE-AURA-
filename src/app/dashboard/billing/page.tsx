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

interface BilledCall {
  id: string;
  date: string;
  duration: string;
  amount: string;
  status: string;
  fromPhone: string;
}

export default function BillingPage() {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [currentPlan, setCurrentPlan] = useState("free"); 
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(true);

  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [recentBilledCalls, setRecentBilledCalls] = useState<BilledCall[]>([]);

  const [walletBalance, setWalletBalance] = useState(0);
  const [organizationId, setOrganizationId] = useState("");
  const [rechargeAmount, setRechargeAmount] = useState("500");
  const [recharging, setRecharging] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        const { data: membership } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('profile_id', user.id)
          .single();
          
        if (!membership) return;
        const orgId = membership.organization_id;

        // Fetch organization details (wallet_balance)
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('id, wallet_balance')
          .eq('id', orgId)
          .maybeSingle();
          
        if (!orgErr && orgData) {
          setWalletBalance(Number(orgData.wallet_balance) || 0);
          setOrganizationId(orgData.id);
        }

        // Fetch all completed call logs to compute exact duration & accumulated cost
        const { data: logs, error: logsErr } = await supabase
          .from('call_logs')
          .select('id, duration_seconds, cost, created_at, from_phone_number')
          .eq('organization_id', orgId);

        if (logsErr) {
          console.error('Failed to fetch call logs:', logsErr.message);
          return;
        }

        const calculatedSeconds = (logs || []).reduce((sum, log) => sum + (log.duration_seconds || 0), 0);
        const calculatedCost = (logs || []).reduce((sum, log) => sum + (Number(log.cost) || 0), 0);

        setTotalSeconds(calculatedSeconds);
        setTotalCost(calculatedCost);
        
        // Determine current plan based on 600-minute threshold
        const hasExceededFreeLimit = calculatedSeconds >= (600 * 60);
        setCurrentPlan(hasExceededFreeLimit ? "paygo" : "free");

        // Define our custom pricing tiers structure statically
        const staticTiers: PricingTier[] = [
          {
            id: "free",
            name: "Free Trial Plan",
            price: "₹0",
            frequency: "600 mins",
            description: "Default starting plan for all new users. Includes 600 free minutes of voice streaming.",
            features: [
              "600 minutes of real-time voice streams",
              "Low latency LLM-powered response node",
              "Basic call routing & transfer",
              "Standard dashboard log access"
            ],
            ctaText: "Active Tier",
            popular: false,
            stripePriceId: "price_free"
          },
          {
            id: "paygo",
            name: "Aura Pay-As-You-Go",
            price: "₹3.5",
            frequency: "minute",
            description: "Automatically billed on seconds-level increments after free quota is consumed.",
            features: [
              "Charged at ₹3.5 per call minute",
              "Unlimited minutes allocation",
              "Access to custom voice clones",
              "Priority agent response routing",
              "Detailed cost inspector"
            ],
            ctaText: "Upgrade / Active",
            popular: true,
            badge: "Flexible Usage",
            stripePriceId: "price_paygo"
          },
          {
            id: "enterprise",
            name: "Enterprise SLA",
            price: "Custom",
            frequency: "",
            description: "For high-volume centers requiring dedicated server capacity and custom models.",
            features: [
              "Volume discount minute pricing",
              "Dedicated WebRTC gateway nodes",
              "Custom local TTS/STT training",
              "24/7 priority support and SLA",
              "Custom webhook & CRM triggers"
            ],
            ctaText: "Contact Sales",
            popular: false,
            stripePriceId: "price_enterprise"
          }
        ];
        
        setPricingTiers(staticTiers);

        // Fetch recent call logs with cost > 0 to populate transaction history
        const { data: billedCalls, error: billedErr } = await supabase
          .from('call_logs')
          .select('id, created_at, duration_seconds, cost, from_phone_number')
          .eq('organization_id', orgId)
          .gt('cost', 0)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!billedErr && billedCalls) {
          const list = billedCalls.map((c) => {
            const m = Math.floor((c.duration_seconds || 0) / 60);
            const s = (c.duration_seconds || 0) % 60;
            return {
              id: c.id.substring(0, 16),
              date: new Date(c.created_at).toLocaleDateString(),
              duration: `${m}m ${s}s`,
              amount: `₹${Number(c.cost).toFixed(2)}`,
              status: "Billed",
              fromPhone: c.from_phone_number || "Call"
            };
          });
          setRecentBilledCalls(list);
        }
      } catch (err) {
        console.error("Failed to load billing metrics:", err);
      } finally {
        setLoading(false);
      }
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

  // Load Razorpay Script Dynamically
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      // Clean up script on unmount
      const existingScript = document.querySelector(`script[src="${script.src}"]`);
      if (existingScript) {
        document.body.removeChild(existingScript);
      }
    };
  }, []);

  const handleRazorpayRecharge = async () => {
    const amountNum = Number(rechargeAmount);
    if (isNaN(amountNum) || amountNum < 100) {
      alert("Minimum recharge amount is ₹100");
      return;
    }

    setRecharging(true);
    try {
      const res = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountNum, organizationId }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed && parsed.error) errorMessage = parsed.error;
        } catch (_) {}
        throw new Error(errorMessage);
      }

      const orderData = await res.json();
      
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
        amount: orderData.amount,
        currency: orderData.currency,
        name: "VoxAura AI",
        description: `Wallet Top-up of ₹${amountNum}`,
        order_id: orderData.id,
        prefill: {
          name: user?.email?.split("@")[0] || "Customer",
          email: user?.email || "",
        },
        theme: {
          color: "#7c3aed",
        },
        handler: async function (response: any) {
          try {
            const verifyRes = await fetch("/api/razorpay/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                amount: amountNum,
                organizationId
              }),
            });

            if (!verifyRes.ok) {
              const errorText = await verifyRes.text();
              let errorMessage = errorText;
              try {
                const parsed = JSON.parse(errorText);
                if (parsed && parsed.error) errorMessage = parsed.error;
              } catch (_) {}
              throw new Error(errorMessage);
            }

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              alert(`Payment successful! Credited ₹${Number(verifyData.creditedAmount).toFixed(2)} (after 18% GST deduction on ₹${amountNum}) to your wallet.`);
              setWalletBalance(verifyData.newBalance);
            } else {
              alert("Payment verification failed.");
            }
          } catch (verifyErr: any) {
            console.error("Verification error:", verifyErr);
            alert("Error verifying payment: " + verifyErr.message);
          } finally {
            setRecharging(false);
          }
        },
        modal: {
          ondismiss: function () {
            setRecharging(false);
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      console.error("Recharge error:", err);
      alert("Error starting payment gateway: " + err.message);
      setRecharging(false);
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
              Quota Limit: <strong className="text-zinc-200">600 mins free</strong>
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
                  {loading ? (
                    "Calculating..."
                  ) : (
                    <>
                      <strong className="text-white">
                        {Math.floor(totalSeconds / 60)}m {totalSeconds % 60}s
                      </strong>{" "}
                      / 600 mins (
                      {Math.min(((totalSeconds / (600 * 60)) * 100), 100).toFixed(1)}
                      %)
                    </>
                  )}
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-zinc-950 rounded-full h-2.5 border border-zinc-900 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-violet-600 to-indigo-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(((totalSeconds / (600 * 60)) * 100), 100)}%` }}
                />
              </div>
            </div>

            {/* Custom clone models */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-zinc-300">Active Custom Voice Clones</span>
                <span className="font-mono text-zinc-400">
                  <strong className="text-white">1</strong> / 5 Clones (20%)
                </span>
              </div>
              <div className="w-full bg-zinc-950 rounded-full h-2.5 border border-zinc-900 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full w-[20%] rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick summary stats */}
        <div className="glass-panel rounded-2xl p-6 border border-zinc-800 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">
              Active Tier Profile
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-heading font-extrabold text-white">
                {loading ? "Loading..." : (currentPlan === "free" ? "Free Trial Plan" : "Pay-As-You-Go Tier")}
              </span>
              <span className="text-[10px] font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full font-bold">
                Active Node
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t border-zinc-900 pt-4">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Wallet Balance:</span>
              <span className={`font-mono font-bold ${walletBalance < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                ₹{loading ? "0.00" : walletBalance.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Accumulated Charges:</span>
              <span className="font-mono text-zinc-300 font-bold">
                ₹{loading ? "0.00" : totalCost.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Billing Rate:</span>
              <span className="text-zinc-200 font-mono">₹3.5 / min</span>
            </div>
          </div>

          {/* Razorpay Recharge Field */}
          <div className="border-t border-zinc-900 pt-4 space-y-2.5">
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
              Recharge Wallet
            </span>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2 text-zinc-500 text-xs font-bold">₹</span>
                <input
                  type="number"
                  min="100"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  placeholder="500"
                  className="w-full pl-6 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50 transition-colors"
                />
              </div>
              <button
                onClick={handleRazorpayRecharge}
                disabled={recharging || !organizationId}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-violet-600/10 cursor-pointer flex items-center justify-center min-w-[90px]"
              >
                {recharging ? "Processing..." : "Recharge"}
              </button>
            </div>
            <span className="text-[9px] text-zinc-500 block leading-tight">
              * Minimum recharge is ₹100. Instant credits via UPI, Cards, and Netbanking.
            </span>
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
                    disabled={loadingTier === tier.id || isCurrent}
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
          Recent Metered Call Transactions
        </h2>

        <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Session Reference ID</th>
                  <th className="px-6 py-4">Transaction Date</th>
                  <th className="px-6 py-4">From Agent/Device</th>
                  <th className="px-6 py-4">Duration</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Amount Charged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/60 text-xs">
                {recentBilledCalls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-zinc-500 font-mono">
                      No metered transactions recorded. All calls are currently within the 600 free minutes allocation.
                    </td>
                  </tr>
                ) : (
                  recentBilledCalls.map((call) => (
                    <tr key={call.id} className="hover:bg-zinc-900/10 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-zinc-300">
                        {call.id}
                      </td>
                      <td className="px-6 py-4 font-medium text-zinc-400">
                        {call.date}
                      </td>
                      <td className="px-6 py-4 text-zinc-300">
                        {call.fromPhone}
                      </td>
                      <td className="px-6 py-4 font-mono text-zinc-400">
                        {call.duration}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[9px] font-bold uppercase">
                          Billed
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                        {call.amount}
                      </td>
                    </tr>
                  ))
                )}
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

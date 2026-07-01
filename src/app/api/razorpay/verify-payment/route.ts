import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      organizationId,
    } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount || !organizationId) {
      return NextResponse.json(
        { error: "Missing required verification parameters" },
        { status: 400 }
      );
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!keySecret) {
      return NextResponse.json(
        { error: "Razorpay secret is not configured on the server." },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Database configuration credentials missing on the server." },
        { status: 500 }
      );
    }

    // Cryptographic signature validation
    const message = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(message)
      .digest("hex");

    const isSignatureValid = generatedSignature === razorpay_signature;

    if (!isSignatureValid) {
      console.warn(`[Razorpay Verify API] Signature mismatch for Order: ${razorpay_order_id}`);
      return NextResponse.json(
        { error: "Payment verification failed. Signature mismatch." },
        { status: 400 }
      );
    }

    console.log(`[Razorpay Verify API] Payment verified successfully for Order: ${razorpay_order_id}. Crediting ₹${amount} to Org ${organizationId}`);

    // Update organization balance in database using service role (bypassing RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: org, error: fetchErr } = await supabase
      .from("organizations")
      .select("wallet_balance")
      .eq("id", organizationId)
      .maybeSingle();

    if (fetchErr || !org) {
      console.error("[Razorpay Verify API] Error fetching organization:", fetchErr?.message);
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    const currentBalance = Number(org.wallet_balance) || 0;
    const newBalance = Number((currentBalance + amount).toFixed(4));

    const { error: updateErr } = await supabase
      .from("organizations")
      .update({ wallet_balance: newBalance })
      .eq("id", organizationId);

    if (updateErr) {
      console.error("[Razorpay Verify API] Error updating wallet balance:", updateErr.message);
      return NextResponse.json(
        { error: "Failed to update wallet balance in database" },
        { status: 500 }
      );
    }

    console.log(`[Razorpay Verify API] Successfully credited ₹${amount}. New balance: ₹${newBalance}`);

    return NextResponse.json({
      success: true,
      newBalance,
    });
  } catch (err: any) {
    console.error("[Razorpay Verify API] Verification error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to verify payment" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

let stripe: Stripe | null = null;
if (stripeSecret) {
  stripe = new Stripe(stripeSecret, {
    apiVersion: "2025-01-27.acac" as any,
  });
}

export async function POST() {
  try {
    // In production, fetch current authenticated user and their Stripe customer ID
    // e.g. const customerId = user.stripe_customer_id;
    const mockCustomerId = "cus_mock_alexmercer123";

    if (!stripe || stripeSecret?.startsWith("sk_test_your")) {
      console.log("Stripe Billing Portal in simulation offline mode for customer:", mockCustomerId);
      return NextResponse.json({
        url: `${appUrl}/dashboard/billing?portal_session=mock_portal_active`,
        simulated: true,
      });
    }

    // Active connection using stripe SDK
    const session = await stripe.billingPortal.sessions.create({
      customer: mockCustomerId,
      return_url: `${appUrl}/dashboard/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe billing portal error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error in billing portal" },
      { status: 500 }
    );
  }
}

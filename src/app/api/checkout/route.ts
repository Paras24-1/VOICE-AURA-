import { NextResponse } from "next/server";
import Stripe from "stripe";

// Initialize Stripe conditionally
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

let stripe: Stripe | null = null;
if (stripeSecret) {
  stripe = new Stripe(stripeSecret, {
    apiVersion: "2025-01-27.acac" as any, // fallback to standard API versions
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { priceId, tierId } = body;

    if (!priceId) {
      return NextResponse.json({ error: "Missing Price ID specifier" }, { status: 400 });
    }

    // Mock mode if Stripe secret is empty or default placeholder
    if (!stripe || stripeSecret?.startsWith("sk_test_your")) {
      console.log("Stripe API in simulation offline mode for tier:", tierId);
      // Simulate success URL with callback parameters
      return NextResponse.json({
        url: `${appUrl}/dashboard/billing?session_id=mock_stripe_checkout_${Math.floor(
          Math.random() * 100000
        )}&tier=${tierId}`,
        simulated: true,
      });
    }

    // Active connection using stripe SDK
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${appUrl}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/billing?canceled=true`,
      metadata: {
        tierId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error in checkout" },
      { status: 500 }
    );
  }
}

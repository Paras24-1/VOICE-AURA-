import { NextResponse } from "next/server";
import Razorpay from "razorpay";

export async function POST(req: Request) {
  try {
    const { amount, organizationId } = await req.json();

    if (!amount || amount < 100) {
      return NextResponse.json(
        { error: "Minimum recharge amount is ₹100" },
        { status: 400 }
      );
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Missing organizationId" },
        { status: 400 }
      );
    }

    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error("[Razorpay API] Missing key_id or key_secret configuration.");
      return NextResponse.json(
        { error: "Razorpay credentials are not configured on the server." },
        { status: 500 }
      );
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const options = {
      amount: Math.round(amount * 100), // Razorpay amount is in paisa (1 INR = 100 paisa)
      currency: "INR",
      receipt: `rcpt_${organizationId.substring(0, 8)}_${Date.now()}`,
      notes: {
        organizationId: organizationId,
      },
    };

    console.log(`[Razorpay Order API] Creating order for Org ${organizationId} of amount: ₹${amount}`);
    const order = await razorpay.orders.create(options);

    return NextResponse.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err: any) {
    console.error("[Razorpay Order API] Error creating order:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create payment order" },
      { status: 500 }
    );
  }
}

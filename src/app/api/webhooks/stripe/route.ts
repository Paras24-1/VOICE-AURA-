import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Initialize Stripe Client
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
      apiVersion: "2023-10-16" as any, // Cast to any to avoid typescript mismatch with older/newer SDK types
    })
  : null;

// Initialize Supabase Admin Client using the service_role key to bypass Row Level Security
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

const relevantEvents = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error("❌ Missing stripe-signature or webhook secret configuration.");
    return new NextResponse("Missing Stripe Webhook Signature or Secret", { status: 400 });
  }

  if (!stripe) {
    console.error("❌ Stripe is not initialized due to missing secret key.");
    return new NextResponse("Stripe configuration error", { status: 500 });
  }

  if (!supabaseAdmin) {
    console.error("❌ Supabase Admin is not initialized due to missing credentials.");
    return new NextResponse("Database configuration error", { status: 500 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (relevantEvents.has(event.type)) {
    try {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;
      const orgIdFromMetadata = subscription.metadata?.organization_id;

      let organizationId = orgIdFromMetadata;

      // 1. Resolve Organization ID
      if (!organizationId) {
        // If not in subscription metadata, query organizations by stripe_customer_id
        const { data: orgData, error: orgError } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (orgError || !orgData) {
          console.error(`⚠️ No organization mapped to stripe_customer_id: ${customerId}`);
          return new NextResponse("Organization not found for customer ID", { status: 400 });
        }
        organizationId = orgData.id;
      } else {
        // Ensure organization has the correct stripe_customer_id linked
        const { error: linkError } = await supabaseAdmin
          .from("organizations")
          .update({ stripe_customer_id: customerId })
          .eq("id", organizationId);

        if (linkError) {
          console.error(`⚠️ Failed to link stripe_customer_id to organization ${organizationId}: ${linkError.message}`);
        }
      }

      // 2. Synchronize Subscription Statuses
      if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        const subscriptionData = {
          organization_id: organizationId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId,
          status: subscription.status,
          price_id: subscription.items.data[0]?.price.id,
          quantity: subscription.items.data[0]?.quantity ?? 1,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        };

        const { error: upsertError } = await supabaseAdmin
          .from("subscriptions")
          .upsert(subscriptionData, { onConflict: "organization_id" });

        if (upsertError) {
          throw new Error(`Failed to upsert subscription in database: ${upsertError.message}`);
        }
        console.log(`✅ Subscription ${subscription.id} successfully synced for Organization ${organizationId}`);
      } else if (event.type === "customer.subscription.deleted") {
        // Set the status to canceled when subscription is deleted
        const { error: deleteError } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: subscription.status, // "canceled"
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (deleteError) {
          throw new Error(`Failed to mark subscription as deleted: ${deleteError.message}`);
        }
        console.log(`✅ Subscription ${subscription.id} successfully marked as deleted/canceled.`);
      }
    } catch (err: any) {
      console.error(`❌ Webhook processing failed: ${err.message}`);
      return new NextResponse(`Webhook Handler Error: ${err.message}`, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

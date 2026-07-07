-- ==========================================================
-- Migration: Add notification_email to agents and lead_details to call_logs
-- Run this in your Supabase SQL Editor
-- ==========================================================

DO $$
BEGIN
    -- 1. Add notification_email to public.agents table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='notification_email') THEN
        ALTER TABLE public.agents ADD COLUMN notification_email text DEFAULT '';
    END IF;

    -- 2. Add lead_details to public.call_logs table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='call_logs' AND column_name='lead_details') THEN
        ALTER TABLE public.call_logs ADD COLUMN lead_details jsonb;
    END IF;
END $$;

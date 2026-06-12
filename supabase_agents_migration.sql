-- ==========================================================
-- Migration: Add missing columns to agents table
-- Run this in your Supabase SQL Editor
-- ==========================================================

-- Add missing columns (each uses IF NOT EXISTS via DO block to be idempotent)
DO $$
BEGIN
    -- lang_code: stores the country/locale code (e.g., "US", "ES")
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='lang_code') THEN
        ALTER TABLE public.agents ADD COLUMN lang_code text DEFAULT 'US';
    END IF;

    -- voice_profile: full voice profile identifier string
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='voice_profile') THEN
        ALTER TABLE public.agents ADD COLUMN voice_profile text DEFAULT '';
    END IF;

    -- active: whether the agent is enabled/disabled
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='active') THEN
        ALTER TABLE public.agents ADD COLUMN active boolean DEFAULT true;
    END IF;

    -- temperature: LLM temperature parameter
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='temperature') THEN
        ALTER TABLE public.agents ADD COLUMN temperature numeric(3,2) DEFAULT 0.70;
    END IF;

    -- speech_threshold: VAD speech threshold in dB
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='speech_threshold') THEN
        ALTER TABLE public.agents ADD COLUMN speech_threshold integer DEFAULT -42;
    END IF;

    -- silence_detection: silence detection timeout in ms
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='silence_detection') THEN
        ALTER TABLE public.agents ADD COLUMN silence_detection integer DEFAULT 600;
    END IF;

    -- telephone_number: assigned phone number for telephony binding
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='telephone_number') THEN
        ALTER TABLE public.agents ADD COLUMN telephone_number text DEFAULT '';
    END IF;

    -- avatar_url: agent avatar image URL
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='avatar_url') THEN
        ALTER TABLE public.agents ADD COLUMN avatar_url text;
    END IF;

    -- description: short description of the agent
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='description') THEN
        ALTER TABLE public.agents ADD COLUMN description text;
    END IF;

    -- avg_latency: average response latency in ms (computed/cached)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='avg_latency') THEN
        ALTER TABLE public.agents ADD COLUMN avg_latency integer DEFAULT 0;
    END IF;

    -- transfer_number: destination number for call transfers / human handover
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agents' AND column_name='transfer_number') THEN
        ALTER TABLE public.agents ADD COLUMN transfer_number text DEFAULT '';
    END IF;

    -- Make voice_id nullable since we now use voice_profile instead
    ALTER TABLE public.agents ALTER COLUMN voice_id DROP NOT NULL;
    ALTER TABLE public.agents ALTER COLUMN voice_id SET DEFAULT '';
END $$;

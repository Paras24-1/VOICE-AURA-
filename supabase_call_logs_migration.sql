-- ==========================================================
-- Migration: Add call_sid column to call_logs table
-- Run this in your Supabase SQL Editor
-- ==========================================================

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS call_sid text;

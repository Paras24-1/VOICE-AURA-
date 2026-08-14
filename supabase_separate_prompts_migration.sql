-- Database migration to add separate inbound/outbound prompt columns to agents table

ALTER TABLE public.agents 
    ADD COLUMN IF NOT EXISTS inbound_system_prompt text,
    ADD COLUMN IF NOT EXISTS outbound_system_prompt text;

-- Backfill existing prompts to outbound_system_prompt so we don't lose data
UPDATE public.agents 
SET outbound_system_prompt = system_prompt 
WHERE outbound_system_prompt IS NULL OR outbound_system_prompt = '';

UPDATE public.agents 
SET inbound_system_prompt = system_prompt 
WHERE inbound_system_prompt IS NULL OR inbound_system_prompt = '';

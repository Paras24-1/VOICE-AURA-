-- Migration to add phonebook_id column to public.campaigns table

ALTER TABLE public.campaigns 
    ADD COLUMN IF NOT EXISTS phonebook_id uuid REFERENCES public.phonebooks(id) ON DELETE SET NULL;

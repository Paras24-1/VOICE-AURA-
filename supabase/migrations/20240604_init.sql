-- Supabase PostgreSQL Schema Migration
-- Multilingual AI Voice Agent SaaS Schema
-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- ==========================================================
-- 1. Core Tables Definition
-- ==========================================================
-- Organizations Table
create table if not exists public.organizations (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    stripe_customer_id text unique,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Profiles Table (Linked to Supabase Auth users)
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Organization Members (Junction Table for Multi-tenancy)
create table if not exists public.organization_members (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    profile_id uuid references public.profiles(id) on delete cascade not null,
    role text not null check (role in ('admin', 'member')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique (organization_id, profile_id)
);

-- Subscriptions Table (Scoped to Organizations)
create table if not exists public.subscriptions (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null unique,
    stripe_subscription_id text unique,
    stripe_customer_id text,
    status text not null, -- e.g., active, trialing, canceled, past_due, unpaid
    price_id text,
    quantity integer,
    cancel_at_period_end boolean default false,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Agents Table (SaaS Product Entities)
create table if not exists public.agents (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    name text not null,
    voice_id text not null,
    system_prompt text,
    language text not null default 'en',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Call Logs Table (SaaS Call activity)
create table if not exists public.call_logs (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    agent_id uuid references public.agents(id) on delete set null,
    from_phone_number text,
    to_phone_number text,
    duration_seconds integer default 0 not null,
    status text not null, -- e.g., completed, failed, busy, no-answer
    recording_url text,
    transcript text,
    cost numeric(10, 4) default 0.0000 not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Usage Records Table (For metered usage billing)
create table if not exists public.usage_records (
    id uuid default gen_random_uuid() primary key,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    metric text not null, -- e.g., call_minutes, api_tokens
    amount integer not null,
    recorded_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==========================================================
-- 2. Indexes for Performance
-- ==========================================================
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_org_members_org_id on public.organization_members(organization_id);
create index if not exists idx_org_members_profile_id on public.organization_members(profile_id);
create index if not exists idx_subscriptions_org_id on public.subscriptions(organization_id);
create index if not exists idx_subscriptions_stripe_sub_id on public.subscriptions(stripe_subscription_id);
create index if not exists idx_organizations_stripe_cust_id on public.organizations(stripe_customer_id);
create index if not exists idx_agents_org_id on public.agents(organization_id);
create index if not exists idx_call_logs_org_id on public.call_logs(organization_id);
create index if not exists idx_call_logs_agent_id on public.call_logs(agent_id);
create index if not exists idx_usage_records_org_id on public.usage_records(organization_id);

-- ==========================================================
-- 3. Automatic Timestamps Triggers
-- ==========================================================
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;
create trigger update_profiles_updated_at
    before update on public.profiles
    for each row execute procedure public.update_updated_at_column();
create trigger update_subscriptions_updated_at
    before update on public.subscriptions
    for each row execute procedure public.update_updated_at_column();
create trigger update_agents_updated_at
    before update on public.agents
    for each row execute procedure public.update_updated_at_column();

-- ==========================================================
-- 4. Auth Auto-Registration Triggers
-- ==========================================================
-- This trigger automatically provisions a Profile, a default Organization,
-- and assigns the User as an Admin for that Organization upon signing up.
create or replace function public.handle_new_user()
returns trigger as $$
declare
    default_org_id uuid;
    org_name text;
begin
    -- 1. Insert profile
    insert into public.profiles (id, email, full_name, avatar_url)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url'
    );
    -- Determine default organization name
    org_name := coalesce(new.raw_user_meta_data->>'organization_name', split_part(new.email, '@', 1) || '''s Org');
    -- 2. Insert organization
    insert into public.organizations (name)
    values (org_name)
    returning id into default_org_id;
    -- 3. Link user to organization as Admin
    insert into public.organization_members (organization_id, profile_id, role)
    values (default_org_id, new.id, 'admin');
    return new;
end;
$$ language plpgsql security definer;
-- Trigger execution link to auth.users
create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ==========================================================
-- 5. Helper RLS Functions
-- ==========================================================
-- Security definer functions bypass RLS constraints to evaluate
-- membership accurately and avoid infinite RLS recursion.
create or replace function public.is_org_member(org_id uuid)
returns boolean as $$
begin
    return exists (
        select 1 
        from public.organization_members 
        where organization_members.organization_id = org_id 
          and organization_members.profile_id = auth.uid()
    );
end;
$$ language plpgsql security definer;
create or replace function public.is_org_admin(org_id uuid)
returns boolean as $$
begin
    return exists (
        select 1 
        from public.organization_members 
        where organization_members.organization_id = org_id 
          and organization_members.profile_id = auth.uid()
          and organization_members.role = 'admin'
    );
end;
$$ language plpgsql security definer;

-- ==========================================================
-- 6. Row Level Security (RLS) Configuration & Policies
-- ==========================================================
-- Enable Row Level Security (RLS) on all tables
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.agents enable row level security;
alter table public.call_logs enable row level security;
alter table public.usage_records enable row level security;

-- --- profiles policies ---
create policy "Allow users to view their own profile or profiles in the same org"
    on public.profiles for select
    using (
        auth.uid() = id 
        or exists (
            select 1 
            from public.organization_members m1 
            where m1.profile_id = auth.uid() 
              and exists (
                  select 1 
                  from public.organization_members m2 
                  where m2.organization_id = m1.organization_id 
                    and m2.profile_id = profiles.id
              )
        )
    );
create policy "Allow users to update their own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- --- organizations policies ---
create policy "Allow members to view their organizations"
    on public.organizations for select
    using (public.is_org_member(id));
create policy "Allow authenticated users to create organizations"
    on public.organizations for insert
    with check (auth.role() = 'authenticated');
create policy "Allow organization admins to update their organizations"
    on public.organizations for update
    using (public.is_org_admin(id));

-- --- organization_members policies ---
create policy "Allow members to view members of their organizations"
    on public.organization_members for select
    using (public.is_org_member(organization_id));
create policy "Allow organization admins to add members"
    on public.organization_members for insert
    with check (public.is_org_admin(organization_id));
create policy "Allow organization admins to update members"
    on public.organization_members for update
    using (public.is_org_admin(organization_id));
create policy "Allow organization admins to remove members"
    on public.organization_members for delete
    using (public.is_org_admin(organization_id));

-- --- subscriptions policies ---
create policy "Allow members to view their organization subscriptions"
    on public.subscriptions for select
    using (public.is_org_member(organization_id));
-- Write operations are restricted to service role (Stripe Webhook), which bypasses RLS

-- --- agents policies ---
create policy "Allow members to view their organization agents"
    on public.agents for select
    using (public.is_org_member(organization_id));
create policy "Allow members to manage their organization agents"
    on public.agents for all
    using (public.is_org_member(organization_id))
    with check (public.is_org_member(organization_id));

-- --- call_logs policies ---
create policy "Allow members to view their organization call logs"
    on public.call_logs for select
    using (public.is_org_member(organization_id));
create policy "Allow members to insert call logs"
    on public.call_logs for insert
    with check (public.is_org_member(organization_id));

-- --- usage_records policies ---
create policy "Allow members to view their organization usage records"
    on public.usage_records for select
    using (public.is_org_member(organization_id));
create policy "Allow members to insert usage records"
    on public.usage_records for insert
    with check (public.is_org_member(organization_id));

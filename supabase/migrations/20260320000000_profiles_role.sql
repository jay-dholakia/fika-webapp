-- Add role to profiles for admin portal (Google auth). Default 'user'; set to 'admin' for admin access.
alter table public.profiles
  add column if not exists role text not null default 'user';

comment on column public.profiles.role is 'User role: user (default), admin (can access /admin and manage markets).';

-- Optional: constrain allowed values for future roles
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin'));

-- To set your first admin after sign-up: run in SQL editor or dashboard:
--   update public.profiles set role = 'admin' where id = auth.uid();
-- Or by email (if you have a way to resolve it): update from auth.users and set that profile's role to 'admin'.

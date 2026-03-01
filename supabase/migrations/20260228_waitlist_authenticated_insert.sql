-- Allow authenticated users (e.g. after Google sign-in for waitlist) to insert into waitlist.
-- Restrict so they can only insert a row with their own email.
create policy "Authenticated users can insert own email into waitlist"
  on public.waitlist for insert
  to authenticated
  with check (
    lower(trim(email)) = (select lower(email) from auth.users where id = auth.uid())
  );

-- Send reminder SMS for onboarding sessions that are inactive for 3+ hours.
-- Runs every 30 minutes.

do $$
begin
  -- pg_cron throws if the job doesn't exist yet, so we ignore that case.
  perform cron.unschedule('sms-onboarding-reminder');
exception
  when others then null;
end $$;

select cron.schedule(
  'sms-onboarding-reminder',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sms-onboarding-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);


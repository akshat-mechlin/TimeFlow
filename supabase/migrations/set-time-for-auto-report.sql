do $$
begin
  perform cron.unschedule('send-monthly-auto-reports');
exception when others then null;
end $$;

select cron.schedule(
  'send-monthly-auto-reports',
  '0 9 1,25 * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-manager-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := jsonb_build_object(
      'cronSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'monthlyAuto', true
    )
  ) as request_id;
  $$
);

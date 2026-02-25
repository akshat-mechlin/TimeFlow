# Email reports to managers (Microsoft 365)

Reports (attendance and tracker) can be sent automatically to each manager for their team via **Microsoft 365** email.

---

## Quick: Use `hrms@mechlintech.com` as the sender

To send all report emails **from** `hrms@mechlintech.com`:

1. **Use that mailbox in Microsoft 365**  
   The account **hrms@mechlintech.com** must exist in your Microsoft 365 (Mechlin) tenant and have a mailbox. It can be a shared mailbox or a normal user—either is fine.

2. **Set the “from” address in Supabase**  
   In your Supabase project:
   - Go to **Project Settings** → **Edge Functions** → **Secrets** (or **Settings** → **Edge Functions** → **Secrets**).
   - Add or edit the secret:
     - **Name:** `MICROSOFT_FROM_EMAIL`
     - **Value:** `hrms@mechlintech.com`
   - Save.

   After this, the Edge Function will send every manager report **from** `hrms@mechlintech.com`. No code change is needed.

3. **Other required secrets**  
   You still need these four secrets set for the function to work:
   - `MICROSOFT_TENANT_ID` – your Azure AD (Mechlin) tenant ID  
   - `MICROSOFT_CLIENT_ID` – your Azure app (client) ID  
   - `MICROSOFT_CLIENT_SECRET` – the app’s client secret  
   - `MICROSOFT_FROM_EMAIL` – **`hrms@mechlintech.com`** (the sender address)

---

## How it works

- **Who can trigger “Send reports now”:**
  - **Admins:** Send to **all managers** (each manager gets their team’s report). HR and Payroll emails (if configured) also receive a copy of each report.
  - **Managers:** Send only to **themselves** (their own team’s report). HR and Payroll also receive a copy.
- **Who receives:** Each manager with a valid **email** in `profiles` receives their team’s report. Additional recipients (HR and Payroll) are configured in **Admin Panel → System Settings → Report Recipients (HR & Payroll)** (admin only).
- **Content:** Each email includes:
  - **Attendance report** – daily status (Present / Half day / Absent) and hours for each employee in the manager’s team.
  - **Tracker report** – time by project per employee and subtotals.
  - **Leaves** – approved leaves in the period (employee, leave type, dates, reason).

The date range is the same as the one selected on the Reports page when you click “Send reports now”.

## Microsoft 365 setup

Sending uses **Microsoft Graph API** with **client credentials** (application permission). You need an Azure AD app and Supabase Edge Function secrets.

### 1. Azure AD app registration

1. In [Azure Portal](https://portal.azure.com) go to **Azure Active Directory** → **App registrations** → **New registration**.
2. Name the app (e.g. “TimeFlow Reports”) and choose **Accounts in this organizational directory only**. Register.
3. Note:
   - **Application (client) ID**
   - **Directory (tenant) ID** (from the app’s “Overview” page).

### 2. Client secret

1. In the app: **Certificates & secrets** → **New client secret**.
2. Add a description, choose an expiry, and create.
3. Copy the **Value** (client secret) once; it’s not shown again.

### 3. API permission

1. In the app: **API permissions** → **Add a permission**.
2. Choose **Microsoft Graph** → **Application permissions**.
3. Add **Mail.Send**.
4. Click **Grant admin consent for &lt;your tenant&gt;** so the app can send mail.

### 4. Mailbox to send from

Graph will send mail **as** a user in your tenant. You need a mailbox that is allowed to send (e.g. a shared mailbox or a service account like `no-reply@yourdomain.com`).

- That user must exist in the same Azure AD tenant.
- Use their **User Principal Name (UPN)** or **email** as the “from” address (e.g. `no-reply@yourdomain.com`).

### 5. Supabase Edge Function secrets

The Edge Function `send-manager-reports` reads these **secrets** from your Supabase project (Dashboard → Project Settings → Edge Functions → Secrets, or via [Supabase CLI](https://supabase.com/docs/guides/functions/secrets)):

| Secret | Description |
|--------|-------------|
| `MICROSOFT_TENANT_ID` | Azure AD Directory (tenant) ID |
| `MICROSOFT_CLIENT_ID` | Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | Client secret value |
| `MICROSOFT_FROM_EMAIL` | **Sender address** – the email that appears in “From”. Use your HR mailbox, e.g. `hrms@mechlintech.com`. |

Example for sending from **hrms@mechlintech.com** (replace the placeholder IDs and secret with your Azure app values):

```bash
MICROSOFT_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=your-client-secret-value
MICROSOFT_FROM_EMAIL=hrms@mechlintech.com
```

**Where to set these:** Supabase Dashboard → your project → **Project Settings** → **Edge Functions** → **Secrets**. Add each name and value, then save.

### 6. Deploy the Edge Functions

Deploy the functions so Supabase can run them:

```bash
# From project root
npx supabase functions deploy send-manager-reports
npx supabase functions deploy send-weekly-reports
```

If you use the Supabase Dashboard, you can instead create the functions there and paste the code from `supabase/functions/send-manager-reports/index.ts` and `supabase/functions/send-weekly-reports/index.ts`.

## Report recipients (HR & Payroll)

Admins can configure additional email recipients that receive every report (manual and weekly):

1. Log in as an **admin**.
2. Go to **Admin Panel** → **System Settings**.
3. In **Report Recipients (HR & Payroll)**, enter HR team emails and Payroll team emails (comma- or newline-separated).
4. Click **Save report recipients**.

These addresses receive the same report emails as managers (per-run for “Send reports now”, and the weekly Excel report when the weekly job runs).

## Sending reports

1. Log in as an **admin** or **manager**.
2. Open **Reports** and set the **date range** you want (for “Send reports now”).
3. Click **“Send reports now”** in the “Email reports to managers” section.
   - **Admin:** All managers receive their team’s report; HR and Payroll (if configured) receive copies.
   - **Manager:** You receive your team’s report; HR and Payroll receive a copy.
4. **(Admin only)** To send the **weekly report** (previous Monday–Saturday) as an **Excel attachment** to all managers and HR/Payroll, click **“Send weekly report now”**. The Excel contains: Summary (total week hours), Project-wise, Leaves, and Day-wise (Mon–Sat) sheets.

## Automatic (scheduled) sending

### Weekly report every Monday

To send the **weekly report** (previous week Mon–Sat) automatically every Monday:

1. **Set a cron secret** in Supabase Edge Function secrets:
   - Name: `CRON_SECRET`
   - Value: a long random string (e.g. from `openssl rand -base64 32`).

2. **Enable pg_cron and pg_net** in your Supabase project (Database → Extensions).

3. **Schedule the weekly function** (e.g. every Monday at 9:00 AM UTC). In the SQL Editor, run (replace `YOUR_CRON_SECRET` and your project URL/anon key if using Vault):

```sql
-- Store secrets in Vault first (if not already):
-- select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
-- select vault.create_secret('YOUR_ANON_KEY', 'anon_key');

select cron.schedule(
  'send-weekly-reports-monday',
  '0 9 * * 1',  -- Every Monday at 09:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-weekly-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := jsonb_build_object('cronSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  ) as request_id;
  $$
);
```

Alternatively, use an external cron (e.g. [cron-job.org](https://cron-job.org)) that POSTs to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-weekly-reports` with body `{"cronSecret": "YOUR_CRON_SECRET"}` and no auth (the secret in the body authorizes the run).

### Manual “Send reports now” on a schedule

To run the **date-range report** (same as “Send reports now”) on a schedule, use an external cron that calls `send-manager-reports` with a valid **admin JWT** in the `Authorization: Bearer <token>` header and body:

```json
{ "startDate": "2026-02-10", "endDate": "2026-02-16" }
```

Store and rotate the admin token securely.

## Troubleshooting

- **“Microsoft 365 email not configured”**  
  One or more of the four secrets above are missing. Add them in Supabase Edge Function secrets.

- **“Only admins can send reports to managers”**  
  The docs previously said only admins; both **admins** and **managers** can use “Send reports now” (admin sends to all managers, manager sends to themselves). Only **admins** can use “Send weekly report now” and configure HR/Payroll recipients.

- **Managers don’t receive email**  
  - Ensure each manager has `profiles.email` set and that it’s a valid Microsoft 365 mailbox if you’re sending inside the same tenant.  
  - Check Edge Function logs in the Supabase Dashboard for Graph API errors (e.g. permission or “from” address issues).

- **Graph API 403 / Mail.Send**  
  Ensure **Mail.Send** is added as an **application** permission and **admin consent** has been granted for your tenant.

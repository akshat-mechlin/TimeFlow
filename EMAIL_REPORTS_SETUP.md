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

- **Who can trigger:** Only **admins** can use “Send reports now” on the Reports page.
- **Who receives:** Each user with role **manager** and a valid **email** in `profiles` receives one email per report run.
- **Content:** Each email includes:
  - **Attendance report** – daily status (Present / Half day / Absent) and hours for each employee in the manager’s team.
  - **Tracker report** – time by project per employee and subtotals.

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

### 6. Deploy the Edge Function

Deploy the function so Supabase can run it:

```bash
# From project root
npx supabase functions deploy send-manager-reports
```

If you use the Supabase Dashboard, you can instead create the function there and paste the code from `supabase/functions/send-manager-reports/index.ts`.

## Sending reports

1. Log in as an **admin**.
2. Open **Reports** and set the **date range** you want.
3. Click **“Send reports now”** in the “Email reports to managers” section.
4. Each manager (with an email in their profile) receives one email with their team’s attendance and tracker report for that period.

## Automatic (scheduled) sending

The app does not run a built-in schedule. To send reports automatically (e.g. daily or weekly):

- Use an external cron (e.g. [cron-job.org](https://cron-job.org), GitHub Actions, or your own server) that calls the Edge Function **with a valid admin JWT** in the `Authorization: Bearer <token>` header, and body:

  ```json
  { "startDate": "2026-02-10", "endDate": "2026-02-16" }
  ```

- Or use Supabase’s [pg_cron](https://supabase.com/docs/guides/database/extensions/pgcron) (or similar) to trigger an HTTP request to the function with an admin token (store the token securely and rotate as needed).

## Troubleshooting

- **“Microsoft 365 email not configured”**  
  One or more of the four secrets above are missing. Add them in Supabase Edge Function secrets.

- **“Only admins can send reports to managers”**  
  The user calling the function must have `role = 'admin'` in `profiles`.

- **Managers don’t receive email**  
  - Ensure each manager has `profiles.email` set and that it’s a valid Microsoft 365 mailbox if you’re sending inside the same tenant.  
  - Check Edge Function logs in the Supabase Dashboard for Graph API errors (e.g. permission or “from” address issues).

- **Graph API 403 / Mail.Send**  
  Ensure **Mail.Send** is added as an **application** permission and **admin consent** has been granted for your tenant.

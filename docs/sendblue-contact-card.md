# Sendblue contact card setup

Once you own the Sendblue line, run this **once** so recipients see "Fika ☕" and your logo when they get messages from the concierge number.

## Prerequisites

- `SENDBLUE_CONCIERGE_NUMBER`, `SENDBLUE_API_KEY_ID`, and `SENDBLUE_API_SECRET_KEY` set in Vercel (and in `.env.local` for local runs).
- Optional: `SENDBLUE_CONCIERGE_CONTACT_PHOTO_URL` — public JPEG/PNG URL for the contact photo. If unset, the app uses `https://<your-app-url>/logo-contact.png` (see `public/logo-contact.png`).

## Run the setup

**Production (Vercel)**

If you use `CRON_SECRET` in Vercel, call the setup route with it:

```bash
curl -X POST "https://letsfika.vercel.app/api/setup/concierge-contact" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

If you do **not** set `CRON_SECRET`, the route allows unauthenticated requests (one-time setup only). Omit the header:

```bash
curl -X POST "https://letsfika.vercel.app/api/setup/concierge-contact"
```

**Local**

With `.env.local` filled (including Sendblue keys and concierge number):

```bash
curl -X POST "http://localhost:3000/api/setup/concierge-contact" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

(Or omit the header if `CRON_SECRET` is not set.)

## Check that it’s set

```bash
curl "https://letsfika.vercel.app/api/setup/concierge-contact?check=1" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

You should see `ok: true` and a `state` object with `hasProfile`, `displayName`, etc.

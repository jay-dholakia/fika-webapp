# Add Google (Gmail) sign-in

To enable "Sign in with Google" for sign-up and login:

## 1. Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select an existing one.
3. **APIs & Services → Credentials** → **Create credentials** → **OAuth client ID**.
4. If prompted, configure the **OAuth consent screen** (External, add your app name and support email).
5. Application type: **Web application**.
6. **Authorized JavaScript origins**
   - `http://localhost:3000` (local)
   - Your production origin, e.g. `https://your-app.vercel.app`
   - Your Supabase project URL, e.g. `https://<project-ref>.supabase.co`
7. **Authorized redirect URIs**
   - Add: `https://<project-ref>.supabase.co/auth/v1/callback`  
     (Find your project ref in Supabase: Project Settings → General → Reference ID.)
8. Create and copy the **Client ID** and **Client secret**.

## 2. Supabase Dashboard

1. Open your project → **Authentication** → **Providers**.
2. Find **Google** and enable it.
3. Paste **Client ID** and **Client secret** from Google.
4. **Authentication** → **URL Configuration**:
   - **Redirect URLs**: add your app URLs, e.g.  
     `http://localhost:3000/app`,  
     `https://your-app.vercel.app/app`.

Save. The app's "Continue with Google" button will then sign users in and create an account on first use.

## 3. App code (already in place)

- **Login** (`/login`) and **Signup** (`/signup`) each have a "Continue with Google" button that calls `signInWithOAuth({ provider: 'google' })` and redirects to Google.
- After OAuth, Supabase redirects to `/app`. The app layout ensures a **profile** row exists for the user (using Google display name if available).
- **Waitlist** (when user is not in LA) is **email-only**: users enter their email and consent to receive launch emails; no OAuth is used for the waitlist.

No extra env vars are required; Supabase uses the credentials stored in the dashboard.

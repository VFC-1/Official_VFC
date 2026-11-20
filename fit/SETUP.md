# Leanline — setup guide

Leanline lives in the `fit/` folder. Everything except AI photo estimates works on its own.

## 1. Put the app online (GitHub Pages)

1. Merge the branch `claude/optimistic-cray-i1umj5` into `main` (open a pull request on GitHub and tap **Merge**).
2. On GitHub, open the repo → **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. Wait 1–2 minutes. The app is at **https://vfc-1.github.io/Official_VFC/fit/**

## 2. Add it to your iPhone Home Screen

1. Open the link above in **Safari**. Other browsers can't install it.
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**. Make sure **Open as Web App** is on, then tap **Add**.
4. Open **Leanline** from your Home Screen. It runs full-screen like a normal app and works offline.

> Your data is saved inside the Home Screen app on this phone. Use **Me → Backup → Export** now and then to save a copy to Files or iCloud Drive.

## 3. Turn on AI calorie estimates (photos + descriptions), about 10 minutes

The app sends photos to a small server function (`api/estimate.js`). That function holds your Claude API key, so the key never appears in the web page.

### a) Get a Claude API key
1. Go to **https://console.anthropic.com** and sign up or log in.
2. **Billing**: add a few dollars of credit. Each estimate costs a cent or two.
3. **API Keys → Create Key**. Copy it (it starts with `sk-ant-`). Keep it secret.

### b) Deploy the function on Vercel (free; works from your phone)
1. Go to **https://vercel.com** and **Sign up with GitHub**.
2. **Add New → Project** → import **Official_VFC**.
3. Before you click Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
   | `APP_PASSCODE` | any secret word you make up, e.g. `tacos4life` |
   | `ALLOWED_ORIGIN` | `https://vfc-1.github.io` |

4. Tap **Deploy**. When it finishes, copy your domain, e.g. `official-vfc.vercel.app`.

### c) Connect the app
1. In Leanline, open **Me → AI estimates**.
2. **Estimator URL**: `https://YOUR-DOMAIN.vercel.app/api/estimate`
3. **Passcode**: the same word you used for `APP_PASSCODE`.
4. Tap **Save**, then **Test**. You should see "✅ Works! 1 banana ≈ 105 cal".

Done. Photos, and descriptions like "chipotle bowl with extra rice" or "45 min spin class", now get estimated by Claude.

**To change the key later:** Vercel → your project → Settings → Environment Variables → edit → then Deployments → ⋯ → Redeploy.

## How the numbers work

- **Daily target (net calories)** = maintenance (Mifflin-St Jeor BMR × activity level) − 500, which is about 1 lb a week. If you set a target date, the deficit adjusts to hit it (between 250 and 1,000 a day). It never goes below 1,500 (male) or 1,200 (female). It updates as your weight drops.
- **Net** = eaten − exercise burned.
- **Day score (0–100)**: calories on target 60, logging 20 (3+ meals = 17, plus 3 for a weigh-in), exercise 20 (full points at 300+ cal burned). Eating far below target doesn't earn full points.
- **Streaks**: logging streak (any food logged) and on-target streak. Today counts once you log; until then, your streak from yesterday stays alive.
- **Projected goal date**: from the trend line of your last 30 days of weigh-ins, or from your average calorie deficit if you don't have enough weigh-ins yet.
- **Fast food**: built-in menus for 15 chains use approximate published calories for the standard build. Tweaks such as "no mayo" or "diet" adjust them. Typing an order like "Big Mac and large fries" in the Food box matches the menu automatically.
- **Workout calories**: if you enter heart rate, the estimate uses a heart-rate formula (Keytel). Otherwise runs and walks with a distance use per-mile burn for your weight, and everything else uses MET values × intensity × minutes. Only calories above your resting burn count. Choose "I know my calories" to use your watch's number instead.
- **Streak ranks**: based on your logging streak. Bronze I/II/III at 1/3/5 days, Silver at 7/10/14, Gold at 21/30/45, Diamond at 60/90/120. If the streak breaks, your rank drops with it, but your highest rank is saved.
- **Daily inspiration**: by default the Today screen alternates a Bible verse (NABRE) and a motivational quote each day. Tap Verse or Quote on the card to switch for the day, or pick Verses only or Quotes only in Me → Daily inspiration. Verse text is copied from bible.usccb.org, with the NABRE copyright notice shown in Me.

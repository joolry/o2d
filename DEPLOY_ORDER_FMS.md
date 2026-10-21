# Joolry Order FMS — Full Deploy Guide

**App:** Joolry Order FMS  
**Theme:** Black / Cream / Soft coral (same as joolry.in)

---

## 1. Google Apps Script (Code.gs)

1. Open FMS sheet → **Extensions → Apps Script**
2. Paste entire `Code.gs`
3. Set:
   ```js
   var API_SECRET = 'your-long-random-secret';
   ```
4. Deploy → New deployment → Web app  
   - Execute as: **Me**  
   - Who has access: **Anyone**
5. Copy the **Web App URL**

Optional: run `setupShopifySyncTrigger()` once (every 5 min Shopify → FMS).

---

## 2. Vercel Project

### Files to push
```
api/               ← all 6 files
index.html
app.js
app.css
appconfig.js
core.js
manifest.json
sw.js
package.json
vercel.json
.gitignore
icon-192.png       ← copy from existing taskapp or make new
icon-512.png
icon-180.png
```

### Environment Variables

| Key | Value |
|-----|-------|
| `GAS_URL` | Web App URL from step 1 |
| `GAS_SECRET` | same as `API_SECRET` in Code.gs |
| `SESSION_SECRET` | long random string |
| `SYNC_SECRET` | long random string |
| `SNAPSHOT` | `on` |
| `FIREBASE_SERVICE_ACCOUNT` | full JSON or base64 of service account |

### First warm-up after deploy
```
https://YOUR-APP.vercel.app/api/sync?secret=YOUR_SYNC_SECRET&full=1
```

---

## 3. Icons

Copy the existing `icon-*.png` from taskapp, or generate new ones.  
Place them in the project root (same level as index.html).

---

## 4. How the app works

```
Browser  →  /api/rpc  →  Firestore SNAP (fast)  or  GAS (writes + miss)
Writes   →  GAS → FMS Sheet → background getSnapshot → Firestore
Shopify  →  ShopifyIntegration sheet → syncFromShopify() → FMS Orders
```

---

## 5. Login users

Users tab in FMS sheet:

| Username | Role | Notes |
|----------|------|-------|
| admin | Admin | sees everything |
| atul | Ops | Boxes where allowed |
| pooja | Ops | Boxes where allowed |

First login sets the password hash automatically.

---

## 6. Rollback

Set `SNAPSHOT=off` on Vercel → all reads go live to GAS again.

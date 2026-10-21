# Joolry Order FMS — Backend Artifacts

## Files

```
order-fms-api/
├── Code.gs                 ← Apps Script (paste into the FMS Google Sheet)
└── api/
    ├── _lib.js
    ├── _store.js
    ├── _cache.js
    ├── _snapServe.js
    ├── rpc.js
    └── sync.js
```

## 1. Deploy Code.gs (Google Apps Script)

1. Open your FMS sheet:  
   https://docs.google.com/spreadsheets/d/1Q70HA-qGioB237IATinZBLmMCSHMLgn99y8cGUZMWWM
2. **Extensions → Apps Script**
3. Delete any old code → paste the entire `Code.gs`
4. Change this line:
   ```js
   var API_SECRET = 'CHANGE_ME_TO_LONG_RANDOM_STRING';
   ```
   to a long random string (same value you will put in Vercel as `GAS_SECRET`)
5. **Save** → **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL

### Optional: Auto-sync Shopify every 5 min
In the Apps Script editor run once:
```
setupShopifySyncTrigger()
```

## 2. Vercel / api/ folder

Copy the whole `api/` folder into your Vercel project (or a new repo).

### Environment Variables (Vercel)

| Key | Value |
|-----|-------|
| `GAS_URL` | the Web App URL from step 1 |
| `GAS_SECRET` | same as `API_SECRET` in Code.gs |
| `SESSION_SECRET` | long random string |
| `SYNC_SECRET` | long random string |
| `SNAPSHOT` | `on` (or `off` for pure GAS) |
| `FIREBASE_SERVICE_ACCOUNT` | full JSON or base64 of service account |

### First warm-up
After deploy:
```
https://YOUR-VERCEL-APP.vercel.app/api/sync?secret=YOUR_SYNC_SECRET&full=1
```

## 3. What works out of the box

| Action | Description |
|--------|-------------|
| `login` | username + password → token |
| `getBootData` | user + open count + config + steps |
| `getOrders` | list (filter: open / all) |
| `getOrderDetail` | one order + its items |
| `markBoxDone` | Box 2-5 → Actual + Status + Done By |
| `updateCourier` | Courier / AWB / Auto-Update |
| `syncFromShopify` | pull new orders from ShopifyIntegration sheet |
| `getSnapshot` | full payload for Firestore cache |

## 4. Shopify → FMS flow

- Shopify webhook → ShopifyIntegration sheet (already working)
- Every 5 min (or manual) `syncFromShopify` copies new `#xxxx` orders into FMS Orders + Order_Items
- Staff app only talks to FMS sheet via this backend

## Notes

- Password: first login sets SHA-256 hash automatically.
- Box permissions come from **Steps → Allowed Usernames**.
- Admin role sees / can complete everything.
- Overall Status & Current Box are still calculated by the sheet formulas.

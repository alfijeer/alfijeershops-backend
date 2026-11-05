# v10 — what changed

1. **Report this shop** — models/ShopReport.js, controllers/reportController.js, routes/reportRoutes.js (`/api/reports`). Admin: Shop Reports tab.
2. **Verification badges** — Seller.isVerified; admin opens the ID (logged) and verifies; badge shows only on verified shops.
3. **Saved-shop alerts** — Buyer.savedShops + `/api/buyers/saved`; services/shopAlertRules.js (rules) + shopAlerts.js (sending); hooked into productController.
4. **Soft delete** — delete → 30 days in the admin "Deleted" tab → Restore, or removed for good by services/shopPurge.js.

## After deploying
- `node scripts/flagDeletedShops.js` once (marks shops deleted before v9).
- Existing shops start WITHOUT the verified badge. Verify them one by one from the admin panel.
- Web-push needs VAPID keys (`npm run vapid`) for the alerts to be delivered.
- `npm test`

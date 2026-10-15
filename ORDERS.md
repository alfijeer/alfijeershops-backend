ALFIJEER ORDER SYSTEM: WHAT CHANGED IN YOUR BACKEND

NEW OR REPLACED FILES
  models/Order.js              REPLACED. Same field names as before (buyer, seller, orderId) so buyerController,
                               sellerController and the Dispute model keep working. Status is now the 13-status workflow.
  models/AdminLog.js           NEW. Records every admin decision and every proof view.
  models/Seller.js             +3 fields: strikes, completedOrders, disputeCount.
  controllers/sellerController.js  admin list now includes those 3 fields (public list does not).
  routes/orderRoutes.js        REPLACED. Buyer and seller routes.
  routes/adminOrderRoutes.js   NEW. Mounted at /api/admin.
  controllers/orderController.js  REMOVED (its work is now in services/).
  services/workflow.js         NEW. Every rule (who, from which status, to which status). Pure and tested.
  services/orderService.js     NEW. Saves changes safely, writes history, counts strikes.
  services/timers.js           NEW. Moves overdue orders every 5 minutes (started from server.js).
  services/shopStats.js        NEW. Shop analytics, calculated from orders.
  middleware/orderRoles.js     NEW. Finds the seller's shop through Seller.user.
  middleware/proofUpload.js    NEW. Payment receipts go to a PRIVATE Cloudinary folder.
  config/orders.js             NEW. Every deadline, limit and threshold in one place.
  utils/orderNumber.js         NEW. ALF-20261004-0001, using your existing Counter model.
  scripts/migrateOrders.js     NEW. One-time conversion of old orders.
  server.js                    +3 lines: mounts /api/admin, starts the timers.

HOW TO INSTALL
  1. Copy these files over your backend (keep everything else as it is). No new npm packages are needed.
  2. BEFORE deploying, convert existing orders:   npm run migrate:orders            (shows what it would do)
                                                    npm run migrate:orders -- --apply (does it)
     Old orders have no payment step: new -> PENDING, confirmed -> PAYMENT_CONFIRMED, completed -> COMPLETED,
     cancelled -> CANCELLED. Pending and confirmed ones get a fresh deadline clock.
  3. Run the tests (no database needed):   npm test
  4. Deploy backend FIRST, then the frontend files. The new pages call the new routes.

ROUTES (all under /api)
  POST /orders                          buyer places an order { shopId, items: [{ productId, quantity }] }
  GET  /orders/mine                     buyer's orders
  GET  /orders/shop  (also /orders/seller)   seller's orders
  GET  /orders/:id                      one order (its buyer or its shop only)
  POST /orders/:id/proof                buyer uploads a receipt (multipart field "proof"), only in PAYMENT_ISSUE
  POST /orders/:id/dispute              buyer reports "not as ordered" (multipart: reason + up to 3 optional photos, field "evidence"),
                                        only while the order is DELIVERED. Photos go to the same private folder as payment proofs.
  POST /orders/:id/actions/:ACTION      a button press (see below)

  Buyer actions:  BUYER_CANCEL, BUYER_PAID {method}, BUYER_REPORT_PAYMENT_ISSUE {reason}, BUYER_CONFIRM_RECEIPT,
                  BUYER_DISPUTE {reason}, BUYER_CONFIRM_REFUND
  Seller actions: SELLER_ACCEPT, SELLER_DECLINE, SELLER_CONFIRM_PAYMENT, SELLER_REPORT_PAYMENT_ISSUE {reason},
                  SELLER_DELIVER, SELLER_REQUEST_CANCEL {reason}

  GET  /admin/orders?status=&shopId=&limit=       all orders
  GET  /admin/orders/:id/payment-proof            5-minute private link; logged; only in issue statuses
  GET  /admin/orders/:id/dispute-evidence         the buyer's dispute photos as 5-minute private links; each view is logged
  PUT  /admin/orders/:id/resolve                  { decision, reason, faultParty? }
  GET  /admin/shops/:id/order-stats?range=all|30d|7d

THINGS TO KNOW
  - Old dispute routes (/api/disputes) are untouched but no longer used by the new flow: disputes now live on the order
    and are decided from the admin Orders page. You can retire them later.
  - Payment proof is only requested when a payment issue opens. It is stored privately and admin gets a link that
    expires after 5 minutes (PROOF_LINK_SECONDS in config/orders.js).
  - A suspended buyer cannot place new orders. A suspended shop cannot receive new orders, but its open orders continue.
  - Not tested against a live database or Cloudinary (neither was available while writing). Test one full order
    (place, accept, pay, confirm, deliver, complete) and one payment issue with a receipt upload before launch.

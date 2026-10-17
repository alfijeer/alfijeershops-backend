ALFIJEER ORDER SYSTEM (VERSION 1: PICKUP AND DELIVERY)

THE FLOW
  Pickup:    PENDING > ACCEPTED > PAYMENT_SUBMITTED > PAYMENT_CONFIRMED > DELIVERED > COMPLETED
  Delivery:  PENDING > ACCEPTED > TOTAL_SENT > TOTAL_ACCEPTED > PAYMENT_SUBMITTED > PAYMENT_CONFIRMED > DELIVERED > COMPLETED
  Problems (unchanged): PAYMENT_ISSUE, DELIVERY_REVIEW, DISPUTED, REPLACEMENT_PENDING, REFUND_PENDING, REFUNDED, CANCELLED. Admin decides these.

  - The buyer chooses pickup or delivery when placing the order. Delivery needs name, phone and address (landmark and note optional).
  - Pickup has no total step: the price is already known.
  - Delivery: after accepting, the seller enters ONLY the delivery fee (0 to MAX_DELIVERY_FEE) and sends the total. The buyer sees
    product total + fee + total, with the fixed notice "Delivery fee is based on the delivery location and the current rider's charge."
    The buyer accepts the total or cancels. The fee cannot be changed once sent.
  - Alfijeer never receives or holds money. The buyer pays the seller's bank account directly.

BANK DETAILS
  - A seller cannot register without bank name, account name and a 10 digit account number (auth.html + POST /auth/register).
  - Sellers edit them under Seller Dashboard > Settings > Payment Details (PUT /sellers/profile with bankName, accountName, accountNumber).
  - A seller cannot accept an order without complete details: "Complete your payment details before accepting customer orders."
  - The buyer sees them only after the seller accepted (pickup) or the buyer accepted the total (delivery). At that moment a COPY is saved on
    the order (order.paymentDetails), so later edits never change an order in progress.
  - Seller.bankDetails is hidden from every query by default (select: false). It never appears in public shop data.

RECEIPTS (private)
  - At "I have paid" the buyer may upload a receipt and a transfer reference (both optional): POST /orders/:id/pay.
  - The receipt is stored in a PRIVATE Cloudinary folder. The browser never gets its link, only payment.hasProof.
  - The buyer of the order and the shop it was placed with can open it: GET /orders/:id/receipt returns a link that expires in 5 minutes.
    Nobody else can. Admin opens it through GET /admin/orders/:id/payment-proof (logged, only in issue statuses, as before).

FAIR TIMERS: each deadline belongs to whoever must act next
  PENDING            seller must accept or decline            48h   late: cancelled (SELLER_TIMEOUT)
  ACCEPTED, pickup   buyer must pay                           48h   late: cancelled (PAYMENT_DEADLINE_EXPIRED)
  ACCEPTED, delivery seller must send the total               24h   late: cancelled (SELLER_NO_TOTAL, counts against the shop)
  TOTAL_SENT         buyer must accept or cancel              24h   late: cancelled (TOTAL_EXPIRED, not held against the shop)
  TOTAL_ACCEPTED     buyer must pay                           48h   late: cancelled (PAYMENT_DEADLINE_EXPIRED)
  PAYMENT_SUBMITTED  seller must confirm the money            24h   late: PAYMENT_ISSUE for admin
  PAYMENT_CONFIRMED  seller must deliver                      7d    late: DELIVERY_REVIEW for admin (nobody is struck automatically;
                                                                    for pickup the buyer may not have come, so admin decides who was at fault)
  DELIVERED          buyer must confirm or report a problem   72h   late: auto-completed
  All hours live in config/orders.js.

ROUTES (all under /api)
  POST /orders                          { shopId, items: [{ productId, quantity }], fulfilment: 'PICKUP'|'DELIVERY', delivery?: { name, phone, address, landmark?, note? } }
  GET  /orders/mine                     buyer's orders
  GET  /orders/shop  (also /orders/seller)   seller's orders
  GET  /orders/:id                      one order (its buyer or its shop only)
  POST /orders/:id/pay                  "I have paid": multipart { method, reference?, receipt? }
  GET  /orders/:id/receipt              short-lived private link to the receipt (buyer of the order, or its shop)
  POST /orders/:id/proof                buyer replaces the receipt while in PAYMENT_ISSUE (multipart field "proof")
  POST /orders/:id/dispute              buyer reports "not as ordered" (multipart: reason + up to 3 optional photos, field "evidence")
  POST /orders/:id/actions/:ACTION      a button press. File links in the body are ignored: files only come in through the upload routes.

  Buyer actions:  BUYER_CANCEL, BUYER_ACCEPT_TOTAL, BUYER_DECLINE_TOTAL, BUYER_PAID {method, reference?}, BUYER_REPORT_PAYMENT_ISSUE {reason},
                  BUYER_CONFIRM_RECEIPT, BUYER_DISPUTE {reason}, BUYER_CONFIRM_REFUND
  Seller actions: SELLER_ACCEPT, SELLER_DECLINE {reason?}, SELLER_SEND_TOTAL {deliveryFee}, SELLER_CONFIRM_PAYMENT,
                  SELLER_REPORT_PAYMENT_ISSUE {reason}, SELLER_DELIVER, SELLER_REQUEST_CANCEL {reason}

  GET  /admin/orders?status=&shopId=&limit=       all orders
  GET  /admin/orders/:id/payment-proof            5-minute private link; logged; only in issue statuses
  GET  /admin/orders/:id/dispute-evidence         the buyer's dispute photos as 5-minute private links; each view is logged
  PUT  /admin/orders/:id/resolve                  { decision, reason, faultParty? }
  GET  /admin/shops/:id/order-stats?range=all|30d|7d

INSTALL / UPGRADE
  1. Back up the database.
  2. Deploy the backend FIRST (no new npm packages are needed).
  3. Convert orders that are already in progress:
       npm run migrate:orders-v1            shows what it would do, changes nothing
       npm run migrate:orders-v1 -- --apply does it
     Every existing order becomes a pickup order, which is the flow it was already following, so NO status or deadline changes.
     Orders waiting for payment get the seller's bank details copied on if the seller has saved them. The script lists shops that have
     waiting orders but no bank details, so you can ask them to add them. It is safe to run twice.
     (Orders from the very old system still need:  npm run migrate:orders  first.)
  4. Deploy the frontend files.
  5. Existing approved sellers have no bank details yet: they must add them under Settings > Payment Details before they can accept
     orders. The seller dashboard shows a reminder until they do.
  6. Run the tests (no database needed):   npm test

THINGS TO KNOW
  - Old dispute routes (/api/disputes) are untouched but no longer used by the new flow.
  - A suspended buyer cannot place new orders. A suspended shop cannot receive new orders, but its open orders continue.
  - Not tested against a live database or Cloudinary (neither was available while writing). Before launch, test with real accounts:
    one pickup order, one delivery order (fee, accept total, pay with a receipt, seller opens the receipt), a seller with no bank
    details trying to accept, and one payment issue.

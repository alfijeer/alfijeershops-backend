# ALFIJEER — Backend API

Node.js + Express + MongoDB REST API powering the ALFIJEER marketplace.
Built to match the frontend exactly — every endpoint, field name, and status
code here is what `auth.html`, `buyer-dashboard.html`, `seller-dashboard.html`,
`shop-detail.html`, `directions.html`, `admin.html`, and `admin-payments.html`
already call.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your real MongoDB URI and JWT secret
npm run dev             # nodemon, for local development
npm start                # plain node, for production
```

Requires Node.js 18+ and a MongoDB database (MongoDB Atlas recommended —
the free tier is enough to start).

## Project structure

```
config/db.js          MongoDB connection
models/                Mongoose schemas (User, Seller, Buyer, Product, Order, Dispute, Counter)
middleware/auth.js     JWT verification + role checks (protect, requireRole, optionalAuth)
middleware/upload.js   Multer file uploads (see "Known gap" below)
middleware/errorHandler.js   Centralized error responses
controllers/            Route handler logic, one file per resource
routes/                  Route definitions, wired to controllers
utils/                   Small helpers (JWT signing, order IDs, async wrapper)
server.js                App entry point — security middleware, CORS, rate limiting, routes
```

## API contract

All routes are prefixed with `/api`.

### Auth
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | JSON body for buyers (`role: 'buyer'`), multipart for sellers (`role: 'seller'`, optional `shopPhoto`/`govId` files) |
| POST | `/auth/login` | — | Returns `{ token, role, user, seller? }` |

### Sellers
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/sellers?limit=N` | optional | Public sees only `approved`; a logged-in admin sees every status |
| GET | `/sellers/me` | seller | Own shop + products |
| PUT | `/sellers/profile` | seller | Update own shop, including `latitude`/`longitude` |
| PUT | `/sellers/:id/approve` | admin | Assigns a permanent `shopNumber` on first approval |
| PUT | `/sellers/:id/reject` | admin | Body: `{ reason }` |
| PUT | `/sellers/:id/suspend` | admin | |
| PUT | `/sellers/:id/reactivate` | admin | |

### Buyers
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/buyers?limit=N` | admin | |

### Products
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/products?sellerId=ID` | — | Public |
| GET | `/products/mine` | seller | |
| POST | `/products` | seller | Multipart, `images` field (up to 6 files) |
| PUT | `/products/:id` | seller | Own products only |
| DELETE | `/products/:id` | seller | Own products only |

### Orders
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/orders` | buyer | Body: `{ sellerId, items: [{name,price,quantity}], total }` |
| GET | `/orders/seller` | seller | Own orders |
| GET | `/orders` | admin | Platform-wide |
| PUT | `/orders/:id/confirm` | seller/admin | |
| PUT | `/orders/:id/complete` | seller/admin | |

### Disputes
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/disputes` | admin | Replaces the frontend's previous placeholder data |
| POST | `/disputes` | buyer | Not yet wired up on the frontend — ready when needed |
| PUT | `/disputes/:id/resolve` | admin | |

## Known gaps (carried over from the frontend build, now real TODOs here)

1. **File storage** — `middleware/upload.js` currently writes to local disk,
   which Railway wipes on every redeploy. Swap the storage engine for
   Cloudinary or S3 before relying on uploaded images/documents surviving a
   deploy. The comment in that file explains exactly what to change.
2. **Password reset email** — not implemented. `.env.example` has commented-out
   SMTP variables ready for whenever this is built.
3. **Disputes** — the schema and CRUD endpoints are real now, but nothing on
   the frontend creates a dispute yet (no "Report an Issue" button exists).
   `POST /disputes` is ready whenever that UI gets built.

## A note on how this was built

This backend was written to match an existing frontend, not the other way
around — every field name (`whatsappNumber`, `images[]`, `latitude`/`longitude`,
etc.) was cross-checked against the actual frontend code calling it, including
one place where the frontend itself had a field-name bug (`s.whatsapp` vs.
the correct `s.whatsappNumber`) that was fixed on the frontend side to match
what a real backend would return. If you already have a running backend with
different route names or field shapes, treat this as a reference implementation
to diff against rather than a drop-in replacement — copy over the pieces that
differ rather than overwriting a working deployment wholesale.

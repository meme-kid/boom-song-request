# Club Song Request App - AI Agent Instructions

## Project Overview
**Purpose**: VIP song request payment system for clubs. Users pay via either **Yoco** (card payments), **PayFast** (crypto + alternative methods), or **direct crypto** (USDT TRC20/BTC) to request songs, which are queued and visible to the DJ. Requests are tiered by payment level (Standard/Express/VIP) with price-based priority.

**Tech Stack**: Express.js backend (port 4000), vanilla JS frontend, SQLite3 database (`club.db`), multi-gateway payment integration (Yoco + PayFast + Direct Crypto).

## Architecture & Data Flow

### Multi Payment System
1. **Yoco** (Card Payments)
   - POST `/create-payment` → Yoco API → payment link redirect
   - Returns `paymentUrl` for user to complete payment
   
2. **PayFast** (Crypto & Alternative)
   - POST `/create-payfast-payment` → PayFast form data → redirect
   - Supports Bitcoin, Ethereum, bank transfer, card (alternative processor)
   - IPN webhook at `/payfast-notify` validates completion

3. **Direct Crypto** (USDT TRC20 / BTC)
   - POST `/create-usdt-payment` or `/create-btc-payment` → crypto-payment.html
   - Shows QR code + wallet address for manual payment
   - DJ manually verifies via `/verify-payment` endpoint

### Three-Tier Request System
1. **Customer Frontend** (`index.html`): Select tier + payment method → POST appropriate `/create-*-payment` endpoint
2. **Payment Processing**: 
   - Cards: Yoco redirect → `success.html`
   - PayFast: PayFast redirect → `success.html` 
   - Direct Crypto: `crypto-payment.html` → manual verification → queue
3. **DJ Dashboard** (`dj.html`): Polls `/queue`, displays payment method icon (💳 Yoco / ₿ PayFast / 💰 USDT / ₿ BTC)

### Queue Priority Logic
Songs ordered by:
- **Tier** (vip=1, express=2, standard=3) - payment amount determines tier
- **ID** (ascending) - insertion order within same tier
- See [server.js GET /queue](server.js#L211) for CASE/WHEN ordering

### Database Schema
```sql
CREATE TABLE queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song TEXT NOT NULL,
  tier TEXT NOT NULL,                  -- values: 'standard', 'express', 'vip'
  paymentMethod TEXT NOT NULL DEFAULT 'yoco',  -- 'yoco', 'payfast', 'usdt', 'btc'
  paymentId TEXT                       -- transaction ID for tracking
)
```

## Critical Routes & Data Contracts

| Endpoint | Method | Purpose | Params | Returns |
|----------|--------|---------|--------|---------|
| `/create-payment` | POST | Yoco card payment link | `{songName, tier}` | `{paymentUrl}` |
| `/create-payfast-payment` | POST | PayFast crypto/alt link | `{songName, tier}` | `{paymentUrl, paymentId}` |
| `/create-usdt-payment` | POST | Direct USDT TRC20 payment | `{songName, tier}` | `{paymentUrl, paymentId, walletAddress, amount}` |
| `/create-btc-payment` | POST | Direct BTC payment | `{songName, tier}` | `{paymentUrl, paymentId, walletAddress, amount}` |
| `/add-to-queue` | POST | Insert song after payment | `{songName, tier, method, paymentId}` | `{message}` |
| `/verify-payment` | POST | Manual crypto verification (DJ) | `{password, paymentId, songName, tier, method}` | `{message}` |
| `/queue` | GET | Fetch prioritized queue | none | `[{id, song, tier, paymentMethod, paymentId}]` |
| `/payfast-notify` | POST | PayFast IPN webhook | PayFast form data (signatures verified) | `{status: "processed"}` |
| `/clear-queue` | POST | Emergency wipe (DJ only) | `{password}` | `{message}` |

## Configuration & Environment

### Required Environment Variables
```bash
# =======================
# CRYPTO WALLET ADDRESSES (Direct Payments)
# =======================
# USDT TRC20 Wallet Address (for direct crypto payments)
USDT_TRC20_ADDRESS=your_usdt_trc20_wallet_address_here
# BTC Wallet Address (for direct Bitcoin payments)
BTC_ADDRESS=your_btc_wallet_address_here

# =======================
# YOCO PAYMENT (Card Payments)
# =======================
YOCO_SECRET_KEY=sk_test_your_key_here

# =======================
# PAYFAST PAYMENT (Crypto & Alternative Methods)
# =======================
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=46f1db3175061957052b37038e7e5349b41f7236
PAYFAST_PASSPHRASE=                    # Optional MD5 signature key
PAYFAST_MODE=test                      # test or live

# =======================
# APPLICATION SETTINGS
# =======================
APP_URL=http://localhost:4000          # Used for payment redirects
DJ_PASSWORD=your_secure_password       # DJ dashboard access
PORT=4000
```

See [.env.example](.env.example) for full template.

## Development Workflow

**Start Server**:
```bash
npm install
cp .env.example .env           # Edit with your API keys
node server.js                 # Runs on http://localhost:4000
```

**Test Yoco Flow**:
1. Open `http://localhost:4000/index.html`
2. Select tier + "💳 Yoco" payment method → redirects to Yoco test link
3. Complete payment → redirected to `success.html` → song added to queue

**Test PayFast Flow**:
1. Open `http://localhost:4000/index.html`
2. Select tier + "₿ PayFast" payment method → redirects to PayFast sandbox
3. Complete payment → redirected to `success.html` → song added to queue

**Test Direct Crypto Flow**:
1. Open `http://localhost:4000/index.html`
2. Select tier + "💰 USDT TRC20" or "₿ Bitcoin" payment method
3. Redirected to `crypto-payment.html` showing QR code + wallet address
4. DJ manually verifies payment via `/dj.html` verification form
5. Song added to queue after verification

**Database Reset**: Delete `club.db` (recreated on next server start)

## Project-Specific Patterns

### Payment Abstraction
- Both gateways route through same `/add-to-queue` endpoint
- `paymentMethod` field in database tracks origin
- DJ dashboard displays visual icons (💳 vs ₿ vs 💰) for quick identification

### PayFast Signature Validation
- MD5 hash of form data validates IPN notifications
- `generatePayFastSignature()` helper (server.js line 58) handles generation
- Passphrase optional—if empty, exclude from signature calculation

### Direct Crypto Manual Verification
- USDT/BTC payments require DJ manual verification via `/verify-payment`
- Payment IDs generated as `USDT-{timestamp}-{random}` or `BTC-{timestamp}-{random}`
- QR codes generated client-side using qrcode.js library
- Wallet addresses configured via environment variables

### Environment-Based URLs
- `config.js` (frontend) auto-detects API URL based on browser location
- Falls back to `localhost:4000` for dev environment
- Allows same code to work on different domains/ports

### Async Payment Flow
- Yoco returns instant redirect URL
- PayFast generates signed form redirect (no API response)
- Direct crypto shows payment page with QR code (no redirect)
- Both eventually redirect to `success.html` with query params

## Pricing Configuration

All prices stored as ZAR cents in `PRICING` constant:
```javascript
const PRICING = {
    standard: 15000,   // R150
    express: 30000,    // R250
    vip: 50000         // R500
};
```

- Used by `/create-payment` and `/create-payfast-payment`
- Converted to Rands for PayFast API (`15000 cents = 150.00 ZAR`)

## Integration Points

**Yoco API**:
- POST `https://online.yoco.com/v1/payment-links`
- Header: `Authorization: Bearer sk_test_...`
- Returns `data.url` for redirect

**PayFast API**:
- HTML form POST to `https://sandbox.payfast.co.za/eng/process` (test mode)
- or `https://www.payfast.co.za/eng/process` (live mode)
- IPN notifications POST back to `/payfast-notify` endpoint

**Direct Crypto Wallets**:
- USDT: TRC20 network wallet address from `USDT_TRC20_ADDRESS`
- BTC: Bitcoin wallet address from `BTC_ADDRESS`
- QR codes generated client-side for wallet addresses
- Manual verification required via DJ dashboard

**Callback URLs**:
- Yoco: redirects direct users to `APP_URL/success.html`
- PayFast: users come back via browser redirect after off-site payment
- Direct Crypto: shows `crypto-payment.html` with QR code (no redirect)

## Known Limitations & Technical Debt

- No persistent session management (stateless API)
- SQLite not ideal for production (consider PostgreSQL)
- PayFast passphrase stored in env (should use secrets manager in production)
- No request deduplication (users can request same song multiple times)
- DJ dashboard polling (no WebSocket real-time updates)
- No automatic payment reconciliation with queue additions

## Code Quality Standards

- Sections marked with clear `// =======================` comment blocks
- Variable names contextual: `songName`, `tier`, `paymentMethod`, `paymentId`
- Status codes: 400 (validation), 403 (auth), 500 (server), 200 (success)
- Error messages human-readable
- PayFast signature validation prevents tampering

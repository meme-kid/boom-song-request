# Club Song Request App - Quick Start Guide

## Installation

```bash
# Clone/navigate to project
cd club-song-app

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your payment gateway credentials
# See below for which credentials you need
```

## Configuration - Which Payment Method to Use?

### Option 1: Cards Only (Yoco)
If you only want credit/debit card payments:

```bash
# .env
YOCO_SECRET_KEY=sk_test_your_yoco_key_here
PAYFAST_MODE=test  # PayFast route will be available but inactive
```

### Option 2: Crypto Only (PayFast + Direct)
If you only want cryptocurrency payments:

```bash
# .env
PAYFAST_MERCHANT_ID=your_id
PAYFAST_MERCHANT_KEY=your_key
PAYFAST_MODE=test
USDT_TRC20_ADDRESS=your_trc20_address
BTC_ADDRESS=your_btc_address
YOCO_SECRET_KEY=sk_test_xxx  # Leave as test key
```

### Option 3: All Methods (Recommended)
Users choose which payment method to use:

```bash
# .env - Set real keys for all methods
YOCO_SECRET_KEY=sk_test_your_yoco_key_here
PAYFAST_MERCHANT_ID=your_id
PAYFAST_MERCHANT_KEY=your_key
PAYFAST_PASSPHRASE=optional_passphrase
PAYFAST_MODE=test
USDT_TRC20_ADDRESS=your_trc20_address
BTC_ADDRESS=your_btc_address
```

## Start Development Server

```bash
node server.js
```

Output:
```
🔥 Server running at http://localhost:4000
📊 Payment methods: Yoco (cards) + PayFast (crypto/alternative)
✓ Yoco API configured
✓ PayFast configured (test mode)
```

## Access the App

Open in browser:
- **Customer Portal**: `http://localhost:4000` (song request + payment)
- **DJ Dashboard**: `http://localhost:4000/dj.html` (view queue, clear songs)
- **Success Redirect**: `http://localhost:4000/success.html` (auto-redirects)

## First Test Payment

### Using Yoco (Test Mode)
1. Go to `http://localhost:4000`
2. Enter song name (e.g., "Bohemian Rhapsody")
3. Select tier: Standard/Express/VIP
4. Click "💳 Yoco (Debit/Credit Card)"
5. Click "Pay & Request"
6. You'll redirect to Yoco test payment page
7. Complete payment with test card details
8. Auto-redirect to success page, song added to queue

### Using PayFast (Test Mode)
1. Go to `http://localhost:4000`
2. Enter song name
3. Select tier
4. Click "₿ PayFast (Crypto & More)"
5. Click "Pay & Request"
6. You'll redirect to PayFast sandbox
7. Choose payment method: Bitcoin, Ethereum, Bank Transfer, Card
8. Complete payment
9. Auto-redirect to queue

### Using Direct Crypto (USDT/BTC)
1. Go to `http://localhost:4000`
2. Enter song name
3. Select tier
4. Click "💰 USDT TRC20" or "₿ Bitcoin"
5. Click "Pay & Request"
6. You'll see QR code + wallet address + exact amount
7. (In real use) Send crypto from your wallet
8. Go to DJ dashboard, manually verify payment
9. Song appears in queue

## DJ Dashboard Features

Open `http://localhost:4000/dj.html`

- **Live Queue**: Shows all requested songs (updates every 3 seconds)
- **Song Display**: `#. Song Name [TIER - PRICE] PaymentMethod`
  - Example: `1. Bohemian Rhapsody [EXPRESS - R250] 💳` (Yoco)
  - Example: `2. Hotel California [VIP - R500] ₿` (PayFast)
  - Example: `3. Sweet Child O Mine [STANDARD - R150] 💰` (USDT)
- **Clear Queue**: Password-protected (DJ only)
  - Default: `dj_default_pass` (change in `.env`)
- **Manual Verification**: For direct crypto payments
  - Enter payment details to add songs to queue

## Database

- **Location**: `club.db` (created automatically)
- **Reset**: Delete `club.db`, restart server to recreate
- **Inspect**: Use SQLite viewer, or SQL query in code

Song schema:
```
id          - Auto-increment queue position
song        - Song name (string)
tier        - Payment tier: 'standard', 'express', 'vip'
paymentMethod - 'yoco' or 'payfast'
paymentId   - Transaction ID for tracking
```

## Environment Variables Reference

| Variable | Required? | Example | Purpose |
|----------|-----------|---------|---------|
| `YOCO_SECRET_KEY` | No | `sk_test_abc` | Card payment API key |
| `PAYFAST_MERCHANT_ID` | No | `10000100` | Crypto payment merchant ID |
| `PAYFAST_MERCHANT_KEY` | No | `46f1db31...` | Crypto payment API key |
| `PAYFAST_PASSPHRASE` | No | `my-secret` | Optional MD5 signature key |
| `PAYFAST_MODE` | No | `test` or `live` | Sandbox vs production |
| `USDT_TRC20_ADDRESS` | No | `TXXXXXXXXXXXXXXXXX` | Direct USDT wallet address |
| `BTC_ADDRESS` | No | `bc1qxxxxxxxxxxxxx` | Direct Bitcoin wallet address |
| `APP_URL` | Yes | `http://localhost:4000` | Callback URL for redirects |
| `DJ_PASSWORD` | Yes | `your-password` | Queue clearing auth |
| `PORT` | No | `4000` | Server port |

## Pricing (In ZAR)

- **Standard**: R150 (15000 cents)
- **Express**: R250 (30000 cents)  
- **VIP**: R500 (50000 cents)

Edit these in `server.js` `PRICING` constant.

## Troubleshooting

### "Cannot find module 'dotenv'"
```bash
npm install dotenv
```

### Port 4000 already in use
```bash
# Use different port
PORT=5000 node server.js
```

### Payment gateway redirects back to localhost
- Make sure `APP_URL=http://localhost:4000` in `.env`
- Test gateways only work with `localhost` or whitelisted domains

### Queue not updating in DJ dashboard
- Check browser console for errors
- Verify server is running (`node server.js` output visible)
- Try refreshing page
- Check Network tab in DevTools for `/queue` API calls

### Song not appearing after payment
- Navigate manually to `http://localhost:4000/dj.html`
- Check `club.db` exists and has data
- Look at server console for database errors

## Next Steps

1. **Production Deploy**: See [PAYFAST_SETUP.md](PAYFAST_SETUP.md) for production checklist
2. **Custom Pricing**: Edit `PRICING` in [server.js](server.js)
3. **Authentication**: Implement user accounts if needed
4. **UI Customization**: Edit CSS in HTML files
5. **Performance**: Consider Redis caching for `/queue` endpoint

## Support

- Yoco Docs: [https://developer.yoco.com](https://developer.yoco.com)
- PayFast Docs: [https://developer.payfast.co.za](https://developer.payfast.co.za)
- Express.js Docs: [https://expressjs.com](https://expressjs.com)

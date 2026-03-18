# PayFast Crypto Payment Gateway Integration

This app now supports **two payment methods**:
- **Yoco** 💳 - Debit/Credit cards
- **PayFast** ₿ - Cryptocurrency (Bitcoin, Ethereum) + Alternative methods

## PayFast Setup (Crypto Payments)

### 1. Create PayFast Account
- Go to [https://www.payfast.co.za](https://www.payfast.co.za)
- Sign up as a merchant
- Navigate to **Settings → API Credentials → Merchant Details**

### 2. Get Your Credentials
Extract these values and add to `.env`:
```bash
PAYFAST_MERCHANT_ID=your_merchant_id
PAYFAST_MERCHANT_KEY=your_merchant_key
PAYFAST_PASSPHRASE=optional_passphrase    # Leave empty if not set
PAYFAST_MODE=test                          # Use 'test' for sandbox, 'live' for production
```

### 3. Testing in Sandbox
- Use `PAYFAST_MODE=test` to test with [https://sandbox.payfast.co.za](https://sandbox.payfast.co.za)
- Test card numbers and crypto options available in PayFast docs
- Payments won't be charged (sandbox only)

### 4. Webhook Configuration (Optional)
PayFast sends payment notifications to `/payfast-notify` endpoint:
- Signatures verified using MD5 hash
- Ensures no tampering with payment data
- Currently logs but doesn't block queue additions (consider webhook validation in production)

## How It Works

### Frontend (`index.html`)
```javascript
<select id="paymentMethod">
    <option value="yoco">💳 Yoco (Debit/Credit Card)</option>
    <option value="payfast">₿ PayFast (Crypto & More)</option>
</select>
```

Users select payment method before entering song request.

### Endpoints

#### `/create-payment` (Yoco)
- Calls Yoco API, returns direct payment link
- Instant redirect to payment processor

#### `/create-payfast-payment` (PayFast)
- Generates signed form redirect
- Includes merchant details, amount, song metadata
- Redirects to PayFast payment page

### Payment Method Tracking
Database now tracks which gateway processed payment:
```sql
-- Queue table stores payment method
paymentMethod TEXT DEFAULT 'yoco',
paymentId TEXT                    -- PayFast transaction ID
```

DJ dashboard displays icons:
- 💳 = Yoco (card payment)
- ₿ = PayFast (crypto/alternative)

## Security Considerations

### MD5 Signatures
PayFast uses MD5 hashing to validate payment data integrity:
```javascript
// Request must include signature parameter
signature = md5(merchant_id=X&amount=Y&...&passphrase=Z)
```

Webhook IPN receives same signature for verification:
```javascript
// Server validates: received_signature === expected_signature
```

### Credentials Management
- **Production**: Use environment secrets manager (AWS Secrets, Vault, etc.)
- **Development**: `.env` file (never commit to git)
- **Rotation**: Change `PAYFAST_PASSPHRASE` annually or if compromised

### URL Callbacks
- Success redirects user to `/success.html` with query params
- Query params include payment method and transaction ID
- `/success.html` adds song to queue based on params

## Production Deployment Checklist

- [ ] Set `PAYFAST_MODE=live` (switch from sandbox)
- [ ] Use real `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY`
- [ ] Set strong `DJ_PASSWORD` (random string, not default)
- [ ] Set `APP_URL` to your production domain
- [ ] Enable HTTPS (PayFast requires secure callbacks)
- [ ] Implement webhook validation (optional but recommended)
- [ ] Test full payment flow with live crypto transfers
- [ ] Monitor logs for errors or suspicious activity

## Troubleshooting

### "Invalid tier" error
- Ensure tier is one of: `standard`, `express`, `vip`
- Check `PRICING` constant in `server.js`

### "Error creating PayFast payment link"
- Verify `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY` are set
- Check ` APP_URL` is correct (used in callbacks)

### Payments not appearing in queue
- Check `/success.html` receives `song`, `tier`, `method` query params
- Verify `/add-to-queue` accepts `method` and `paymentId` parameters
- Check browser console for JavaScript errors

### Webhook IPN not received
- PayFast may be calling webhook, check logs
- Enable in PayFast dashboard: Settings → Integrate → IPN (Enable)
- Ensure `APP_URL` is publicly accessible (localhost won't work)

## Cost Comparison

| Gateway | Payment Method | Fee |
|---------|---|---|
| Yoco | Debit/Credit | ~2% |
| PayFast | Bitcoin | ~1% + network fee |
| PayFast | Ethereum | ~1% + network fee |
| PayFast | Bank Transfer | ~1% |
| PayFast | Card (Stripe) | ~2.5% |

Users can choose cheapest option based on available payment method!

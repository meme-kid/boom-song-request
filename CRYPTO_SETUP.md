# Direct Crypto Payment Setup Guide

This guide covers setting up **direct cryptocurrency payments** (USDT TRC20 and Bitcoin) for your club song request app.

## Overview

Direct crypto payments work differently from payment processors:
- **No third-party fees** (except network fees)
- **Instant settlement** to your wallet
- **Manual verification** required by DJ
- **QR codes** for easy mobile payments

## 1. Get Crypto Wallets

### USDT TRC20 Wallet
TRC20 is Tron network - most popular for USDT stablecoin.

**Recommended Wallets:**
- **Trust Wallet** (Mobile) - Free, easy QR scanning
- **TronLink** (Browser extension) - Good for desktop
- **Ledger/Trezor** (Hardware) - Most secure

**Getting a TRC20 Address:**
1. Install wallet app
2. Create/import wallet
3. Add USDT (TRC20) token
4. Copy your TRC20 address (starts with `T`)

### Bitcoin Wallet
Standard BTC wallet for Bitcoin payments.

**Recommended Wallets:**
- **Electrum** (Desktop) - Lightweight, fast
- **Wasabi Wallet** (Desktop) - Privacy-focused
- **BlueWallet** (Mobile) - User-friendly
- **Ledger/Trezor** (Hardware) - Most secure

## 2. Configure Environment

Add your wallet addresses to `.env`:

```bash
# Direct Crypto Payments
USDT_TRC20_ADDRESS=TZ2HcoWgXVz8ETADBXzFUjXnduYa62F7FN
BTC_ADDRESS=1HgmysQ7yTPXNby3CBj4PfUv5yff8seoqR
```

**Security Notes:**
- ✅ Use hardware wallet for large amounts
- ✅ Never share private keys
- ✅ Backup wallet seed phrases securely
- ✅ Test with small amounts first

## 3. Payment Flow

### For Customers:
1. Select song + tier + "💰 USDT TRC20" or "₿ Bitcoin"
2. Redirected to `crypto-payment.html`
3. Shows QR code + wallet address + exact amount
4. Customer sends crypto from their wallet
5. DJ manually verifies payment

### For DJ:
1. Open `http://localhost:4000/dj.html`
2. Scroll to "Manual Payment Verification" section
3. Enter payment details from customer
4. Click "Verify & Add to Queue"

## 4. Testing Crypto Payments

### Test with Small Amounts:
```bash
# Test USDT: Send 0.01 USDT to your TRC20 address
# Test BTC: Send 0.00001 BTC to your BTC address
```

### Test Flow:
1. Go to `http://localhost:4000`
2. Select "💰 USDT TRC20" payment method
3. Enter song name, click "Pay & Request"
4. Verify QR code shows your wallet address
5. Go to DJ dashboard, manually verify payment
6. Check queue updates

## 5. Production Considerations

### Wallet Management:
- **Hot Wallet**: For frequent small payments (less secure)
- **Cold Wallet**: For large amounts (hardware wallet, offline)
- **Exchange Withdrawal**: Direct to exchange for instant liquidity

### Pricing Strategy:
- **USDT Advantage**: Stable value (pegged to USD)
- **BTC Advantage**: Higher value per transaction
- **Consider volatility**: BTC price changes affect payment value

### Customer Support:
- **Network Selection**: Ensure customers use correct network
  - USDT: TRC20 (Tron) network only
  - BTC: Bitcoin network only
- **Transaction Speed**: Explain blockchain confirmation times
- **Fees**: Customers pay network fees

### Legal & Compliance:
- **KYC Requirements**: Check local regulations
- **Tax Reporting**: Crypto payments may need reporting
- **Business License**: Ensure compliance for payment processing

## 6. Troubleshooting

### "USDT wallet not configured"
- Check `USDT_TRC20_ADDRESS` in `.env`
- Ensure address starts with `T` (TRC20 format)

### "BTC wallet not configured"
- Check `BTC_ADDRESS` in `.env`
- Ensure valid Bitcoin address format

### QR Code not showing
- Check browser console for JavaScript errors
- Ensure `qrcode.min.js` loads from CDN
- Try refreshing page

### Payment not verifying
- Check payment ID format: `USDT-{timestamp}-{random}`
- Ensure all fields filled in DJ verification form
- Check DJ password is correct

### Customer sent wrong amount
- **Underpayment**: Ask customer to send difference
- **Overpayment**: Explain no refunds possible
- **Wrong crypto**: Different wallet needed

## 7. Advanced Features (Optional)

### Auto-Verification (Future)
- Blockchain API integration (requires API keys)
- Automatic payment detection
- Webhook notifications

### Multi-Network Support
- Add ERC20 USDT (Ethereum network)
- Add BEP20 USDT (Binance Smart Chain)
- Add Solana USDT

### Exchange Integration
- Direct withdrawal to local exchange
- Automatic conversion to fiat
- Bank transfer integration

## 8. Cost Comparison

| Method | Setup Cost | Transaction Fee | Settlement |
|--------|------------|-----------------|------------|
| USDT TRC20 | Free | ~$0.10-0.50 | Instant |
| Bitcoin | Free | ~$1-5 | 10-60 min |
| Yoco | Free | 2% | Instant |
| PayFast | Free | 1% + crypto fee | Instant |

## 9. Security Best Practices

### Wallet Security:
- Use hardware wallet for main funds
- Enable 2FA on all accounts
- Regular security audits
- Cold storage for large amounts

### Operational Security:
- Change DJ password regularly
- Monitor wallet balances
- Log all manual verifications
- Backup database regularly

### Customer Privacy:
- No personal data collection
- Anonymous payments possible
- No KYC requirements

## Support Resources

- **Trust Wallet**: https://trustwallet.com
- **TronLink**: https://www.tronlink.org
- **Electrum**: https://electrum.org
- **TRC20 Explorer**: https://tronscan.org
- **BTC Explorer**: https://blockchair.com/bitcoin

---

**Ready to start?** Add your wallet addresses to `.env` and test with small amounts first!
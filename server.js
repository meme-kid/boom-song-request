require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const crypto = require('crypto');

const app = express();

// =======================
// Middleware
// =======================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// =======================
// Database Setup
// =======================
const db = new sqlite3.Database("./club.db");

db.serialize(() => {
    db.run(`
CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song TEXT NOT NULL,
    tier TEXT NOT NULL,
    paymentMethod TEXT NOT NULL DEFAULT 'yoco',
    paymentId TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    txid TEXT
)
`);

    db.run(`
CREATE TABLE IF NOT EXISTS pending_crypto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paymentId TEXT UNIQUE,
    song TEXT,
    tier TEXT,
    method TEXT,
    txid TEXT,
    amount TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

    // Ensure status and txid columns exist for older DBs
    db.all("PRAGMA table_info(queue)", (err2, cols) => {
        if (err2) return;
        const hasStatus = cols.some(c => c.name === 'status');
        const hasTxid = cols.some(c => c.name === 'txid');
        if (!hasStatus) {
            db.run("ALTER TABLE queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'", (alterErr) => {
                if (alterErr) {
                    console.error("Error adding status column", alterErr);
                } else {
                    console.log("Added status column to queue table");
                }
            });
        }
        if (!hasTxid) {
            db.run("ALTER TABLE queue ADD COLUMN txid TEXT", (alterErr) => {
                if (alterErr) {
                    console.error("Error adding txid column", alterErr);
                } else {
                    console.log("Added txid column to queue table");
                }
            });
        }
    });
});

// =======================
// Payment Configuration
// =======================
const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY || "sk_test_xxxxxxxxxxxxxxxxx";
const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || "10000100";
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || "46f1db3175061957052b37038e7e5349b41f7236";
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE || "";
const PAYFAST_MODE = process.env.PAYFAST_MODE || "test";
const PAYFAST_URL = PAYFAST_MODE === "live" 
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process";

// Direct Crypto Wallet Addresses
const USDT_TRC20_ADDRESS = process.env.USDT_TRC20_ADDRESS || "";
const BTC_ADDRESS = process.env.BTC_ADDRESS || "";

const APP_URL = process.env.APP_URL || "http://localhost:4000";

const getBaseUrl = (req) => {
    if (!req || !req.headers) return APP_URL;
    const protocol = req.protocol || (req.headers['x-forwarded-proto'] || 'http');
    const host = req.get('host');
    if (!host) return APP_URL;
    return `${protocol}://${host}`;
};
const DJ_PASSWORD = process.env.DJ_PASSWORD || "dj_default_pass";

// Pricing tiers in ZAR cents
const PRICING = {
    standard: 15000,   // R150
    express: 30000,    // R250
    vip: 50000         // R500
};

// =======================
// Exchange Rate Helper
// =======================
async function getUSDZARRate() {
    try {
        console.log('Fetching USD/ZAR exchange rate...');
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
        const rate = response.data.rates.ZAR;
        console.log('USD/ZAR rate:', rate);
        return rate;
    } catch (error) {
        console.error('Error fetching USD/ZAR exchange rate:', error.message);
        // Fallback to approximate rate if API fails
        return 18.5;
    }
}

async function getBTCUSDRate() {
    try {
        console.log('Fetching BTC/USD exchange rate...');
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        const rate = response.data.bitcoin.usd;
        console.log('BTC/USD rate:', rate);
        return 1 / rate; // USD per BTC to BTC per USD? No.

        // response.data.bitcoin.usd is USD per BTC
        // So BTC per USD = 1 / rate
        return 1 / rate;
    } catch (error) {
        console.error('Error fetching BTC/USD exchange rate:', error.message);
        // Fallback to approximate rate (BTC around $60k)
        return 1 / 60000; // BTC per USD
    }
}

// =======================
// PayFast Signature Helper
// =======================
function generatePayFastSignature(data) {
    let string = "";
    for (let key in data) {
        string += key + "=" + encodeURIComponent(data[key]).replace(/%20/g, "+") + "&";
    }
    string = string.slice(0, -1);
    
    if (PAYFAST_PASSPHRASE) {
        string += "&passphrase=" + encodeURIComponent(PAYFAST_PASSPHRASE).replace(/%20/g, "+");
    }
    
    return crypto.createHash('md5').update(string).digest('hex');
}

// =======================
// Yoco Payment Link
// =======================
app.post("/create-payment", async (req, res) => {
    try {
        const { songName, tier } = req.body;

        if (!songName || !tier) {
            return res.status(400).json({ message: "Song and tier required" });
        }

        if (!PRICING[tier]) {
            return res.status(400).json({ message: "Invalid tier" });
        }

        const baseUrl = getBaseUrl(req);
        const response = await axios.post(
            "https://online.yoco.com/v1/payment-links",
            {
                amount: PRICING[tier],
                currency: "ZAR",
                successUrl: `${baseUrl}/success.html?song=${encodeURIComponent(songName)}&tier=${tier}&method=yoco`,
                cancelUrl: `${baseUrl}/index.html`,
                metadata: { song: songName, tier }
            },
            {
                headers: {
                    Authorization: `Bearer ${YOCO_SECRET_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.json({ paymentUrl: response.data.url });

    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ message: "Error creating payment link" });
    }
});

// =======================
// PayFast Payment Link (Crypto & Alternative)
// =======================
app.post("/create-payfast-payment", (req, res) => {
    try {
        const { songName, tier } = req.body;

        if (!songName || !tier) {
            return res.status(400).json({ message: "Song and tier required" });
        }

        if (!PRICING[tier]) {
            return res.status(400).json({ message: "Invalid tier" });
        }

        const amountRands = Math.round(PRICING[tier]) / 100;
        const paymentId = `SONG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const baseUrl = getBaseUrl(req);
        const paymentData = {
            merchant_id: PAYFAST_MERCHANT_ID,
            merchant_key: PAYFAST_MERCHANT_KEY,
            return_url: `${baseUrl}/success.html?song=${encodeURIComponent(songName)}&tier=${tier}&method=payfast&pid=${paymentId}`,
            cancel_url: `${baseUrl}/index.html`,
            notify_url: `${baseUrl}/payfast-notify`,
            amount: amountRands.toFixed(2),
            item_name: `Song Request - ${tier.toUpperCase()}`,
            item_description: songName,
            custom_int1: paymentId,
            email_confirmation: 1,
            confirmation_address: 1
        };

        paymentData.signature = generatePayFastSignature(paymentData);

        res.json({ 
            paymentUrl: PAYFAST_URL + "?" + new URLSearchParams(paymentData).toString(),
            paymentId 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error creating PayFast payment link" });
    }
});

// =======================
// PayFast Webhook Handler
// =======================
app.post("/payfast-notify", (req, res) => {
    // Verify signature from PayFast IPN
    const notifyData = req.body;
    const signature = notifyData.signature;
    delete notifyData.signature;
    
    const expectedSignature = generatePayFastSignature(notifyData);
    
    if (signature !== expectedSignature) {
        console.warn("Invalid PayFast signature");
        return res.status(403).json({ message: "Invalid signature" });
    }
    
    console.log("PayFast IPN received:", notifyData);
    res.json({ status: "processed" });
});

// =======================
// Direct Crypto Payment (USDT TRC20)
// =======================
app.post("/create-usdt-payment", async (req, res) => {
    console.log('Creating USDT payment...');
    try {
        const { songName, tier } = req.body;

        if (!songName || !tier) {
            return res.status(400).json({ message: "Song and tier required" });
        }

        if (!PRICING[tier]) {
            return res.status(400).json({ message: "Invalid tier" });
        }

        if (!USDT_TRC20_ADDRESS) {
            return res.status(500).json({ message: "USDT wallet not configured" });
        }

        const amountRands = Math.round(PRICING[tier]) / 100;
        console.log('Amount Rands:', amountRands);
        // const usdZarRate = await getUSDZARRate();
        // console.log('USD/ZAR rate:', usdZarRate);
        // const amountUsdt = (amountRands / usdZarRate).toFixed(2);
        const amountUsdt = (amountRands / 18.5).toFixed(2); // Fixed rate for testing
        console.log('Amount USDT:', amountUsdt);

        const paymentId = `USDT-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substr(2, 4)}`;

        // For USDT, we'll show a payment page with QR code and instructions
        const baseUrl = getBaseUrl(req);
        const paymentUrl = `${baseUrl}/crypto-payment.html?song=${encodeURIComponent(songName)}&tier=${tier}&method=usdt&pid=${paymentId}&amount=${amountUsdt}`;

        res.json({ 
            paymentUrl,
            paymentId,
            walletAddress: USDT_TRC20_ADDRESS,
            amount: amountUsdt,
            currency: 'USDT'
        });

    } catch (error) {
        console.error('Error in create-usdt-payment:', error);
        res.status(500).json({ message: "Error creating USDT payment" });
    }
});

// =======================
// Direct Crypto Payment (BTC)
// =======================
app.post("/create-btc-payment", async (req, res) => {
    try {
        const { songName, tier } = req.body;

        if (!songName || !tier) {
            return res.status(400).json({ message: "Song and tier required" });
        }

        if (!PRICING[tier]) {
            return res.status(400).json({ message: "Invalid tier" });
        }

        if (!BTC_ADDRESS) {
            return res.status(500).json({ message: "BTC wallet not configured" });
        }

        const amountRands = Math.round(PRICING[tier]) / 100;
        // const usdZarRate = await getUSDZARRate();
        // const btcUsdRate = await getBTCUSDRate();
        // const usdEquivalent = amountRands / usdZarRate;
        // const amountBtc = (usdEquivalent * btcUsdRate).toFixed(8);
        const amountBtc = (amountRands / 18.5 / 75000).toFixed(8); // Fixed rates for testing

        const paymentId = `BTC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substr(2, 4)}`;

        // For BTC, we'll show a payment page with QR code and instructions
        const baseUrl = getBaseUrl(req);
        const paymentUrl = `${baseUrl}/crypto-payment.html?song=${encodeURIComponent(songName)}&tier=${tier}&method=btc&pid=${paymentId}&amount=${amountBtc}`;

        res.json({ 
            paymentUrl,
            paymentId,
            walletAddress: BTC_ADDRESS,
            amount: amountBtc,
            currency: 'BTC'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error creating BTC payment" });
    }
});

// =======================
// Wallet Address Lookup
// =======================
app.get("/wallet-address", (req, res) => {
    const method = req.query.method;

    if (!method) {
        return res.status(400).json({ message: "Missing method" });
    }

    if (method === "usdt") {
        if (!USDT_TRC20_ADDRESS) {
            return res.status(500).json({ message: "USDT wallet not configured" });
        }
        return res.json({ walletAddress: USDT_TRC20_ADDRESS, cryptoName: "USDT (TRC20)" });
    }

    if (method === "btc") {
        if (!BTC_ADDRESS) {
            return res.status(500).json({ message: "BTC wallet not configured" });
        }
        return res.json({ walletAddress: BTC_ADDRESS, cryptoName: "Bitcoin (BTC)" });
    }

    return res.status(400).json({ message: "Invalid method" });
});

// =======================
// Submit Transaction ID (Client)
// =======================
app.post("/submit-txid", (req, res) => {
    const { paymentId, txid, song, tier, method } = req.body;

    if (!paymentId || !txid) {
        return res.status(400).json({ message: "Payment ID and TXID required" });
    }

    db.run(
        "INSERT OR REPLACE INTO pending_crypto (paymentId, song, tier, method, txid) VALUES (?, ?, ?, ?, ?)",
        [paymentId, song, tier, method, txid],
        function(err) {
            if (err) {
                console.error("Error inserting pending crypto:", err);
                return res.status(500).json({ message: "Database error" });
            }

            res.json({ message: "TXID submitted successfully. DJ will verify your payment." });
        }
    );
});

// =======================
// Get Pending Crypto Payments (DJ)
// =======================
app.get("/pending-crypto", (req, res) => {
    db.all("SELECT * FROM pending_crypto ORDER BY submitted_at DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Database error" });
        }

        res.json(rows);
    });
});

// =======================
// Remove Pending Crypto (DJ Only)
// =======================
app.post("/remove-pending-crypto", (req, res) => {
    const { paymentId, password } = req.body;

    if (password !== DJ_PASSWORD) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!paymentId) {
        return res.status(400).json({ message: "Payment ID required" });
    }

    db.run("DELETE FROM pending_crypto WHERE paymentId = ?", [paymentId], function(err) {
        if (err) {
            return res.status(500).json({ message: "Database error" });
        }

        res.json({ message: "Pending crypto removed" });
    });
});

// =======================
// Manual Payment Verification (DJ Only)
// =======================
app.post("/verify-payment", (req, res) => {
    const { password, paymentId, songName, tier, method } = req.body;

    if (password !== DJ_PASSWORD) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!paymentId || !songName || !tier || !method) {
        return res.status(400).json({ message: "All fields required" });
    }

    // Add song to queue after manual verification
    db.run(
        "INSERT INTO queue (song, tier, paymentMethod, paymentId) VALUES (?, ?, ?, ?)",
        [songName, tier, method, paymentId],
        function(err) {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            res.json({ message: "Payment verified and song added to queue" });
        }
    );
});

// =======================
// Add Song To Queue
// =======================
app.post("/add-to-queue", (req, res) => {
    const { songName, tier, method, paymentId } = req.body;

    if (!songName || !tier) {
        return res.status(400).json({ message: "Song and tier required" });
    }

    const paymentMethod = method || "yoco";

    db.run(
        "INSERT INTO queue (song, tier, paymentMethod, paymentId, status) VALUES (?, ?, ?, ?, 'pending')",
        [songName, tier, paymentMethod, paymentId || null],
        function(err) {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            res.json({ message: "Song added successfully" });
        }
    );
});

// =======================
// Mark Song as Played (DJ)
// =======================
app.post("/mark-played", (req, res) => {
    const { password, id } = req.body;

    if (password !== DJ_PASSWORD) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!id) {
        return res.status(400).json({ message: "ID required" });
    }

    db.run(
        "UPDATE queue SET status = 'played' WHERE id = ?",
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            res.json({ message: "Song marked as played" });
        }
    );
});

// =======================
// Get Queue
// =======================
app.get("/queue", (req, res) => {
    db.all(`
        SELECT * FROM queue
        WHERE status = 'pending'
        ORDER BY 
            CASE tier
                WHEN 'vip' THEN 1
                WHEN 'express' THEN 2
                WHEN 'standard' THEN 3
            END,
            id ASC
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Database error" });
        }

        res.json(rows);
    });
});

// =======================
// Clear Queue (DJ Only)
// =======================
app.post("/clear-queue", (req, res) => {
    const { password } = req.body;

    if (password !== DJ_PASSWORD) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    db.run("DELETE FROM queue", [], (err) => {
        if (err) {
            return res.status(500).json({ message: "Error clearing queue" });
        }

        res.json({ message: "Queue cleared" });
    });
});

// =======================
// Start Server
// =======================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🔥 Server running at ${APP_URL}`);
    console.log(`📊 Payment methods: Yoco (cards) + PayFast (crypto) + Direct (USDT/BTC)`);
    if (process.env.YOCO_SECRET_KEY) {
        console.log("✓ Yoco API configured");
    } else {
        console.log("⚠️  Set YOCO_SECRET_KEY for card payments");
    }
    if (process.env.PAYFAST_MERCHANT_ID) {
        console.log("✓ PayFast configured (" + PAYFAST_MODE + " mode)");
    } else {
        console.log("⚠️  Set PAYFAST credentials for crypto/alternative payments");
    }
    if (process.env.USDT_TRC20_ADDRESS) {
        console.log("✓ USDT TRC20 wallet configured");
    } else {
        console.log("⚠️  Set USDT_TRC20_ADDRESS for direct USDT payments");
    }
    if (process.env.BTC_ADDRESS) {
        console.log("✓ BTC wallet configured");
    } else {
        console.log("⚠️  Set BTC_ADDRESS for direct Bitcoin payments");
    }
});

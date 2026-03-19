require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const crypto = require('crypto');

const app = express();
app.disable("x-powered-by");

// =======================
// Middleware
// =======================
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
});
app.use(express.static(path.join(__dirname)));

const staticPages = {
    "/": "index.html",
    "/index.html": "index.html",
    "/public-queue": "public-queue.html",
    "/public-queue.html": "public-queue.html",
    "/dj": "dj.html",
    "/dj.html": "dj.html",
    "/dj-display": "dj-display.html",
    "/dj-display.html": "dj-display.html",
    "/qr": "qr.html",
    "/qr.html": "qr.html",
    "/success": "success.html",
    "/success.html": "success.html",
    "/crypto-payment": "crypto-payment.html",
    "/crypto-payment.html": "crypto-payment.html"
};

Object.entries(staticPages).forEach(([routePath, fileName]) => {
    app.get(routePath, (req, res) => {
        res.sendFile(path.join(__dirname, fileName));
    });
});

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

    db.run(`
CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount INTEGER NOT NULL,
    tier TEXT NOT NULL,
    paymentMethod TEXT NOT NULL,
    date DATE DEFAULT CURRENT_DATE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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

    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_payment_id ON queue(paymentId) WHERE paymentId IS NOT NULL");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_crypto_payment_id ON pending_crypto(paymentId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_queue_status_tier_id ON queue(status, tier, id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_earnings_date_timestamp ON earnings(date, timestamp)");
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

const APP_URL = process.env.APP_URL || "https://www.boomsongrequest.com";

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

const VALID_TIERS = new Set(Object.keys(PRICING));
const VALID_PAYMENT_METHODS = new Set(["yoco", "payfast", "usdt", "btc"]);

function normalizeSongName(songName) {
    if (typeof songName !== "string") return "";
    return songName.replace(/\s+/g, " ").trim();
}

function isValidTier(tier) {
    return VALID_TIERS.has(tier);
}

function isValidPaymentMethod(method) {
    return VALID_PAYMENT_METHODS.has(method);
}

function validateSongRequest(songName, tier) {
    const normalizedSongName = normalizeSongName(songName);

    if (!normalizedSongName || !tier) {
        return { error: "Song and tier required" };
    }

    if (normalizedSongName.length < 2) {
        return { error: "Song name must be at least 2 characters" };
    }

    if (normalizedSongName.length > 100) {
        return { error: "Song name must be 100 characters or fewer" };
    }

    if (!isValidTier(tier)) {
        return { error: "Invalid tier" };
    }

    return { normalizedSongName };
}

function createPaymentId(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function addSongToQueue({ songName, tier, paymentMethod, paymentId, txid }, callback) {
    const normalizedSongName = normalizeSongName(songName);
    const amount = PRICING[tier] || 0;
    const normalizedMethod = paymentMethod || "yoco";

    db.run(
        "INSERT INTO queue (song, tier, paymentMethod, paymentId, status, txid) VALUES (?, ?, ?, ?, 'pending', ?)",
        [normalizedSongName, tier, normalizedMethod, paymentId || null, txid || null],
        function(err) {
            if (err) {
                if (err.message && err.message.includes("UNIQUE constraint failed: queue.paymentId")) {
                    db.get(
                        "SELECT id, song, tier, paymentMethod, paymentId, status, txid FROM queue WHERE paymentId = ?",
                        [paymentId],
                        (lookupErr, existingRow) => {
                            if (lookupErr) {
                                return callback(lookupErr);
                            }

                            return callback(null, {
                                duplicate: true,
                                row: existingRow
                            });
                        }
                    );
                    return;
                }

                return callback(err);
            }

            db.run(
                "INSERT INTO earnings (amount, tier, paymentMethod) VALUES (?, ?, ?)",
                [amount, tier, normalizedMethod],
                (earningsErr) => {
                    if (earningsErr) {
                        console.error("Error recording earnings:", earningsErr);
                    }

                    callback(null, {
                        duplicate: false,
                        row: {
                            id: this.lastID,
                            song: normalizedSongName,
                            tier,
                            paymentMethod: normalizedMethod,
                            paymentId: paymentId || null,
                            status: "pending",
                            txid: txid || null
                        }
                    });
                }
            );
        }
    );
}

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
        const { error, normalizedSongName } = validateSongRequest(songName, tier);

        if (error) {
            return res.status(400).json({ message: error });
        }

        const baseUrl = getBaseUrl(req);
        const response = await axios.post(
            "https://online.yoco.com/v1/payment-links",
            {
                amount: PRICING[tier],
                currency: "ZAR",
                successUrl: `${baseUrl}/success.html?song=${encodeURIComponent(normalizedSongName)}&tier=${tier}&method=yoco`,
                cancelUrl: `${baseUrl}/index.html`,
                metadata: { song: normalizedSongName, tier }
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
        const { error, normalizedSongName } = validateSongRequest(songName, tier);

        if (error) {
            return res.status(400).json({ message: error });
        }

        const amountRands = Math.round(PRICING[tier]) / 100;
        const paymentId = createPaymentId("SONG");

        const baseUrl = getBaseUrl(req);
        const paymentData = {
            merchant_id: PAYFAST_MERCHANT_ID,
            merchant_key: PAYFAST_MERCHANT_KEY,
            return_url: `${baseUrl}/success.html?song=${encodeURIComponent(normalizedSongName)}&tier=${tier}&method=payfast&pid=${paymentId}`,
            cancel_url: `${baseUrl}/index.html`,
            notify_url: `${baseUrl}/payfast-notify`,
            amount: amountRands.toFixed(2),
            item_name: `Song Request - ${tier.toUpperCase()}`,
            item_description: normalizedSongName,
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
        const { error, normalizedSongName } = validateSongRequest(songName, tier);

        if (error) {
            return res.status(400).json({ message: error });
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

        const paymentId = createPaymentId("USDT");

        // For USDT, we'll show a payment page with QR code and instructions
        const baseUrl = getBaseUrl(req);
        const paymentUrl = `${baseUrl}/crypto-payment.html?song=${encodeURIComponent(normalizedSongName)}&tier=${tier}&method=usdt&pid=${paymentId}&amount=${amountUsdt}`;

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
        const { error, normalizedSongName } = validateSongRequest(songName, tier);

        if (error) {
            return res.status(400).json({ message: error });
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

        const paymentId = createPaymentId("BTC");

        // For BTC, we'll show a payment page with QR code and instructions
        const baseUrl = getBaseUrl(req);
        const paymentUrl = `${baseUrl}/crypto-payment.html?song=${encodeURIComponent(normalizedSongName)}&tier=${tier}&method=btc&pid=${paymentId}&amount=${amountBtc}`;

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
    const normalizedSongName = normalizeSongName(song);

    if (!paymentId || !txid) {
        return res.status(400).json({ message: "Payment ID and TXID required" });
    }

    if (normalizedSongName && normalizedSongName.length > 100) {
        return res.status(400).json({ message: "Song name must be 100 characters or fewer" });
    }

    if (tier && !isValidTier(tier)) {
        return res.status(400).json({ message: "Invalid tier" });
    }

    if (method && !isValidPaymentMethod(method)) {
        return res.status(400).json({ message: "Invalid payment method" });
    }

    db.run(
        "INSERT OR REPLACE INTO pending_crypto (paymentId, song, tier, method, txid) VALUES (?, ?, ?, ?, ?)",
        [paymentId, normalizedSongName || null, tier || null, method || null, txid],
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

    const { error, normalizedSongName } = validateSongRequest(songName, tier);

    if (error || !paymentId || !method) {
        return res.status(400).json({ message: error || "All fields required" });
    }

    if (!isValidPaymentMethod(method)) {
        return res.status(400).json({ message: "Invalid payment method" });
    }

    addSongToQueue(
        {
            songName: normalizedSongName,
            tier,
            paymentMethod: method,
            paymentId
        },
        (err, result) => {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            db.run("DELETE FROM pending_crypto WHERE paymentId = ?", [paymentId], (deleteErr) => {
                if (deleteErr) {
                    console.error("Error clearing pending crypto after verification:", deleteErr);
                }

                res.json({
                    message: result.duplicate
                        ? "Payment was already verified earlier. Existing queue entry returned."
                        : "Payment verified and song added to queue",
                    duplicate: result.duplicate,
                    queueItem: result.row
                });
            });
        }
    );
});

// =======================
// Add Song To Queue
// =======================
app.post("/add-to-queue", (req, res) => {
    const { songName, tier, method, paymentId } = req.body;
    const paymentMethod = method || "yoco";
    const { error, normalizedSongName } = validateSongRequest(songName, tier);

    if (error) {
        return res.status(400).json({ message: error });
    }

    if (!isValidPaymentMethod(paymentMethod)) {
        return res.status(400).json({ message: "Invalid payment method" });
    }

    addSongToQueue(
        {
            songName: normalizedSongName,
            tier,
            paymentMethod,
            paymentId
        },
        (err, result) => {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            res.json({
                message: result.duplicate ? "Song was already added to queue" : "Song added successfully",
                duplicate: result.duplicate,
                queueItem: result.row
            });
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

            if (this.changes === 0) {
                return res.status(404).json({ message: "Queue item not found" });
            }

            res.json({ message: "Song marked as played" });
        }
    );
});

// =======================
// Get Queue
// =======================
app.get("/queue", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
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
// Get Earnings Stats
// =======================
app.get("/earnings", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Get tonight's earnings (current date)
    db.get(`
        SELECT SUM(amount) as tonight
        FROM earnings
        WHERE date = date('now')
    `, [], (err, tonightRow) => {
        if (err) {
            return res.status(500).json({ message: "Database error" });
        }

        // Get total songs tonight
        db.get(`
            SELECT COUNT(*) as totalSongs
            FROM earnings
            WHERE date = date('now')
        `, [], (err2, songsRow) => {
            if (err2) {
                return res.status(500).json({ message: "Database error" });
            }

            // Get VIP requests this hour
            db.get(`
                SELECT COUNT(*) as vipThisHour
                FROM earnings
                WHERE date = date('now')
                AND tier = 'vip'
                AND strftime('%H', timestamp) = strftime('%H', 'now')
            `, [], (err3, vipRow) => {
                if (err3) {
                    return res.status(500).json({ message: "Database error" });
                }

                const tonightEarnings = Math.round((tonightRow.tonight || 0) / 100); // Convert cents to rands
                const totalSongs = songsRow.totalSongs || 0;
                const vipThisHour = vipRow.vipThisHour || 0;

                res.json({
                    tonight: tonightEarnings,
                    totalSongs: totalSongs,
                    vipThisHour: vipThisHour
                });
            });
        });
    });
});

app.get("/health", (req, res) => {
    db.get("SELECT 1 as ok", [], (err) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                database: "down",
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            status: "ok",
            database: "up",
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime())
        });
    });
});

app.get("/app-status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
        appName: "BOOM Song Request",
        currency: "ZAR",
        pricing: {
            standard: PRICING.standard / 100,
            express: PRICING.express / 100,
            vip: PRICING.vip / 100
        },
        payments: {
            yocoConfigured: Boolean(process.env.YOCO_SECRET_KEY),
            payfastConfigured: Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY),
            usdtConfigured: Boolean(USDT_TRC20_ADDRESS),
            btcConfigured: Boolean(BTC_ADDRESS)
        },
        environment: {
            appUrl: APP_URL,
            payfastMode: PAYFAST_MODE
        }
    });
});

app.get("/stats", (req, res) => {
    const tierPrices = {
        standard: 150,
        express: 250,
        vip: 500
    };

    db.all(
        "SELECT id, tier, paymentMethod, status FROM queue",
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            let totalRevenue = 0;
            const totalSongs = rows.length;
            let pendingSongs = 0;
            let playedSongs = 0;

            const tierCounts = {
                standard: 0,
                express: 0,
                vip: 0
            };

            const tierRevenue = {
                standard: 0,
                express: 0,
                vip: 0
            };

            const paymentMethodCounts = {};
            const paymentMethodRevenue = {};

            rows.forEach((row) => {
                const tier = row.tier || "standard";
                const method = row.paymentMethod || "unknown";
                const amount = tierPrices[tier] || 0;

                totalRevenue += amount;

                if (row.status === "played") {
                    playedSongs++;
                } else {
                    pendingSongs++;
                }

                tierCounts[tier] = (tierCounts[tier] || 0) + 1;
                tierRevenue[tier] = (tierRevenue[tier] || 0) + amount;

                paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
                paymentMethodRevenue[method] = (paymentMethodRevenue[method] || 0) + amount;
            });

            res.json({
                totalRevenue,
                totalSongs,
                pendingSongs,
                playedSongs,
                tierCounts,
                tierRevenue,
                paymentMethodCounts,
                paymentMethodRevenue
            });
        }
    );
});

app.get("/queue-history", (req, res) => {
    db.all(
        "SELECT * FROM queue ORDER BY id DESC",
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ message: "Database error" });
            }

            res.json(rows);
        }
    );
});

app.post("/remove-song", (req, res) => {
    const { password, id } = req.body;

    if (password !== DJ_PASSWORD) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!id) {
        return res.status(400).json({ message: "Song ID required" });
    }

    db.run("DELETE FROM queue WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ message: "Database error" });
        }

        res.json({ message: "Song removed successfully" });
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

app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
});

// =======================
// Start Server
// =======================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🔥 Server running`);
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

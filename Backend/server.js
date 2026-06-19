const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Point to the correct Frontend folder!
app.use(express.static(path.join(__dirname, '../Frontend'))); 

// ─── EMAIL TRANSPORTER (Bypassed for Render Free Tier) ───
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'connect.thecreatorslinkup@gmail.com', 
        pass: 'pzpyoagghzrgccgc' 
    }
});

// ─── DATABASE INITIALIZATION ───
const db = new sqlite3.Database(path.join(__dirname, 'redefine.db'), (err) => {
    if (err) {
        console.error("❌ Database connection error:", err.message);
        process.exit(1);
    }
    console.log("✅ Connected to SQLite database.");
    initializeSchema();
});

function initializeSchema() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT, email TEXT UNIQUE, phone TEXT UNIQUE,
            username TEXT UNIQUE, password TEXT, isVerified INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS pending_otps (
            email TEXT PRIMARY KEY, otpCode TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tweets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, username TEXT, avatar TEXT, color TEXT, verified INTEGER DEFAULT 0,
            time TEXT, text TEXT, views TEXT DEFAULT '0', likes INTEGER DEFAULT 0,
            hasLiked INTEGER DEFAULT 0, rt INTEGER DEFAULT 0, hasRT INTEGER DEFAULT 0,
            replies INTEGER DEFAULT 0, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tweetId INTEGER NOT NULL,
            name TEXT, username TEXT, avatar TEXT, color TEXT, verified INTEGER DEFAULT 0,
            time TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tweetId) REFERENCES tweets(id) ON DELETE CASCADE
        )`);
    });
}

// ==========================================
// ─── AUTHENTICATION APIs ───
// ==========================================

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// 1. Request OTP
app.post('/api/signup', async (req, res) => {
    const { email, username } = req.body;
    
    db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [email, username], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Database error" });
        if (row) return res.status(400).json({ success: false, message: "Email or Username already exists" });

        const otp = generateOTP();
        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to generate OTP" });
            
            // DEVELOPER BYPASS
            console.log(`\n=========================================`);
            console.log(`🔔 NEW USER OTP CODE: ${otp}`);
            console.log(`=========================================\n`);
            
            return res.status(200).json({ success: true, message: "OTP bypassed for development" });
        });
    });
});

// 2. Step One: Check OTP (Reveals Password Box)
app.post('/api/check-otp', (req, res) => {
    const { email, otp } = req.body;

    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], (err, row) => {
        if (err || !row) return res.status(400).json({ success: false, message: "OTP Session expired" });
        if (row.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP" });

        // Tell frontend OTP is good
        res.status(200).json({ success: true, message: "OTP Verified" });
    });
});

// 3. Step Two: Final Registration (Saves User + Password)
// Note: Handled on both /register and /verify-otp to catch whichever your frontend uses
const finalizeRegistration = async (req, res) => {
    const { fullName, email, phone, username, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (fullName, email, phone, username, password) VALUES (?, ?, ?, ?, ?)`,
            [fullName, email, phone, username, hashedPassword], function(err) {
                if (err) return res.status(500).json({ success: false, message: "Registration failed" });
                
                db.run(`DELETE FROM pending_otps WHERE email = ?`, [email]); // cleanup
                res.status(200).json({ 
                    success: true, 
                    user: { id: this.lastID, name: fullName, username, email, phone } 
                });
            }
        );
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

app.post('/api/register', finalizeRegistration);
app.post('/api/verify-otp', finalizeRegistration);

// 4. Login
app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [identifier, identifier], async (err, user) => {
        if (err) return res.status(500).json({ success: false, message: "Database error" });
        if (!user) return res.status(400).json({ success: false, message: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ success: false, message: "Incorrect password" });

        res.status(200).json({ 
            success: true, 
            user: { id: user.id, name: user.fullName, username: user.username, email: user.email, phone: user.phone } 
        });
    });
});

// ==========================================
// ─── COMMUNITY TWEETS & REPLIES APIs ───
// ==========================================

app.get('/api/tweets', (req, res) => {
    db.all(`SELECT * FROM tweets ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch feed" });
        res.json({ success: true, tweets: rows });
    });
});

app.post('/api/tweets', (req, res) => {
    const { name, username, avatar, color, verified, time, text, views } = req.body;
    db.run(`INSERT INTO tweets (name, username, avatar, color, verified, time, text, views, likes, replies, rt) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
        [name, username, avatar, color, verified ? 1 : 0, time, text, views || '0'],
        function(err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, tweetId: this.lastID });
        }
    );
});

app.post('/api/tweets/:id/like', (req, res) => {
    const { isLiked } = req.body;
    const inc = isLiked ? 1 : -1;
    db.run(`UPDATE tweets SET likes = max(0, likes + ?), hasLiked = ? WHERE id = ?`, 
        [inc, isLiked ? 1 : 0, req.params.id], 
        (err) => res.json({ success: !err })
    );
});

app.post('/api/tweets/:id/rt', (req, res) => {
    const { isRT } = req.body;
    const inc = isRT ? 1 : -1;
    db.run(`UPDATE tweets SET rt = max(0, rt + ?), hasRT = ? WHERE id = ?`, 
        [inc, isRT ? 1 : 0, req.params.id], 
        (err) => res.json({ success: !err })
    );
});

app.delete('/api/tweets/:id', (req, res) => {
    db.run(`DELETE FROM tweets WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// ─── THE FIXED ROUTES ───

// Get Single Post + View Counter Fix
app.get('/api/tweets/:id', (req, res) => {
    const id = req.params.id;
    
    // COALESCE turns empty data into 0 so the math actually works!
    db.run(`UPDATE tweets SET views = COALESCE(views, 0) + 1 WHERE id = ?`, [id], () => {
        db.get(`SELECT * FROM tweets WHERE id = ?`, [id], (err, row) => {
            if (err || !row) return res.status(404).json({ success: false, message: "Not found" });
            row.hasLiked = false; 
            row.hasRT = false;
            res.json({ success: true, tweet: row });
        });
    });
});

// Missing Route Added: Fetch Replies
app.get('/api/tweets/:id/replies', (req, res) => {
    const tweetId = req.params.id;
    
    db.all(`SELECT * FROM replies WHERE tweetId = ?`, [tweetId], (err, rows) => {
        if (err) {
            // If the table doesn't exist yet, just send an empty array safely
            return res.json({ success: true, replies: [] });
        }
        res.json({ success: true, replies: rows });
    });
});

// Auto-Create Replies Table + Sync Counters
app.post('/api/tweets/:id/replies', (req, res) => {
    const tweetId = req.params.id;
    const { name, username, avatar, color, verified, time, text } = req.body;

    // Auto-create the replies table if it doesn't exist yet
    db.run(`CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY AUTOINCREMENT, tweetId INTEGER, name TEXT, username TEXT, avatar TEXT, color TEXT, verified BOOLEAN, time TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`, () => {
        
        // 1. Save the actual text to the new replies table
        db.run(`INSERT INTO replies (tweetId, name, username, avatar, color, verified, time, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tweetId, name, username, avatar, color, verified, time, text],
            function(err) {
                if (err) return res.status(500).json({ success: false });
                
                // 2. Update the counter on the main post
                db.run(`UPDATE tweets SET replies = COALESCE(replies, 0) + 1 WHERE id = ?`, [tweetId]);
                res.json({ success: true });
            }
        );
    });
});

// ==========================================
// ─── ADMIN DASHBOARD ───
// ==========================================
app.get('/secret-admin-users', (req, res) => {
    db.all(`SELECT id, fullName, email, username, phone FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.send(`<pre>Total Users: ${rows.length}\n\n${JSON.stringify(rows, null, 4)}</pre>`);
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Redefine Server running on port ${PORT}`);
});
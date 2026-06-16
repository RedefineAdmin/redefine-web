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
app.use(express.static(__dirname)); 

// ─── EMAIL TRANSPORTER ───
// Note: Hardcoding credentials is a security risk. In production, move these to a .env file.
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
        // 1. Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT, email TEXT UNIQUE, phone TEXT UNIQUE,
            username TEXT UNIQUE, password TEXT, isVerified INTEGER DEFAULT 1
        )`);

        // 2. Pending OTPs
        db.run(`CREATE TABLE IF NOT EXISTS pending_otps (
            email TEXT PRIMARY KEY, otpCode TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 3. Tweets (Community Posts)
        db.run(`CREATE TABLE IF NOT EXISTS tweets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, username TEXT, avatar TEXT, color TEXT, verified INTEGER DEFAULT 0,
            time TEXT, text TEXT, views TEXT DEFAULT '0', likes INTEGER DEFAULT 0,
            hasLiked INTEGER DEFAULT 0, rt INTEGER DEFAULT 0, hasRT INTEGER DEFAULT 0,
            replies INTEGER DEFAULT 0, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 4. Replies Table
        db.run(`CREATE TABLE IF NOT EXISTS replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tweetId INTEGER NOT NULL,
            name TEXT, username TEXT, avatar TEXT, color TEXT, verified INTEGER DEFAULT 0,
            time TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tweetId) REFERENCES tweets(id) ON DELETE CASCADE
        )`);

        // Safe Migration: Ensure existing 'tweets' table has a 'replies' column
        db.run(`ALTER TABLE tweets ADD COLUMN replies INTEGER DEFAULT 0`, (err) => {
            // Ignore error if column already exists
        });
    });
}

// ==========================================
// ─── AUTHENTICATION APIs ───
// ==========================================

// Helper: Generate OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

app.post('/api/signup', async (req, res) => {
    const { fullName, email, phone, username, password } = req.body;
    
    // Check if user exists
    db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [email, username], async (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Database error" });
        if (row) return res.status(400).json({ success: false, message: "Email or Username already exists" });

        const otp = generateOTP();
        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to generate OTP" });
            
            // --- DEVELOPER BYPASS: PRINT OTP TO RENDER LOGS ---
            console.log(`\n=========================================`);
            console.log(`🔔 NEW USER OTP CODE: ${otp}`);
            console.log(`=========================================\n`);
            
            // Tell the frontend it was successful immediately!
            return res.status(200).json({ success: true, message: "OTP bypassed for development" });
            
            /* (Nodemailer temporarily disabled due to Render free tier blocks)
            transporter.sendMail({
                from: 'connect.thecreatorslinkup@gmail.com',
                to: email,
                subject: 'Redefine - Verification Code',
                text: `Your Redefine verification code is: ${otp}`
            }, (mailErr) => {
                if (mailErr) return res.status(500).json({ success: false, message: "Failed to send email" });
                res.status(200).json({ success: true, message: "OTP sent successfully" });
            });
            */
        });
    });
});

app.post('/api/verify-otp', async (req, res) => {
    const { fullName, email, phone, username, password, otp } = req.body;

    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], async (err, row) => {
        if (err || !row) return res.status(400).json({ success: false, message: "OTP Session expired" });
        if (row.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP" });

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run(`INSERT INTO users (fullName, email, phone, username, password) VALUES (?, ?, ?, ?, ?)`,
                [fullName, email, phone, username, hashedPassword], function(err) {
                    if (err) return res.status(500).json({ success: false, message: "Registration failed" });
                    
                    db.run(`DELETE FROM pending_otps WHERE email = ?`, [email]);
                    res.status(200).json({ 
                        success: true, 
                        user: { id: this.lastID, name: fullName, username, email, phone } 
                    });
                }
            );
        } catch (error) {
            res.status(500).json({ success: false, message: "Server configuration error" });
        }
    });
});

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

// Get all posts for feed
app.get('/api/tweets', (req, res) => {
    db.all(`SELECT * FROM tweets ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: "Failed to fetch feed" });
        res.json({ success: true, tweets: rows });
    });
});

// Get a single post by ID
app.get('/api/tweets/:id', (req, res) => {
    db.get(`SELECT * FROM tweets WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: "Database error" });
        if (!row) return res.status(404).json({ success: false, message: "Post not found" });
        res.json({ success: true, tweet: row });
    });
});

// Create a new post
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

// Like a post
app.post('/api/tweets/:id/like', (req, res) => {
    const { isLiked } = req.body;
    const inc = isLiked ? 1 : -1;
    db.run(`UPDATE tweets SET likes = max(0, likes + ?), hasLiked = ? WHERE id = ?`, 
        [inc, isLiked ? 1 : 0, req.params.id], 
        (err) => res.json({ success: !err })
    );
});

// Retweet a post
app.post('/api/tweets/:id/rt', (req, res) => {
    const { isRT } = req.body;
    const inc = isRT ? 1 : -1;
    db.run(`UPDATE tweets SET rt = max(0, rt + ?), hasRT = ? WHERE id = ?`, 
        [inc, isRT ? 1 : 0, req.params.id], 
        (err) => res.json({ success: !err })
    );
});

// Fetch all replies for a specific post
app.get('/api/tweets/:id/replies', (req, res) => {
    db.all(`SELECT * FROM replies WHERE tweetId = ? ORDER BY timestamp ASC`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, replies: rows });
    });
});

// Post a new reply
app.post('/api/tweets/:id/replies', (req, res) => {
    const { name, username, avatar, color, verified, time, text } = req.body;
    const tweetId = req.params.id;

    db.run(`INSERT INTO replies (tweetId, name, username, avatar, color, verified, time, text) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tweetId, name, username, avatar, color, verified ? 1 : 0, time, text],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            
            // Increment the reply count on the main post atomically
            db.run(`UPDATE tweets SET replies = replies + 1 WHERE id = ?`, [tweetId], (updateErr) => {
                if (updateErr) console.error("Failed to update reply count");
            });
            
            res.json({ success: true, replyId: this.lastID });
        }
    );
});

// Delete a post
app.delete('/api/tweets/:id', (req, res) => {
    db.run(`DELETE FROM tweets WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
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
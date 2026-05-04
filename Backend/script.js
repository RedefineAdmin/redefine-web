const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;

// Allow all origins strictly to prevent any browser blocking
app.use(cors({ origin: '*' }));
app.use(express.json());

// 🌟 THE MAGIC LINE: This lets your backend host your HTML directly!
app.use(express.static(__dirname)); 

// ─── EMAIL TRANSPORTER SETUP ───
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'connect.thecreatorslinkup@gmail.com', 
        pass: 'pzpyoagghzrgccgc' 
    }
});

const db = new sqlite3.Database(path.join(__dirname, 'redefine.db'), (err) => {
    if (err) console.error("Database error: ", err.message);
    else console.log("✅ Connected to the SQLite database.");
});

// 1. The main users table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fullName TEXT, email TEXT UNIQUE, phone TEXT UNIQUE,
    username TEXT UNIQUE, password TEXT, isVerified INTEGER DEFAULT 1
)`);

// 2. Pending OTPs
db.run(`CREATE TABLE IF NOT EXISTS pending_otps (
    email TEXT PRIMARY KEY, otpCode TEXT
)`);

// 3. The Tweets Table
db.run(`CREATE TABLE IF NOT EXISTS tweets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, username TEXT, avatar TEXT, color TEXT,
    verified INTEGER DEFAULT 0, time TEXT, text TEXT,
    replies INTEGER DEFAULT 0, rt INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
    views TEXT DEFAULT '0', hasLiked INTEGER DEFAULT 0, hasRT INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`, () => {
    db.get(`SELECT COUNT(*) as count FROM tweets`, (err, row) => {
        if (row && row.count === 0) {
            console.log("Seeding default tweets...");
            const defaults = [
                { name: "REDEFINE Official", username: "RedefineEdu", avatar: "R", color: "var(--p)", verified: 1, time: "2h", text: "Welcome to the brand new Community Tab! 🎉<br><br>Drop your study doubts, share your notes, or just connect with fellow students preparing for boards and JEE. Let's build the best study community together! 🚀", replies: 142, rt: 45, likes: 892, views: "12K" },
                { name: "Aman Sharma", username: "Aman_JEE2026", avatar: "A", color: "#f59e0b", verified: 0, time: "3h", text: "Integration is officially driving me crazy. 😭 Does anyone have a good cheat sheet for Definite Integrals properties? #Math #JEE", replies: 12, rt: 2, likes: 45, views: "1.2K" },
                { name: "ChemWizard", username: "ChemWizard_Tips", avatar: "C", color: "#059669", verified: 0, time: "5h", text: "🧪 Quick Chemistry Tip:<br><br>Always remember: SN1 reactions favor tertiary carbocations because of stability, while SN2 reactions favor primary substrates due to less steric hindrance! Keep this in mind for your upcoming mock tests.", replies: 5, rt: 12, likes: 128, views: "3.4K" },
                { name: "Priya Patel", username: "Priya_Codes", avatar: "P", color: "#0891b2", verified: 0, time: "6h", text: "Python list comprehensions are literal magic. ✨<br><br>Instead of writing a 4-line loop, I just write \`squares = [x**2 for x in range(10)]\` and boom. My CS teacher was so impressed today!", replies: 8, rt: 4, likes: 210, views: "4.1K" },
                { name: "MemeStudent", username: "BackbencherLife", avatar: "M", color: "#dc2626", verified: 0, time: "8h", text: "Me opening the Physics Mock Test on REDEFINE knowing fully well I only studied the first two chapters:<br><br>\"Guess I'll rely on common sense today.\" 🤡", replies: 45, rt: 112, likes: 1500, views: "22K" }
            ];
            const stmt = db.prepare(`INSERT INTO tweets (name, username, avatar, color, verified, time, text, replies, rt, likes, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            defaults.forEach(t => stmt.run(t.name, t.username, t.avatar, t.color, t.verified, t.time, t.text, t.replies, t.rt, t.likes, t.views));
            stmt.finalize();
        }
    });
});

// ─── AUTHENTICATION APIs ───
app.post('/api/send-otp', (req, res) => { 
    const { email } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (row) return res.status(400).json({ success: false, message: "Email is already registered. Please sign in.", field: "su-email" });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            if (err) return res.status(500).json({ success: false, message: "Database error." });
            const mailOptions = {
                from: 'REDEFINE Study Hub', to: email, subject: 'Your REDEFINE Verification Code',
                html: `<h2>Welcome to REDEFINE!</h2><p>Your 6-digit verification code is: <strong style="font-size: 24px; letter-spacing: 2px;">${otp}</strong></p>`
            };
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) return res.status(500).json({ success: false, message: "Failed to send email.", field: "su-email" });
                res.status(200).json({ success: true, message: "OTP sent to email!" });
            });
        });
    });
});

app.post('/api/check-otp', (req, res) => {
    const { email, otp } = req.body;
    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], (err, pendingRow) => {
        if (!pendingRow) return res.status(400).json({ success: false, message: "Please request an OTP first.", field: "otp" });
        if (pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP code.", field: "otp" });
        res.status(200).json({ success: true, message: "OTP Verified!" });
    });
});

app.post('/api/signup', async (req, res) => {
    let { fullName, email, phone, username, password, otp } = req.body;
    if (username && username.startsWith('@')) username = username.substring(1);
    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], (err, pendingRow) => {
        if (!pendingRow || pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid or expired OTP.", field: "otp" });
        db.get(`SELECT * FROM users WHERE phone = ? OR username = ?`, [phone, username], async (err, row) => {
            if (row) {
                if (row.phone === phone) return res.status(400).json({ success: false, message: "Phone number is already in use.", field: "su-phone" });
                if (row.username === username) return res.status(400).json({ success: false, message: "Username is already taken.", field: "su-username" });
            }
            try {
                const hashedPassword = await bcrypt.hash(password, 10);
                db.run(`INSERT INTO users (fullName, email, phone, username, password, isVerified) VALUES (?, ?, ?, ?, ?, 1)`, 
                    [fullName, email, phone, username, hashedPassword], 
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: "Failed to save user." });
                        db.run(`DELETE FROM pending_otps WHERE email = ?`, [email]);
                        res.status(201).json({ success: true, message: "Account created successfully!" });
                    }
                );
            } catch (error) {
                res.status(500).json({ success: false, message: "Server error." });
            }
        });
    });
});

app.post('/api/login', (req, res) => {
    let { loginId, password } = req.body; 
    if (loginId && loginId.startsWith('@')) loginId = loginId.substring(1);
    db.get(`SELECT * FROM users WHERE email = ? OR phone = ? OR username = ?`, [loginId, loginId, loginId], async (err, user) => {
        if (!user) return res.status(400).json({ success: false, message: "Account not found.", field: "login-id" });
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (passwordMatch) {
            res.status(200).json({ success: true, message: "Login successful!", user: { name: user.fullName, email: user.email, username: user.username } });
        } else {
            res.status(400).json({ success: false, message: "Incorrect password.", field: "login-pw" });
        }
    });
});

app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user) return res.status(400).json({ success: false, message: "No account found.", field: "fp-email" });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            const mailOptions = {
                from: 'REDEFINE Study Hub', to: email, subject: 'Password Reset Code',
                html: `<h2>Password Reset Request</h2><p>Your 6-digit code is: <strong style="font-size: 24px;">${otp}</strong></p>`
            };
            transporter.sendMail(mailOptions, (error, info) => {
                res.status(200).json({ success: true, message: "Reset OTP sent!" });
            });
        });
    });
});

app.post('/api/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], async (err, pendingRow) => {
        if (!pendingRow || pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP.", field: "fp-otp" });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, email], function(err) {
            db.run(`DELETE FROM pending_otps WHERE email = ?`, [email]);
            res.status(200).json({ success: true, message: "Password reset successfully!" });
        });
    });
});

// ─── TWEETS APIs ───
app.get('/api/tweets', (req, res) => {
    db.all(`SELECT * FROM tweets ORDER BY timestamp DESC, id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, tweets: rows });
    });
});

app.post('/api/tweets', (req, res) => {
    const { name, username, avatar, color, verified, time, text, views } = req.body;
    db.run(`INSERT INTO tweets (name, username, avatar, color, verified, time, text, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, username, avatar, color, verified ? 1 : 0, time, text, views || '0'],
        function(err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, tweetId: this.lastID });
        }
    );
});

app.delete('/api/tweets/:id', (req, res) => {
    db.run(`DELETE FROM tweets WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.post('/api/tweets/:id/like', (req, res) => {
    const { isLiked } = req.body;
    const inc = isLiked ? 1 : -1;
    db.run(`UPDATE tweets SET likes = likes + ?, hasLiked = ? WHERE id = ?`, [inc, isLiked ? 1 : 0, req.params.id], (err) => {
        res.json({ success: true });
    });
});

app.post('/api/tweets/:id/rt', (req, res) => {
    const { isRT } = req.body;
    const inc = isRT ? 1 : -1;
    db.run(`UPDATE tweets SET rt = rt + ?, hasRT = ? WHERE id = ?`, [inc, isRT ? 1 : 0, req.params.id], (err) => {
        res.json({ success: true });
    });
});

// Using 0.0.0.0 ensures it connects perfectly across all networks!
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 REDEFINE Backend running on http://127.0.0.1:${PORT}`);
});
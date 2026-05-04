const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;

app.use(cors());
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
    fullName TEXT,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT,
    isVerified INTEGER DEFAULT 1
)`);

// 2. A temporary table just to hold OTPs while they sign up or reset
db.run(`CREATE TABLE IF NOT EXISTS pending_otps (
    email TEXT PRIMARY KEY,
    otpCode TEXT
)`);

// ─── API ENDPOINT 1: SEND OTP ONLY ───
app.post('/api/send-otp', (req, res) => {
    const { email } = req.body;

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (row) return res.status(400).json({ success: false, message: "Email is already registered. Please sign in.", field: "su-email" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            if (err) return res.status(500).json({ success: false, message: "Database error." });

            const mailOptions = {
                from: 'REDEFINE Study Hub',
                to: email,
                subject: 'Your REDEFINE Verification Code',
                html: `<h2>Welcome to REDEFINE!</h2>
                       <p>Your 6-digit verification code is: <strong style="font-size: 24px; letter-spacing: 2px;">${otp}</strong></p>
                       <p>Enter this code to complete your signup.</p>`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) return res.status(500).json({ success: false, message: "Failed to send email.", field: "su-email" });
                res.status(200).json({ success: true, message: "OTP sent to email!" });
            });
        });
    });
});

// ─── API ENDPOINT 1.5: CHECK OTP EARLY ───
app.post('/api/check-otp', (req, res) => {
    const { email, otp } = req.body;
    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], (err, pendingRow) => {
        if (!pendingRow) return res.status(400).json({ success: false, message: "Please click 'Get OTP' first.", field: "su-email" });
        if (pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP code.", field: "otp" });
        
        res.status(200).json({ success: true, message: "OTP verified!" });
    });
});

// ─── API ENDPOINT 2: VERIFY & SIGN UP ───
app.post('/api/signup', async (req, res) => {
    let { fullName, email, phone, username, password, otp } = req.body;

    if (username && username.startsWith('@')) username = username.substring(1);

    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], (err, pendingRow) => {
        if (!pendingRow) return res.status(400).json({ success: false, message: "Please click 'Get OTP' first.", field: "su-email" });
        if (pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP code.", field: "otp" });

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

// ─── API ENDPOINT 3: LOGIN ───
app.post('/api/login', (req, res) => {
    let { loginId, password } = req.body; 

    if (loginId && loginId.startsWith('@')) loginId = loginId.substring(1);

    db.get(`SELECT * FROM users WHERE email = ? OR phone = ? OR username = ?`, [loginId, loginId, loginId], async (err, user) => {
        if (!user) return res.status(400).json({ success: false, message: "Account not found. Please check your details.", field: "login-id" });

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            res.status(200).json({ 
                success: true, 
                message: "Login successful!",
                user: { name: user.fullName, email: user.email, username: user.username, phone: user.phone } 
            });
        } else {
            return res.status(400).json({ success: false, message: "Incorrect password.", field: "login-pw" });
        }
    });
});

// ─── API ENDPOINT 4: REQUEST PASSWORD RESET OTP ───
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user) return res.status(400).json({ success: false, message: "No account found with this email.", field: "fp-email" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        db.run(`INSERT OR REPLACE INTO pending_otps (email, otpCode) VALUES (?, ?)`, [email, otp], (err) => {
            if (err) return res.status(500).json({ success: false, message: "Database error." });

            const mailOptions = {
                from: 'REDEFINE Study Hub',
                to: email,
                subject: 'Password Reset Request',
                html: `<h2>Password Reset</h2>
                       <p>We received a request to reset your password for REDEFINE.</p>
                       <p>Your 6-digit reset code is: <strong style="font-size: 24px; letter-spacing: 2px;">${otp}</strong></p>
                       <p>If you did not request this, please ignore this email.</p>`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) return res.status(500).json({ success: false, message: "Failed to send email.", field: "fp-email" });
                res.status(200).json({ success: true, message: "Reset OTP sent to email!" });
            });
        });
    });
});

// ─── API ENDPOINT 5: VERIFY OTP & CHANGE PASSWORD ───
app.post('/api/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;

    db.get(`SELECT * FROM pending_otps WHERE email = ?`, [email], async (err, pendingRow) => {
        if (!pendingRow) return res.status(400).json({ success: false, message: "Session expired. Request a new OTP.", field: "fp-email" });
        if (pendingRow.otpCode !== otp) return res.status(400).json({ success: false, message: "Invalid OTP code.", field: "fp-otp" });

        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, email], function(err) {
                if (err) return res.status(500).json({ success: false, message: "Failed to update password." });
                
                db.run(`DELETE FROM pending_otps WHERE email = ?`, [email]);
                res.status(200).json({ success: true, message: "Password updated successfully!" });
            });
        } catch (error) {
            res.status(500).json({ success: false, message: "Server error during encryption." });
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 REDEFINE Backend running on http://localhost:${PORT}`);
});
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Server State for handling stop action
let isStopRequested = false;

// Helper: Spintax Parser e.g., "{Hi|Hello|Hey}" -> Pick random
function parseSpintax(text) {
    if (!text) return '';
    const spintaxRegex = /\{([^{}]+)\}/g;
    return text.replace(spintaxRegex, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)];
    });
}

// Helper: Convert HTML to plain text fallback (Crucial for Spam score)
function htmlToPlainText(html) {
    return html.replace(/<[^>]+>/g, '').trim();
}

// Helper: Random Delay Generator
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Auth Route
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // Set in .env

    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: 'Invalid password' });
});

// Verify SMTP Connection & Turnstile Token
app.post('/api/verify', async (req, res) => {
    const { email, appPassword, cfToken } = req.body;

    if (!email || !appPassword) {
        return res.status(400).json({ success: false, message: 'Email and App Password required.' });
    }

    try {
        // Create Transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: email,
                pass: appPassword.replace(/\s+/g, '') // remove accidental spaces
            }
        });

        // Verify connection configuration
        await transporter.verify();
        res.json({ success: true, message: 'SMTP credentials verified successfully.' });
    } catch (error) {
        console.error('SMTP Verify Error:', error);
        res.status(400).json({ success: false, message: 'SMTP verification failed. Ensure Gmail App Password is valid.' });
    }
});

// Stop Route
app.post('/api/stop', (req, res) => {
    isStopRequested = true;
    res.json({ success: true, message: 'Stop signal registered.' });
});

// Bulk Streaming Sender Endpoint
app.post('/api/send-stream', async (req, res) => {
    const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

    if (!email || !appPassword || !recipients || recipients.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    // Set Header for Server-Sent Events (SSE) Streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    isStopRequested = false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: email,
            pass: appPassword.replace(/\s+/g, '')
        },
        // Anti-Spam Optimization
        pool: true,
        maxConnections: 1,
        maxMessages: 50
    });

    for (let i = 0; i < recipients.length; i++) {
        if (isStopRequested) {
            res.write(`data: ${JSON.stringify({ stopped: true })}\n\n`);
            break;
        }

        const recipient = recipients[i];

        // Process Spintax dynamically for EVERY recipient
        const currentSubject = parseSpintax(subject);
        const currentBody = parseSpintax(messageBody);

        const mailOptions = {
            from: `"${senderName}" <${email}>`,
            to: recipient,
            subject: currentSubject,
            html: currentBody,
            text: htmlToPlainText(currentBody), // Plaintext fallback helps bypass spam filters
            headers: {
                'X-Mailer': 'Secure Console Mailer',
                'X-Report-Abuse-To': email
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            res.write(`data: ${JSON.stringify({ success: true, recipient })}\n\n`);
        } catch (err) {
            console.error(`Failed sending to ${recipient}:`, err.message);
            res.write(`data: ${JSON.stringify({ success: false, recipient, error: err.message })}\n\n`);
        }

        // Random Delay between 2.0s to 2.0s (Critical to avoid Gmail rate limits & spam flagging)
        if (i < recipients.length - 1 && !isStopRequested) {
            const randomDelay = Math.floor(Math.random() * (2000 - 800 + 1)) + 2500;
            await delay(randomDelay);
        }
    }

    res.write('data: [DONE]\n\n');
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

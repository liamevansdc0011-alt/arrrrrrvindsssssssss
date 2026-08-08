const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

let isStopRequested = false;

// 1. Dynamic Unique Reference Generator (Anti-Spam Hash Bypass)
function generateRefCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `REF-${code}-${Date.now().toString().slice(-4)}`;
}

// 2. Spintax Engine ({Hi|Hello|Hey})
function parseSpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)];
    });
}

// 3. Plain Text Fallback Generator (Mandatory for Gmail Inbox)
function htmlToPlainText(html) {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// 4. Fixed 1.5 Seconds Delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Auth Endpoint
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
    if (password === ADMIN_PASSWORD) return res.json({ success: true });
    return res.status(401).json({ success: false, message: 'Invalid password' });
});

// SMTP Verification
app.post('/api/verify', async (req, res) => {
    const { email, appPassword } = req.body;
    if (!email || !appPassword) {
        return res.status(400).json({ success: false, message: 'Email and App Password required.' });
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: email, pass: appPassword.replace(/\s+/g, '') }
        });
        await transporter.verify();
        res.json({ success: true, message: 'SMTP credentials verified.' });
    } catch (error) {
        res.status(400).json({ success: false, message: 'SMTP verification failed.' });
    }
});

// Stop Signal
app.post('/api/stop', (req, res) => {
    isStopRequested = true;
    res.json({ success: true, message: 'Stopping process...' });
});

// Streaming Email Dispatcher
app.post('/api/send-stream', async (req, res) => {
    const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

    if (!email || !appPassword || !recipients || recipients.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }

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
        pool: true,
        maxConnections: 1
    });

    for (let i = 0; i < recipients.length; i++) {
        if (isStopRequested) {
            res.write(`data: ${JSON.stringify({ stopped: true })}\n\n`);
            break;
        }

        const recipient = recipients[i];
        const refCode = generateRefCode();

        // Process Spintax
        let processedSubject = parseSpintax(subject);
        let processedBody = parseSpintax(messageBody);

        // Inject Unique Reference Footer (Bypasses Duplicate Content Filters)
        const antiSpamFooter = `<br><br><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;font-family:sans-serif;">Reference ID: #${refCode} | Communication Code: ${Date.now().toString().slice(-6)}</td></tr></table>`;
        
        const finalHtml = processedBody + antiSpamFooter;
        const finalPlain = htmlToPlainText(processedBody) + `\n\nReference ID: #${refCode}`;

        // RFC Compliant Headers
        const domain = email.split('@')[1] || 'gmail.com';
        const customMessageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 7)}@${domain}>`;

        const mailOptions = {
            from: `"${senderName}" <${email}>`,
            to: recipient,
            subject: processedSubject,
            html: finalHtml,
            text: finalPlain,
            headers: {
                'Message-ID': customMessageId,
                'X-Entity-Ref-ID': refCode,
                'X-Mailer': 'Secure Direct Mailer Engine',
                'List-Unsubscribe': `<mailto:${email}?subject=Unsubscribe>`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            res.write(`data: ${JSON.stringify({ success: true, recipient, ref: refCode })}\n\n`);
        } catch (err) {
            res.write(`data: ${JSON.stringify({ success: false, recipient, error: err.message })}\n\n`);
        }

        // Exact 1.5 Seconds Delay (1500ms)
        if (i < recipients.length - 1 && !isStopRequested) {
            await delay(1500);
        }
    }

    res.write('data: [DONE]\n\n');
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;

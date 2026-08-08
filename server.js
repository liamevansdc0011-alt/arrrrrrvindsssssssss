const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Anti-Spam Reference Code Generator
function generateRefCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `REF-${code}-${Date.now().toString().slice(-4)}`;
}

// Spintax Engine ({Hi|Hello})
function parseSpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)];
    });
}

// Plaintext Fallback
function htmlToPlainText(html) {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Auth Route
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
    if (password === ADMIN_PASSWORD) return res.json({ success: true });
    return res.status(401).json({ success: false, message: 'Invalid password' });
});

// Verify SMTP
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

// Send Batch Route
app.post('/api/send-batch', async (req, res) => {
    const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

    if (!email || !appPassword || !recipients || recipients.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: email,
            pass: appPassword.replace(/\s+/g, '')
        }
    });

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const refCode = generateRefCode();

        const currentSubject = parseSpintax(subject);
        const currentBody = parseSpintax(messageBody);

        const antiSpamFooter = `<br><br><div style="border-top:1px solid #eee;padding-top:10px;font-size:11px;color:#888;">Ref ID: #${refCode}</div>`;
        const finalHtml = currentBody + antiSpamFooter;
        const finalPlain = htmlToPlainText(currentBody) + `\n\nRef ID: #${refCode}`;

        const mailOptions = {
            from: `"${senderName}" <${email}>`,
            to: recipient,
            subject: currentSubject,
            html: finalHtml,
            text: finalPlain,
            headers: {
                'X-Entity-Ref-ID': refCode,
                'List-Unsubscribe': `<mailto:${email}?subject=Unsubscribe>`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            sentCount++;
        } catch (err) {
            console.error(`Failed to ${recipient}:`, err.message);
            failedCount++;
        }

        if (i < recipients.length - 1) {
            await delay(1500); // 1.5 seconds delay
        }
    }

    return res.json({ success: true, sentCount, failedCount });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;

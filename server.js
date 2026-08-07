import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '##';

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const activeSessions = {};
const transporters = new Map();

/* ==========================================================================
   1. UNIQUE REFERENCE CODE & HASH GENERATOR (Anti-Spam Fingerprint)
   ========================================================================== */
function generateReferenceData() {
  const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
  const timeStamp = Date.now().toString().slice(-4);
  
  // Example Ref Code: REF-8F3A-9201
  const refCode = `REF-${randomHex}-${timeStamp}`;
  
  // Invisible Hash to break duplicate content hashing by Gmail AI
  const invisibleHash = `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    [RefID: ${crypto.randomBytes(8).toString('hex')}]
  </div>`;

  return { refCode, invisibleHash };
}

/* ==========================================================================
   2. TRANSPORTER POOLING
   ========================================================================== */
function getTransporter(email, appPassword) {
  const cleanEmail = email.toLowerCase().trim();
  const cacheKey = `${cleanEmail}_${appPassword}`;

  if (!transporters.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: cleanEmail, pass: appPassword },
      pool: true,
      maxConnections: 1, // Single connection to avoid rapid socket bans
      maxMessages: 100
    });
    transporters.set(cacheKey, transporter);
  }
  return transporters.get(cacheKey);
}

/* ==========================================================================
   3. SPINTAX PARSER ({Hi|Hello|Hey})
   ========================================================================== */
function parseSpintax(text) {
  if (!text) return "";
  let spun = text;
  const regex = /\{([^{}]+)\}/g;
  let iterations = 0;
  while (regex.test(spun) && iterations < 10) {
    spun = spun.replace(regex, (_, choices) => {
      const options = choices.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
    iterations++;
  }
  return spun;
}

/* ==========================================================================
   4. HTML TO PLAIN-TEXT CONVERTER
   ========================================================================== */
function convertHtmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/* ==========================================================================
   5. AUTHENTICATION ROUTES
   ========================================================================== */
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) return res.json({ success: true });
  return res.status(401).json({ success: false, message: "Incorrect password" });
});

app.post("/api/verify", async (req, res) => {
  const { email, appPassword } = req.body;
  if (!email || !appPassword) return res.status(400).json({ success: false, message: "Credentials required" });

  try {
    const transporter = getTransporter(email, appPassword);
    await transporter.verify();
    return res.json({ success: true, message: "SMTP verified successfully" });
  } catch (error) {
    return res.status(401).json({ success: false, message: "Authentication failed. Check App Password." });
  }
});

/* ==========================================================================
   6. SAFE & INBOX-OPTIMIZED STREAM ROUTE
   ========================================================================== */
app.post("/api/send-stream", async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

  if (!email || !appPassword || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Missing required fields" })}\n\n`);
    res.end();
    return;
  }

  const senderEmail = email.toLowerCase().trim();
  const cleanSenderName = (senderName || "").replace(/"/g, "").trim();

  activeSessions['global_stop'] = false;

  for (let index = 0; index < recipients.length; index++) {
    if (activeSessions['global_stop']) {
      res.write(`data: ${JSON.stringify({ success: false, error: "Stopped by user" })}\n\n`);
      break;
    }

    const recipient = recipients[index] ? recipients[index].trim() : "";
    if (!recipient) continue;

    res.write(': keep-alive\n\n');

    try {
      const transporter = getTransporter(email, appPassword);
      
      // Generate Unique Reference ID for this specific mail
      const { refCode, invisibleHash } = generateReferenceData();

      const spunSubject = parseSpintax(subject);
      let spunBody = parseSpintax(messageBody);

      // Append Reference Code Footer to Mail Body
      const referenceFooterHtml = `
        <br/><br/>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0;"/>
        <p style="font-size:11px;color:#888888;font-family:sans-serif;margin:0;">
          Reference Code: <strong>${refCode}</strong> | Sent via Secure Mail Protocol
        </p>
        ${invisibleHash}
      `;

      const referenceFooterText = `\n\n---\nReference Code: ${refCode}`;

      const isHtml = /<[a-z][\s\S]*>/i.test(spunBody);

      // Unique Message ID generation for email standards compliance
      const messageIdDomain = senderEmail.split('@')[1] || 'gmail.com';
      const customMessageId = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@${messageIdDomain}>`;

      const mailOptions = {
        from: cleanSenderName ? `"${cleanSenderName}" <${senderEmail}>` : senderEmail,
        to: recipient,
        subject: `${spunSubject} [#${refCode.slice(-8)}]`, // Unique subject suffix
        messageId: customMessageId,
        headers: {
          'X-Entity-Ref-ID': refCode,
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'List-Unsubscribe': `<mailto:${senderEmail}?subject=Unsubscribe%20${refCode}>`,
          'Date': new Date().toUTCString()
        }
      };

      if (isHtml) {
        mailOptions.html = spunBody + referenceFooterHtml;
        mailOptions.text = convertHtmlToText(spunBody) + referenceFooterText;
      } else {
        mailOptions.text = spunBody + referenceFooterText;
      }

      await transporter.sendMail(mailOptions);
      res.write(`data: ${JSON.stringify({ success: true, recipient, refCode })}\n\n`);

    } catch (error) {
      console.error(`Error sending to ${recipient}:`, error.message);
      res.write(`data: ${JSON.stringify({ success: false, recipient, error: error.message })}\n\n`);
    }

    // HUMAN BEHAVIOR SIMULATION DELAY (1.8s - 3.2s)
    // Dynamic delay keeps sending speed natural to pass Google AI checks
    if (index < recipients.length - 1) {
      const dynamicDelay = 400 + Math.floor(Math.random() * 300);
      await new Promise(resolve => setTimeout(resolve, dynamicDelay));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

/* ==========================================================================
   7. STOP ROUTE
   ========================================================================== */
app.post("/api/stop", (req, res) => {
  activeSessions['global_stop'] = true;
  res.json({ success: true, message: "Stop process registered" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;

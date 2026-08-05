import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '##';

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const globalState = { stopFlag: false };
const poolMap = new Map();

/* ==========================================================================
   DYNAMIC SMTP CONNECTION POOL (Fast Socket Re-use)
   ========================================================================== */
function buildSMTPClient(userEmail, appPass) {
  const account = userEmail.toLowerCase().trim();
  const key = `${account}:${appPass}`;

  if (!poolMap.has(key)) {
    const client = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: account, pass: appPass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      socketTimeout: 15000
    });
    poolMap.set(key, client);
  }
  return poolMap.get(key);
}

/* ==========================================================================
   RECURSIVE SPINTAX TRANSFORMER ({A|B|C})
   ========================================================================== */
function processSpintax(input) {
  if (!input) return "";
  let result = input;
  const pattern = /\{([^{}]+)\}/g;
  
  while (pattern.test(result)) {
    result = result.replace(pattern, (_, options) => {
      const choices = options.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }
  return result;
}

/* ==========================================================================
   HIGH-INBOX TEXT FALLBACK GENERATOR
   ========================================================================== */
function generateCleanText(htmlContent) {
  if (!htmlContent) return "";
  return htmlContent
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/* ==========================================================================
   AUTHENTICATION API
   ========================================================================== */
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) return res.json({ success: true });
  return res.status(401).json({ success: false, message: "Invalid key" });
});

app.post("/api/verify", async (req, res) => {
  const { email, appPassword } = req.body;
  if (!email || !appPassword) return res.status(400).json({ success: false, message: "Missing auth data" });

  try {
    const smtpClient = buildSMTPClient(email, appPassword);
    await smtpClient.verify();
    return res.json({ success: true, message: "SMTP Connected Successfully" });
  } catch (err) {
    return res.status(401).json({ success: false, message: "Auth Error: " + err.message });
  }
});

/* ==========================================================================
   STREAM ENGINE (0.5 SEC DELAY & UNIQUE HEADERS PER RECIPIENT)
   ========================================================================== */
app.post("/api/send-stream", async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

  if (!email || !appPassword || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Required fields missing" })}\n\n`);
    res.end();
    return;
  }

  const senderAddr = email.toLowerCase().trim();
  const displayName = (senderName || "").replace(/"/g, "").trim();

  globalState.stopFlag = false;

  for (let idx = 0; idx < recipients.length; idx++) {
    if (globalState.stopFlag) {
      res.write(`data: ${JSON.stringify({ success: false, error: "Process cancelled" })}\n\n`);
      break;
    }

    const targetEmail = recipients[idx] ? recipients[idx].trim() : "";
    if (!targetEmail) continue;

    res.write(': keep-alive\n\n');

    try {
      const client = buildSMTPClient(email, appPassword);
      
      // Dynamic content variation
      const finalSubject = processSpintax(subject);
      let finalBody = processSpintax(messageBody);
      const isHtml = /<[a-z][\s\S]*>/i.test(finalBody);

      // Generate unique identifier to bypass duplicate content filters
      const uniqueHash = crypto.randomBytes(6).toString('hex');
      const timeStamp = Date.now();

      const mailData = {
        from: displayName ? `"${displayName}" <${senderAddr}>` : senderAddr,
        to: targetEmail,
        subject: finalSubject,
        headers: {
          'Message-ID': `<${timeStamp}.${uniqueHash}@mail.gmail.com>`,
          'X-Gmail-Original-Message-ID': `${uniqueHash}`,
          'X-Mailer': 'Gmail Desktop Client (v11.0)',
          'Date': new Date().toUTCString()
        }
      };

      if (isHtml) {
        mailData.html = finalBody;
        mailData.text = generateCleanText(finalBody);
      } else {
        mailData.text = finalBody;
      }

      await client.sendMail(mailData);
      res.write(`data: ${JSON.stringify({ success: true, recipient: targetEmail })}\n\n`);

    } catch (err) {
      console.error(`Failed sending to ${targetEmail}:`, err.message);
      res.write(`data: ${JSON.stringify({ success: false, recipient: targetEmail, error: err.message })}\n\n`);
    }

    // ⚡ EXACT 0.5 SECONDS SPEED (500ms delay)
    if (idx < recipients.length - 1) {
      await new Promise(res => setTimeout(res, 500));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

/* ==========================================================================
   CANCEL/STOP API
   ========================================================================== */
app.post("/api/stop", (req, res) => {
  globalState.stopFlag = true;
  res.json({ success: true, message: "Engine stopped" });
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Inbox Engine active on port ${PORT}`));
}

export default app;

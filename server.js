import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// File Path Resolver
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Application Initialization
const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_KEY = process.env.SITE_PASSWORD || '##';

// Middleware Pipeline
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Global Application Memory
const engineState = { isRunning: true };
const smtpPool = new Map();

/* ==========================================================================
   1. UTILITY: SPINTAX RESOLVER
   ========================================================================== */
function resolveSpintax(template) {
  if (!template) return "";
  let result = template;
  const spintaxRegex = /\{([^{}]+)\}/g;
  let count = 0;

  while (spintaxRegex.test(result) && count < 8) {
    result = result.replace(spintaxRegex, (_, group) => {
      const variants = group.split('|');
      return variants[Math.floor(Math.random() * variants.length)];
    });
    count++;
  }
  return result;
}

/* ==========================================================================
   2. UTILITY: HTML TO TEXT SANITIZER
   ========================================================================== */
function sanitizeToText(htmlContent) {
  if (!htmlContent) return "";
  return htmlContent
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
   3. SMTP TRANSPORTER MANAGER
   ========================================================================== */
function fetchTransporter(userEmail, appPassword) {
  const normalizedEmail = userEmail.toLowerCase().trim();
  const poolKey = `${normalizedEmail}:${appPassword}`;

  if (!smtpPool.has(poolKey)) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: normalizedEmail, pass: appPassword },
      pool: true,
      maxConnections: 1,
      maxMessages: 100
    });
    smtpPool.set(poolKey, transporter);
  }
  return smtpPool.get(poolKey);
}

/* ==========================================================================
   4. AUTHENTICATION & SMTP VERIFICATION ROUTES
   ========================================================================== */
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_KEY) return res.json({ success: true });
  return res.status(401).json({ success: false, message: "Unauthorized password access" });
});

app.post("/api/verify", async (req, res) => {
  const { email, appPassword } = req.body;
  if (!email || !appPassword) {
    return res.status(400).json({ success: false, message: "Email and App Password required" });
  }

  try {
    const transporter = fetchTransporter(email, appPassword);
    await transporter.verify();
    return res.json({ success: true, message: "Gmail SMTP Verified Successfully" });
  } catch (error) {
    return res.status(401).json({ success: false, message: `SMTP Failed: ${error.message}` });
  }
});

/* ==========================================================================
   5. CLEAN SSE DISPATCH STREAM ROUTE (1.0s - 1.1s Speed | No Ref Code)
   ========================================================================== */
app.post("/api/send-stream", async (req, res) => {
  // SSE Headers Setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { email, appPassword, senderName, subject, messageBody, recipients } = req.body;

  if (!email || !appPassword || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Invalid or missing payload data" })}\n\n`);
    res.end();
    return;
  }

  const senderEmail = email.toLowerCase().trim();
  const formattedSender = senderName ? `"${senderName.replace(/"/g, '').trim()}" <${senderEmail}>` : senderEmail;
  
  engineState.isRunning = true;

  for (let i = 0; i < recipients.length; i++) {
    if (!engineState.isRunning) {
      res.write(`data: ${JSON.stringify({ success: false, error: "Execution stopped by user" })}\n\n`);
      break;
    }

    const recipient = recipients[i] ? recipients[i].trim() : "";
    if (!recipient) continue;

    // Keep SSE Connection Warm
    res.write(': keep-alive\n\n');

    try {
      const transporter = fetchTransporter(email, appPassword);
      
      const spunSubject = resolveSpintax(subject);
      const spunBody = resolveSpintax(messageBody);

      const isHtmlBody = /<[a-z][\s\S]*>/i.test(spunBody);
      const domainName = senderEmail.split('@')[1] || 'gmail.com';
      
      // Clean, standard Message-ID
      const uniqueMsgId = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@${domainName}>`;

      const mailOptions = {
        from: formattedSender,
        to: recipient,
        subject: spunSubject,
        messageId: uniqueMsgId,
        headers: {
          'Date': new Date().toUTCString()
        }
      };

      if (isHtmlBody) {
        mailOptions.html = spunBody;
        mailOptions.text = sanitizeToText(spunBody);
      } else {
        mailOptions.text = spunBody;
      }

      await transporter.sendMail(mailOptions);
      
      res.write(`data: ${JSON.stringify({ 
        success: true, 
        recipient 
      })}\n\n`);

    } catch (error) {
      console.error(`Dispatch failed for [${recipient}]:`, error.message);
      res.write(`data: ${JSON.stringify({ 
        success: false, 
        recipient, 
        error: error.message 
      })}\n\n`);
    }

    // STRICT SPEED CONTROL: 1.0 TO 1.1 SECONDS (1000ms - 1100ms)
    if (i < recipients.length - 1) {
      const delayInterval = 1000 + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, delayInterval));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

/* ==========================================================================
   6. CONTROL ROUTE: HALT STREAM PROCESS
   ========================================================================== */
app.post("/api/stop", (req, res) => {
  engineState.isRunning = false;
  res.json({ success: true, message: "Engine stop signal emitted" });
});

/* ==========================================================================
   7. SERVER LISTEN
   ========================================================================== */
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Mail Engine operational on http://localhost:${PORT}`);
  });
}

export default app;

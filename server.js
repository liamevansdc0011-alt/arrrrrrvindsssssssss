import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import validator from 'validator';
import { convert } from 'html-to-text';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';

// Global Configuration & Security Rules
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate limiting to protect endpoints against overuse
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Rate limit exceeded. Try again later." }
});
app.use('/api/', generalLimiter);

// State Management
const activeTransporters = new Map();
let isStopRequested = false;

/* ==========================================================================
   UTILITY & HELPER FUNCTIONS
   ========================================================================== */

/**
 * Constant-time password verification to prevent timing attacks.
 */
function verifyPassword(inputPassword) {
  if (!SITE_PASSWORD || !inputPassword) return false;
  const inputBuffer = Buffer.from(inputPassword);
  const targetBuffer = Buffer.from(SITE_PASSWORD);
  
  if (inputBuffer.length !== targetBuffer.length) return false;
  return crypto.timingSafeEqual(inputBuffer, targetBuffer);
}

/**
 * Parses Spintax formatting: {Option A|Option B|Option C}
 */
function parseSpintax(text = "") {
  let result = text;
  const pattern = /{([^{}]+)}/g;
  let iterations = 0;
  
  while (pattern.test(result) && iterations < 10) {
    result = result.replace(pattern, (_, choices) => {
      const options = choices.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
    iterations++;
  }
  return result;
}

/**
 * Creates or retrieves an existing pooled Nodemailer transporter instance.
 */
function getTransporter(email, appPassword) {
  const cleanEmail = email.toLowerCase().trim();
  const cacheKey = `${cleanEmail}:${appPassword}`;

  if (!activeTransporters.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cleanEmail, pass: appPassword },
      pool: true,
      maxConnections: 1,
      maxMessages: 50,
      rateDelta: 1000,
      rateLimit: 1
    });
    activeTransporters.set(cacheKey, transporter);
  }
  return activeTransporters.get(cacheKey);
}

/* ==========================================================================
   ROUTES
   ========================================================================== */

// Authentication
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password)) {
    return res.json({ success: true, message: "Authenticated successfully" });
  }
  return res.status(401).json({ success: false, message: "Unauthorized" });
});

// SMTP Verification
app.post("/api/verify", async (req, res) => {
  const { email, appPassword } = req.body;
  
  if (!email || !appPassword || !validator.isEmail(email)) {
    return res.status(400).json({ success: false, message: "Valid email and app password required" });
  }

  try {
    const transporter = getTransporter(email, appPassword);
    await transporter.verify();
    return res.json({ success: true, message: "SMTP credentials verified" });
  } catch (error) {
    return res.status(401).json({ success: false, message: "SMTP verification failed" });
  }
});

// Streaming Email Route
app.post("/api/send-stream", async (req, res) => {
  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { email, appPassword, senderName, subject, messageBody, recipients, delayMs = 3500 } = req.body;

  if (!email || !appPassword || !Array.isArray(recipients) || recipients.length === 0) {
    res.write(`data: ${JSON.stringify({ success: false, error: "Invalid payload parameters" })}\n\n`);
    return res.end();
  }

  const cleanSenderEmail = email.toLowerCase().trim();
  const cleanSenderName = validator.escape(senderName || "").trim();
  isStopRequested = false;

  for (let i = 0; i < recipients.length; i++) {
    if (isStopRequested) {
      res.write(`data: ${JSON.stringify({ success: false, message: "Process stopped by user" })}\n\n`);
      break;
    }

    const recipient = recipients[i] ? recipients[i].trim() : "";

    // Skip invalid recipient emails
    if (!recipient || !validator.isEmail(recipient)) {
      res.write(`data: ${JSON.stringify({ success: false, recipient, error: "Invalid recipient address skipped" })}\n\n`);
      continue;
    }

    // Keep-alive signal
    res.write(': keep-alive\n\n');

    try {
      const transporter = getTransporter(cleanSenderEmail, appPassword);
      const spunSubject = parseSpintax(subject);
      const spunBody = parseSpintax(messageBody);
      const containsHtml = /<[a-z][\s\S]*>/i.test(spunBody);

      const domain = cleanSenderEmail.split('@')[1] || 'gmail.com';
      const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${domain}>`;

      const plainTextContent = containsHtml 
        ? convert(spunBody, { wordwrap: 120 }) 
        : spunBody;

      const mailOptions = {
        from: cleanSenderName ? `"${cleanSenderName}" <${cleanSenderEmail}>` : cleanSenderEmail,
        replyTo: cleanSenderEmail,
        to: recipient,
        subject: spunSubject,
        text: plainTextContent,
        headers: {
          'Message-ID': messageId,
          'X-Mailer': 'Secure Mail Engine',
          'List-Unsubscribe': `<mailto:${cleanSenderEmail}?subject=unsubscribe>`
        }
      };

      if (containsHtml) {
        mailOptions.html = spunBody;
      }

      await transporter.sendMail(mailOptions);
      res.write(`data: ${JSON.stringify({ success: true, recipient })}\n\n`);

    } catch (err) {
      res.write(`data: ${JSON.stringify({ success: false, recipient, error: err.message })}\n\n`);
    }

    // Dynamic delay with randomized jitter
    if (i < recipients.length - 1) {
      const baseDelay = Math.max(300, Number(delayMs) || 250);
      const jitter = Math.floor(Math.random() * 200);
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

// Process Control
app.post("/api/stop", (req, res) => {
  isStopRequested = true;
  res.json({ success: true, message: "Stop signal broadcasted" });
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.message);
  res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;

```js
import "dotenv/config";
import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_passwords || "";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const activeSessions = {
  global_stop: false
};

const transporters = new Map();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function getTransporter(email, appPassword) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPassword = String(appPassword).trim();

  const cacheKey = `${cleanEmail}:${cleanPassword}`;

  if (!transporters.has(cacheKey)) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      pool: true,
      maxConnections: 1,
      maxMessages: 50,
      auth: {
        user: cleanEmail,
        pass: cleanPassword
      }
    });

    transporters.set(cacheKey, transporter);
  }

  return transporters.get(cacheKey);
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function convertHtmlToText(html) {
  if (!html) return "";

  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

function parseSpintax(text) {
  if (!text) return "";

  let result = String(text);
  const regex = /{([^{}]+)}/g;

  for (let i = 0; i < 10; i++) {
    if (!regex.test(result)) break;

    result = result.replace(regex, (_, choices) => {
      const options = choices.split("|");

      return options[
        crypto.randomInt(0, options.length)
      ];
    });
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
*/

app.post("/api/auth", (req, res) => {
  const { password } = req.body;

  if (!SITE_PASSWORD) {
    return res.status(500).json({
      success: false,
      message: "SITE_PASSWORD is not configured"
    });
  }

  if (password === SITE_PASSWORD) {
    return res.json({
      success: true
    });
  }

  return res.status(401).json({
    success: false,
    message: "Incorrect password"
  });
});

/*
|--------------------------------------------------------------------------
| Verify Gmail SMTP
|--------------------------------------------------------------------------
*/

app.post("/api/verify", async (req, res) => {
  const { email, appPassword } = req.body;

  if (!email || !appPassword) {
    return res.status(400).json({
      success: false,
      message: "Gmail email and App Password are required"
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Gmail address"
    });
  }

  try {
    const transporter = getTransporter(email, appPassword);

    await transporter.verify();

    return res.json({
      success: true,
      message: "Gmail SMTP verified successfully"
    });
  } catch (error) {
    console.error("SMTP verification error:", error.message);

    return res.status(401).json({
      success: false,
      message:
        "Gmail authentication failed. Check the email address and App Password."
    });
  }
});

/*
|--------------------------------------------------------------------------
| Send Email Stream
|--------------------------------------------------------------------------
*/

app.post("/api/send-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const {
    email,
    appPassword,
    senderName,
    subject,
    messageBody,
    recipients
  } = req.body;

  if (!email || !appPassword) {
    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "Gmail email and App Password are required"
      })}\n\n`
    );

    res.end();
    return;
  }

  if (!isValidEmail(email)) {
    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "Invalid sender email"
      })}\n\n`
    );

    res.end();
    return;
  }

  if (!subject || !String(subject).trim()) {
    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "Subject is required"
      })}\n\n`
    );

    res.end();
    return;
  }

  if (!messageBody || !String(messageBody).trim()) {
    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "Message body is required"
      })}\n\n`
    );

    res.end();
    return;
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "At least one recipient is required"
      })}\n\n`
    );

    res.end();
    return;
  }

  const senderEmail = email.trim().toLowerCase();
  const cleanSenderName = String(senderName || "")
    .replace(/["<>]/g, "")
    .trim();

  let transporter;

  try {
    transporter = getTransporter(senderEmail, appPassword);
    await transporter.verify();
  } catch (error) {
    console.error("SMTP verification failed:", error.message);

    res.write(
      `data: ${JSON.stringify({
        success: false,
        error: "Gmail SMTP authentication failed"
      })}\n\n`
    );

    res.end();
    return;
  }

  activeSessions.global_stop = false;

  for (let index = 0; index < recipients.length; index++) {
    if (activeSessions.global_stop) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          stopped: true,
          error: "Sending stopped by user"
        })}\n\n`
      );

      break;
    }

    const recipient = String(recipients[index] || "")
      .trim()
      .toLowerCase();

    if (!recipient) {
      continue;
    }

    if (!isValidEmail(recipient)) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          recipient,
          error: "Invalid recipient email"
        })}\n\n`
      );

      continue;
    }

    res.write(": keep-alive\n\n");

    try {
      const spunSubject = parseSpintax(subject);
      const spunBody = parseSpintax(messageBody);

      const isHtml =
        /<\/?[a-z][\s\S]*>/i.test(spunBody);

      const htmlBody = isHtml
        ? spunBody
        : escapeHtml(spunBody).replace(/\r?\n/g, "<br>");

      const plainText = isHtml
        ? convertHtmlToText(spunBody)
        : spunBody;

      const mailOptions = {
        from: cleanSenderName
          ? `"${cleanSenderName}" <${senderEmail}>`
          : senderEmail,

        to: recipient,

        subject: spunSubject,

        text: plainText,

        html: htmlBody
      };

      const info = await transporter.sendMail(mailOptions);

      console.log(
        `Email accepted by SMTP: ${recipient} | ${info.messageId}`
      );

      res.write(
        `data: ${JSON.stringify({
          success: true,
          recipient,
          messageId: info.messageId
        })}\n\n`
      );
    } catch (error) {
      console.error(
        `Error sending to ${recipient}:`,
        error.message
      );

      res.write(
        `data: ${JSON.stringify({
          success: false,
          recipient,
          error: error.message
        })}\n\n`
      );
    }
  }

  res.write(
    `data: ${JSON.stringify({
      done: true
    })}\n\n`
  );

  res.write("data: [DONE]\n\n");
  res.end();
});

/*
|--------------------------------------------------------------------------
| Stop Sending
|--------------------------------------------------------------------------
*/

app.post("/api/stop", (req, res) => {
  activeSessions.global_stop = true;

  return res.json({
    success: true,
    message: "Stop request registered"
  });
});

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Email server is running"
  });
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

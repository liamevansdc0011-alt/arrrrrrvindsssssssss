```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// SMTP configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Check SMTP connection
async function verifySMTP() {
  try {
    await transporter.verify();
    console.log("✅ SMTP connection successful");
  } catch (error) {
    console.error("❌ SMTP connection failed:", error.message);
  }
}

// Home route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Bulk Email Sender is running"
  });
});

// Send email
app.post("/send-email", async (req, res) => {
  try {
    const { clientEmail, subject, text, html } = req.body;

    // Validate client email
    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(clientEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid client email address"
      });
    }

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: "Email subject is required"
      });
    }

    if (!text && !html) {
      return res.status(400).json({
        success: false,
        message: "Email content is required"
      });
    }

    const mailOptions = {
      from: `"${process.env.FROM_NAME || "Your Company"}" <${process.env.FROM_EMAIL}>`,
      to: clientEmail,
      subject: subject,
      text: text || "",
      html: html || text || ""
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent to: ${clientEmail}`);
    console.log(`Message ID: ${info.messageId}`);

    return res.status(200).json({
      success: true,
      message: "Email accepted by the SMTP server",
      clientEmail: clientEmail,
      messageId: info.messageId
    });

  } catch (error) {
    console.error("❌ Email sending error:", error);

    return res.status(500).json({
      success: false,
      message: "Email could not be sent",
      error: error.message
    });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await verifySMTP();
});
```

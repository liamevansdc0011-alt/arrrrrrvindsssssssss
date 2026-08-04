import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Standard Nodemailer Transporter Configuration
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.post("/api/send-email", async (req, res) => {
  const { to, subject, html, text } = req.body;

  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ 
      success: false, 
      message: "Mandatory fields missing (to, subject, body)" 
    });
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      html
    });

    return res.json({ 
      success: true, 
      messageId: info.messageId 
    });
  } catch (error) {
    console.error("Email processing failed:", error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Email Service running on port ${PORT}`);
});

export default app;

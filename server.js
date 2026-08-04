import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Example using SendGrid API (Requires domain SPF/DKIM verification)
app.post("/api/send-transactional", async (req, res) => {
  const { to, subject, htmlContent } = req.body;

  if (!to || !subject || !htmlContent) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: process.env.VERIFIED_SENDER_EMAIL }, // Must be your authenticated domain email
        subject: subject,
        content: [{ type: "text/html", value: htmlContent }]
      })
    });

    if (response.ok) {
      return res.json({ success: true, message: "Email sent via API" });
    } else {
      const errorData = await response.json();
      return res.status(response.status).json({ success: false, error: errorData });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

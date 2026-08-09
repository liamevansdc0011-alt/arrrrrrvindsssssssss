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

/*
|--------------------------------------------------------------------------
| DASHBOARD PASSWORD
|--------------------------------------------------------------------------
| Vercel Environment Variable:
|
| SITE_PASSWORD = your dashboard password
|
*/

const SITE_PASSWORD = process.env.SITE_PASSWORD || "";


/*
|--------------------------------------------------------------------------
| MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use(cors());

app.use(
  express.json({
    limit: "50mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/*
|--------------------------------------------------------------------------
| STATE
|--------------------------------------------------------------------------
*/

const activeSessions = {
  global_stop: false
};

const transporters = new Map();


/*
|--------------------------------------------------------------------------
| HELPER: EMAIL VALIDATION
|--------------------------------------------------------------------------
*/

function isValidEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email.trim()
  );
}


/*
|--------------------------------------------------------------------------
| HELPER: HTML ESCAPE
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/*
|--------------------------------------------------------------------------
| HELPER: HTML TO TEXT
|--------------------------------------------------------------------------
*/

function convertHtmlToText(html) {
  if (!html) {
    return "";
  }

  return String(html)
    .replace(
      /<style[^>]*>[\s\S]*?<\/style>/gi,
      ""
    )
    .replace(
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      ""
    )
    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )
    .replace(
      /<\/p>/gi,
      "\n\n"
    )
    .replace(
      /<\/div>/gi,
      "\n"
    )
    .replace(
      /<[^>]*>/g,
      ""
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /\n\s*\n\s*\n/g,
      "\n\n"
    )
    .trim();
}


/*
|--------------------------------------------------------------------------
| HELPER: SPINTAX
|--------------------------------------------------------------------------
| Example:
| {Hello|Hi|Hey}
|
*/

function parseSpintax(text) {
  if (!text) {
    return "";
  }

  let result = String(text);

  const regex = /{([^{}]+)}/g;

  for (let i = 0; i < 10; i++) {
    if (!regex.test(result)) {
      break;
    }

    result = result.replace(
      regex,
      (_, choices) => {
        const options = choices
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean);

        if (options.length === 0) {
          return "";
        }

        return options[
          crypto.randomInt(
            0,
            options.length
          )
        ];
      }
    );
  }

  return result;
}


/*
|--------------------------------------------------------------------------
| GMAIL TRANSPORTER
|--------------------------------------------------------------------------
*/

function getTransporter(
  email,
  appPassword
) {
  const cleanEmail = String(email)
    .trim()
    .toLowerCase();

  const cleanPassword = String(appPassword)
    .trim();

  const cacheKey =
    `${cleanEmail}:${cleanPassword}`;

  if (!transporters.has(cacheKey)) {
    const transporter =
      nodemailer.createTransport({
        service: "gmail",

        pool: true,

        maxConnections: 1,

        maxMessages: 50,

        auth: {
          user: cleanEmail,
          pass: cleanPassword
        }
      });

    transporters.set(
      cacheKey,
      transporter
    );
  }

  return transporters.get(cacheKey);
}


/*
|--------------------------------------------------------------------------
| DASHBOARD AUTHENTICATION
|--------------------------------------------------------------------------
*/

app.post(
  "/api/auth",
  (req, res) => {
    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    if (!SITE_PASSWORD) {
      console.error(
        "SITE_PASSWORD environment variable is not configured."
      );

      return res.status(500).json({
        success: false,
        message:
          "Dashboard password is not configured on the server."
      });
    }

    if (
      password === SITE_PASSWORD
    ) {
      return res.json({
        success: true
      });
    }

    return res.status(401).json({
      success: false,
      message: "Incorrect password"
    });
  }
);


/*
|--------------------------------------------------------------------------
| VERIFY GMAIL SMTP
|--------------------------------------------------------------------------
*/

app.post(
  "/api/verify",
  async (req, res) => {
    const {
      email,
      appPassword
    } = req.body || {};

    if (
      !email ||
      !appPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Gmail email and App Password are required."
      });
    }

    const cleanEmail =
      String(email)
        .trim()
        .toLowerCase();

    if (
      !isValidEmail(cleanEmail)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Gmail address."
      });
    }

    try {
      const transporter =
        getTransporter(
          cleanEmail,
          appPassword
        );

      await transporter.verify();

      return res.json({
        success: true,
        message:
          "Gmail SMTP verified successfully."
      });
    } catch (error) {
      console.error(
        "SMTP verification error:",
        error.message
      );

      return res.status(401).json({
        success: false,
        message:
          "Gmail authentication failed. Check your Gmail address and App Password."
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| SEND EMAIL STREAM
|--------------------------------------------------------------------------
*/

app.post(
  "/api/send-stream",
  async (req, res) => {

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-transform"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.setHeader(
      "X-Accel-Buffering",
      "no"
    );

    const {
      email,
      appPassword,
      senderName,
      subject,
      messageBody,
      recipients
    } = req.body || {};


    /*
    |--------------------------------------------------------------------------
    | BASIC VALIDATION
    |--------------------------------------------------------------------------
    */

    if (
      !email ||
      !appPassword
    ) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "Gmail email and App Password are required."
        })}\n\n`
      );

      return res.end();
    }


    const senderEmail =
      String(email)
        .trim()
        .toLowerCase();


    if (
      !isValidEmail(senderEmail)
    ) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "Invalid sender email."
        })}\n\n`
      );

      return res.end();
    }


    if (
      !subject ||
      !String(subject).trim()
    ) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "Subject is required."
        })}\n\n`
      );

      return res.end();
    }


    if (
      !messageBody ||
      !String(messageBody).trim()
    ) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "Message body is required."
        })}\n\n`
      );

      return res.end();
    }


    if (
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "At least one recipient is required."
        })}\n\n`
      );

      return res.end();
    }


    /*
    |--------------------------------------------------------------------------
    | SENDER NAME
    |--------------------------------------------------------------------------
    */

    const cleanSenderName =
      String(senderName || "")
        .replace(/["<>]/g, "")
        .trim();


    /*
    |--------------------------------------------------------------------------
    | CREATE GMAIL TRANSPORTER
    |--------------------------------------------------------------------------
    */

    let transporter;

    try {
      transporter =
        getTransporter(
          senderEmail,
          appPassword
        );

      await transporter.verify();

    } catch (error) {

      console.error(
        "SMTP verification failed:",
        error.message
      );

      res.write(
        `data: ${JSON.stringify({
          success: false,
          error:
            "Gmail SMTP authentication failed."
        })}\n\n`
      );

      return res.end();
    }


    /*
    |--------------------------------------------------------------------------
    | RESET STOP STATE
    |--------------------------------------------------------------------------
    */

    activeSessions.global_stop =
      false;


    /*
    |--------------------------------------------------------------------------
    | SEND RECIPIENTS
    |--------------------------------------------------------------------------
    */

    for (
      let index = 0;
      index < recipients.length;
      index++
    ) {

      /*
      |--------------------------------------------------------------------------
      | STOP CHECK
      |--------------------------------------------------------------------------
      */

      if (
        activeSessions.global_stop
      ) {

        res.write(
          `data: ${JSON.stringify({
            success: false,
            stopped: true,
            error:
              "Sending stopped by user."
          })}\n\n`
        );

        break;
      }


      /*
      |--------------------------------------------------------------------------
      | CLEAN RECIPIENT
      |--------------------------------------------------------------------------
      */

      const recipient =
        String(
          recipients[index] || ""
        )
          .trim()
          .toLowerCase();


      if (!recipient) {
        continue;
      }


      /*
      |--------------------------------------------------------------------------
      | RECIPIENT VALIDATION
      |--------------------------------------------------------------------------
      */

      if (
        !isValidEmail(recipient)
      ) {

        res.write(
          `data: ${JSON.stringify({
            success: false,
            recipient,
            error:
              "Invalid recipient email."
          })}\n\n`
        );

        continue;
      }


      /*
      |--------------------------------------------------------------------------
      | KEEP CONNECTION ALIVE
      |--------------------------------------------------------------------------
      */

      res.write(
        ": keep-alive\n\n"
      );


      try {

        /*
        |--------------------------------------------------------------------------
        | PARSE MESSAGE
        |--------------------------------------------------------------------------
        */

        const spunSubject =
          parseSpintax(subject);

        const spunBody =
          parseSpintax(messageBody);


        /*
        |--------------------------------------------------------------------------
        | DETECT HTML
        |--------------------------------------------------------------------------
        */

        const isHtml =
          /<\/?[a-z][\s\S]*>/i.test(
            spunBody
          );


        /*
        |--------------------------------------------------------------------------
        | HTML / TEXT BODY
        |--------------------------------------------------------------------------
        */

        const htmlBody = isHtml
          ? spunBody
          : escapeHtml(
              spunBody
            ).replace(
              /\r?\n/g,
              "<br>"
            );


        const plainText = isHtml
          ? convertHtmlToText(
              spunBody
            )
          : spunBody;


        /*
        |--------------------------------------------------------------------------
        | MAIL OPTIONS
        |--------------------------------------------------------------------------
        */

        const mailOptions = {

          from:
            cleanSenderName
              ? `"${cleanSenderName}" <${senderEmail}>`
              : senderEmail,

          to: recipient,

          subject: spunSubject,

          text: plainText,

          html: htmlBody
        };


        /*
        |--------------------------------------------------------------------------
        | SEND
        |--------------------------------------------------------------------------
        */

        const info =
          await transporter.sendMail(
            mailOptions
          );


        console.log(
          `Email accepted by Gmail SMTP: ${recipient}`
        );


        /*
        |--------------------------------------------------------------------------
        | SUCCESS EVENT
        |--------------------------------------------------------------------------
        */

        res.write(
          `data: ${JSON.stringify({
            success: true,
            recipient,
            messageId:
              info.messageId
          })}\n\n`
        );

      } catch (error) {

        console.error(
          `Error sending to ${recipient}:`,
          error.message
        );


        /*
        |--------------------------------------------------------------------------
        | FAILURE EVENT
        |--------------------------------------------------------------------------
        */

        res.write(
          `data: ${JSON.stringify({
            success: false,
            recipient,
            error:
              error.message
          })}\n\n`
        );
      }


      /*
      |--------------------------------------------------------------------------
      | SMALL DELAY
      |--------------------------------------------------------------------------
      */

      if (
        index <
        recipients.length - 1
      ) {

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              1000
            )
        );
      }
    }


    /*
    |--------------------------------------------------------------------------
    | COMPLETE
    |--------------------------------------------------------------------------
    */

    res.write(
      `data: ${JSON.stringify({
        done: true
      })}\n\n`
    );

    res.write(
      "data: [DONE]\n\n"
    );

    res.end();
  }
);


/*
|--------------------------------------------------------------------------
| STOP SENDING
|--------------------------------------------------------------------------
*/

app.post(
  "/api/stop",
  (req, res) => {

    activeSessions.global_stop =
      true;

    return res.json({
      success: true,
      message:
        "Stop request registered."
    });
  }
);


/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      success: true,
      message:
        "Email server is running."
    });
  }
);


/*
|--------------------------------------------------------------------------
| HOME PAGE
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/*
|--------------------------------------------------------------------------
| LOCAL SERVER
|--------------------------------------------------------------------------
| Vercel par app ko export kiya jayega.
| Local computer par "npm start" karne par server chalega.
|--------------------------------------------------------------------------
*/

if (!process.env.VERCEL) {

  app.listen(
    PORT,
    () => {
      console.log(
        `Server running on port ${PORT}`
      );
    }
  );

}


/*
|--------------------------------------------------------------------------
| VERCEL EXPORT
|--------------------------------------------------------------------------
*/

export default app;

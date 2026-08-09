import smtplib
import ssl
import time
import random
import secrets
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import make_msgid, formatdate

# ==========================================
# 1. CONFIGURATION (Apni details yahan dalein)
# ==========================================
SENDER_EMAIL = "your-gmail@gmail.com"
APP_PASSWORD = "your-16-digit-app-password"
SENDER_NAME = "Official Notifications"

# Recipients ki list
RECIPIENTS = [
    "client1@example.com",
    "client2@example.com",
    "client3@example.com"
]

# Spintax Enabled Subject & Body
SUBJECT_TEMPLATE = "{Important|Notice|Update}: Account Verification Process"
BODY_TEMPLATE = """
<p>{Hi|Hello|Dear Client},</p>
<p>We are reaching out regarding your account settings. Please confirm your details when possible.</p>
<p>Best regards,<br/>Support Team</p>
"""

# ==========================================
# 2. HELPER FUNCTIONS
# ==========================================
def parse_spintax(text):
    """Spintax resolver {A|B|C}"""
    pattern = r'\{([^{}]+)\}'
    while re.search(pattern, text):
        text = re.sub(pattern, lambda m: random.choice(m.group(1).split('|')), text)
    return text

def build_ref_code():
    """Generates #REF-XXXX-XXXX"""
    hex_part = secrets.token_hex(2).upper()
    num_part = random.randint(1000, 9999)
    return f"REF-{hex_part}-{num_part}"

# ==========================================
# 3. MAIL DISPATCH ENGINE
# ==========================================
def run_mail_engine():
    context = ssl.create_default_context()
    
    print("\n[+] Connecting to Gmail Secure Server...")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(SENDER_EMAIL, APP_PASSWORD)
            print("[+] Login Successful! Starting sending process...\n")

            for index, recipient in enumerate(RECIPIENTS, start=1):
                ref_code = build_ref_code()
                spun_subject = parse_spintax(SUBJECT_TEMPLATE)
                spun_body = parse_spintax(BODY_TEMPLATE)

                # Clean Dynamic Footer at the Bottom
                footer_html = f"""
                <br/><br/>
                <hr style="border:none; border-top:1px dashed #cccccc; margin-top:20px;"/>
                <div style="font-family: Arial, sans-serif; font-size:11px; color:#777777;">
                    Security Reference Code: <strong>#{ref_code}</strong>
                </div>
                """

                footer_text = f"\n\n----------------------------------------\nSecurity Reference Code: #{ref_code}"

                # Construct MIME Email
                msg = MIMEMultipart("alternative")
                msg["From"] = f'"{SENDER_NAME}" <{SENDER_EMAIL}>'
                msg["To"] = recipient
                msg["Subject"] = spun_subject
                msg["Date"] = formatdate(localtime=True)
                
                # Message-ID for Inbox Authority
                domain = SENDER_EMAIL.split("@")[-1] if "@" in SENDER_EMAIL else "gmail.com"
                msg["Message-ID"] = make_msgid(domain=domain)
                msg["X-Delivery-Ref"] = ref_code

                # Convert HTML to Plaintext Fallback
                plain_text_body = re.sub('<[^<]+?>', '', spun_body) + footer_text
                full_html_body = spun_body + footer_html

                msg.attach(MIMEText(plain_text_body, "plain"))
                msg.attach(MIMEText(full_html_body, "html"))

                # Send Mail
                try:
                    server.sendmail(SENDER_EMAIL, recipient, msg.as_string())
                    print(f"[{index}/{len(RECIPIENTS)}] Delivered -> {recipient} | #{ref_code}")
                except Exception as e:
                    print(f"[{index}/{len(RECIPIENTS)}] Failed -> {recipient} | Error: {e}")

                # STRICT SPEED: 1.0s to 1.1s Delay
                if index < len(RECIPIENTS):
                    delay = 1.0 + random.uniform(0.0, 0.1)
                    time.sleep(delay)

            print("\n[+] All mails processed successfully!")

    except Exception as e:
        print(f"\n[-] Authentication or Network Error: {e}")

if __name__ == "__main__":
    run_mail_engine()

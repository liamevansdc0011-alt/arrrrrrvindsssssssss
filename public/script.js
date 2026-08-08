const response = await fetch('/api/send-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        email: emailVal,
        appPassword: appPasswordVal,
        senderName: senderNameVal,
        subject: subjectVal,
        messageBody: messageBodyVal,
        recipients: recipientsToSend
    })
});

const result = await response.json();
if (result.success) {
    alert(`Completed! Sent: ${result.sentCount}, Failed: ${result.failedCount}`);
} else {
    alert('Failed to send emails.');
}

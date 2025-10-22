# Notification System Documentation

## Overview

The notification system provides email and Telegram notifications for admin panel events. It's designed to be configurable, secure, and non-blocking.

## Features

- **Email Notifications** via SMTP (nodemailer)
- **Telegram Notifications** via Bot API
- **Configurable Triggers** (6 event types)
- **Rate Limiting** (1 test per minute)
- **Async Sending** (non-blocking API responses)
- **Encrypted Storage** (AES-256-CBC encryption for passwords/tokens)
- **Graceful Degradation** (notifications never block operations)

## Architecture

### Components

1. **Notification Service** (`web/lib/services/notification-service.ts`)
   - Core notification logic
   - Email and Telegram sending
   - Configuration management
   - Encryption/decryption

2. **API Endpoints**
   - `GET /api/admin/settings/notifications` - Get configuration (masked)
   - `POST /api/admin/settings/notifications` - Save configuration
   - `POST /api/admin/notifications/test` - Test notifications

3. **UI Component** (`web/app/admin/settings/page.tsx`)
   - Email/Telegram configuration forms
   - Toggle switches for notification types
   - Test buttons

4. **Database Schema** (`admin_settings` table)
   - Stores notification configuration as JSON
   - Created by migration `0019_add_admin_settings.sql`

### Notification Events

| Event | Trigger | Context Data |
|-------|---------|--------------|
| `ipo_locked` | IPO lock enabled | companyName, ipoId, adminName, note |
| `ipo_unlocked` | IPO lock disabled | companyName, ipoId, adminName |
| `field_protection_enabled` | Field protection enabled | companyName, tableName, fieldName, adminName, note |
| `field_protection_disabled` | Field protection disabled | companyName, tableName, fieldName, adminName |
| `scraper_update_blocked` | Scraper blocked from updating | companyName, scraperName, tableName, fieldName, details |
| `bulk_operation_completed` | Bulk field operation finished | companyName, count, details, adminName |

## Configuration

### Email (SMTP)

Required settings:
- **SMTP Host**: Mail server hostname (e.g., `smtp.gmail.com`)
- **SMTP Port**: Port number (e.g., `587` for TLS, `465` for SSL)
- **SMTP Username**: Email account username
- **SMTP Password**: Email account password (encrypted in database)
- **From Email**: Sender email address

### Telegram

Required settings:
- **Bot Token**: Telegram bot token (format: `123456:ABC-DEF1234...`)
- **Chat ID**: Telegram chat/group ID (format: `-1001234567890`)

#### Setting up Telegram Bot

1. **Create Bot**:
   ```
   1. Open Telegram and search for @BotFather
   2. Send /newbot command
   3. Follow prompts to name your bot
   4. Copy the bot token (123456:ABC-DEF...)
   ```

2. **Get Chat ID**:
   ```
   Option A (Personal chat):
   1. Start chat with your bot
   2. Send any message
   3. Visit: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   4. Find "chat":{"id":12345678} in response

   Option B (Group/Channel):
   1. Add bot to group/channel
   2. Send any message
   3. Visit: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   4. Find "chat":{"id":-1001234567890} in response
   ```

### Environment Variables (Optional)

Default values can be set via environment variables:

```bash
# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.email@gmail.com
SMTP_PASSWORD=your_password
SMTP_FROM_EMAIL=noreply@ipodhan.com

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=-1001234567890

# Encryption key (32 bytes)
NOTIFICATION_ENCRYPTION_KEY=your-32-byte-encryption-key-here
```

## Usage

### API Usage

#### Get Configuration

```typescript
const response = await fetch('/api/admin/settings/notifications');
const { data } = await response.json();

// Sensitive data is masked:
// data.email.smtpPassword = "pa*******rd"
// data.telegram.botToken = "12*******11"
```

#### Save Configuration

```typescript
const config = {
  email: {
    enabled: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpUser: "admin@ipodhan.com",
    smtpPassword: "your_password", // Will be encrypted
    fromEmail: "noreply@ipodhan.com"
  },
  telegram: {
    enabled: true,
    botToken: "123456:ABC-DEF...", // Will be encrypted
    chatId: "-1001234567890"
  },
  triggers: {
    ipoLocked: true,
    ipoUnlocked: true,
    fieldProtectionEnabled: true,
    fieldProtectionDisabled: true,
    scraperUpdateBlocked: true,
    bulkOperationCompleted: true
  }
};

const response = await fetch('/api/admin/settings/notifications', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(config)
});
```

#### Test Notifications

```typescript
// Test email
const response = await fetch('/api/admin/notifications/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'email',
    email: 'test@example.com'
  })
});

// Test Telegram
const response = await fetch('/api/admin/notifications/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'telegram' })
});

// Test both
const response = await fetch('/api/admin/notifications/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'both',
    email: 'test@example.com'
  })
});
```

### Programmatic Usage

```typescript
import { sendNotification } from '@/lib/services/notification-service';

// Send notification
await sendNotification('ipo_locked', {
  ipoId: 'uuid-123',
  companyName: 'XYZ Corporation',
  adminName: 'admin@ipodhan.com',
  note: 'Manual data correction in progress'
});
```

## Security

### Encryption

Sensitive data (passwords, tokens) is encrypted using AES-256-CBC:

```typescript
// Automatic encryption on save
await saveNotificationConfig(config);
// config.email.smtpPassword is encrypted before storage

// Automatic decryption on retrieval
const config = await getNotificationConfig();
// config.email.smtpPassword is decrypted from storage
```

### Data Masking

API responses mask sensitive data:

```typescript
// Response from GET /api/admin/settings/notifications
{
  email: {
    smtpPassword: "pa*******rd" // Masked
  },
  telegram: {
    botToken: "12*******11" // Masked
  }
}
```

### Rate Limiting

Test notifications are rate-limited to prevent abuse:
- **Limit**: 1 test per minute per type (email/telegram)
- **Error**: Returns 400 with message "Rate limit exceeded. Please wait 1 minute"

## Integration Points

Notifications are automatically sent from these routes:

1. **IPO Lock/Unlock**
   - File: `web/app/api/admin/protection/ipo/[ipoId]/route.ts`
   - Events: `ipo_locked`, `ipo_unlocked`

2. **Field Protection**
   - File: `web/app/api/admin/protection/fields/[ipoId]/route.ts`
   - Events: `field_protection_enabled`, `field_protection_disabled`

3. **Scraper Updates Blocked**
   - File: `web/lib/admin/field-protection-checker.ts`
   - Event: `scraper_update_blocked`

4. **Bulk Operations**
   - File: `web/app/api/admin/protection/fields/bulk/route.ts`
   - Event: `bulk_operation_completed`

## Troubleshooting

### Email Not Sending

1. **Check SMTP credentials**:
   - Verify host, port, username, password
   - Try logging into email account manually

2. **Gmail-specific issues**:
   - Enable "Less secure app access" OR
   - Use App Password (recommended)
   - 2FA must be enabled to use App Passwords

3. **Port issues**:
   - Port 587: TLS (STARTTLS)
   - Port 465: SSL (deprecated but often works)
   - Port 25: Usually blocked by ISPs

4. **Firewall/Network**:
   - Check if SMTP ports are blocked
   - Test connection: `telnet smtp.gmail.com 587`

### Telegram Not Sending

1. **Invalid Bot Token**:
   - Format must be: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
   - Get new token from @BotFather if lost

2. **Invalid Chat ID**:
   - Must be numeric (personal) or negative (group)
   - Use `/getUpdates` API to verify

3. **Bot Not Added to Group**:
   - Bot must be added to group/channel
   - Bot needs permission to send messages

4. **Test API Directly**:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
     -H "Content-Type: application/json" \
     -d '{"chat_id":"<CHAT_ID>","text":"Test"}'
   ```

### Rate Limit Errors

- Wait 1 minute between test notifications
- Rate limiter is in-memory (resets on server restart)

### Encryption Errors

If you see decryption errors:
1. Encryption key changed in environment
2. Database was manually edited
3. **Fix**: Re-save notification settings from UI

## Best Practices

1. **Use App Passwords** for Gmail (not account password)
2. **Test notifications** after configuration changes
3. **Monitor logs** for notification failures
4. **Don't disable critical triggers** (ipo_locked, scraper_update_blocked)
5. **Keep Chat ID secret** (grants access to receive notifications)
6. **Rotate credentials** periodically
7. **Use dedicated bot** for each environment (dev/staging/prod)

## Message Format

### Email Format

- **Subject**: `<Event Type>: <Company Name>`
- **Body**: Plain text with key details
- **HTML**: Formatted version (same content)

Example:
```
Subject: IPO Locked: XYZ Corporation

IPO Locked

Company: XYZ Corporation
IPO ID: uuid-123
Locked by: admin@ipodhan.com
Reason: Manual data correction in progress
Time: 22-10-2025 14:30:00 IST

All scraper updates are now blocked for this IPO.
```

### Telegram Format

- **Format**: HTML (bold headers)
- **Message**: Same as email body with HTML formatting

Example:
```
<b>IPO Locked</b>

Company: XYZ Corporation
IPO ID: uuid-123
Locked by: admin@ipodhan.com
Reason: Manual data correction in progress
Time: 22-10-2025 14:30:00 IST

All scraper updates are now blocked for this IPO.
```

## Performance

- **Async Sending**: Notifications are sent asynchronously (non-blocking)
- **No Retries**: Failed notifications are logged but not retried (yet)
- **Cache Impact**: None (notifications don't use Redis)
- **API Response Time**: <50ms (notification happens in background)

## Future Enhancements

1. **Notification Queue** with retry logic
2. **Webhook Support** for custom integrations
3. **Slack Integration**
4. **SMS Notifications** via Twilio
5. **Notification History** dashboard
6. **Template Customization** for messages
7. **Per-Event Email Recipients**
8. **Daily Digest Mode** (batch notifications)
9. **Notification Preferences** per admin user
10. **Rich HTML Templates** for emails

## Migration

To apply the database schema:

```bash
cd web
npm run db:migrate
```

This will create the `admin_settings` table with default notification configuration.

## Testing

Run integration tests:

```bash
cd web
npm run test:integration
```

Manual testing checklist:
- [ ] Save email configuration
- [ ] Test email notification
- [ ] Save Telegram configuration
- [ ] Test Telegram notification
- [ ] Lock IPO (verify notification sent)
- [ ] Enable field protection (verify notification sent)
- [ ] Trigger scraper block (verify notification sent)
- [ ] Bulk protect fields (verify notification sent)
- [ ] Check masked passwords in API response
- [ ] Verify rate limiting (test twice within 1 minute)

## Support

For issues or questions:
1. Check logs: `console.log('[NotificationService] ...')`
2. Verify configuration in admin settings
3. Test notifications manually via API
4. Review error messages in API responses

# Standard Operating Procedure

## Starting the Bridge

1. Ensure Codex CLI is installed and accessible
2. Configure `.env` file with required settings
3. Run `npm start` or `node apps/bridge/dist/main.js`
4. Verify "Connected to Codex app-server" in logs
5. If Telegram enabled, verify "Telegram bot started"
6. If Web enabled, verify "WebSocket server listening on port 8765"

## Connecting via Telegram

1. Start a chat with your bot on Telegram
2. Send `/start` to see available commands
3. Use `/list` to see existing threads
4. Use `/open <id>` to open a thread
5. Use `/new` to create a new thread
6. Use `/send <text>` to send a message
7. Approve/reject requests via inline buttons when prompted

## Connecting via Web

1. In Telegram, run `/pair` to get a 6-digit pairing code
2. Open the bridge URL in a mobile browser
3. Enter the pairing code
4. You should see your thread list
5. Tap a thread to view details and send messages

## Handling Approvals

When Codex needs approval (command execution, file change, etc.):

1. Telegram: Inline keyboard appears with Approve/Reject buttons
2. Web: Approval card appears at the top of the thread view
3. For dangerous commands: A second confirmation is required
4. If no response within 5 minutes: Auto-rejected

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to Codex" | Check `CODEX_BINARY` path and ensure Codex is installed |
| Telegram bot not responding | Verify `TELEGRAM_BOT_TOKEN` and check bot is started |
| Web can't connect | Check `WEB_ENABLED=true` and correct port |
| Approvals timing out | Increase `APPROVAL_TIMEOUT_SECONDS` |
| Secrets appearing in output | Ensure `REDACT_SECRETS=true` |

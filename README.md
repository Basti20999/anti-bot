# Anti Bot

A Discord moderation bot that catches spam accounts with a trap channel, scam keyword detection, cross-post detection, Discord AutoMod rules, and OCR scanning for scam text hidden in images.

## Features

- Posts and maintains a clear warning message in a configured trap channel.
- Automatically timeouts users who post in the trap channel.
- Detects common fake giveaway, crypto casino, reward, and bonus scam patterns.
- Flags new accounts that post links.
- Detects repeated cross-posted messages across multiple channels.
- Uses OCR to scan suspicious image attachments and embeds.
- Creates a native Discord AutoMod rule for server-side blocking and timeouts.
- Cleans up the timed-out user's recent messages across text channels.

## Requirements

- Node.js 18 or newer
- A Discord bot token
- A Discord server where the bot has the required permissions

## Discord Permissions

The bot needs these permissions in your server:

- View Channels
- Send Messages
- Manage Messages
- Moderate Members
- Manage Server
- Read Message History

The bot also needs the `Message Content Intent` enabled in the Discord Developer Portal.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment example:

   ```bash
   cp .env.example .env
   ```

3. Fill in `.env`:

   ```env
   TOKEN=your-discord-bot-token
   TRAP_CHANNEL_ID=your-trap-channel-id
   ```

4. Start the bot:

   ```bash
   npm start
   ```

## Runtime State

The bot writes `state.json` at runtime to remember the trap warning message and timeout counter. This file is intentionally ignored by Git.

## Safety Notes

This bot applies automatic timeouts. Test it in a private server or staging channel before using it on a public community server. Make sure the trap channel warning is visible and unambiguous.

## License

MIT

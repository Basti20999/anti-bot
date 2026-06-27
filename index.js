require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const { TOKEN, TRAP_CHANNEL_ID } = process.env;

if (!TOKEN || !TRAP_CHANNEL_ID) {
  console.error("Fehlende Umgebungsvariablen: TOKEN und TRAP_CHANNEL_ID müssen in .env gesetzt sein.");
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, "state.json");

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { messageId: parsed.messageId ?? null, count: parsed.count ?? 0 };
  } catch {
    return { messageId: null, count: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[STATE] Konnte Zustand nicht speichern:", err.message);
  }
}

const state = loadState();

function formatDate(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
}

function buildTrapMessage(count, date = new Date()) {
  return [
    "# **DO NOT SEND A MESSAGE IN THIS CHANNEL OR YOU WILL BE TIMEOUTED AUTOMATICALLY**",
    "## There is no manual review. No appeals. **SEND MESSAGE = INSTANT TIMEOUT**",
    "",
    "The point is to catch bots that send spam messages in every channel. If you are not a bot, you should read this message, and not send a message here.",
    "",
    "Again, **send message = instant timeout**, do not send a message here. I hope that is crystal clear.",
    "",
    "A bot **automatically timeouts you** if you send a message in this channel. Nobody reads the text of your message. You are **instantly timeouted**. If you are a human, please do not send a message here.",
    "",
    "# SEND MESSAGE = INSTANT TIMEOUT",
    "",
    `# MORE THAN ${count} ACCOUNTS HAVE BEEN TIMEOUTED AS OF ${formatDate(date)}`
  ].join("\n");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

let trapChannel = null;
let trapMessage = null;

// Stellt sicher, dass die Warnnachricht im Trap-Kanal existiert.
// Aktualisiert eine vorhandene Nachricht oder erstellt sie neu.
async function ensureTrapMessage() {
  trapChannel = await client.channels.fetch(TRAP_CHANNEL_ID);
  if (!trapChannel || !trapChannel.isTextBased()) {
    throw new Error("TRAP_CHANNEL_ID verweist nicht auf einen Textkanal.");
  }

  const content = buildTrapMessage(state.count);

  if (state.messageId) {
    try {
      trapMessage = await trapChannel.messages.fetch(state.messageId);
      await trapMessage.edit(content);
      console.log("[TRAP] Bestehende Warnnachricht aktualisiert.");
      return;
    } catch {
      console.warn("[TRAP] Gespeicherte Nachricht nicht gefunden, erstelle eine neue.");
    }
  }

  trapMessage = await trapChannel.send(content);
  state.messageId = trapMessage.id;
  saveState(state);
  console.log("[TRAP] Warnnachricht im Kanal gepostet.");
}

// Bearbeitet die bestehende Warnnachricht mit dem aktuellen Zählerstand.
async function updateTrapMessage() {
  try {
    if (!trapMessage) {
      await ensureTrapMessage();
      return;
    }
    await trapMessage.edit(buildTrapMessage(state.count));
    console.log(`[TRAP] Warnnachricht aktualisiert (${state.count} Timeouts).`);
  } catch (err) {
    console.error("[TRAP] Aktualisierung fehlgeschlagen, erstelle neu:", err.message);
    state.messageId = null;
    await ensureTrapMessage();
  }
}

client.on("ready", async () => {
  console.log(`Bot online: ${client.user.tag}`);
  try {
    await ensureTrapMessage();
  } catch (err) {
    console.error("[TRAP] Konnte Warnnachricht nicht einrichten:", err.message);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== TRAP_CHANNEL_ID) return;
  if (!message.member) return;

  try {
    await message.delete();

    await message.member.timeout(7 * 24 * 60 * 60 * 1000, "Security Trap Channel");

    console.log(`[TRAP] ${message.author.tag} (${message.author.id}) wurde getimeoutet.`);

    state.count += 1;
    saveState(state);
    await updateTrapMessage();

    const limit = Date.now() - 24 * 60 * 60 * 1000;
    const textChannels = message.guild.channels.cache.filter(c => c.isTextBased());

    await Promise.all(
      textChannels.map(async (channel) => {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          const toDelete = messages.filter(
            m => m.author.id === message.author.id && m.createdTimestamp > limit
          );
          if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
            console.log(`[CLEANUP] ${toDelete.size} Nachricht(en) in #${channel.name} gelöscht.`);
          }
        } catch (err) {
          console.error(`[CLEANUP] Fehler in #${channel.name}:`, err.message);
        }
      })
    );
  } catch (err) {
    console.error("[ERROR]", err);
  }
});

client.login(TOKEN);

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  AutoModerationRuleTriggerType,
  AutoModerationRuleEventType,
  AutoModerationActionType
} = require("discord.js");
const { createWorker } = require("tesseract.js");

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

// --- Scam-Filter: läuft in JEDEM Channel, nicht nur im Trap-Channel ---
// Deckt genau das Muster aus dem Screenshot ab (Fake-Giveaway/Crypto-Casino).

const SCAM_PATTERNS = [
  /claim\s+(your\s+)?(reward|bonus|prize)/i,
  /(activate|redeem)\s+(the\s+|your\s+)?code/i,
  /rakeback/i,
  /(crypto|betting|bet)\s*casino/i,
  /withdrawal\s+(was\s+)?success/i,
  /giving\s+away/i,
  /free\s+(nitro|crypto|btc|eth|usdt)/i,
  /\$\d{2,}\s*(giveaway|bonus|reward)/i,
  /invite.{0,10}friends.{0,20}(bonus|reward|crypto)/i
];

const NEW_ACCOUNT_MS = 3 * 24 * 60 * 60 * 1000; // Account < 3 Tage alt + Link = verdächtig
const CROSS_POST_WINDOW_MS = 20 * 1000;
const CROSS_POST_MIN_CHANNELS = 3; // gleiche Nachricht in 3+ Channels = Spam-Blast
const CROSS_POST_MIN_LENGTH = 20; // kurze Nachrichten ("lol" etc.) ignorieren

function looksLikeScam(message) {
  const content = message.content;
  if (SCAM_PATTERNS.some((re) => re.test(content))) return true;

  const hasLink = /https?:\/\//i.test(content);
  const accountAge = Date.now() - message.author.createdTimestamp;
  return hasLink && accountAge < NEW_ACCOUNT_MS;
}

// authorId -> { hash, channels: Set<channelId>, timestamp }
const recentPosts = new Map();

function isCrossPosting(message) {
  const content = message.content.trim();
  if (content.length < CROSS_POST_MIN_LENGTH) return false;

  const authorId = message.author.id;
  const hash = content.toLowerCase();
  const now = Date.now();
  const entry = recentPosts.get(authorId);

  if (!entry || entry.hash !== hash || now - entry.timestamp > CROSS_POST_WINDOW_MS) {
    recentPosts.set(authorId, { hash, channels: new Set([message.channel.id]), timestamp: now });
    return false;
  }

  entry.channels.add(message.channel.id);
  entry.timestamp = now;
  return entry.channels.size >= CROSS_POST_MIN_CHANNELS;
}

setInterval(() => {
  const cutoff = Date.now() - CROSS_POST_WINDOW_MS;
  for (const [id, entry] of recentPosts) {
    if (entry.timestamp < cutoff) recentPosts.delete(id);
  }
}, 30 * 1000);

// --- Bild-OCR: AutoMod und der Text-Filter oben sehen NUR message.content, keine Bilder. ---
// Scam-Text, der nur im Screenshot steckt (kein Fließtext in der Nachricht), rutscht sonst durch.
// Worker wird einmal beim Start erzeugt (initOcrWorker) und wiederverwendet - pro Bild neu zu
// initialisieren wäre spürbar langsamer.

let ocrWorker = null;

async function initOcrWorker() {
  try {
    ocrWorker = await createWorker("eng");
    console.log("[OCR] Worker bereit.");
  } catch (err) {
    console.error("[OCR] Konnte Worker nicht starten, Bild-Scan deaktiviert:", err.message);
  }
}

function getImageUrls(message) {
  const attachmentUrls = [...message.attachments.values()]
    .filter((a) => a.contentType?.startsWith("image/"))
    .map((a) => a.url);
  const embedUrls = message.embeds
    .map((e) => e.image?.url ?? e.thumbnail?.url)
    .filter(Boolean);
  return [...new Set([...attachmentUrls, ...embedUrls])];
}

async function imageContainsScamText(urls) {
  for (const url of urls) {
    try {
      const { data } = await ocrWorker.recognize(url);
      if (SCAM_PATTERNS.some((re) => re.test(data.text))) return true;
    } catch (err) {
      console.error("[OCR] Fehler bei", url, ":", err.message);
    }
  }
  return false;
}

// --- Native Discord-AutoMod-Regel ---
// Blockt + timeoutet serverseitig, BEVOR die Nachricht überhaupt in einem Channel
// landet. Kann von Spam-Scripts nicht durch Channel-Erkennung umgangen werden.

async function ensureAutoMod(guild) {
  try {
    const rules = await guild.autoModerationRules.fetch();
    if ([...rules.values()].some((r) => r.name === "Anti-Scam")) return;

    await guild.autoModerationRules.create({
      name: "Anti-Scam",
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        regexPatterns: [
          "claim (your )?(reward|bonus|prize)",
          "(activate|redeem) (the |your )?code",
          "rakeback",
          "(crypto|betting|bet) ?casino",
          "withdrawal (was )?success"
        ]
      },
      actions: [
        { type: AutoModerationActionType.BlockMessage },
        { type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 7 * 24 * 60 * 60 } }
      ],
      enabled: true
    });
    console.log("[AUTOMOD] Anti-Scam-Regel erstellt.");
  } catch (err) {
    console.error("[AUTOMOD] Konnte Regel nicht erstellen (Bot braucht 'Manage Server'):", err.message);
  }
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
    await ensureAutoMod(trapChannel.guild);
  } catch (err) {
    console.error("[TRAP] Konnte Warnnachricht nicht einrichten:", err.message);
  }
  await initOcrWorker();
});

// Löscht die Nachricht, timeoutet den Autor und räumt dessen Nachrichten
// der letzten 24h serverweit auf. Wird von Trap-Channel UND Scam-Filter genutzt.
async function punishAndCleanup(message, reason) {
  try {
    await message.delete().catch(() => {});
    await message.member.timeout(7 * 24 * 60 * 60 * 1000, reason);
    console.log(`[PUNISH] ${message.author.tag} (${message.author.id}) getimeoutet: ${reason}`);

    state.count += 1;
    saveState(state);
    await updateTrapMessage();

    const limit = Date.now() - 24 * 60 * 60 * 1000;
    const textChannels = message.guild.channels.cache.filter((c) => c.isTextBased());

    await Promise.all(
      textChannels.map(async (channel) => {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          const toDelete = messages.filter(
            (m) => m.author.id === message.author.id && m.createdTimestamp > limit
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
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.member) return;

  if (message.channel.id === TRAP_CHANNEL_ID) {
    return punishAndCleanup(message, "Security Trap Channel");
  }

  if (looksLikeScam(message)) {
    return punishAndCleanup(message, "Auto-Scam-Filter (Keyword)");
  }

  if (isCrossPosting(message)) {
    return punishAndCleanup(message, "Auto-Scam-Filter (Cross-Post)");
  }

  if (ocrWorker) {
    const imageUrls = getImageUrls(message);
    if (imageUrls.length > 0) {
      const hasLink = /https?:\/\//i.test(message.content);
      const isNewAccount = Date.now() - message.author.createdTimestamp < NEW_ACCOUNT_MS;
      // OCR nur bei Link ODER neuem Account auslösen - spart CPU und vermeidet False
      // Positives bei normalen Screenshots (z.B. Trading-Charts) von etablierten Membern.
      if ((hasLink || isNewAccount) && (await imageContainsScamText(imageUrls))) {
        return punishAndCleanup(message, "Auto-Scam-Filter (Bild-OCR)");
      }
    }
  }
});

client.login(TOKEN);

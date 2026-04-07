require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const { TOKEN, TRAP_CHANNEL_ID } = process.env;

if (!TOKEN || !TRAP_CHANNEL_ID) {
  console.error("Fehlende Umgebungsvariablen: TOKEN und TRAP_CHANNEL_ID müssen in .env gesetzt sein.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.on("ready", () => {
  console.log(`Bot online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== TRAP_CHANNEL_ID) return;
  if (!message.member) return;

  try {
    await message.delete();

    await message.member.timeout(7 * 24 * 60 * 60 * 1000, "Security Trap Channel");

    console.log(`[TRAP] ${message.author.tag} (${message.author.id}) wurde getimeoutet.`);

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

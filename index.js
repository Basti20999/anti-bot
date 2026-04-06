const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const TOKEN = "MTQ4MTA0NzE1Njk0NDI3MzU3MA.GUcGLK.lwuNvwGPkV9rqVzjIiuYq0NiosdRL3qSe7FEqk";
const TRAP_CHANNEL_ID = "1484251123270422628";

client.on("ready", () => {
  console.log(`Bot online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;
  if (message.channel.id !== TRAP_CHANNEL_ID) return;

  try {

    // Nachricht löschen
    await message.delete();

    // 7 Tage Timeout
    await message.member.timeout(
      7 * 24 * 60 * 60 * 1000,
      "Security Trap Channel"
    );

    console.log(`${message.author.tag} wurde getimeoutet`);

    const guild = message.guild;

    // Zeitlimit 24h
    const limit = Date.now() - 24 * 60 * 60 * 1000;

    guild.channels.cache.forEach(async (channel) => {

      if (!channel.isTextBased()) return;

      try {

        const messages = await channel.messages.fetch({ limit: 100 });

        const toDelete = messages.filter(
          m =>
            m.author.id === message.author.id &&
            m.createdTimestamp > limit
        );

        if (toDelete.size > 0) {
          await channel.bulkDelete(toDelete, true);
        }

      } catch {}

    });

  } catch (err) {
    console.error(err);
  }

});

client.login(TOKEN);
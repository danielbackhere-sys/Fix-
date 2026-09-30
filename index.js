const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Missing TOKEN environment variable.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  // !cleanup <text> : delete channels whose name contains <text>.
  // Requires the Manage Channels permission in this server.
  if (msg.content.toLowerCase().startsWith("!cleanup ")) {
    if (!msg.member?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return msg.reply("You need the Manage Channels permission for this.");
    }
    const term = msg.content.slice(9).trim().toLowerCase();
    const all = await msg.guild.channels.fetch();
    let matches;
    let label;

    if (term.startsWith("recent ")) {
      // !cleanup recent <hours> : channels created in the last N hours (for raids)
      const hours = parseFloat(term.split(/\s+/)[1]);
      if (!hours || hours <= 0) return msg.reply("Usage: `!cleanup recent 6` (hours)");
      const cutoff = Date.now() - hours * 3600 * 1000;
      matches = [...all.values()].filter(
        (c) => c && c.id !== msg.channel.id && c.createdTimestamp >= cutoff
      );
      label = `created in the last ${hours}h`;
    } else {
      if (term.length < 3) return msg.reply("Use a search term of at least 3 characters.");
      matches = [...all.values()].filter(
        (c) => c && c.id !== msg.channel.id && c.name.toLowerCase().includes(term)
      );
      label = `containing \`${term}\``;
    }

    // Delete categories last
    matches.sort(
      (a, b) =>
        (a.type === ChannelType.GuildCategory) - (b.type === ChannelType.GuildCategory)
    );
    if (!matches.length) return msg.reply("No channels match that.");

    await msg.reply(
      `Found ${matches.length} channels ${label}. Type \`confirm\` within 30s to delete them.`
    );
    try {
      const got = await msg.channel.awaitMessages({
        filter: (m) => m.author.id === msg.author.id && m.content.toLowerCase() === "confirm",
        max: 1,
        time: 30000,
        errors: ["time"],
      });
      if (!got.size) return;
    } catch {
      return msg.channel.send("Timed out. Nothing was deleted.");
    }

    let deleted = 0;
    for (const ch of matches) {
      try {
        await ch.delete("Raid cleanup");
        deleted++;
        await sleep(500);
      } catch (e) {
        console.log(`Couldn't delete ${ch.name}: ${e.message}`);
      }
    }
    return msg.channel.send(`Deleted ${deleted}/${matches.length} channels.`);
  }

  // !purge <number> : bulk delete recent messages in this channel (max 1000).
  // Requires Manage Messages. Discord only allows bulk delete for messages under 14 days old.
  if (msg.content.toLowerCase().startsWith("!purge")) {
    if (!msg.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return msg.reply("You need the Manage Messages permission for this.");
    }
    let remaining = Math.min(parseInt(msg.content.split(/\s+/)[1], 10) || 100, 1000);
    let total = 0;
    while (remaining > 0) {
      const batch = Math.min(remaining, 100);
      const deleted = await msg.channel.bulkDelete(batch, true).catch(() => null);
      if (!deleted || deleted.size === 0) break;
      total += deleted.size;
      remaining -= batch;
      await sleep(1000);
    }
    const note = await msg.channel.send(`Deleted ${total} messages.`);
    return setTimeout(() => note.delete().catch(() => {}), 5000);
  }

  if (msg.content.trim().toLowerCase() !== "!resetserver") return;

  const guild = msg.guild;

  const isOwner = msg.author.id === guild.ownerId;
  const isAdmin = msg.member?.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!isOwner && !isAdmin) {
    return msg.reply("Only the server owner or an administrator can run this.");
  }

  await msg.reply(
    `⚠️ This will delete ALL channels, categories, roles and emojis.\n` +
      `Type the server name exactly (\`${guild.name}\`) within 30s to confirm.`
  );

  let confirmation;
  try {
    const collected = await msg.channel.awaitMessages({
      filter: (m) => m.author.id === msg.author.id,
      max: 1,
      time: 30000,
      errors: ["time"],
    });
    confirmation = collected.first();
  } catch {
    return msg.channel.send("Timed out. Nothing was deleted.");
  }

  if (confirmation.content !== guild.name) {
    return msg.channel.send("Name didn't match. Cancelled.");
  }

  // Fresh channel first so the server isn't left empty
  const newChannel = await guild.channels.create({
    name: "general",
    type: ChannelType.GuildText,
  });

  const channels = await guild.channels.fetch();

  // Non-category channels first, then categories
  for (const [, ch] of channels) {
    if (!ch || ch.id === newChannel.id || ch.type === ChannelType.GuildCategory) continue;
    try {
      await ch.delete("Server reset");
      await sleep(500);
    } catch (e) {
      console.log(`Couldn't delete ${ch.name}: ${e.message}`);
    }
  }

  for (const [, ch] of channels) {
    if (!ch || ch.type !== ChannelType.GuildCategory) continue;
    try {
      await ch.delete("Server reset");
      await sleep(500);
    } catch (e) {
      console.log(`Couldn't delete category ${ch.name}: ${e.message}`);
    }
  }

  // Roles (skips @everyone, managed/bot roles, and roles above the bot)
  const roles = await guild.roles.fetch();
  for (const [, role] of roles) {
    if (role.id === guild.id || role.managed) continue;
    try {
      await role.delete("Server reset");
      await sleep(500);
    } catch {}
  }

  // Custom emojis
  const emojis = await guild.emojis.fetch();
  for (const [, emoji] of emojis) {
    try {
      await emoji.delete("Server reset");
      await sleep(500);
    } catch {}
  }

  await newChannel.send("✅ Server reset complete.");
});

client.login(TOKEN);

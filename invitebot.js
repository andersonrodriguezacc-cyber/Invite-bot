const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
});

// ============================================================
//  CONFIGURE THESE VALUES
// ============================================================
const BOT_TOKEN         = 'YOUR_BOT_TOKEN_HERE';
const CLIENT_ID         = '1513757486056865792';
const INVITE_CHANNEL_ID = '1513776126525181962';
const VIP_ROLE_ID       = '1484619172381200505';
const VIP_THRESHOLD     = 10;
// ============================================================

const inviteCache    = new Map();
const pendingInvites = new Map();
const inviteCounts   = new Map();

// Register slash command
const commands = [
  new SlashCommandBuilder()
    .setName('invitecount')
    .setDescription('Check how many people you have successfully invited!')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

client.once('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);

  // Register slash commands
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('Error registering slash commands:', err);
  }

  // Cache invites
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
  }
});

client.on('inviteCreate', (invite) => {
  const cache = inviteCache.get(invite.guild.id) || new Map();
  cache.set(invite.code, invite.uses);
  inviteCache.set(invite.guild.id, cache);
});

client.on('inviteDelete', (invite) => {
  const cache = inviteCache.get(invite.guild.id);
  if (cache) cache.delete(invite.code);
});

client.on('guildMemberAdd', async (member) => {
  try {
    const guild = member.guild;
    const cachedInvites = inviteCache.get(guild.id) || new Map();
    const newInvites = await guild.invites.fetch();

    const usedInvite = newInvites.find(
      i => (cachedInvites.get(i.code) || 0) < i.uses
    );

    inviteCache.set(guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

    const channel = guild.channels.cache.get(INVITE_CHANNEL_ID);
    if (!channel) return;

    if (usedInvite && usedInvite.inviter) {
      const inviter = usedInvite.inviter;
      const msg = await channel.send(
        `📨 <@${inviter.id}> has invited <@${member.id}> to the server! Waiting for them to accept...`
      );
      pendingInvites.set(member.id, {
        msgId: msg.id,
        inviterId: inviter.id,
        inviterTag: inviter.tag,
        channelId: INVITE_CHANNEL_ID,
        guildId: guild.id,
      });
    } else {
      await channel.send(`📨 <@${member.id}> joined the server but the inviter could not be determined.`);
    }
  } catch (error) {
    console.error('Error tracking invite:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const pending = pendingInvites.get(message.author.id);
  if (!pending) return;

  try {
    const guild = client.guilds.cache.get(pending.guildId);
    const channel = guild.channels.cache.get(pending.channelId);
    const msg = await channel.messages.fetch(pending.msgId);

    await msg.reply(
      `✅ <@${message.author.id}> has accepted <@${pending.inviterId}>'s invite and is now active in the server!`
    );

    pendingInvites.delete(message.author.id);

    const currentCount = (inviteCounts.get(pending.inviterId) || 0) + 1;
    inviteCounts.set(pending.inviterId, currentCount);

    if (currentCount >= VIP_THRESHOLD) {
      try {
        const inviterMember = await guild.members.fetch(pending.inviterId);
        if (!inviterMember.roles.cache.has(VIP_ROLE_ID)) {
          await inviterMember.roles.add(VIP_ROLE_ID);
          await channel.send(
            `🎉 Congratulations <@${pending.inviterId}>! You have successfully invited **${VIP_THRESHOLD} people** to the server and have been awarded **VIP**! 🏆`
          );
        }
      } catch (err) {
        console.error('Error giving VIP role:', err);
      }
    }
  } catch (err) {
    console.error('Error replying to invite message:', err);
  }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'invitecount') {
    const count = inviteCounts.get(interaction.user.id) || 0;
    const remaining = Math.max(0, VIP_THRESHOLD - count);
    await interaction.reply({
      content: `📊 <@${interaction.user.id}> you have invited **${count}** people to the server!\n${remaining > 0 ? `You need **${remaining}** more invites to get **VIP**! 🏆` : `You already have **VIP**! 🎉`}`,
      ephemeral: false,
    });
  }
});

client.login(BOT_TOKEN);

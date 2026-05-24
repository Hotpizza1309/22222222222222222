const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['Manager', 'Owner'];
const LOG_ROLES = ['Head Manager', 'Owner'];
const LOG_CHANNEL   = 'person-log';
const DATA_FILE     = './potion_data.json';

const REWARDS = [
  { label: '🔥 Grand Potion Lord',  role: '🔥 Grand Potion Lord',  threshold: 500 },
  { label: '👑 Arcane Benefactor',  role: '👑 Arcane Benefactor',  threshold: 200 },
  { label: '🕯️ Master of Elixirs', role: '🕯️ Master of Elixirs', threshold: 100 },
  { label: '⚜️ Trusted Alchemist', role: '⚜️ Trusted Alchemist', threshold: 50  },
  { label: '📜 Certified Patron',   role: '📜 Certified Patron',   threshold: 30  },
  { label: 'Verified Customer💕',   role: 'Verified Customer💕',   threshold: 1   },
];

const ITEMS = [
  { name: "Animagus Potion",               price: 25 },
  { name: "Polyjuice Potion",              price: 5  },
  { name: "Death Potion",                  price: 2  },
  { name: "Pittlebugs Exhaust Potion",     price: 1  },
  { name: "Invisibility Potion",           price: 3  },
  { name: "Shrinking Solution Potion",     price: 3  },
  { name: "Healing Potion",                price: 3  },
  { name: "Alihotsy Draught Potion",       price: 2  },
  { name: "Dizziness Draught Potion",      price: 2  },
  { name: "Bulgeye Potion",                price: 2  },
  { name: "Exploding Potion",              price: 8  },
  { name: "Snape's Advanced Potion Book",  price: 50 },
];

// ── Persistent storage ────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Failed to load data:', e); }
  return {};
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Failed to save data:', e); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hasAllowedRole(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.name));
}

function getTierForCount(count) {
  return REWARDS.find(r => count >= r.threshold) ?? null;
}

// ── Slash command definitions ─────────────────────────────────────────────────
const orderCommand = new SlashCommandBuilder()
  .setName('order')
  .setDescription('Calculate the total cost of a potion order');
ITEMS.forEach(item => {
  const optionName = item.name.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim().replace(/\s+/g,'_').slice(0,32);
  orderCommand.addIntegerOption(opt =>
    opt.setName(optionName).setDescription(`${item.name} — ${item.price} Galleons each`).setMinValue(0).setRequired(false)
  );
});
orderCommand.addBooleanOption(opt => opt.setName('discount').setDescription('Apply 15% loyalty discount?').setRequired(false));
orderCommand.addBooleanOption(opt => opt.setName('clearance_sale').setDescription('Apply 25% clearance sale discount?').setRequired(false));

const logCommand = new SlashCommandBuilder()
  .setName('logpurchase')
  .setDescription('Log potions purchased by a customer and update their rewards tier')
  .addUserOption(opt => opt.setName('customer').setDescription('The customer to log for').setRequired(true))
  .addIntegerOption(opt => opt.setName('potions').setDescription('Number of potions purchased').setMinValue(1).setRequired(true))
  .addStringOption(opt => opt.setName('note').setDescription('Optional note (e.g. order details)').setRequired(false));

const checkCommand = new SlashCommandBuilder()
  .setName('checkpotions')
  .setDescription('Check how many potions a customer has purchased')
  .addUserOption(opt => opt.setName('customer').setDescription('The customer to check').setRequired(true));

const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the top 5 customers with the most potions purchased');

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available bot commands');

// ── Register commands ─────────────────────────────────────────────────────────
async function registerCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: [
        orderCommand.toJSON(),
        logCommand.toJSON(),
        checkCommand.toJSON(),
        leaderboardCommand.toJSON(),
        helpCommand.toJSON(),
      ]
    });
    console.log('Slash commands registered.');
  } catch (err) { console.error('Failed to register commands:', err); }
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id, process.env.DISCORD_TOKEN);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ── /order ──────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'order') {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ content: '❌ Only **Manager** and **Owner** roles can use this command.', ephemeral: true });
    }

    const applyDiscount  = interaction.options.getBoolean('discount') ?? false;
    const applyClearance = interaction.options.getBoolean('clearance_sale') ?? false;
    const lineItems = [];
    let subtotal = 0;

    ITEMS.forEach(item => {
      const optionName = item.name.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim().replace(/\s+/g,'_').slice(0,32);
      const qty = interaction.options.getInteger(optionName) ?? 0;
      if (qty > 0) {
        const cost = item.price * qty;
        subtotal += cost;
        lineItems.push({ name: item.name, qty, cost });
      }
    });

    if (lineItems.length === 0) {
      return interaction.reply({ content: '⚠️ No items selected! Add at least one item to your order.', ephemeral: true });
    }

    let discountPct = 0, discountLabel = '';
    if (applyDiscount && applyClearance) { discountPct = 0.25; discountLabel = '25% clearance sale (best discount applied)'; }
    else if (applyClearance)             { discountPct = 0.25; discountLabel = '25% clearance sale'; }
    else if (applyDiscount)              { discountPct = 0.15; discountLabel = '15% loyalty discount'; }

    const discountAmt = Math.round(subtotal * discountPct * 100) / 100;
    const total = subtotal - discountAmt;

    const embed = new EmbedBuilder()
      .setTitle('🧪 Potion Order Summary')
      .setColor(applyClearance ? 0xF1C40F : 0x5865F2)
      .addFields(lineItems.map(l => ({ name: l.name, value: `× ${l.qty} — **${l.cost} Galleons**`, inline: true })))
      .addFields({ name: '\u200b', value: '─────────────────', inline: false });

    if (discountPct > 0) {
      embed.addFields(
        { name: 'Subtotal', value: `${subtotal} Galleons`, inline: true },
        { name: `Discount (${discountPct * 100}%)`, value: `−${discountAmt} Galleons`, inline: true },
      );
    }

    embed.addFields({ name: '💰 Total', value: `**${total} Galleons**`, inline: false })
      .setFooter({ text: discountPct > 0 ? `${discountLabel} applied` : 'No discount applied' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── /logpurchase ────────────────────────────────────────────────────────────
  if (interaction.commandName === 'logpurchase') {
    const hasLogRole = interaction.member.roles.cache.some(r => LOG_ROLES.includes(r.name));
    if (!hasLogRole) {
      return interaction.reply({ content: '❌ Only **Head Manager** and **Owner** roles can log purchases.', ephemeral: true });
    }

    const customer = interaction.options.getUser('customer');
    const potions  = interaction.options.getInteger('potions');
    const note     = interaction.options.getString('note') ?? null;
    const member   = await interaction.guild.members.fetch(customer.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: '❌ Could not find that user in this server.', ephemeral: true });
    }

    const data      = loadData();
    const prevCount = data[customer.id] ?? 0;
    const newCount  = prevCount + potions;
    data[customer.id] = newCount;
    saveData(data);

    const prevTier = getTierForCount(prevCount);
    const newTier  = getTierForCount(newCount);
    const tieredUp = newTier && newTier.threshold !== (prevTier?.threshold ?? -1);

    if (tieredUp) {
      for (const reward of REWARDS) {
        const role = interaction.guild.roles.cache.find(r => r.name === reward.role);
        if (role) {
          if (reward.role === newTier.role) await member.roles.add(role).catch(() => {});
          else await member.roles.remove(role).catch(() => {});
        }
      }
    }

    const nextTier = REWARDS.slice().reverse().find(r => r.threshold > newCount) ?? null;
    const nextTierText = nextTier
      ? `${nextTier.threshold - newCount} more potions until **${nextTier.label}**`
      : '🏆 Max tier reached!';

    const logChannel = interaction.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Purchase Logged')
        .setColor(tieredUp ? 0xF1C40F : 0x57F287)
        .setThumbnail(customer.displayAvatarURL())
        .addFields(
          { name: 'Customer',      value: `<@${customer.id}>`,        inline: true },
          { name: 'Potions Added', value: `+${potions}`,              inline: true },
          { name: 'Total Potions', value: `${newCount}`,               inline: true },
          { name: 'Current Tier',  value: newTier ? newTier.label : 'None', inline: true },
          { name: 'Next Tier',     value: nextTierText,                inline: true },
          { name: 'Logged by',     value: `<@${interaction.user.id}>`, inline: true },
        );
      if (note) logEmbed.addFields({ name: '📝 Note', value: note, inline: false });
      if (tieredUp) logEmbed.addFields({ name: '🎉 Tier Up!', value: `${customer.username} has reached **${newTier.label}**!`, inline: false });
      logEmbed.setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }

    const replyEmbed = new EmbedBuilder()
      .setTitle('✅ Purchase Logged')
      .setColor(0x57F287)
      .addFields(
        { name: 'Customer',      value: `<@${customer.id}>`, inline: true },
        { name: 'Potions Added', value: `+${potions}`,       inline: true },
        { name: 'New Total',     value: `${newCount}`,        inline: true },
        { name: 'Current Tier',  value: newTier ? newTier.label : 'None', inline: true },
      )
      .setTimestamp();

    if (tieredUp) replyEmbed.setDescription(`🎉 **${customer.username}** just ranked up to **${newTier.label}**!`);
    return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
  }

  // ── /checkpotions ───────────────────────────────────────────────────────────
  if (interaction.commandName === 'checkpotions') {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ content: '❌ Only **Manager** and **Owner** roles can check potion counts.', ephemeral: true });
    }

    const customer = interaction.options.getUser('customer');
    const data     = loadData();
    const count    = data[customer.id] ?? 0;
    const tier     = getTierForCount(count);
    const nextTier = REWARDS.slice().reverse().find(r => r.threshold > count) ?? null;
    const nextTierText = nextTier
      ? `${nextTier.threshold - count} more potions until **${nextTier.label}**`
      : '🏆 Max tier reached!';

    const embed = new EmbedBuilder()
      .setTitle(`🧪 Potion History — ${customer.username}`)
      .setColor(0x5865F2)
      .setThumbnail(customer.displayAvatarURL())
      .addFields(
        { name: 'Total Potions', value: `${count}`,                        inline: true },
        { name: 'Current Tier',  value: tier ? tier.label : 'None yet',    inline: true },
        { name: 'Next Tier',     value: nextTierText,                       inline: false },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /leaderboard ────────────────────────────────────────────────────────────
  if (interaction.commandName === 'leaderboard') {
    const data = loadData();

    const sorted = Object.entries(data)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    if (sorted.length === 0) {
      return interaction.reply({ content: '📭 No purchases have been logged yet!', ephemeral: true });
    }

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

    const fields = await Promise.all(sorted.map(async ([userId, count], i) => {
      const user = await client.users.fetch(userId).catch(() => null);
      const tier = getTierForCount(count);
      const username = user ? user.username : `Unknown User`;
      return {
        name: `${medals[i]} ${username}`,
        value: `**${count}** potions — ${tier ? tier.label : 'No tier yet'}`,
        inline: false,
      };
    }));

    const embed = new EmbedBuilder()
      .setTitle('🏆 Potion Leaderboard — Top 5 Customers')
      .setColor(0xF1C40F)
      .addFields(fields)
      .setFooter({ text: 'Rankings based on total potions purchased' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── /help ───────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🧙 Potion Shop Bot — Commands')
      .setColor(0x5865F2)
      .setDescription('Here are all available commands. Commands marked 🔒 require the **Manager** or **Owner** role.')
      .addFields(
        {
          name: '🔒 `/order`',
          value: 'Calculate the total cost of a potion order. Select quantities for each item and optionally apply a **15% loyalty** or **25% clearance sale** discount.',
          inline: false,
        },
        {
          name: '🔒 `/logpurchase`',
          value: 'Log potions purchased by a customer. Automatically updates their total, assigns the correct rewards tier role, and posts to `#person-log`.',
          inline: false,
        },
        {
          name: '🔒 `/checkpotions`',
          value: 'Check how many potions a customer has purchased in total, their current rewards tier, and how far they are from the next one.',
          inline: false,
        },
        {
          name: '🏆 `/leaderboard`',
          value: 'Shows the top 5 customers with the most potions purchased of all time.',
          inline: false,
        },
        {
          name: '❓ `/help`',
          value: 'Shows this help message.',
          inline: false,
        },
        {
          name: '\u200b',
          value: '**Rewards Tiers**',
          inline: false,
        },
        ...REWARDS.map(r => ({
          name: r.label,
          value: `${r.threshold}+ potions`,
          inline: true,
        })),
      )
      .setFooter({ text: 'Potion Shop Bot' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');

// ── Config ────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES   = ['Manager', 'Owner'];
const LOG_ROLES       = ['Owner'];
const LOG_CHANNEL     = 'person-log';
const INV_CHANNEL     = '📰┋inventory-log';
const LB_CHANNEL      = '🕯️┋rewards';
const LOW_STOCK_LIMIT = 30;

const REWARDS = [
  { label: '🔥 Grand Potion Lord',  role: '🔥 Grand Potion Lord',  threshold: 500 },
  { label: '👑 Arcane Benefactor',  role: '👑 Arcane Benefactor',  threshold: 200 },
  { label: '🕯️ Master of Elixirs', role: '🕯️ Master of Elixirs', threshold: 100 },
  { label: '⚜️ Trusted Alchemist', role: '⚜️ Trusted Alchemist', threshold: 50  },
  { label: '📜 Certified Patron',   role: '📜 Certified Patron',   threshold: 30  },
  { label: 'Verified Customer💕',   role: 'Verified Customer💕',   threshold: 1   },
];

const ADVANCED_POTIONS = [
  "Animagus Potion",
  "Polyjuice Potion",
  "Death Potion",
];

const REGULAR_POTIONS = [
  "Pittlebugs Exhaust Potion",
  "Invisibility Potion",
  "Shrinking Solution Potion",
  "Healing Potion",
];

const ITEM_POTIONS = [
  "Snape's Advanced Potion Book",
];

const INVENTORY_ITEMS = [...ADVANCED_POTIONS, ...REGULAR_POTIONS, ...ITEM_POTIONS];

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

// ── Database ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS potion_totals (
      user_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      item_name TEXT PRIMARY KEY,
      quantity INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_message (
      id INTEGER PRIMARY KEY DEFAULT 1,
      message_id TEXT,
      channel_id TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaderboard_message (
      id INTEGER PRIMARY KEY DEFAULT 1,
      message_id TEXT,
      channel_id TEXT
    )
  `);
  // Seed inventory with 0 for any missing items
  for (const name of INVENTORY_ITEMS) {
    await pool.query(`
      INSERT INTO inventory (item_name, quantity) VALUES ($1, 0)
      ON CONFLICT (item_name) DO NOTHING
    `, [name]);
  }
  console.log('Database ready.');
}

async function getCount(userId) {
  const res = await pool.query('SELECT total FROM potion_totals WHERE user_id = $1', [userId]);
  return res.rows[0]?.total ?? 0;
}

async function setCount(userId, total) {
  await pool.query(`
    INSERT INTO potion_totals (user_id, total) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET total = $2
  `, [userId, total]);
}

async function getAllCounts() {
  const res = await pool.query('SELECT user_id, total FROM potion_totals ORDER BY total DESC');
  return res.rows;
}

async function getInventory() {
  const res = await pool.query('SELECT item_name, quantity FROM inventory');
  return res.rows;
}

async function setInventoryItem(itemName, quantity) {
  await pool.query(`
    INSERT INTO inventory (item_name, quantity) VALUES ($1, $2)
    ON CONFLICT (item_name) DO UPDATE SET quantity = $2
  `, [itemName, quantity]);
}

async function getSavedMessage() {
  const res = await pool.query('SELECT message_id, channel_id FROM inventory_message WHERE id = 1');
  return res.rows[0] ?? null;
}

async function saveMessageRef(messageId, channelId) {
  await pool.query(`
    INSERT INTO inventory_message (id, message_id, channel_id) VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET message_id = $1, channel_id = $2
  `, [messageId, channelId]);
}

async function getSavedLeaderboardMessage() {
  const res = await pool.query('SELECT message_id, channel_id FROM leaderboard_message WHERE id = 1');
  return res.rows[0] ?? null;
}

async function saveLeaderboardMessageRef(messageId, channelId) {
  await pool.query(`
    INSERT INTO leaderboard_message (id, message_id, channel_id) VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET message_id = $1, channel_id = $2
  `, [messageId, channelId]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hasAllowedRole(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.name));
}

function hasLogRole(member) {
  return member.roles.cache.some(r => LOG_ROLES.includes(r.name));
}

function getTierForCount(count) {
  return REWARDS.find(r => count >= r.threshold) ?? null;
}

function stockLabel(qty) {
  if (qty === 0)              return '🔴 {Out of Stock}';
  if (qty < LOW_STOCK_LIMIT)  return '🟡 {Low Stock}';
  return '🟢 {In Stock}';
}

function pad(name, total) {
  const dots = total - name.length;
  return name + ' ' + '.'.repeat(Math.max(0, dots));
}

function buildInventoryText(rows) {
  const map = {};
  rows.forEach(r => { map[r.item_name] = r.quantity; });

  const advanced = ITEMS.filter(i => ADVANCED_POTIONS.includes(i.name));
  const regular  = ITEMS.filter(i => REGULAR_POTIONS.includes(i.name));
  const items    = ITEMS.filter(i => ITEM_POTIONS.includes(i.name));

  const maxLen = Math.max(...INVENTORY_ITEMS.map(n => n.length)) + 2;

  const fmt = (item) => {
    const qty   = map[item.name] ?? 0;
    const emoji = qty === 0 ? '🔴' : qty < LOW_STOCK_LIMIT ? '🟡' : '🟢';
    const label = qty === 0 ? '{Out of Stock}' : qty < LOW_STOCK_LIMIT ? '{Low Stock}' : '{In Stock}';
    return `    ${emoji} ${pad(item.name, maxLen)} x${qty}  ${label}`;
  };

  const totalQty = INVENTORY_ITEMS.reduce((sum, name) => sum + (map[name] ?? 0), 0);
  const lowCount = INVENTORY_ITEMS.filter(n => (map[n] ?? 0) > 0 && (map[n] ?? 0) < LOW_STOCK_LIMIT).length;
  const outCount = INVENTORY_ITEMS.filter(n => (map[n] ?? 0) === 0).length;

  const lines = [
    '```',
    '✨ ═══════════════════════════════ ✨',
    '    🏰 OFFICE OF EXPERIMENTAL ELIXIRS',
    '         📜 Stock Manifest 📜',
    '✨ ═══════════════════════════════ ✨',
    '',
    '        ≪ ⚗️  ADVANCED POTIONS ⚗️ ≫',
    '    ────────────────────────────────',
    ...advanced.map(fmt),
    '',
    '        ≪ 🧪  REGULAR POTIONS 🧪 ≫',
    '    ────────────────────────────────',
    ...regular.map(fmt),
    '',
    '        ≪ 📚  ITEMS 📚 ≫',
    '    ────────────────────────────────',
    ...items.map(fmt),
    '',
    '    ══════════════════════════════',
    `    📦 Total: x${totalQty}  🟡 Low: ${lowCount}  🔴 Out: ${outCount}`,
    '    ══════════════════════════════',
    '```',
    `> 🕯️ *Last updated <t:${Math.floor(Date.now() / 1000)}:R>*`,
  ];

  return lines.join('\n');
}
async function updateInventoryMessage(guild) {
  const invChannel = guild.channels.cache.find(c => c.name === INV_CHANNEL);
  if (!invChannel) return;

  const rows    = await getInventory();
  const content = buildInventoryText(rows);
  const saved   = await getSavedMessage();

  if (saved) {
    try {
      const ch  = await guild.channels.fetch(saved.channel_id);
      const msg = await ch.messages.fetch(saved.message_id);
      await msg.edit(content);
      return;
    } catch {
      // Message was deleted, send a new one
    }
  }

  const newMsg = await invChannel.send(content);
  await saveMessageRef(newMsg.id, invChannel.id);
}

async function updateLeaderboardMessage(guild) {
  const lbChannel = guild.channels.cache.find(c => c.name === LB_CHANNEL);
  if (!lbChannel) return;

  const rows  = await getAllCounts();
  const top10 = rows.slice(0, 10);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  const fields = [];
  if (top10.length === 0) {
    fields.push({ name: 'No entries yet', value: 'No purchases have been logged yet!', inline: false });
  } else {
    for (let i = 0; i < top10.length; i++) {
      const row  = top10[i];
      const tier = getTierForCount(row.total);
      fields.push({
        name: `${medals[i]} #${i + 1}`,
        value: `<@${row.user_id}>\n${row.total} potions — ${tier ? tier.label : 'No tier yet'}`,
        inline: false,
      });
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 Potion Shop — Customer Leaderboard')
    .setColor(0xF1C40F)
    .setDescription('Top 10 customers by total potions purchased')
    .addFields(fields)
    .setFooter({ text: '🕯️ Refreshes every 30 minutes' })
    .setTimestamp();

  const saved = await getSavedLeaderboardMessage();

  if (saved) {
    try {
      const ch  = await guild.channels.fetch(saved.channel_id);
      const msg = await ch.messages.fetch(saved.message_id);
      await msg.edit({ content: '', embeds: [embed] });
      return;
    } catch {
      // Message was deleted, send a new one
    }
  }

  const newMsg = await lbChannel.send({ content: '', embeds: [embed] });
  await saveLeaderboardMessageRef(newMsg.id, lbChannel.id);
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

const restoreCommand = new SlashCommandBuilder()
  .setName('restorelog')
  .setDescription('Restore a customers potion total from old logs')
  .addUserOption(opt => opt.setName('customer').setDescription('The customer to restore').setRequired(true))
  .addIntegerOption(opt => opt.setName('total').setDescription('Their total potion count from the logs').setMinValue(1).setRequired(true));

// Build /updateinventory with dropdown potion, action, and amount
const updateInvCommand = new SlashCommandBuilder()
  .setName('updateinventory')
  .setDescription('Withdraw or restock a potion in inventory')
  .addStringOption(opt =>
    opt.setName('potion')
       .setDescription('Which potion to update')
       .setRequired(true)
       .addChoices(...ITEMS.filter(i => INVENTORY_ITEMS.includes(i.name)).map(i => ({ name: i.name, value: i.name })))
  )
  .addStringOption(opt =>
    opt.setName('action')
       .setDescription('Withdraw or Restock?')
       .setRequired(true)
       .addChoices(
         { name: 'Withdraw', value: 'withdraw' },
         { name: 'Restock',  value: 'restock'  },
         { name: 'Set',      value: 'set'       },
       )
  )
  .addIntegerOption(opt =>
    opt.setName('amount')
       .setDescription('How many potions?')
       .setMinValue(1)
       .setRequired(true)
  );

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
        restoreCommand.toJSON(),
        updateInvCommand.toJSON(),
      ]
    });
    console.log('Slash commands registered.');
  } catch (err) { console.error('Failed to register commands:', err); }
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await initDB();
  await registerCommands(client.user.id, process.env.DISCORD_TOKEN);

  // Auto-refresh leaderboard every 10 minutes
  const guild = client.guilds.cache.first();
  if (guild) {
    await updateLeaderboardMessage(guild);
    setInterval(async () => {
      const g = client.guilds.cache.first();
      if (g) await updateLeaderboardMessage(g);
    }, 30 * 60 * 1000);
  }
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
      if (qty > 0) { const cost = item.price * qty; subtotal += cost; lineItems.push({ name: item.name, qty, cost }); }
    });
    if (lineItems.length === 0) return interaction.reply({ content: '⚠️ No items selected!', ephemeral: true });
    let discountPct = 0, discountLabel = '';
    if (applyDiscount && applyClearance) { discountPct = 0.25; discountLabel = '25% clearance sale (best discount applied)'; }
    else if (applyClearance)             { discountPct = 0.25; discountLabel = '25% clearance sale'; }
    else if (applyDiscount)              { discountPct = 0.15; discountLabel = '15% loyalty discount'; }
    const discountAmt = Math.round(subtotal * discountPct * 100) / 100;
    const total = subtotal - discountAmt;
    const embed = new EmbedBuilder()
      .setTitle('🧪 Potion Order Summary').setColor(applyClearance ? 0xF1C40F : 0x5865F2)
      .addFields(lineItems.map(l => ({ name: l.name, value: `× ${l.qty} — **${l.cost} Galleons**`, inline: true })))
      .addFields({ name: '\u200b', value: '─────────────────', inline: false });
    if (discountPct > 0) embed.addFields(
      { name: 'Subtotal', value: `${subtotal} Galleons`, inline: true },
      { name: `Discount (${discountPct * 100}%)`, value: `−${discountAmt} Galleons`, inline: true },
    );
    embed.addFields({ name: '💰 Total', value: `**${total} Galleons**`, inline: false })
      .setFooter({ text: discountPct > 0 ? `${discountLabel} applied` : 'No discount applied' }).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── /logpurchase ────────────────────────────────────────────────────────────
  if (interaction.commandName === 'logpurchase') {
    if (!hasLogRole(interaction.member)) return interaction.reply({ content: '❌ Only **Owner** can log purchases.', ephemeral: true });
    const customer = interaction.options.getUser('customer');
    const potions  = interaction.options.getInteger('potions');
    const note     = interaction.options.getString('note') ?? null;
    const member   = await interaction.guild.members.fetch(customer.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Could not find that user in this server.', ephemeral: true });
    const prevCount = await getCount(customer.id);
    const newCount  = prevCount + potions;
    await setCount(customer.id, newCount);
    const prevTier = getTierForCount(prevCount);
    const newTier  = getTierForCount(newCount);
    const tieredUp = newTier && newTier.threshold !== (prevTier?.threshold ?? -1);
    const verifiedRole = REWARDS.find(r => r.threshold === 1);
    if (tieredUp) {
      for (const reward of REWARDS) {
        const role = interaction.guild.roles.cache.find(r => r.name === reward.role);
        if (role) {
          if (reward.role === newTier.role || reward.role === verifiedRole.role) await member.roles.add(role).catch(() => {});
          else await member.roles.remove(role).catch(() => {});
        }
      }
    }
    const nextTier = REWARDS.slice().reverse().find(r => r.threshold > newCount) ?? null;
    const nextTierText = nextTier ? `${nextTier.threshold - newCount} more potions until **${nextTier.label}**` : '🏆 Max tier reached!';
    const logChannel = interaction.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder().setTitle('📋 Purchase Logged').setColor(tieredUp ? 0xF1C40F : 0x57F287)
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
    const replyEmbed = new EmbedBuilder().setTitle('✅ Purchase Logged').setColor(0x57F287)
      .addFields(
        { name: 'Customer',      value: `<@${customer.id}>`, inline: true },
        { name: 'Potions Added', value: `+${potions}`,       inline: true },
        { name: 'New Total',     value: `${newCount}`,        inline: true },
        { name: 'Current Tier',  value: newTier ? newTier.label : 'None', inline: true },
      ).setTimestamp();
    if (tieredUp) replyEmbed.setDescription(`🎉 **${customer.username}** just ranked up to **${newTier.label}**!`);
    await updateLeaderboardMessage(interaction.guild);
    return interaction.reply({ embeds: [replyEmbed], ephemeral: false });
  }

  // ── /checkpotions ───────────────────────────────────────────────────────────
  if (interaction.commandName === 'checkpotions') {
    if (!hasAllowedRole(interaction.member)) return interaction.reply({ content: '❌ Only **Manager** and **Owner** roles can check potion counts.', ephemeral: true });
    const customer = interaction.options.getUser('customer');
    const count    = await getCount(customer.id);
    const tier     = getTierForCount(count);
    const nextTier = REWARDS.slice().reverse().find(r => r.threshold > count) ?? null;
    const nextTierText = nextTier ? `${nextTier.threshold - count} more potions until **${nextTier.label}**` : '🏆 Max tier reached!';
    const embed = new EmbedBuilder().setTitle(`🧪 Potion History — ${customer.username}`).setColor(0x5865F2)
      .setThumbnail(customer.displayAvatarURL())
      .addFields(
        { name: 'Total Potions', value: `${count}`,                     inline: true },
        { name: 'Current Tier',  value: tier ? tier.label : 'None yet', inline: true },
        { name: 'Next Tier',     value: nextTierText,                    inline: false },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /leaderboard ────────────────────────────────────────────────────────────
  if (interaction.commandName === 'leaderboard') {
    const rows = await getAllCounts();
    const top5 = rows.slice(0, 5);
    if (top5.length === 0) return interaction.reply({ content: '📭 No purchases have been logged yet!', ephemeral: true });
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const fields = await Promise.all(top5.map(async (row, i) => {
      const user = await client.users.fetch(row.user_id).catch(() => null);
      const tier = getTierForCount(row.total);
      return { name: `${medals[i]} ${user ? user.username : 'Unknown User'}`, value: `**${row.total}** potions — ${tier ? tier.label : 'No tier yet'}`, inline: false };
    }));
    const embed = new EmbedBuilder().setTitle('🏆 Potion Leaderboard — Top 5 Customers').setColor(0xF1C40F)
      .addFields(fields).setFooter({ text: 'Rankings based on total potions purchased' }).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── /restorelog ─────────────────────────────────────────────────────────────
  if (interaction.commandName === 'restorelog') {
    if (!hasLogRole(interaction.member)) return interaction.reply({ content: '❌ Only **Owner** can restore logs.', ephemeral: true });
    const customer = interaction.options.getUser('customer');
    const total    = interaction.options.getInteger('total');
    const member   = await interaction.guild.members.fetch(customer.id).catch(() => null);
    await setCount(customer.id, total);
    const newTier      = getTierForCount(total);
    const verifiedRole = REWARDS.find(r => r.threshold === 1);
    if (member && newTier) {
      for (const reward of REWARDS) {
        const role = interaction.guild.roles.cache.find(r => r.name === reward.role);
        if (role) {
          if (reward.role === newTier.role || reward.role === verifiedRole.role) await member.roles.add(role).catch(() => {});
          else await member.roles.remove(role).catch(() => {});
        }
      }
    }
    const nextTier = REWARDS.slice().reverse().find(r => r.threshold > total) ?? null;
    const nextTierText = nextTier ? `${nextTier.threshold - total} more potions until **${nextTier.label}**` : '🏆 Max tier reached!';
    const embed = new EmbedBuilder().setTitle('♻️ Potion Log Restored').setColor(0x5865F2)
      .setThumbnail(customer.displayAvatarURL())
      .addFields(
        { name: 'Customer',      value: `<@${customer.id}>`,                  inline: true },
        { name: 'Total Potions', value: `${total}`,                            inline: true },
        { name: 'Current Tier',  value: newTier ? newTier.label : 'None yet', inline: true },
        { name: 'Next Tier',     value: nextTierText,                          inline: false },
      ).setFooter({ text: `Restored by ${interaction.user.username}` }).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /updateinventory ────────────────────────────────────────────────────────
  if (interaction.commandName === 'updateinventory') {
    if (!hasLogRole(interaction.member)) return interaction.reply({ content: '❌ Only **Owner** can update inventory.', ephemeral: true });

    const potion = interaction.options.getString('potion');
    const action = interaction.options.getString('action');
    const amount = interaction.options.getInteger('amount');

    // Get current stock
    const rows = await getInventory();
    const current = rows.find(r => r.item_name === potion)?.quantity ?? 0;

    let newQty;
    if (action === 'withdraw') {
      newQty = Math.max(0, current - amount);
    } else if (action === 'restock') {
      newQty = current + amount;
    } else {
      newQty = amount;
    }

    await setInventoryItem(potion, newQty);
    await updateInventoryMessage(interaction.guild);

    const actionText = action === 'withdraw' ? `withdrew **${amount}**` : action === 'restock' ? `restocked **+${amount}**` : `set to **${newQty}**`;
    const stockText  = stockLabel(newQty);

    return interaction.reply({
      content: `✅ **${potion}**: ${actionText} — now at **x${newQty}** ${stockText}`,
      ephemeral: true
    });
  }

  // ── /help ───────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder().setTitle('🧙 Potion Shop Bot — Commands').setColor(0x5865F2)
      .setDescription('Commands marked 🔒 require **Manager** or **Owner**. Commands marked 👑 require **Owner** only.')
      .addFields(
        { name: '🔒 `/order`',            value: 'Calculate the total cost of a potion order with optional 15% or 25% discounts.', inline: false },
        { name: '👑 `/logpurchase`',       value: 'Log potions purchased by a customer. Updates their total, assigns their rewards tier, and posts to `#person-log`.', inline: false },
        { name: '🔒 `/checkpotions`',      value: 'Check a customer\'s total potion count, current tier, and progress to the next tier.', inline: false },
        { name: '🏆 `/leaderboard`',       value: 'Shows the top 5 customers with the most potions purchased.', inline: false },
        { name: '👑 `/restorelog`',        value: 'Restore a customer\'s potion total from old logs.', inline: false },
        { name: '👑 `/updateinventory`',   value: 'Update stock quantities for any potion. Automatically refreshes the inventory message in `#📰┋inventory-log`.', inline: false },
        { name: '❓ `/help`',              value: 'Shows this help message.', inline: false },
        { name: '\u200b',                  value: '**Rewards Tiers**', inline: false },
        ...REWARDS.map(r => ({ name: r.label, value: `${r.threshold}+ potions`, inline: true })),
      ).setFooter({ text: 'Potion Shop Bot' }).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);

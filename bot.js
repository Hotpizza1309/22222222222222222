const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ALLOWED_ROLES = ['Manager', 'Owner'];

const ITEMS = [
  { name: "Animagus Potion",                    price: 25  },
  { name: "Polyjuice Potion",                   price: 5   },
  { name: "Death Potion",                       price: 2   },
  { name: "Pittlebugs Exhaust Potion",          price: 1   },
  { name: "Invisibility Potion",                price: 3   },
  { name: "Shrinking Solution Potion",          price: 3   },
  { name: "Healing Potion",                     price: 3   },
  { name: "Alihotsy Draught Potion",            price: 2   },
  { name: "Dizziness Draught Potion",           price: 2   },
  { name: "Bulgeye Potion",                     price: 2   },
  { name: "Exploding Potion",                   price: 8   },
  { name: "Snape's Advanced Potion Book",       price: 50  },
];

const commandBuilder = new SlashCommandBuilder()
  .setName('order')
  .setDescription('Calculate the total for a potion order');

ITEMS.forEach(item => {
  const optionName = item.name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 32);
  commandBuilder.addIntegerOption(opt =>
    opt.setName(optionName)
       .setDescription(`${item.name} — ${item.price} Galleons each`)
       .setMinValue(0)
       .setRequired(false)
  );
});

commandBuilder.addBooleanOption(opt =>
  opt.setName('discount')
     .setDescription('Apply 15% loyalty discount?')
     .setRequired(false)
);

commandBuilder.addBooleanOption(opt =>
  opt.setName('clearance_sale')
     .setDescription('Apply 25% clearance sale discount?')
     .setRequired(false)
);

async function registerCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: [commandBuilder.toJSON()]
    });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id, process.env.DISCORD_TOKEN);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'order') return;

  const memberRoles = interaction.member.roles.cache;
  const hasPermission = memberRoles.some(role => ALLOWED_ROLES.includes(role.name));

  if (!hasPermission) {
    await interaction.reply({ content: '❌ You do not have permission to use this command. Only **Manager** and **Owner** roles can place orders.', ephemeral: true });
    return;
  }

  const applyDiscount = interaction.options.getBoolean('discount') ?? false;
  const applyClearance = interaction.options.getBoolean('clearance_sale') ?? false;
  const lineItems = [];
  let subtotal = 0;

  ITEMS.forEach(item => {
    const optionName = item.name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 32);
    const qty = interaction.options.getInteger(optionName) ?? 0;
    if (qty > 0) {
      const cost = item.price * qty;
      subtotal += cost;
      lineItems.push({ name: item.name, qty, cost });
    }
  });

  if (lineItems.length === 0) {
    await interaction.reply({ content: '⚠️ No items selected! Add at least one item to your order.', ephemeral: true });
    return;
  }

  let discountPct = 0;
  let discountLabel = '';
  if (applyDiscount && applyClearance) {
    discountPct = 0.25;
    discountLabel = '25% clearance sale (best discount applied)';
  } else if (applyClearance) {
    discountPct = 0.25;
    discountLabel = '25% clearance sale';
  } else if (applyDiscount) {
    discountPct = 0.15;
    discountLabel = '15% loyalty discount';
  }

  const discountAmt = Math.round(subtotal * discountPct * 100) / 100;
  const total = subtotal - discountAmt;

  const embed = new EmbedBuilder()
    .setTitle('🧪 Potion Order Summary')
    .setColor(applyClearance ? 0xF1C40F : 0x5865F2)
    .addFields(
      lineItems.map(l => ({
        name: l.name,
        value: `× ${l.qty} — **${l.cost} Galleons**`,
        inline: true,
      }))
    )
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

  await interaction.reply({ embeds: [embed] });
});

client.login(process.env.DISCORD_TOKEN);

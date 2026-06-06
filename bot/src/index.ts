import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config';
import { commandMap } from './commands/index';
import { registerGuildCommands } from './discord/registerCommands';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);
  try {
    const n = await registerGuildCommands();
    console.log(`[bot] registered ${n} slash command(s)`);
  } catch (err) {
    console.error('[bot] command registration failed:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = commandMap.get(interaction.commandName);
    if (cmd?.autocomplete) {
      try {
        await cmd.autocomplete(interaction);
      } catch (err) {
        console.error('[autocomplete]', err);
      }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error('[command]', err);
      const content = `❌ ${(err as Error).message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(content).catch(() => undefined);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }
});

client.login(config.DISCORD_TOKEN);

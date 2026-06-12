import { config } from '../config';
import { registerCommandsForGuild } from './registerCommands';

//Standalone: `npm run register`. (The bot also auto registers on startup.)
if (!config.DISCORD_GUILD_ID) {
    console.error('Set DISCORD_GUILD_ID to use the standalone register script (the bot itself registers every guild automatically).');
    process.exit(1);
}
const count = await registerCommandsForGuild(config.DISCORD_GUILD_ID);
console.log(`Registered ${count} command(s) to guild ${config.DISCORD_GUILD_ID}.`);

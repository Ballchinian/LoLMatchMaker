import { config } from '../config';
import { registerGuildCommands } from './registerCommands';

/** Standalone: `npm run register`. (The bot also auto-registers on startup.) */
const count = await registerGuildCommands();
console.log(`Registered ${count} command(s) to guild ${config.DISCORD_GUILD_ID}.`);

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),

  ADMIN_ROLE_ID: z.string().optional().default(''),
  INHOUSE_CATEGORY: z.string().default('Inhouse'),
  LOBBY_CHANNEL_ID: z.string().optional().default(''),

  API_BASE_URL: z.string().url().default('http://localhost:4000/api'),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required (must match the backend)'),
});

export const config = schema.parse(process.env);

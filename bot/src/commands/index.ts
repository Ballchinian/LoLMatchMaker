import type { Command } from './types';
import { link } from './link';
import { match } from './match';
import { setup } from './setup';
import { syncroles } from './syncroles';

export const commands: Command[] = [link, match, setup, syncroles];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

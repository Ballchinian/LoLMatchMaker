import type { Command } from './types';
import { link } from './link';
import { match } from './match';

export const commands: Command[] = [link, match];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

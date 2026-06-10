import type { Command } from './types';
import { link } from './link';
import { unlink } from './unlink';
import { match } from './match';
import { setup } from './setup';
import { syncroles } from './syncroles';
import { update } from './update';

export const commands: Command[] = [link, unlink, match, setup, syncroles, update];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

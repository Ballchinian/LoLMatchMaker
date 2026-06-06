/** Fun, memorable two-word lobby names for matches (e.g. "Feral Scuttle"). */

const ADJECTIVES = [
  'Brave', 'Swift', 'Mighty', 'Sneaky', 'Feral', 'Cosmic', 'Ancient', 'Savage',
  'Radiant', 'Cursed', 'Frozen', 'Blazing', 'Shadow', 'Golden', 'Iron', 'Crimson',
  'Mystic', 'Rabid', 'Noble', 'Vicious', 'Sacred', 'Rogue', 'Eternal', 'Wicked',
  'Stormy', 'Silent', 'Lucky', 'Grumpy', 'Sleepy', 'Chaotic', 'Epic', 'Tilted',
  'Cracked', 'Galaxy', 'Thunder', 'Venom', 'Phantom', 'Hungry', 'Spicy', 'Dizzy',
];

const NOUNS = [
  'Baron', 'Drake', 'Herald', 'Scuttle', 'Krug', 'Gromp', 'Raptor', 'Wolf',
  'Nexus', 'Minion', 'Poro', 'Yordle', 'Inhibitor', 'Turret', 'Tower', 'Ward',
  'Dragon', 'Rift', 'Cannon', 'Brush', 'Pentakill', 'Backdoor', 'Gank', 'Recall',
  'Flash', 'Smite', 'Comet', 'Lantern', 'Blade', 'Bramble', 'Sunfire', 'Tonic',
  'Cleaver', 'Wisp', 'Golem', 'Sentinel', 'Marksman', 'Juggernaut', 'Stopwatch', 'Teleport',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** A single random "Adjective Noun" name. ~1600 combinations. */
export function randomLobbyName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

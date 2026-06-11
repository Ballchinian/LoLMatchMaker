import {
    PermissionFlagsBits,
    type ColorResolvable,
    type Guild,
    type GuildMember,
    type Role,
} from 'discord.js';
import { config } from '../config';

/** Website tier (uppercase) -> Discord role display name. */
const TIER_DISPLAY: Record<string, string> = {
    IRON: 'Iron',
    BRONZE: 'Bronze',
    SILVER: 'Silver',
    GOLD: 'Gold',
    PLATINUM: 'Platinum',
    EMERALD: 'Emerald',
    DIAMOND: 'Diamond',
    MASTER: 'Master',
    GRANDMASTER: 'Grandmaster',
    CHALLENGER: 'Challenger',
};

const TIER_COLOR: Record<string, number> = {
    IRON: 0x817d7d,
    BRONZE: 0xa9613b,
    SILVER: 0xa8b4bd,
    GOLD: 0xe6b800,
    PLATINUM: 0x4ec0b5,
    EMERALD: 0x2ecc71,
    DIAMOND: 0x6f9bee,
    MASTER: 0xb45edd,
    GRANDMASTER: 0xe04343,
    CHALLENGER: 0xf4d35e,
};

const ALL_TIER_ROLE_NAMES = new Set(Object.values(TIER_DISPLAY));

async function ensureRole(
    guild: Guild,
    name: string,
    opts: { color?: ColorResolvable; permissions?: bigint[]; hoist?: boolean } = {},
): Promise<Role> {
    const existing = guild.roles.cache.find((r) => r.name === name);
    if (existing) return existing;
    return guild.roles.create({
        name,
        color: opts.color,
        permissions: opts.permissions ?? [],
        hoist: opts.hoist ?? false,
        reason: 'LoL Match Maker',
    });
}

//The access role (created with View Channel + Connect so granting it = server access)
export function ensureLinkedRole(guild: Guild): Promise<Role> {
    return ensureRole(guild, config.LINKED_ROLE_NAME, {
        permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });
}

//The admin marker role: grants no Discord permissions, the bot just recognizes it
export function ensureAdminRole(guild: Guild): Promise<Role> {
    return ensureRole(guild, config.ADMIN_ROLE_NAME, { color: 0xd4af37, hoist: false });
}

//Create the admin + Linked + all tier roles (for first-time setup).
export async function ensureAllRoles(guild: Guild): Promise<void> {
    await ensureAdminRole(guild);
    await ensureLinkedRole(guild);
    for (const [tier, name] of Object.entries(TIER_DISPLAY)) {
        await ensureRole(guild, name, { color: TIER_COLOR[tier], hoist: false });
    }
}

/*
    Give a member the Linked role + the single tier role matching their website rank,
    removing any stale tier roles. Returns the rank label applied.
*/

export async function syncMemberRoles(
    guild: Guild,
    member: GuildMember,
    tier: string | null,
): Promise<string> {
    const linked = await ensureLinkedRole(guild);
    const targetName = tier ? (TIER_DISPLAY[tier] ?? null) : null;

    //Desired = current roles minus stale tiers, plus Linked + the current tier.
    const desired = new Set(
        member.roles.cache
            .filter((r) => !(ALL_TIER_ROLE_NAMES.has(r.name) && r.name !== targetName))
            .keys(),
    );
    desired.add(linked.id);
    if (targetName && tier) {
        const role = await ensureRole(guild, targetName, { color: TIER_COLOR[tier], hoist: false });
        desired.add(role.id);
    }

    //Avoids role updates and ensures consistent role deployment
    const changed = desired.size !== member.roles.cache.size ||
        [...desired].some((id) => !member.roles.cache.has(id));

    if (changed) await member.roles.set([...desired], 'Match Maker rank sync');

    return targetName ?? 'Unranked';
}

//Strip the Linked + any tier roles (used on unlink, re-gating the member).
export async function clearMemberRoles(guild: Guild, member: GuildMember): Promise<void> {
    const names = new Set([config.LINKED_ROLE_NAME, ...Object.values(TIER_DISPLAY)]);
    const toRemove = member.roles.cache.filter((r) => names.has(r.name)).map((r) => r.id);
    if (toRemove.length) await member.roles.remove(toRemove, 'Match Maker unlink');
}

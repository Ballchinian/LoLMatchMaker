import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/*
    Per-server website security, no extra dependencies:
    - admin passwords are scrypt-hashed before they touch MongoDB
    - server keys are unguessable random handles (the website "URL secret")
    - logins yield HMAC-signed, expiring tokens so the password is sent once
*/

//Format: s2$<salt hex>$<hash hex>
export function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `s2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 's2') return false;
    const hash = scryptSync(password, parts[1]!, 64);
    const expected = Buffer.from(parts[2]!, 'hex');
    if (hash.length !== expected.length) return false;
    return timingSafeEqual(hash, expected);
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

//16 chars of base58ish (~94 bits): long enough that a server key can't be guessed
export function newServerKey(): string {
    const bytes = randomBytes(16);
    let out = '';
    for (let i = 0; i < 16; i++) out += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length];
    return out;
}

/*
    Token signing secret: AUTH_SECRET if set, otherwise derived from the admin/bot
    tokens, otherwise random per boot (server-admin logins then die on restart).
*/
const secret =
    env.AUTH_SECRET.trim() ||
    (env.ADMIN_TOKEN + env.BOT_TOKEN).trim() ||
    randomBytes(32).toString('hex');

const TOKEN_PREFIX = 'gs1';
//Server-admin logins stay valid for 30 days
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(buf: Buffer): string {
    return buf.toString('base64url');
}

function sign(payload: string): string {
    return b64url(createHmac('sha256', secret).update(payload).digest());
}

//Format: gs1.<base64url {g, exp}>.<hmac>
export function signServerToken(guildId: string): string {
    const payload = b64url(Buffer.from(JSON.stringify({ g: guildId, exp: Date.now() + TOKEN_TTL_MS })));
    return `${TOKEN_PREFIX}.${payload}.${sign(payload)}`;
}

//Returns the guildId baked into a valid, unexpired token, else null
export function verifyServerToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const expected = sign(parts[1]!);
    const got = Buffer.from(parts[2]!);
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as {
            g?: string;
            exp?: number;
        };
        if (!payload.g || !payload.exp || payload.exp < Date.now()) return null;
        return payload.g;
    } catch {
        return null;
    }
}

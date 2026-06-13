import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/*
    Terms of Service + Privacy Policy. Discord's developer portal asks for a
    public URL for each (General Information -> Terms of Service URL / Privacy
    Policy URL): point them at /terms and /privacy on this site.
*/

const CONTACT_EMAIL = 'ethantnewiss@gmail.com';
const LAST_UPDATED = '13 June 2026';

function Legal({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
            <h1 className="mb-1 text-2xl font-bold text-white">{title}</h1>
            <p className="mb-6 text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>
            <div className="space-y-4 text-sm leading-relaxed text-slate-300">{children}</div>
            <p className="mt-8 text-xs text-slate-500">
                Questions? Contact <a className="text-indigo-300 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.{' '}
                See also the <Link className="text-indigo-300 hover:underline" to="/terms">Terms of Service</Link> and{' '}
                <Link className="text-indigo-300 hover:underline" to="/privacy">Privacy Policy</Link>.
            </p>
        </div>
    );
}

function H({ children }: { children: ReactNode }) {
    return <h2 className="mt-6 text-base font-semibold text-white">{children}</h2>;
}

export function TermsPage() {
    return (
        <Legal title="Terms of Service — LoL Match Maker">
            <p>
                LoL Match Maker ("the Service") is a free, hobby-run tool consisting of this website and a
                Discord bot that organise custom League of Legends in-house games: balanced teams, an
                internal MMR ladder, voice channel management and match results. By using the website or
                adding the bot to a Discord server, you agree to these terms.
            </p>

            <H>Use of the Service</H>
            <p>
                You may use the Service only in ways that comply with Discord's Terms of Service and
                Community Guidelines and with Riot Games' Terms of Service. Don't attempt to access other
                Discord servers' data, guess server keys, manipulate ratings through fake results, or
                disrupt the Service. Server administrators are responsible for how the bot is configured
                and used in their own server.
            </p>

            <H>Accounts and data</H>
            <p>
                Players are added to a server's roster by that server's members or admins. Linking your
                Discord account (/link) is voluntary; you can unlink at any time (/unlink). Ratings, match
                history and rankings are calculated automatically and have no monetary value. Server admins
                may edit, reset or delete roster entries and matches for their server.
            </p>

            <H>No warranty</H>
            <p>
                The Service is provided "as is", free of charge, with no uptime guarantee and no warranty
                of any kind. Ratings and auto-detected results are best-effort and may be wrong. We may
                change, suspend or discontinue the Service (or any server's access to it) at any time.
            </p>

            <H>Liability</H>
            <p>
                To the maximum extent permitted by law, the operator of this Service is not liable for any
                damages arising from its use, including lost data, incorrect ratings, or actions taken by
                server administrators.
            </p>

            <H>Riot Games</H>
            <p>
                LoL Match Maker isn't endorsed by Riot Games and doesn't reflect the views or opinions of
                Riot Games or anyone officially involved in producing or managing Riot Games properties.
                Riot Games, and all associated properties are trademarks or registered trademarks of Riot
                Games, Inc. League of Legends © Riot Games, Inc.
            </p>
        </Legal>
    );
}

export function PrivacyPage() {
    return (
        <Legal title="Privacy Policy — LoL Match Maker">
            <p>
                This policy explains what data LoL Match Maker (the website and the Discord bot) stores,
                why, and how to get it removed. The short version: we store the minimum needed to run an
                in-house ladder, we don't sell anything, and there's no advertising or tracking.
            </p>

            <H>What we store</H>
            <p>
                <strong>Discord:</strong> server (guild) IDs and names, and — when you link a player — your
                Discord user ID. The bot reads member/voice state to move players between channels and
                deletes non-command messages in its commands channel; message content is never stored.
                <br />
                <strong>Riot / League of Legends:</strong> for players added via Riot lookup, the public
                profile data returned by the Riot API (Riot ID, PUUID, rank, level, recent match
                statistics). This is public game data, fetched with an authorised Riot API key.
                <br />
                <strong>Ladder data:</strong> player display names, internal MMR/rating values, win/loss
                records, tags, and match results (teams, winners, timestamps).
                <br />
                <strong>Server settings:</strong> each server's website admin password is stored only as a
                salted scrypt hash — never in plain text.
            </p>

            <H>What we don't do</H>
            <p>
                No selling or sharing of data with third parties, no advertising, no analytics trackers,
                no reading of chat messages. Data is partitioned per Discord server: one server's roster
                and matches are not visible to another server.
            </p>

            <H>Where it lives</H>
            <p>
                Data is stored in a MongoDB database (MongoDB Atlas) and processed on the Service's hosting
                providers (currently Railway for the API/bot and Netlify for the website). Access requires
                either a server's unguessable key (viewing) or its admin password (changes).
            </p>

            <H>Retention and deletion</H>
            <p>
                Data is kept while a server uses the Service. You can unlink your Discord account at any
                time with /unlink (this removes the stored Discord ID from your player). To have a player
                entry, a match history, or a whole server's data deleted, ask your server admin or email{' '}
                <a className="text-indigo-300 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
                from a way we can verify (e.g. the Discord account involved) and we'll remove it within a
                reasonable time.
            </p>

            <H>Children</H>
            <p>
                The Service is intended for users who meet Discord's minimum age requirement in their
                country. We don't knowingly collect data from anyone below it.
            </p>

            <H>Changes</H>
            <p>
                If this policy changes materially, the "last updated" date above changes with it. Continued
                use after an update means you accept the revised policy.
            </p>
        </Legal>
    );
}

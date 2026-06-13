*Done:*
> One-click server link: the bot's #info post now shows a magic link `https://<site>/s/<serverKey>` instead of "paste this key". Opening it scopes the website to that server, then auto-strips the key from the address bar (kept in localStorage, sent as X-Server-Key) so it doesn't linger in history/referrers. Admins then just enter the password to unlock. Manual paste still works as a fallback; the key stays rotatable (/setup rotate_key:true).

*Pending:*

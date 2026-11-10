# 🎖️ Barracks Music

**Bringing Soldiers Together and Keeping the Barracks Alive!**

Discord music bot built with Python, discord.py, Wavelink, and Lavalink 4.

## Commands
- `/play <query>` — SoundCloud search or supported direct audio URL
- `/pause`, `/resume`, `/skip`, `/stop`
- `/queue`, `/nowplaying`
- `/volume <0-100>`, `/loop`, `/leave`, `/help`

## Railway deployment

Create two services in the same Railway project from this repository.

### Lavalink service
1. Add a service from this GitHub repository.
2. Set Dockerfile path to `Dockerfile.lavalink`.
3. Add `LAVALINK_SERVER_PASSWORD` with a long random secret.
4. Keep port 2333 private; do not create a public domain or TCP proxy.

### Bot service
1. Add another service from this repository and use the root `Dockerfile`.
2. Set Railway variables:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token |
| `LAVALINK_HOST` | Lavalink service's private Railway hostname |
| `LAVALINK_PORT` | `2333` |
| `LAVALINK_PASSWORD` | Same value as `LAVALINK_SERVER_PASSWORD` |

Use the exact private hostname shown in Railway for Lavalink (normally ending in `.railway.internal`).

## Discord setup
1. Create an application in the Discord Developer Portal and add a bot.
2. Copy the bot token into Railway as `DISCORD_TOKEN`; never commit it to GitHub.
3. Under OAuth2 → URL Generator, select `bot` and `applications.commands`.
4. Grant View Channels, Send Messages, Embed Links, Connect, and Speak.
5. Open the generated invite URL to add the bot to your server.

## Uptime
Use one replica per service and enable restart-on-failure / always restart where available. Uptime depends on your plan limits and service health.

## Audio sources
SoundCloud, Bandcamp, and HTTP sources are enabled. YouTube is disabled. A URL must be supported by Lavalink and the provider's terms to play.

## Local run
Requires Python 3.12+ and a reachable Lavalink 4 server. Set `DISCORD_TOKEN`, `LAVALINK_HOST`, `LAVALINK_PORT`, and `LAVALINK_PASSWORD`, then run:

```bash
pip install -r requirements.txt
python bot.py
```

The queue and repeat setting are in memory and reset after a restart. Slash commands sync globally at startup and may take time to appear.

# 🎖️ Barracks Music

**Bringing Soldiers Together and Keeping the Barracks Alive!**

A standalone music-only Discord bot based on the music player architecture from [Barracks-Bot](https://github.com/Uwakinkanalang/Barracks-Bot). It uses Discord.js, Riffy, and Lavalink 4. All non-music Barracks-Bot features are excluded.

## Music commands

- `/play query:` Search and play a song, YouTube Music query, or supported URL
- `/join` Join your voice channel
- `/queue` Show upcoming tracks
- `/nowplaying` Show the current track
- `/music pause`, `resume`, `skip`, `stop`, `shuffle`
- `/music loop` Set loop mode: off, track, or queue
- `/music volume` Set volume from 0–100
- `/music seek` Seek within the current track
- `/music remove`, `move`, `clear` Manage the queue
- `/music leave` Disconnect
- `/music 247` Keep the bot in voice when the queue ends

The now-playing panel includes playback buttons for pause, resume, skip, stop, loop, volume, shuffle, and queue.

## Railway deployment

Create two services in the same Railway project and environment.

### Lavalink service

- Source: this GitHub repository
- Dockerfile Path: `Dockerfile.lavalink`
- Variable: `LAVALINK_SERVER_PASSWORD` = a long random secret
- Keep port `2333` private; do not create a public domain or TCP proxy.

### Barracks Music bot service

- Source: this GitHub repository
- Dockerfile Path: `Dockerfile`
- Variables:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Discord bot token |
| `LAVALINK_HOST` | Lavalink private Railway hostname |
| `LAVALINK_PORT` | `2333` |
| `LAVALINK_PASSWORD` | Same value as `LAVALINK_SERVER_PASSWORD` |
| `LAVALINK_SEARCH_PLATFORM` | Optional; defaults to `ytmsearch` |

Keep secrets in Railway Variables, never in Git.

## Discord permissions

Invite the bot with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Embed Links, Connect, and Speak.

## Local run

Requires Node.js 20.10+ and a reachable Lavalink 4 server.

```bash
npm install
DISCORD_TOKEN=... LAVALINK_HOST=... LAVALINK_PORT=2333 LAVALINK_PASSWORD=... npm start
```

Queues and per-guild playback preferences are held in memory and reset when the bot restarts. YouTube availability is subject to provider restrictions; some videos may be unavailable to Lavalink.

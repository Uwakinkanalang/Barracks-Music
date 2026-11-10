import logging
import os

import discord
import wavelink
from discord import app_commands
from discord.ext import commands

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
log = logging.getLogger("barracks-music")


def env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


class BarracksMusic(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=discord.Intents.default())
        self.repeat = {}

    async def setup_hook(self):
        node = wavelink.Node(
            uri=f"http://{os.getenv('LAVALINK_HOST', 'localhost')}:{os.getenv('LAVALINK_PORT', '2333')}",
            password=env("LAVALINK_PASSWORD"),
            identifier="barracks-lavalink",
        )
        await wavelink.Pool.connect(nodes=[node], client=self)
        synced = await self.tree.sync()
        log.info("Synced %s slash commands", len(synced))

    async def on_ready(self):
        log.info("Barracks Music online as %s", self.user)

    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload):
        player = payload.player
        if not isinstance(player, wavelink.Player):
            return
        guild_id = player.guild.id
        if self.repeat.get(guild_id) and payload.track:
            await player.play(payload.track)
        elif player.queue:
            await player.play(await player.queue.get_wait())


bot = BarracksMusic()


async def active_player(interaction: discord.Interaction):
    if not interaction.guild:
        await interaction.response.send_message("This command only works in a server.", ephemeral=True)
        return None
    player = interaction.guild.voice_client
    if not isinstance(player, wavelink.Player):
        await interaction.response.send_message("Barracks Music is not connected to voice.", ephemeral=True)
        return None
    return player


async def join_player(interaction: discord.Interaction):
    if not interaction.guild:
        await interaction.response.send_message("This command only works in a server.", ephemeral=True)
        return None
    voice = getattr(interaction.user, "voice", None)
    if not voice or not voice.channel:
        await interaction.response.send_message("Join a voice channel first.", ephemeral=True)
        return None
    player = interaction.guild.voice_client
    if player:
        if isinstance(player, wavelink.Player) and player.channel != voice.channel:
            await interaction.response.send_message("I'm already in another voice channel.", ephemeral=True)
            return None
        return player if isinstance(player, wavelink.Player) else None
    return await voice.channel.connect(cls=wavelink.Player)


@bot.tree.command(name="play", description="Play a SoundCloud song or supported audio URL.")
@app_commands.describe(query="Song title or direct audio URL")
async def play(interaction: discord.Interaction, query: str):
    player = await join_player(interaction)
    if not player:
        if not interaction.response.is_done():
            await interaction.response.send_message("I couldn't join your voice channel.", ephemeral=True)
        return
    await interaction.response.defer()
    search = query if query.startswith(("http://", "https://")) else f"scsearch:{query}"
    try:
        tracks = await wavelink.Playable.search(search)
    except Exception:
        log.exception("Audio search failed")
        await interaction.followup.send("Search failed. Try a SoundCloud link or another title.")
        return
    if not tracks:
        await interaction.followup.send("No playable track found.")
        return
    track = tracks[0]
    if player.playing or player.paused:
        await player.queue.put_wait(track)
        await interaction.followup.send(f"Added to queue: **{track.title}**")
    else:
        await player.play(track)
        await interaction.followup.send(f"Now playing: **{track.title}**")


@bot.tree.command(name="pause", description="Pause playback.")
async def pause(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        await player.pause(True)
        await interaction.response.send_message("⏸️ Paused.")


@bot.tree.command(name="resume", description="Resume playback.")
async def resume(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        await player.pause(False)
        await interaction.response.send_message("▶️ Resumed.")


@bot.tree.command(name="skip", description="Skip the current song.")
async def skip(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        await player.skip()
        await interaction.response.send_message("⏭️ Skipped.")


@bot.tree.command(name="stop", description="Stop playback and clear the queue.")
async def stop(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        player.queue.clear()
        bot.repeat[interaction.guild.id] = False
        await player.stop()
        await interaction.response.send_message("⏹️ Stopped and cleared the queue.")


@bot.tree.command(name="queue", description="Show upcoming songs.")
async def queue(interaction: discord.Interaction):
    player = await active_player(interaction)
    if not player:
        return
    tracks = list(player.queue)
    if not tracks:
        await interaction.response.send_message("The queue is empty.")
        return
    lines = [f"**{i}.** {track.title}" for i, track in enumerate(tracks[:10], 1)]
    if len(tracks) > 10:
        lines.append(f"...and {len(tracks) - 10} more.")
    await interaction.response.send_message("🎶 **Barracks Music Queue**\n" + "\n".join(lines))


@bot.tree.command(name="nowplaying", description="Show the current song.")
async def nowplaying(interaction: discord.Interaction):
    player = await active_player(interaction)
    if not player:
        return
    if not player.current:
        await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        return
    track = player.current
    embed = discord.Embed(title="🎵 Now Playing", description=f"[{track.title}]({track.uri})")
    embed.add_field(name="Duration", value=f"{track.length // 1000} seconds")
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="volume", description="Set volume from 0 to 100.")
@app_commands.describe(level="Volume percentage")
async def volume(interaction: discord.Interaction, level: app_commands.Range[int, 0, 100]):
    player = await active_player(interaction)
    if player:
        await player.set_volume(level)
        await interaction.response.send_message(f"🔊 Volume: **{level}%**")


@bot.tree.command(name="loop", description="Toggle repeat for the current song.")
async def loop(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        guild_id = interaction.guild.id
        bot.repeat[guild_id] = not bot.repeat.get(guild_id, False)
        await interaction.response.send_message(
            f"🔁 Repeat is **{'on' if bot.repeat[guild_id] else 'off'}**."
        )


@bot.tree.command(name="leave", description="Disconnect from the voice channel.")
async def leave(interaction: discord.Interaction):
    player = await active_player(interaction)
    if player:
        player.queue.clear()
        bot.repeat[interaction.guild.id] = False
        await player.disconnect()
        await interaction.response.send_message("👋 Barracks Music left the voice channel.")


@bot.tree.command(name="help", description="Show available commands.")
async def help_command(interaction: discord.Interaction):
    embed = discord.Embed(
        title="🎖️ Barracks Music",
        description=(
            "Bringing Soldiers Together and Keeping the Barracks Alive!\n\n"
            "/play /pause /resume /skip /stop\n"
            "/queue /nowplaying /volume /loop /leave /help"
        ),
        color=discord.Color.dark_blue(),
    )
    await interaction.response.send_message(embed=embed)


if __name__ == "__main__":
    bot.run(env("DISCORD_TOKEN"))

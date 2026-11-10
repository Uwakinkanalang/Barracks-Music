import "dotenv/config";
import { createRequire } from "node:module";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  GatewayDispatchEvents, GatewayIntentBits, MessageFlags, SlashCommandBuilder
} from "discord.js";

const require = createRequire(import.meta.url);
const { Riffy } = require("riffy");

const token = process.env.DISCORD_TOKEN;
const host = process.env.LAVALINK_HOST;
const password = process.env.LAVALINK_PASSWORD;
const port = Number(process.env.LAVALINK_PORT || 2333);
if (!token || !host || !password) throw new Error("Set DISCORD_TOKEN, LAVALINK_HOST, and LAVALINK_PASSWORD.");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const states = new Map();
const IDLE_MS = 30000;

function state(id) {
  if (!states.has(id)) states.set(id, { volume: 75, loop: "none", stay: false, panelId: null, channelId: null, timer: null, autoPaused: false });
  return states.get(id);
}
function player(id) { return client.riffy.players.get(id) || null; }
function makeEmbed(title, description) { return new EmbedBuilder().setColor(0x263b58).setTitle(title).setDescription(description); }
function fmt(ms) {
  if (!ms) return "Live";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? String(h).padStart(2,"0") + ":" : "") + String(m).padStart(2,"0") + ":" + String(r).padStart(2,"0");
}
function panelButtons(p, s) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bm_pause").setLabel("Pause").setEmoji("⏸️").setStyle(ButtonStyle.Primary).setDisabled(!!p.paused),
      new ButtonBuilder().setCustomId("bm_resume").setLabel("Resume").setEmoji("▶️").setStyle(ButtonStyle.Success).setDisabled(!p.paused),
      new ButtonBuilder().setCustomId("bm_skip").setLabel("Skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bm_stop").setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bm_loop").setLabel("Loop: " + s.loop).setEmoji("🔁").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bm_vol_down").setLabel("Vol -").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bm_vol_up").setLabel("Vol +").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bm_shuffle").setLabel("Shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bm_queue").setLabel("Queue").setEmoji("📋").setStyle(ButtonStyle.Secondary)
    )
  ];
}
function nowEmbed(p, s) {
  const t = p.current, i = t.info || {};
  const e = makeEmbed("🎵 Now Playing", "**" + (i.title || "Unknown track") + "**");
  e.addFields(
    { name: "Artist", value: i.author || "Unknown", inline: true },
    { name: "Requester", value: i.requester?.username || "Unknown", inline: true },
    { name: "Progress", value: fmt(p.position) + " / " + fmt(i.length), inline: true },
    { name: "Volume", value: s.volume + "%", inline: true },
    { name: "Loop", value: s.loop, inline: true },
    { name: "Queue", value: String(p.queue.length) + " track(s)", inline: true }
  );
  const art = i.artworkUrl || i.thumbnail;
  if (art) e.setThumbnail(art);
  return e.setFooter({ text: "Barracks Music • Bringing Soldiers Together" });
}
async function refreshPanel(guildId) {
  const p = player(guildId), s = state(guildId);
  if (!p?.current || !s.channelId) return;
  const ch = await client.channels.fetch(s.channelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const payload = { embeds: [nowEmbed(p, s)], components: panelButtons(p, s) };
  if (s.panelId) {
    const old = await ch.messages.fetch(s.panelId).catch(() => null);
    if (old) return old.edit(payload).catch(() => null);
  }
  const msg = await ch.send(payload).catch(() => null);
  if (msg) s.panelId = msg.id;
}
async function clearPanel(id) {
  const s = state(id);
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  if (s.panelId && s.channelId) {
    const ch = await client.channels.fetch(s.channelId).catch(() => null);
    const msg = await ch?.messages.fetch(s.panelId).catch(() => null);
    await msg?.delete().catch(() => null);
  }
  s.panelId = null;
}
function voiceChannel(interaction) {
  const ch = interaction.member?.voice?.channel;
  if (!ch) throw new Error("Join a voice channel first.");
  const perms = ch.permissionsFor(interaction.guild.members.me);
  if (!perms?.has(["Connect", "Speak"])) throw new Error("I need Connect and Speak permissions.");
  return ch;
}
function sameVoice(interaction, p) {
  if (!interaction.member?.voice?.channel || interaction.member.voice.channel.id !== p?.voiceChannel) {
    throw new Error("Join my voice channel to control playback.");
  }
}
function connectedNode() {
  if (![...client.riffy.nodeMap.values()].some(n => n.connected)) throw new Error("Lavalink is not connected. Try again shortly.");
}
async function getOrCreatePlayer(interaction) {
  connectedNode();
  const voice = voiceChannel(interaction), s = state(interaction.guildId);
  let p = player(interaction.guildId);
  if (p && p.voiceChannel !== voice.id) { p.destroy(); p = null; }
  if (!p) {
    p = client.riffy.createConnection({ guildId: interaction.guildId, voiceChannel: voice.id, textChannel: interaction.channelId, deaf: true });
    s.channelId = interaction.channelId;
  }
  p.setVolume(s.volume);
  return p;
}
async function play(interaction, query) {
  const p = await getOrCreatePlayer(interaction), s = state(interaction.guildId);
  const result = await client.riffy.resolve({ query, requester: interaction.user });
  const type = String(result.loadType || "").toLowerCase(), tracks = result.tracks || [];
  if (type.includes("playlist")) {
    for (const t of tracks) { t.info.requester = interaction.user; p.queue.add(t); }
    s.channelId = interaction.channelId;
    if (!p.playing && !p.paused) await p.play();
    return "Added " + tracks.length + " tracks from " + (result.playlistInfo?.name || "playlist") + ".";
  }
  const t = tracks[0];
  if (!t) throw new Error("No playable track found. Try another title or link.");
  t.info.requester = interaction.user;
  p.queue.add(t);
  const start = !p.playing && !p.paused;
  if (start) await p.play();
  s.channelId = interaction.channelId;
  return (start ? "Now playing: " : "Added to queue: ") + "**" + t.info.title + "**";
}
async function action(interaction, name, value) {
  const p = player(interaction.guildId), s = state(interaction.guildId);
  if (!p) throw new Error("No active music player. Use /play first.");
  sameVoice(interaction, p);
  switch (name) {
    case "pause": if (!p.current || p.paused) throw new Error("Nothing is playing or it is already paused."); p.pause(true); return "Paused.";
    case "resume": if (!p.current || !p.paused) throw new Error("Playback is not paused."); p.pause(false); return "Resumed.";
    case "skip": if (!p.current) throw new Error("Nothing is playing."); if (p.loop === "track") p.setLoop("none"); p.stop(); return "Skipped.";
    case "stop": p.queue.clear(); p.stop(); p.destroy(); await clearPanel(interaction.guildId); return "Stopped and cleared the queue.";
    case "shuffle": if (!p.queue.length) throw new Error("The queue is empty."); p.queue.shuffle(); return "Queue shuffled.";
    case "loop": s.loop = value; p.setLoop(value); return "Loop mode: " + value;
    case "volume": s.volume = Math.max(0, Math.min(100, value)); p.setVolume(s.volume); return "Volume: " + s.volume + "%";
    case "seek": if (!p.current || p.current.info?.isSeekable === false) throw new Error("This track cannot be seeked."); p.seek(value * 1000); return "Seeked to " + value + " seconds.";
    case "remove": if (value < 1 || value > p.queue.length) throw new Error("Invalid queue position."); { const removed = p.queue.splice(value - 1, 1)[0]; return "Removed " + removed.info.title; }
    case "move": if (value.from < 1 || value.from > p.queue.length || value.to < 1 || value.to > p.queue.length) throw new Error("Invalid queue positions."); { const t = p.queue.splice(value.from - 1, 1)[0]; p.queue.splice(value.to - 1, 0, t); return "Moved " + t.info.title + " to position " + value.to; }
    case "clear": p.queue.clear(); return "Queue cleared.";
    case "leave": p.queue.clear(); p.destroy(); await clearPanel(interaction.guildId); return "Left the voice channel.";
    case "247": s.stay = Boolean(value); return "24/7 mode " + (s.stay ? "enabled." : "disabled.");
    default: throw new Error("Unknown music command.");
  }
}
function commands() {
  const playCmd = new SlashCommandBuilder().setName("play").setDescription("Play a song, YouTube link, or playlist")
    .addStringOption(o => o.setName("query").setDescription("Song title or URL").setRequired(true));
  const joinCmd = new SlashCommandBuilder().setName("join").setDescription("Join your voice channel");
  const queueCmd = new SlashCommandBuilder().setName("queue").setDescription("Show the music queue");
  const nowCmd = new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track");
  const musicCmd = new SlashCommandBuilder().setName("music").setDescription("Music player controls")
    .addSubcommand(x => x.setName("pause").setDescription("Pause"))
    .addSubcommand(x => x.setName("resume").setDescription("Resume"))
    .addSubcommand(x => x.setName("skip").setDescription("Skip"))
    .addSubcommand(x => x.setName("stop").setDescription("Stop and clear queue"))
    .addSubcommand(x => x.setName("shuffle").setDescription("Shuffle queue"))
    .addSubcommand(x => x.setName("loop").setDescription("Loop mode").addStringOption(o => o.setName("mode").setDescription("Mode").setRequired(true).addChoices({name:"Off",value:"none"},{name:"Track",value:"track"},{name:"Queue",value:"queue"})))
    .addSubcommand(x => x.setName("volume").setDescription("Set volume").addIntegerOption(o => o.setName("level").setDescription("0-100").setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand(x => x.setName("seek").setDescription("Seek in seconds").addIntegerOption(o => o.setName("seconds").setDescription("Seconds").setMinValue(0).setRequired(true)))
    .addSubcommand(x => x.setName("remove").setDescription("Remove queued track").addIntegerOption(o => o.setName("position").setDescription("Queue position").setMinValue(1).setRequired(true)))
    .addSubcommand(x => x.setName("move").setDescription("Move queued track").addIntegerOption(o => o.setName("from").setDescription("From").setMinValue(1).setRequired(true)).addIntegerOption(o => o.setName("to").setDescription("To").setMinValue(1).setRequired(true)))
    .addSubcommand(x => x.setName("clear").setDescription("Clear queue"))
    .addSubcommand(x => x.setName("leave").setDescription("Leave voice channel"))
    .addSubcommand(x => x.setName("247").setDescription("Toggle 24/7 mode").addBooleanOption(o => o.setName("enabled").setDescription("Enabled").setRequired(true)));
  return [playCmd, joinCmd, queueCmd, nowCmd, musicCmd].map(c => c.toJSON());
}
async function runCommand(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (i.commandName === "play") return i.editReply("🎶 " + await play(i, i.options.getString("query", true)));
    if (i.commandName === "join") {
      const p = await getOrCreatePlayer(i);
      return i.editReply("Joined <#" + p.voiceChannel + ">.");
    }
    if (i.commandName === "queue") {
      const p = player(i.guildId);
      if (!p) throw new Error("The queue is empty.");
      const lines = [...p.queue].slice(0, 15).map((t, n) => (n + 1) + ". " + t.info.title);
      return i.editReply("📋 **Barracks Music Queue**\n" + (p.current ? "**Now playing:** " + p.current.info.title + "\n\n" : "") + (lines.join("\n") || "No upcoming tracks."));
    }
    if (i.commandName === "nowplaying") {
      const p = player(i.guildId);
      if (!p?.current) throw new Error("Nothing is playing.");
      return i.editReply({ content: null, embeds: [nowEmbed(p, state(i.guildId))] });
    }
    if (i.commandName === "music") {
      const sub = i.options.getSubcommand();
      let value;
      if (sub === "loop") value = i.options.getString("mode");
      if (sub === "volume") value = i.options.getInteger("level");
      if (sub === "seek") value = i.options.getInteger("seconds");
      if (sub === "remove") value = i.options.getInteger("position");
      if (sub === "move") value = { from: i.options.getInteger("from"), to: i.options.getInteger("to") };
      if (sub === "247") value = i.options.getBoolean("enabled");
      const result = await action(i, sub, value);
      await refreshPanel(i.guildId);
      return i.editReply(result);
    }
  } catch (e) { return i.editReply("⚠️ " + (e.message || "Music command failed.")); }
}
async function runButton(i) {
  try {
    const p = player(i.guildId);
    if (!p) {
      // A panel can outlive its Lavalink player after a bot restart or an idle disconnect.
      // Expire the stale controls instead of returning a confusing "No active player" error.
      await i.update({
        content: "⏳ This music control panel has expired. Join a voice channel and use **/play** to start a new session.",
        embeds: [],
        components: []
      }).catch(() => null);
      return;
    }
    sameVoice(i, p);
    const name = i.customId.slice(3);
    if (name === "queue") {
      const lines = [...p.queue].slice(0, 15).map((t, n) => (n + 1) + ". " + t.info.title);
      return i.reply({ content: lines.join("\n") || "Queue is empty.", flags: MessageFlags.Ephemeral });
    }
    if (name === "loop") {
      const s = state(i.guildId); s.loop = s.loop === "none" ? "track" : s.loop === "track" ? "queue" : "none"; p.setLoop(s.loop);
    } else if (name === "vol_up" || name === "vol_down") {
      const s = state(i.guildId); s.volume = Math.max(0, Math.min(100, s.volume + (name === "vol_up" ? 10 : -10))); p.setVolume(s.volume);
    } else if (name === "shuffle") p.queue.shuffle();
    else if (name === "pause") p.pause(true);
    else if (name === "resume") p.pause(false);
    else if (name === "skip") { if (p.loop === "track") p.setLoop("none"); p.stop(); }
    else if (name === "stop") { p.queue.clear(); p.stop(); p.destroy(); await clearPanel(i.guildId); }
    await i.deferUpdate();
    await refreshPanel(i.guildId);
  } catch (e) {
    const payload = { content: "⚠️ " + e.message, flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.followUp(payload).catch(() => null);
    else await i.reply(payload).catch(() => null);
  }
}

client.riffy = new Riffy(client, [{
  name: process.env.LAVALINK_NAME || "Barracks-Lavalink",
  host, port, password,
  secure: String(process.env.LAVALINK_SECURE || "false").toLowerCase() === "true"
}], {
  send: payload => {
    const id = payload.d?.guild_id;
    const guild = id ? client.guilds.cache.get(id) : null;
    if (guild?.shard) guild.shard.send(payload);
    else if (id) {
      const shardId = Number((BigInt(id) >> 22n) % BigInt(client.ws.shards.size || 1));
      client.ws.shards.get(shardId)?.send(payload);
    }
  },
  defaultSearchPlatform: process.env.LAVALINK_SEARCH_PLATFORM || "ytmsearch",
  restVersion: "v4"
});
client.on("raw", packet => {
  if ([GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(packet.t)) client.riffy.updateVoiceState(packet);
});
client.riffy.on("nodeConnect", node => console.log("[Lavalink] " + node.name + " connected."));
client.riffy.on("nodeError", (node, error) => console.error("[Lavalink] " + node.name + ": " + error.message));
client.riffy.on("trackStart", async (p, track) => {
  const s = state(p.guildId);
  if (s.loop && p.loop !== s.loop) p.setLoop(s.loop);
  s.channelId = p.textChannel || s.channelId;
  await refreshPanel(p.guildId);
  if (s.timer) clearInterval(s.timer);
  s.timer = setInterval(() => refreshPanel(p.guildId), 15000);
  console.log("[Music] Now playing: " + track.info.title);
});
client.riffy.on("queueEnd", async p => {
  const s = state(p.guildId);
  await clearPanel(p.guildId);
  if (!s.stay) setTimeout(() => {
    const current = player(p.guildId);
    if (current && !current.playing && !current.paused && !current.current) current.destroy();
  }, IDLE_MS);
});
client.riffy.on("trackError", (p, track, payload) => {
  console.error("[Music] Track error: " + (track?.info?.title || "unknown"), payload?.error || payload);
  const channelId = state(p.guildId).channelId || p.textChannel;
  client.channels.fetch(channelId).then(ch => ch?.send("⚠️ Failed to play " + (track?.info?.title || "track") + ". Skipping...")).catch(() => null);
});
client.riffy.on("trackStuck", (p, track, payload) => console.warn("[Music] Track stuck: " + track?.info?.title + " (" + payload?.thresholdMs + "ms)"));
client.once("ready", async () => {
  client.riffy.init(client.user.id);
  const list = commands();
  await client.application.commands.set(list);
  console.log("Barracks Music online as " + client.user.tag + "; synced " + list.length + " commands.");
});
client.on("interactionCreate", i => {
  if (i.isChatInputCommand()) return runCommand(i);
  if (i.isButton() && i.customId.startsWith("bm_")) return runButton(i);
});
client.on("voiceStateUpdate", (oldState, newState) => {
  const p = player(newState.guild.id);
  if (!p?.voiceChannel) return;
  const channel = newState.guild.channels.cache.get(p.voiceChannel);
  if (!channel) return;
  const humans = channel.members.filter(m => !m.user.bot).size;
  const s = state(newState.guild.id);
  if (!humans && p.playing && !p.paused) { s.autoPaused = true; p.pause(true); }
  else if (humans && s.autoPaused && p.paused) { s.autoPaused = false; p.pause(false); }
});
async function shutdown() {
  console.log("Shutting down Barracks Music...");
  for (const s of states.values()) if (s.timer) clearInterval(s.timer);
  for (const p of client.riffy.players.values()) p.destroy();
  client.destroy();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
client.login(token);

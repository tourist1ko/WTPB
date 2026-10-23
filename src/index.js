import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { ScheduleService } from './schedule.js';
import { command, handleInteraction } from './command.js';
import { RatingStore } from './rating.js';
import { LiveBattles } from './wtapi-live.js';
import { ArchiveBattles } from './tactical-live.js';
import { SeasonUpdate } from './season-update.js';
import { RequestLimiter, enforceRateLimit } from './rate-limit.js';
import { handleRankPage } from './rank-pages.js';
import { SquadronSuggestions, handleSquadronAutocomplete, suggestionsFile } from './squadron-autocomplete.js';
const suggestions=new SquadronSuggestions({file:suggestionsFile()});
import { rankCommand, registerOption, unregisterOption, importOption, statusOption, statOption, handleRank } from './rank-command.js';
const store=new RatingStore((process.env.DATA_DIR || './storage')+'/rank.sqlite');
command.options.push(registerOption,unregisterOption,importOption,statusOption,statOption);

const token = process.env.DISCORD_TOKEN?.trim();
const guildId = process.env.GUILD_ID?.trim();
if (!token || !/^\d{17,22}$/.test(guildId ?? '')) {
  console.error('Set DISCORD_TOKEN and GUILD_ID in Railway Variables. GUILD_ID is the Discord server ID.');
  process.exit(1);
}
function logError(context, error) {
  console.error(`${context}: ${String(error.message ?? error).replaceAll(token, '[REDACTED]')}`);
}
const service = new ScheduleService();
const client = new Client({intents:[GatewayIntentBits.Guilds], allowedMentions:{parse:[]}});
const statsSource=process.env.STATS_SOURCE?.trim()||'tactical';
if(!['tactical','wtapi'].includes(statsSource)){console.error('STATS_SOURCE must be tactical or wtapi.');process.exit(1);}
const live=statsSource==='wtapi'?new LiveBattles({key:process.env.WTAPI_KEY?.trim(),store,client,guildId}):new ArchiveBattles({store,client,guildId});
const seasons=new SeasonUpdate({store,guildId,service,live});
live.onBattle=battle=>seasons.apply(battle);
const rest = new REST({version:'10'}).setToken(token);
const requestLimiter=new RequestLimiter();

client.on(Events.InteractionCreate, interaction => {
  (async()=>{if(await enforceRateLimit(interaction,guildId,requestLimiter))return;if(await handleSquadronAutocomplete(interaction,store,guildId,suggestions))return;if(await handleRankPage(interaction,store,guildId,seasons))return;if(!await handleRank(interaction,store,guildId,undefined,suggestions,live,seasons))await handleInteraction(interaction, service, guildId);})().catch(async error => {
    logError('Command failed', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Не удалось получить БР. Попробуй ещё раз.').catch(() => {});
    }
  });
});
client.on(Events.Error, error => logError('Discord', error));

let timer;
client.once(Events.ClientReady, async readyClient => {
  try {
    // Replace the complete guild command set so removed commands disappear.
    await rest.put(Routes.applicationGuildCommands(readyClient.application.id, guildId), {
      body: [command, rankCommand],
    });
    // This bot uses guild commands. Clear legacy global registrations too.
    await rest.put(Routes.applicationCommands(readyClient.application.id), { body: [] });
    console.log(`Ready: ${readyClient.user.tag}. /pb and /rank synchronized for server ${guildId}. Legacy global commands cleared.`);
    void service.refresh();
    live.start();
    timer = setInterval(() => { void service.refresh(); }, 3600000);
    timer.unref();
  } catch (error) {
    logError('Command registration failed. Check GUILD_ID and bot membership', error);
    client.destroy();
    process.exit(1);
  }
});
for (const signal of ['SIGTERM','SIGINT']) {
  process.once(signal, () => {
    clearInterval(timer);
    live.stop();
    seasons.stop();
    client.destroy();
    process.exit(0);
  });
}
try { await client.login(token); }
catch (error) { logError('Discord login failed', error); process.exit(1); }

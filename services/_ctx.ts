/**
 * Caller context — the single abstraction that makes services client-agnostic.
 *
 * Every service takes `ctx` as its first argument. Two paths build it:
 *  - Discord command:  ctx = { discordId: interaction.user.id }
 *  - Website (HTTP):   resolved from the Bearer JWT by api/middleware/auth
 *
 * Services never import discord.js or know which client called them.
 */
export interface Ctx {
    /** Discord user snowflake — the identity everything keys off (players.discord_id). */
    discordId: string;
    /** Reserved for DM-scoped actions (combat setup). Set where the caller is known to be the DM. */
    role?: 'DM';
    /** Guilds where an OAuth-authenticated caller has Manage Guild or Administrator. */
    dmGuildIds?: string[];
}

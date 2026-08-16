import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { campaignRecords, campaignWorlds } from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    CAMPAIGN_RECORD_KINDS,
    addEncounterEntry,
    addQuestObjective,
    advanceWorldTime,
    createQuestData,
    normalizeName,
    normalizeText,
    normalizeWorldTime,
    randomWeather,
    rollEncounter,
    setQuestObjective,
    type CampaignRecordKind,
} from '../utils/campaignUtils';
import type { Ctx } from './_ctx';
import { requireDmGuild } from './guildAuth';

const MAX_RECORDS_PER_KIND = 100;

function asValidationError(error: unknown): never {
    if (error instanceof Error) throw httpError(400, error.message);
    throw httpError(400, 'Invalid campaign data');
}

function validateKind(kind: string): CampaignRecordKind {
    if (!CAMPAIGN_RECORD_KINDS.includes(kind as CampaignRecordKind))
        throw httpError(400, 'Invalid campaign record kind');
    return kind as CampaignRecordKind;
}

async function emitCampaignUpdate(
    guildId: string,
    action: string,
    record?: { id: string; kind: string; name: string }
) {
    try {
        const { dispatchWebhookEvent } = await import('./webhooks');
        await dispatchWebhookEvent(guildId, 'campaign.updated', { action, record });
    } catch {
        // Webhook delivery is best-effort and must never make campaign persistence fail.
    }
}

export async function createCampaignRecord(
    ctx: Ctx,
    input: {
        guildId: string;
        kind: CampaignRecordKind;
        name: string;
        status?: string;
        data?: Record<string, unknown>;
    }
) {
    const guildId = requireDmGuild(ctx, input.guildId);
    const kind = validateKind(input.kind);
    let name: string;
    try {
        name = normalizeName(input.name);
    } catch (error) {
        return asValidationError(error);
    }
    const existing = await db
        .select({ id: campaignRecords.id })
        .from(campaignRecords)
        .where(and(eq(campaignRecords.guild_id, guildId), eq(campaignRecords.kind, kind)))
        .limit(MAX_RECORDS_PER_KIND);
    if (existing.length >= MAX_RECORDS_PER_KIND) {
        throw httpError(409, `A server can save at most ${MAX_RECORDS_PER_KIND} ${kind.toLowerCase()} records`);
    }
    const duplicate = await db
        .select({ id: campaignRecords.id })
        .from(campaignRecords)
        .where(
            and(eq(campaignRecords.guild_id, guildId), eq(campaignRecords.kind, kind), eq(campaignRecords.name, name))
        )
        .limit(1);
    if (duplicate.length) throw httpError(409, `${name} already exists`);
    const [record] = await db
        .insert(campaignRecords)
        .values({
            guild_id: guildId,
            kind,
            name,
            status: (input.status || 'ACTIVE').toUpperCase(),
            data: input.data || {},
            created_by_discord_id: ctx.discordId,
            updated_by_discord_id: ctx.discordId,
        })
        .returning();
    await emitCampaignUpdate(guildId, 'created', record);
    return record;
}

export async function listCampaignRecords(ctx: Ctx, guildId: string, kind: CampaignRecordKind) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    validateKind(kind);
    return db
        .select()
        .from(campaignRecords)
        .where(and(eq(campaignRecords.guild_id, scopedGuildId), eq(campaignRecords.kind, kind)))
        .orderBy(asc(campaignRecords.name))
        .limit(MAX_RECORDS_PER_KIND);
}

export async function getCampaignRecord(ctx: Ctx, guildId: string, recordId: string, kind?: CampaignRecordKind) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    const conditions = [eq(campaignRecords.guild_id, scopedGuildId), eq(campaignRecords.id, recordId)];
    if (kind) conditions.push(eq(campaignRecords.kind, validateKind(kind)));
    const [record] = await db
        .select()
        .from(campaignRecords)
        .where(and(...conditions))
        .limit(1);
    if (!record) throw httpError(404, 'Campaign record not found');
    return record;
}

export async function updateCampaignRecord(
    ctx: Ctx,
    input: {
        guildId: string;
        recordId: string;
        kind?: CampaignRecordKind;
        name?: string;
        status?: string;
        data?: Record<string, unknown>;
    }
) {
    const existing = await getCampaignRecord(ctx, input.guildId, input.recordId, input.kind);
    let name = input.name;
    try {
        if (name !== undefined) name = normalizeName(name);
    } catch (error) {
        return asValidationError(error);
    }
    const [record] = await db
        .update(campaignRecords)
        .set({
            ...(name === undefined ? {} : { name }),
            ...(input.status === undefined ? {} : { status: input.status.toUpperCase() }),
            ...(input.data === undefined ? {} : { data: input.data }),
            updated_by_discord_id: ctx.discordId,
            updated_at: new Date(),
        })
        .where(and(eq(campaignRecords.id, existing.id), eq(campaignRecords.updated_at, existing.updated_at)))
        .returning();
    if (!record) throw httpError(409, 'Campaign record changed; retry the command');
    await emitCampaignUpdate(existing.guild_id, 'updated', record);
    return record;
}

export async function deleteCampaignRecord(ctx: Ctx, guildId: string, recordId: string, kind?: CampaignRecordKind) {
    const existing = await getCampaignRecord(ctx, guildId, recordId, kind);
    const [deleted] = await db.delete(campaignRecords).where(eq(campaignRecords.id, existing.id)).returning();
    await emitCampaignUpdate(existing.guild_id, 'deleted', existing);
    return deleted;
}

export async function createQuest(
    ctx: Ctx,
    input: { guildId: string; name: string; summary?: string; objectives?: string[] }
) {
    try {
        return await createCampaignRecord(ctx, {
            guildId: input.guildId,
            kind: 'QUEST',
            name: input.name,
            data: createQuestData(input.summary || '', input.objectives),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export async function addObjective(ctx: Ctx, guildId: string, questId: string, text: string) {
    const quest = await getCampaignRecord(ctx, guildId, questId, 'QUEST');
    try {
        return await updateCampaignRecord(ctx, {
            guildId,
            recordId: quest.id,
            kind: 'QUEST',
            data: addQuestObjective(quest.data, text),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export async function setObjectiveStatus(
    ctx: Ctx,
    guildId: string,
    questId: string,
    objectiveId: string,
    completed: boolean
) {
    const quest = await getCampaignRecord(ctx, guildId, questId, 'QUEST');
    try {
        return await updateCampaignRecord(ctx, {
            guildId,
            recordId: quest.id,
            kind: 'QUEST',
            data: setQuestObjective(quest.data, objectiveId, completed),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export async function createEncounterTable(ctx: Ctx, guildId: string, name: string, description?: string) {
    let normalizedDescription: string;
    try {
        normalizedDescription = normalizeText(description, 'description', 1000);
    } catch (error) {
        return asValidationError(error);
    }
    return createCampaignRecord(ctx, {
        guildId,
        kind: 'ENCOUNTER_TABLE',
        name,
        data: { description: normalizedDescription, entries: [] },
    });
}

export async function addEncounter(
    ctx: Ctx,
    input: { guildId: string; tableId: string; name: string; weight?: number; details?: string }
) {
    const table = await getCampaignRecord(ctx, input.guildId, input.tableId, 'ENCOUNTER_TABLE');
    try {
        return await updateCampaignRecord(ctx, {
            guildId: input.guildId,
            recordId: table.id,
            kind: 'ENCOUNTER_TABLE',
            data: addEncounterEntry(table.data, input),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export async function drawEncounter(ctx: Ctx, guildId: string, tableId: string, random = Math.random) {
    const table = await getCampaignRecord(ctx, guildId, tableId, 'ENCOUNTER_TABLE');
    try {
        return { table, entry: rollEncounter(table.data, random) };
    } catch (error) {
        return asValidationError(error);
    }
}

export async function getWorldState(ctx: Ctx, guildId: string) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    const [existing] = await db
        .select()
        .from(campaignWorlds)
        .where(eq(campaignWorlds.guild_id, scopedGuildId))
        .limit(1);
    if (existing) return existing;
    const [created] = await db
        .insert(campaignWorlds)
        .values({ guild_id: scopedGuildId, updated_by_discord_id: ctx.discordId })
        .returning();
    return created;
}

export async function setWorldState(
    ctx: Ctx,
    input: { guildId: string; currentTime?: string; weather?: string; randomizeWeather?: boolean }
) {
    const existing = await getWorldState(ctx, input.guildId);
    try {
        const currentTime = input.currentTime ? normalizeWorldTime(input.currentTime) : existing.current_time;
        const weather = input.randomizeWeather
            ? randomWeather()
            : input.weather === undefined
              ? existing.weather
              : normalizeText(input.weather, 'weather', 100, true);
        const [updated] = await db
            .update(campaignWorlds)
            .set({ current_time: currentTime, weather, updated_by_discord_id: ctx.discordId, updated_at: new Date() })
            .where(eq(campaignWorlds.guild_id, existing.guild_id))
            .returning();
        await emitCampaignUpdate(existing.guild_id, 'world-updated');
        return updated;
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export async function advanceCampaignTime(
    ctx: Ctx,
    input: { guildId: string; amount: number; unit: 'MINUTES' | 'HOURS' | 'DAYS' }
) {
    const existing = await getWorldState(ctx, input.guildId);
    try {
        return setWorldState(ctx, {
            guildId: input.guildId,
            currentTime: advanceWorldTime(existing.current_time, input.amount, input.unit).toISOString(),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return asValidationError(error);
    }
}

export interface CampaignBackup {
    format: 'dsanewbot-campaign-v1';
    exportedAt: string;
    records: Array<{ kind: CampaignRecordKind; name: string; status: string; data: Record<string, unknown> }>;
    world: { currentTime: string; weather: string } | null;
}

export async function createCampaignBackup(ctx: Ctx, guildId: string): Promise<CampaignBackup> {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    const [records, world] = await Promise.all([
        db
            .select({
                kind: campaignRecords.kind,
                name: campaignRecords.name,
                status: campaignRecords.status,
                data: campaignRecords.data,
            })
            .from(campaignRecords)
            .where(eq(campaignRecords.guild_id, scopedGuildId))
            .orderBy(asc(campaignRecords.kind), asc(campaignRecords.name)),
        db.select().from(campaignWorlds).where(eq(campaignWorlds.guild_id, scopedGuildId)).limit(1),
    ]);
    return {
        format: 'dsanewbot-campaign-v1',
        exportedAt: new Date().toISOString(),
        records: records.map(record => ({ ...record, kind: validateKind(record.kind) })),
        world: world[0] ? { currentTime: world[0].current_time.toISOString(), weather: world[0].weather } : null,
    };
}

export async function restoreCampaignBackup(
    ctx: Ctx,
    guildId: string,
    raw: unknown,
    mode: 'MERGE' | 'REPLACE' = 'MERGE'
) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    if (!raw || typeof raw !== 'object') throw httpError(400, 'Backup must be a JSON object');
    const backup = raw as Partial<CampaignBackup>;
    if (backup.format !== 'dsanewbot-campaign-v1' || !Array.isArray(backup.records)) {
        throw httpError(400, 'Unsupported campaign backup format');
    }
    if (backup.records.length > CAMPAIGN_RECORD_KINDS.length * MAX_RECORDS_PER_KIND) {
        throw httpError(400, 'Backup contains too many campaign records');
    }
    const records = backup.records.map(record => {
        try {
            return {
                kind: validateKind(record.kind),
                name: normalizeName(record.name),
                status: normalizeName(record.status || 'ACTIVE', 'status', 40).toUpperCase(),
                data: record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data : {},
            };
        } catch (error) {
            return asValidationError(error);
        }
    });
    let world: { currentTime: Date; weather: string } | null = null;
    if (backup.world) {
        try {
            world = {
                currentTime: normalizeWorldTime(backup.world.currentTime),
                weather: normalizeText(backup.world.weather, 'weather', 100, true),
            };
        } catch (error) {
            return asValidationError(error);
        }
    }
    await db.transaction(async tx => {
        if (mode === 'REPLACE') {
            await tx.delete(campaignRecords).where(eq(campaignRecords.guild_id, scopedGuildId));
            await tx.delete(campaignWorlds).where(eq(campaignWorlds.guild_id, scopedGuildId));
        }
        for (const record of records) {
            await tx
                .insert(campaignRecords)
                .values({
                    guild_id: scopedGuildId,
                    ...record,
                    created_by_discord_id: ctx.discordId,
                    updated_by_discord_id: ctx.discordId,
                })
                .onConflictDoUpdate({
                    target: [campaignRecords.guild_id, campaignRecords.kind, campaignRecords.name],
                    set: {
                        status: record.status,
                        data: record.data,
                        updated_by_discord_id: ctx.discordId,
                        updated_at: new Date(),
                    },
                });
        }
        if (world) {
            await tx
                .insert(campaignWorlds)
                .values({
                    guild_id: scopedGuildId,
                    current_time: world.currentTime,
                    weather: world.weather,
                    updated_by_discord_id: ctx.discordId,
                })
                .onConflictDoUpdate({
                    target: campaignWorlds.guild_id,
                    set: {
                        current_time: world.currentTime,
                        weather: world.weather,
                        updated_by_discord_id: ctx.discordId,
                        updated_at: new Date(),
                    },
                });
        }
    });
    await emitCampaignUpdate(scopedGuildId, 'backup-restored');
    return { mode, records: records.length, world: Boolean(world) };
}

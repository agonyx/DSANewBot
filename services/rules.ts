/**
 * Rules search services — thin ctx-uniform wrappers over utils/rulesClient
 * (pgvector semantic search + exact title lookup over the rule knowledge base).
 * Rules are public reference data, so ctx is for signature uniformity only.
 *
 * `cache` (optional) is the in-memory page-title cache the Discord bot keeps
 * warm on the client (client.rulePageTitleCache). When omitted — e.g. the
 * website via /api/rules — the service loads titles from the DB itself.
 * No discord.js, no HTTP.
 */
import * as rulesClient from '../utils/rulesClient';
import { httpError } from '../db/operations/errors';
import type { Ctx } from './_ctx';

type TitleCache = Parameters<typeof rulesClient.hybridSearch>[1];

export interface SearchRulesInput {
    query: string;
    category?: string | null;
    limit?: number;
    threshold?: number;
    includeUnresolved?: boolean;
    cache?: TitleCache;
}

export async function searchRules(_ctx: Ctx, input: SearchRulesInput) {
    if (!input.query?.trim()) throw httpError(400, 'query is required');
    const cache = input.cache ?? (await rulesClient.getRulePageTitles());
    return rulesClient.hybridSearch(input.query, cache, {
        category: input.category ?? undefined,
        limit: input.limit ?? 3,
        threshold: input.threshold ?? 0.4,
        includeUnresolved: input.includeUnresolved ?? false,
    });
}

export async function getRulePage(_ctx: Ctx, docId: string) {
    const page = await rulesClient.fetchPageContent(docId);
    if (!page) throw httpError(404, 'Rule page not found');
    return page;
}

export async function suggestRuleTitles(
    _ctx: Ctx,
    input: { query: string; category?: string | null; cache?: TitleCache; limit?: number }
) {
    const cache = input.cache ?? (await rulesClient.getRulePageTitles());
    return rulesClient.getRankedTitleMatches(input.query ?? '', cache, {
        category: input.category ?? undefined,
        limit: input.limit ?? 25,
    });
}

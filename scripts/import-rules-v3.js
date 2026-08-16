require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const postgres = require('postgres');
const { buildChunkRow, buildLegacyRuleRow, buildPageRow } = require('../utils/ruleImportTransforms');

const DATA_DIR = path.join(__dirname, '../DSA5WikiScraper/dsa_scraper_v3/data');
const DOCS_FILE = path.join(DATA_DIR, 'embeddings/canonical_documents.jsonl');
const CHUNKS_FILE = path.join(DATA_DIR, 'embeddings/chunks.jsonl');
const EXPORT_SUMMARY_FILE = path.join(DATA_DIR, 'embeddings/export_summary.json');
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

let openai;
let supabase;
let postgresClient;

const PAGE_COLUMNS = [
    'doc_id',
    'source_item_id',
    'source_url',
    'url_hash',
    'canonical_slug',
    'title',
    'category',
    'resolved_category',
    'subcategory',
    'page_state',
    'is_unresolved',
    'resolution_confidence',
    'normalized_content',
    'content_hash',
    'parser_version',
    'scraper_version',
    'source_snapshot_at',
    'version',
    'metadata',
    'last_seen_at',
    'deleted_at',
];

const CHUNK_COLUMNS = [
    'chunk_id',
    'page_id',
    'version',
    'chunk_index',
    'title',
    'category',
    'resolved_category',
    'heading',
    'chunk_text',
    'char_start',
    'char_end',
    'embedding',
    'embedding_model',
    'embedded_at',
    'is_unresolved',
    'metadata',
    'is_active',
];

function resolveBackend(env = process.env) {
    if (env.DATABASE_URL) return 'postgres';
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) return 'supabase';
    throw new Error('DATABASE_URL or SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
}

function getSupabaseClient() {
    supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    return supabase;
}

function getPostgresClient() {
    postgresClient ??= postgres(process.env.DATABASE_URL, { max: 4 });
    return postgresClient;
}

function getOpenAiClient() {
    openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
}

function parseArgs(argv) {
    const args = {
        dryRun: false,
        includeUnresolved: false,
        legacyOnly: false,
        batchSize: 100,
        embeddingBatchSize: 50,
        forceReembed: false,
        docsFile: DOCS_FILE,
        chunksFile: CHUNKS_FILE,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--include-unresolved') {
            args.includeUnresolved = true;
        } else if (arg === '--legacy-only') {
            args.legacyOnly = true;
        } else if (arg === '--batch-size' && argv[index + 1]) {
            args.batchSize = Number.parseInt(argv[index + 1], 10);
            index += 1;
        } else if (arg === '--embedding-batch-size' && argv[index + 1]) {
            args.embeddingBatchSize = Number.parseInt(argv[index + 1], 10);
            index += 1;
        } else if (arg === '--force-reembed') {
            args.forceReembed = true;
        } else if (arg === '--docs-file' && argv[index + 1]) {
            args.docsFile = path.resolve(argv[index + 1]);
            index += 1;
        } else if (arg === '--chunks-file' && argv[index + 1]) {
            args.chunksFile = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    return args;
}

async function readJsonl(filePath) {
    const rows = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }

        rows.push(JSON.parse(line));
    }

    return rows;
}

function readExportSummary() {
    return JSON.parse(fs.readFileSync(EXPORT_SUMMARY_FILE, 'utf8'));
}

async function tableExists(tableName) {
    if (resolveBackend() === 'postgres') {
        const sql = getPostgresClient();
        const rows = await sql`select to_regclass(${`public.${tableName}`}) as relation`;
        return Boolean(rows[0]?.relation);
    }

    const { error } = await getSupabaseClient().from(tableName).select('*').limit(1);

    return !error || error.code !== 'PGRST205';
}

async function generateEmbeddings(texts, model = DEFAULT_EMBEDDING_MODEL) {
    const cleaned = texts.map(text =>
        String(text || '')
            .replace(/\n+/g, ' ')
            .trim()
            .substring(0, 8000)
    );
    let response;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            response = await getOpenAiClient().embeddings.create({
                model,
                input: cleaned,
                dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
            });
            break;
        } catch (error) {
            const retryable = error?.status === 429 || error?.status >= 500;
            if (!retryable || attempt === 5) throw error;

            const delayMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
            console.error(`Embedding request failed (${error.status}); retrying in ${delayMs}ms`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return response.data.map(item => item.embedding);
}

async function getExistingEmbeddedChunkIds(chunkIds) {
    if (resolveBackend() !== 'postgres' || !chunkIds.length) return new Set();

    const sql = getPostgresClient();
    const rows = await sql`
        select chunk_id
        from rule_chunks
        where chunk_id = any(${chunkIds})
          and embedding is not null
    `;
    return new Set(rows.map(row => row.chunk_id));
}

async function upsertBatch(tableName, rows, onConflict) {
    if (!rows.length) {
        return;
    }

    if (resolveBackend() === 'postgres') {
        const sql = getPostgresClient();

        if (tableName === 'rule_pages') {
            await sql`
                insert into rule_pages ${sql(rows, ...PAGE_COLUMNS)}
                on conflict (doc_id) do update set
                    source_item_id = excluded.source_item_id,
                    source_url = excluded.source_url,
                    url_hash = excluded.url_hash,
                    canonical_slug = excluded.canonical_slug,
                    title = excluded.title,
                    category = excluded.category,
                    resolved_category = excluded.resolved_category,
                    subcategory = excluded.subcategory,
                    page_state = excluded.page_state,
                    is_unresolved = excluded.is_unresolved,
                    resolution_confidence = excluded.resolution_confidence,
                    normalized_content = excluded.normalized_content,
                    content_hash = excluded.content_hash,
                    parser_version = excluded.parser_version,
                    scraper_version = excluded.scraper_version,
                    source_snapshot_at = excluded.source_snapshot_at,
                    version = excluded.version,
                    metadata = excluded.metadata,
                    last_seen_at = excluded.last_seen_at,
                    deleted_at = excluded.deleted_at,
                    updated_at = now()
            `;
            return;
        }

        if (tableName === 'rule_chunks') {
            const preparedRows = rows.map(row => ({
                ...row,
                embedding: `[${row.embedding.join(',')}]`,
            }));
            await sql`
                insert into rule_chunks ${sql(preparedRows, ...CHUNK_COLUMNS)}
                on conflict (chunk_id) do update set
                    page_id = excluded.page_id,
                    version = excluded.version,
                    chunk_index = excluded.chunk_index,
                    title = excluded.title,
                    category = excluded.category,
                    resolved_category = excluded.resolved_category,
                    heading = excluded.heading,
                    chunk_text = excluded.chunk_text,
                    char_start = excluded.char_start,
                    char_end = excluded.char_end,
                    embedding = excluded.embedding,
                    embedding_model = excluded.embedding_model,
                    embedded_at = excluded.embedded_at,
                    is_unresolved = excluded.is_unresolved,
                    metadata = excluded.metadata,
                    is_active = excluded.is_active,
                    updated_at = now()
            `;
            return;
        }

        throw new Error(`Unsupported Postgres import table: ${tableName}`);
    }

    const { error } = await getSupabaseClient().from(tableName).upsert(rows, {
        onConflict,
        ignoreDuplicates: false,
    });

    if (error) {
        throw error;
    }
}

function buildChunkCounts(chunks) {
    const counts = new Map();

    for (const chunk of chunks) {
        counts.set(chunk.doc_id, (counts.get(chunk.doc_id) || 0) + 1);
    }

    return counts;
}

function buildTitleCounts(docs) {
    const counts = new Map();

    for (const doc of docs) {
        const title = String(doc.title || doc.doc_id || 'Untitled Rule').trim();
        counts.set(title, (counts.get(title) || 0) + 1);
    }

    return counts;
}

function chunkArray(items, size) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function importStructured(docs, chunks, options, sourceSnapshotAt) {
    const pageRows = docs.map(doc => buildPageRow(doc, { sourceSnapshotAt }));

    if (options.dryRun) {
        return {
            mode: 'structured',
            pageCount: pageRows.length,
            chunkCount: chunks.length,
        };
    }

    for (const batch of chunkArray(pageRows, options.batchSize)) {
        await upsertBatch('rule_pages', batch, 'doc_id');
    }

    const docIds = pageRows.map(row => row.doc_id);
    const pageIdMap = new Map();

    if (resolveBackend() === 'postgres') {
        const sql = getPostgresClient();
        const storedPages = await sql`
            select id, doc_id, version
            from rule_pages
            where doc_id = any(${docIds})
        `;

        for (const row of storedPages) {
            pageIdMap.set(row.doc_id, { id: row.id, version: row.version || 1 });
        }
    } else {
        for (const batch of chunkArray(docIds, options.batchSize)) {
            const { data, error } = await getSupabaseClient()
                .from('rule_pages')
                .select('id, doc_id, version')
                .in('doc_id', batch);

            if (error) {
                throw error;
            }

            for (const row of data || []) {
                pageIdMap.set(row.doc_id, { id: row.id, version: row.version || 1 });
            }
        }
    }

    const existingChunkIds = options.forceReembed
        ? new Set()
        : await getExistingEmbeddedChunkIds(chunks.map(chunk => chunk.chunk_id));
    const pendingChunks = chunks.filter(chunk => !existingChunkIds.has(chunk.chunk_id));
    const batches = chunkArray(pendingChunks, options.embeddingBatchSize);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const embeddings = await generateEmbeddings(batch.map(row => row.chunk_text));
        const chunkRows = batch.map((chunk, index) => {
            const page = pageIdMap.get(chunk.doc_id);

            if (!page) {
                throw new Error(`Missing page row for doc_id ${chunk.doc_id}`);
            }

            return {
                ...buildChunkRow(chunk, page.id, { version: page.version || 1 }),
                embedding: embeddings[index],
                embedding_model: DEFAULT_EMBEDDING_MODEL,
                embedded_at: new Date().toISOString(),
            };
        });

        await upsertBatch('rule_chunks', chunkRows, 'chunk_id');

        if ((batchIndex + 1) % 10 === 0 || batchIndex + 1 === batches.length) {
            console.error(
                `Embedded ${Math.min((batchIndex + 1) * options.embeddingBatchSize, pendingChunks.length)}/${pendingChunks.length} pending chunks`
            );
        }
    }

    return {
        mode: 'structured',
        pageCount: pageRows.length,
        chunkCount: chunks.length,
        processedChunkCount: pendingChunks.length,
        skippedExistingChunkCount: existingChunkIds.size,
    };
}

async function importLegacy(docs, chunks, options, sourceSnapshotAt) {
    const docById = new Map(docs.map(doc => [doc.doc_id, doc]));
    const chunkCounts = buildChunkCounts(chunks);
    const titleCounts = buildTitleCounts(docs);

    if (options.dryRun) {
        return {
            mode: 'legacy',
            pageCount: docs.length,
            chunkCount: chunks.length,
        };
    }

    for (const batch of chunkArray(chunks, options.embeddingBatchSize)) {
        const embeddings = await generateEmbeddings(batch.map(row => row.chunk_text));

        for (let index = 0; index < batch.length; index += 1) {
            const chunk = batch[index];
            const doc = docById.get(chunk.doc_id);

            if (!doc) {
                throw new Error(`Missing canonical document for chunk ${chunk.chunk_id}`);
            }

            const row = buildLegacyRuleRow(doc, chunk, {
                totalChunks: chunkCounts.get(chunk.doc_id) || 1,
                duplicateTitleCount: titleCounts.get(String(doc.title || doc.doc_id || 'Untitled Rule').trim()) || 1,
                sourceSnapshotAt,
            });

            const { error } = await getSupabaseClient().rpc('upsert_rule', {
                p_title: row.title,
                p_content: row.content,
                p_embedding: embeddings[index],
                p_category: row.category,
                p_source_url: row.sourceUrl,
                p_metadata: row.metadata,
            });

            if (error) {
                throw error;
            }
        }
    }

    return {
        mode: 'legacy',
        pageCount: docs.length,
        chunkCount: chunks.length,
    };
}

async function main() {
    const backend = resolveBackend();

    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY must be set');
    }

    const options = parseArgs(process.argv.slice(2));
    const exportSummary = readExportSummary();
    const sourceSnapshotAt = exportSummary.generated_at || new Date().toISOString();

    const [allDocs, allChunks] = await Promise.all([readJsonl(options.docsFile), readJsonl(options.chunksFile)]);

    const docs = options.includeUnresolved ? allDocs : allDocs.filter(doc => !doc.is_unresolved);
    const allowedDocIds = new Set(docs.map(doc => doc.doc_id));
    const chunks = options.includeUnresolved
        ? allChunks
        : allChunks.filter(chunk => allowedDocIds.has(chunk.doc_id) && !chunk.is_unresolved);

    const hasRulePages = await tableExists('rule_pages');
    const hasRuleChunks = await tableExists('rule_chunks');
    const mode = !options.legacyOnly && hasRulePages && hasRuleChunks ? 'structured' : 'legacy';

    if (backend === 'postgres' && mode !== 'structured') {
        throw new Error('Postgres imports require the rule_pages and rule_chunks migrations');
    }

    const result =
        mode === 'structured'
            ? await importStructured(docs, chunks, options, sourceSnapshotAt)
            : await importLegacy(docs, chunks, options, sourceSnapshotAt);

    console.log(
        JSON.stringify(
            {
                ...result,
                dryRun: options.dryRun,
                includeUnresolved: options.includeUnresolved,
                expectedDocCount: exportSummary.doc_count,
                expectedChunkCount: exportSummary.chunk_count,
                expectedUnresolvedDocCount: exportSummary.unresolved_doc_count,
                backend,
            },
            null,
            2
        )
    );
}

async function closeClients() {
    if (postgresClient) await postgresClient.end({ timeout: 5 });
}

if (require.main === module) {
    main()
        .catch(error => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(closeClients);
}

module.exports = {
    parseArgs,
    resolveBackend,
};

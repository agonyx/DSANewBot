# DSA Rules Vector Database

This document defines the vector database approach for the real scraper pipeline now present in the repo.

The old markdown-first flow is obsolete. The active source pipeline is `DSA5WikiScraper/dsa_scraper_v3`, which scrapes Regelwiki pages, parses them into structured JSON, and exports embedding-ready JSONL corpora. Self-hosted PostgreSQL with pgvector ingests that structured output directly through `scripts/import-rules-v3.js`.

## What Exists Now

The repo currently contains two different worlds:

| Path                                                                       | Role                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `scripts/embed-rules.js`                                                   | Legacy markdown-based embedding script                        |
| `docs/*.md`                                                                | Legacy manual content source                                  |
| `DSA5WikiScraper/dsa_scraper_v3/run.py`                                    | Real scraper entrypoint                                       |
| `DSA5WikiScraper/dsa_scraper_v3/phase1_download.py`                        | Downloads Regelwiki HTML, uses hub discovery + sitemap ingest |
| `DSA5WikiScraper/dsa_scraper_v3/phase2_parse.py`                           | Parses HTML into category JSON records                        |
| `DSA5WikiScraper/dsa_scraper_v3/export_embeddings.py`                      | Builds canonical documents and chunks JSONL files             |
| `DSA5WikiScraper/dsa_scraper_v3/data/page_index.json`                      | Crawl and category-resolution metadata per page               |
| `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/canonical_documents.jsonl` | Page-level embedding-ready corpus                             |
| `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/chunks.jsonl`              | Chunk-level embedding-ready corpus                            |

Current scraper export counts from `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/export_summary.json`:

- `doc_count`: 8027
- `chunk_count`: 11370
- `unresolved_doc_count`: 831
- `failed_url_count`: 57

That means the real migration is not “markdown to a remote document store.” It is “scraper JSONL output to PostgreSQL.”

## Real Scraper Pipeline

The actual v3 flow is:

1. `phase1_download.py` crawls Regelwiki and stores HTML locally under `DSA5WikiScraper/dsa_scraper_v3/data/html/`.
2. `phase1_download.py` also builds checkpoint and discovery state such as `checkpoint.json` and `page_index.json`.
3. `phase2_parse.py` parses stored HTML into category JSON files under `DSA5WikiScraper/dsa_scraper_v3/data/json/`.
4. `export_embeddings.py` reads parsed JSON plus audit metadata and emits:
    - `canonical_documents.jsonl`
    - `chunks.jsonl`
    - `export_summary.json`
5. The PostgreSQL importer consumes those JSONL exports and stores them in database tables.

There is no markdown step in the real pipeline.

## Required Change In Direction

Do not use `docs/*.md` as the input for the vector database anymore.

Do not treat `scripts/embed-rules.js` as the long-term ingestion path.

Instead:

- treat scraper exports as the authoritative ingestion payload,
- treat PostgreSQL with pgvector as the durable retrieval store,
- keep local scraper files as a build artifact and audit trail,
- stop adding new markdown files for rules ingestion.

## Recommended PostgreSQL Architecture

PostgreSQL stores two levels of content:

| Table         | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `rule_pages`  | One row per scraper-exported canonical document               |
| `rule_chunks` | One row per embedding chunk derived from a canonical document |

This matches the scraper output shape closely:

- `canonical_documents.jsonl` maps to `rule_pages`
- `chunks.jsonl` maps to `rule_chunks`
- `page_index.json`, `coverage_summary.json`, and export metadata enrich `metadata jsonb`

## Schema

Enable required extensions first:

```sql
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
```

### `rule_pages`

One row per canonical document emitted by `export_embeddings.py`.

```sql
create table public.rule_pages (
    id uuid primary key default gen_random_uuid(),
    doc_id text not null unique,
    source_item_id text,
    source_url text not null unique,
    url_hash text not null,
    canonical_slug text not null unique,
    title text not null,
    category text not null,
    resolved_category text,
    subcategory text,
    page_state text,
    is_unresolved boolean not null default false,
    resolution_confidence text,
    normalized_content text not null,
    content_hash text not null,
    parser_version text not null,
    scraper_version text not null,
    source_snapshot_at timestamptz,
    version integer not null default 1,
    metadata jsonb not null default '{}'::jsonb,
    last_seen_at timestamptz not null default now(),
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
```

Suggested `metadata` contents:

- `breadcrumbs`
- `crawl_sources`
- `resolution_evidence`
- `properties`
- `extensions`
- `raw_html_path`
- `embedding_text_length`
- any audit warnings or scrape diagnostics you want to preserve

### `rule_chunks`

One row per exported chunk from `chunks.jsonl`.

```sql
create table public.rule_chunks (
    id uuid primary key default gen_random_uuid(),
    chunk_id text not null unique,
    page_id uuid not null references public.rule_pages(id) on delete cascade,
    version integer not null,
    chunk_index integer not null,
    title text,
    category text not null,
    resolved_category text,
    heading text,
    chunk_text text not null,
    char_start integer,
    char_end integer,
    embedding vector(1536),
    embedding_model text,
    embedded_at timestamptz,
    is_unresolved boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    is_active boolean not null default true,
    unique (page_id, version, chunk_index)
);

create index rule_chunks_page_id_idx on public.rule_chunks (page_id);
create index rule_chunks_active_idx on public.rule_chunks (is_active);
create index rule_chunks_embedding_idx
    on public.rule_chunks
    using hnsw (embedding vector_cosine_ops)
    where embedding is not null;
```

## Why This Fits v3 Better

- The scraper already produces stable page-level IDs: `doc_id`, `source_item_id`, `url`, `url_hash`.
- The scraper already produces chunk-level IDs: `chunk_id` and `chunk_index`.
- The scraper already produces resolution metadata that matters for retrieval quality.
- The scraper already distinguishes unresolved documents, failed URLs, and crawl provenance.
- Reconstructing all of this from markdown would throw away useful structure.

## Import Contract From Scraper To PostgreSQL

The importer should read `canonical_documents.jsonl` and `chunks.jsonl`, not markdown files.

### Step 1: Import canonical documents into `rule_pages`

Map scraper fields like this:

| Scraper field       | PostgreSQL field                |
| ------------------- | ------------------------------- |
| `doc_id`            | `rule_pages.doc_id`             |
| `source_item_id`    | `rule_pages.source_item_id`     |
| `url`               | `rule_pages.source_url`         |
| `url_hash`          | `rule_pages.url_hash`           |
| `title`             | `rule_pages.title`              |
| `category`          | `rule_pages.category`           |
| `resolved_category` | `rule_pages.resolved_category`  |
| `subcategory`       | `rule_pages.subcategory`        |
| `page_state`        | `rule_pages.page_state`         |
| `is_unresolved`     | `rule_pages.is_unresolved`      |
| `embedding_text`    | `rule_pages.normalized_content` |

`canonical_slug` should be derived from `doc_id` or a normalized URL path, not from the human title.

`content_hash` should be computed from `embedding_text` or another normalized text representation, not from raw HTML.

### Step 2: Import chunks into `rule_chunks`

Map scraper chunk fields like this:

| Scraper field       | PostgreSQL field                |
| ------------------- | ------------------------------- |
| `chunk_id`          | `rule_chunks.chunk_id`          |
| `doc_id`            | lookup `rule_pages.id`          |
| `chunk_index`       | `rule_chunks.chunk_index`       |
| `title`             | `rule_chunks.title`             |
| `category`          | `rule_chunks.category`          |
| `resolved_category` | `rule_chunks.resolved_category` |
| `chunk_text`        | `rule_chunks.chunk_text`        |
| `char_start`        | `rule_chunks.char_start`        |
| `char_end`          | `rule_chunks.char_end`          |
| `is_unresolved`     | `rule_chunks.is_unresolved`     |

The importer should preserve scraper metadata such as:

- `breadcrumbs`
- `source_item_id`
- `page_state`
- `resolution_confidence`

### Step 3: Generate embeddings

Embeddings should be generated from `rule_chunks.chunk_text`, not from markdown documents and not from raw HTML.

For page-level exact lookup, embeddings are not required.

### Step 4: Sync behavior

If a later scraper run changes a document:

1. compare `content_hash` for the incoming canonical document,
2. if unchanged, skip page rewrite and skip re-embedding,
3. if changed, increment `version`,
4. replace or deactivate prior chunks for that page,
5. insert the new chunks,
6. embed only the new active chunks.

If a page disappears from a later scraper export, mark the page with `deleted_at` and deactivate its chunks.

## Retrieval Contract

Use different query paths for different jobs.

### Semantic search

Semantic search should run against `rule_chunks` only.

```sql
create or replace function public.match_rule_chunks (
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_category text default null,
    include_unresolved boolean default false
)
returns table (
    chunk_id text,
    page_id uuid,
    doc_id text,
    title text,
    category text,
    resolved_category text,
    source_url text,
    chunk_text text,
    metadata jsonb,
    similarity float
)
language sql
as $$
    select
        rc.chunk_id,
        rp.id as page_id,
        rp.doc_id,
        rp.title,
        rp.category,
        rp.resolved_category,
        rp.source_url,
        rc.chunk_text,
        rc.metadata,
        1 - (rc.embedding <=> query_embedding) as similarity
    from public.rule_chunks rc
    join public.rule_pages rp on rp.id = rc.page_id
    where rc.is_active = true
      and rp.deleted_at is null
      and rc.embedding is not null
      and (filter_category is null or rp.category = filter_category)
      and (include_unresolved = true or rp.is_unresolved = false)
      and 1 - (rc.embedding <=> query_embedding) >= match_threshold
    order by rc.embedding <=> query_embedding
    limit match_count;
$$;
```

Search results should be deduplicated or capped per page to avoid one long page dominating the top results.

### Exact lookup

Exact lookups should query `rule_pages` by one of:

- `doc_id`
- `canonical_slug`
- exact or fuzzy `title`
- `source_url`

Do not use chunk rows as the canonical exact-lookup surface.

## Runtime Boundaries

- The scraper remains local/offline and writes files under `DSA5WikiScraper/dsa_scraper_v3/data/`.
- The importer writes directly to PostgreSQL using `DATABASE_URL` and resumes by skipping chunks that already have embeddings.
- The bot runtime reads pages and invokes `match_rule_chunks()` through the shared database layer.

That means the clean long-term flow is:

`DSA5WikiScraper v3 -> JSONL export -> PostgreSQL/pgvector import -> bot retrieval`

## Implications For Existing Repo Code

The following pieces are now legacy and should be treated that way:

- `scripts/embed-rules.js`
- `docs/*.md` as ingestion input
- `rule_documents` as the long-term schema shape

The replacement path should be:

1. keep the scraper as the source generator,
2. use the dedicated importer from `canonical_documents.jsonl` and `chunks.jsonl` into PostgreSQL,
3. replace the single-table `rule_documents` pattern with `rule_pages` + `rule_chunks`,
4. update `utils/rulesClient.js` so semantic search hits chunks and exact lookup hits pages.

## Environment Variables

Required for the importer/runtime side:

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>
OPENAI_API_KEY=<embedding_key>
```

## Operational Rules

- Markdown files are not part of the ingestion pipeline.
- Scraper JSON and JSONL exports are the ingestion payload.
- PostgreSQL with pgvector is the durable retrieval store.
- `canonical_documents.jsonl` feeds `rule_pages`.
- `chunks.jsonl` feeds `rule_chunks`.
- Embeddings are generated from chunk text.
- Exact lookup targets `rule_pages`.
- Semantic search targets `rule_chunks`.
- Unresolved documents should be stored explicitly and optionally filtered at query time.

## Useful Scraper References

- `DSA5WikiScraper/dsa_scraper_v3/run.py`
- `DSA5WikiScraper/dsa_scraper_v3/phase1_download.py`
- `DSA5WikiScraper/dsa_scraper_v3/phase2_parse.py`
- `DSA5WikiScraper/dsa_scraper_v3/export_embeddings.py`
- `DSA5WikiScraper/dsa_scraper_v3/data/page_index.json`
- `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/canonical_documents.jsonl`
- `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/chunks.jsonl`
- `DSA5WikiScraper/dsa_scraper_v3/data/embeddings/export_summary.json`

## Summary

The actual scraper is already structured and already off markdown.

The correct vector strategy for this repo is:

- scrape with `DSA5WikiScraper/dsa_scraper_v3`,
- export canonical documents and chunks as JSONL,
- import those structured records into PostgreSQL,
- store page records in `rule_pages`,
- store vectorized chunks in `rule_chunks`,
- query chunks semantically and pages exactly.

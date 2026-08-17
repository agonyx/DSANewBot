export const CAMPAIGN_RECORD_KINDS = [
    'QUEST',
    'ENCOUNTER_TABLE',
    'MAP',
    'STRONGHOLD',
    'FACTION',
    'ALCHEMY_RECIPE',
] as const;

export type CampaignRecordKind = (typeof CAMPAIGN_RECORD_KINDS)[number];

export interface QuestObjective {
    id: string;
    text: string;
    completed: boolean;
}

export interface EncounterEntry {
    id: string;
    name: string;
    weight: number;
    details: string;
}

const NPC_NAMES = [
    'Alrik',
    'Boronja',
    'Cedrik',
    'Daria',
    'Elgor',
    'Firunja',
    'Geron',
    'Hesindiane',
    'Ilaris',
    'Jucho',
    'Korgrimm',
    'Layariel',
];
const NPC_ROLES = ['Guard', 'Merchant', 'Scholar', 'Scout', 'Craftsperson', 'Healer', 'Mercenary', 'Courtier'];
const NPC_TRAITS = [
    'careful and soft-spoken',
    'boisterous but dependable',
    'curious and easily distracted',
    'formal and relentlessly punctual',
    'warm-hearted with a sharp memory',
    'suspicious of easy answers',
    'ambitious and impeccably dressed',
    'practical, blunt, and loyal',
];
const NPC_MOTIVES = [
    'protect a family secret',
    'repay an old debt',
    'earn enough for a long journey',
    'expose a corrupt official',
    'recover a stolen heirloom',
    'gain entry to an exclusive guild',
    'find a missing relative',
    'avoid being recognized',
];

export function normalizeName(value: string, label = 'name', max = 100): string {
    const normalized = value?.trim().replace(/\s+/g, ' ');
    if (!normalized) throw new Error(`${label} is required`);
    if (normalized.length > max) throw new Error(`${label} must be at most ${max} characters`);
    return normalized;
}

export function normalizeText(value: string | undefined, label: string, max = 2000, required = false): string {
    const normalized = value?.trim() ?? '';
    if (required && !normalized) throw new Error(`${label} is required`);
    if (normalized.length > max) throw new Error(`${label} must be at most ${max} characters`);
    return normalized;
}

export function createQuestData(summary: string, objectives: string[] = []) {
    return {
        summary: normalizeText(summary, 'summary', 2000),
        objectives: objectives
            .map(text => normalizeText(text, 'objective', 300))
            .filter(Boolean)
            .slice(0, 25)
            .map(text => ({ id: crypto.randomUUID(), text, completed: false })),
    };
}

export function parseObjectiveList(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

export function getQuestObjectives(data: Record<string, unknown>): QuestObjective[] {
    return Array.isArray(data.objectives)
        ? data.objectives.filter(
              (entry): entry is QuestObjective =>
                  Boolean(entry) &&
                  typeof entry === 'object' &&
                  typeof (entry as QuestObjective).id === 'string' &&
                  typeof (entry as QuestObjective).text === 'string' &&
                  typeof (entry as QuestObjective).completed === 'boolean'
          )
        : [];
}

export function addQuestObjective(data: Record<string, unknown>, text: string): Record<string, unknown> {
    const objectives = getQuestObjectives(data);
    if (objectives.length >= 25) throw new Error('A quest can have at most 25 objectives');
    return {
        ...data,
        objectives: [
            ...objectives,
            { id: crypto.randomUUID(), text: normalizeText(text, 'objective', 300, true), completed: false },
        ],
    };
}

export function setQuestObjective(
    data: Record<string, unknown>,
    objectiveId: string,
    completed: boolean
): Record<string, unknown> {
    const objectives = getQuestObjectives(data);
    const index = objectives.findIndex(objective => objective.id === objectiveId);
    if (index < 0) throw new Error('Quest objective not found');
    return {
        ...data,
        objectives: objectives.map(objective =>
            objective.id === objectiveId ? { ...objective, completed } : objective
        ),
    };
}

export function getEncounterEntries(data: Record<string, unknown>): EncounterEntry[] {
    return Array.isArray(data.entries)
        ? data.entries.filter(
              (entry): entry is EncounterEntry =>
                  Boolean(entry) &&
                  typeof entry === 'object' &&
                  typeof (entry as EncounterEntry).id === 'string' &&
                  typeof (entry as EncounterEntry).name === 'string' &&
                  Number.isInteger((entry as EncounterEntry).weight) &&
                  (entry as EncounterEntry).weight > 0 &&
                  typeof (entry as EncounterEntry).details === 'string'
          )
        : [];
}

export function addEncounterEntry(
    data: Record<string, unknown>,
    input: { name: string; weight?: number; details?: string }
): Record<string, unknown> {
    const entries = getEncounterEntries(data);
    if (entries.length >= 100) throw new Error('An encounter table can have at most 100 entries');
    const weight = input.weight ?? 1;
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
        throw new Error('Encounter weight must be an integer from 1 to 1000');
    }
    return {
        ...data,
        entries: [
            ...entries,
            {
                id: crypto.randomUUID(),
                name: normalizeName(input.name, 'encounter name'),
                weight,
                details: normalizeText(input.details, 'encounter details', 1000),
            },
        ],
    };
}

export function rollEncounter(data: Record<string, unknown>, random = Math.random): EncounterEntry {
    const entries = getEncounterEntries(data);
    if (!entries.length) throw new Error('Encounter table has no entries');
    const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
    let target = random() * totalWeight;
    for (const entry of entries) {
        target -= entry.weight;
        if (target < 0) return entry;
    }
    return entries[entries.length - 1];
}

export function validateHttpsUrl(value: string, label = 'URL'): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label} must be a valid URL`);
    }
    if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
    if (url.username || url.password) throw new Error(`${label} cannot contain embedded credentials`);
    const host = url.hostname.toLowerCase();
    if (
        host === 'localhost' ||
        host === '::1' ||
        host.endsWith('.local') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
        throw new Error(`${label} cannot target a local or private address`);
    }
    const normalized = url.toString();
    if (normalized.length > 1000) throw new Error(`${label} must be at most 1000 characters`);
    return normalized;
}

export function normalizeEventTypes(value?: string): string[] {
    const allowed = new Set(['*', 'dice.roll', 'campaign.updated', 'character.imported']);
    const events = (value || '*')
        .split(',')
        .map(event => event.trim().toLowerCase())
        .filter(Boolean);
    if (!events.length || events.some(event => !allowed.has(event))) {
        throw new Error(`Events must be one or more of: ${[...allowed].join(', ')}`);
    }
    return [...new Set(events)].slice(0, 10);
}

export function generateNpc(random = Math.random) {
    const pick = <T>(values: T[]) => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
    const competence = 8 + Math.floor(random() * 7);
    return {
        name: pick(NPC_NAMES),
        role: pick(NPC_ROLES),
        trait: pick(NPC_TRAITS),
        motive: pick(NPC_MOTIVES),
        stats: {
            courage: competence,
            initiative: 8 + Math.floor(random() * 9),
            attack: 8 + Math.floor(random() * 8),
            parry: 4 + Math.floor(random() * 8),
            lifePoints: 20 + Math.floor(random() * 21),
        },
    };
}

export function randomWeather(random = Math.random): string {
    const weather = [
        'Clear skies',
        'Light clouds',
        'Steady rain',
        'Heavy rain and wind',
        'Fog',
        'Dry heat',
        'Cold snap',
        'Thunderstorm',
    ];
    return weather[Math.min(weather.length - 1, Math.floor(random() * weather.length))];
}

export function normalizeWorldTime(value: string): Date {
    const date = new Date(value);
    if (!value?.trim() || Number.isNaN(date.getTime())) throw new Error('Time must be a valid ISO date/time');
    return date;
}

export function advanceWorldTime(value: Date, amount: number, unit: 'MINUTES' | 'HOURS' | 'DAYS'): Date {
    if (!Number.isInteger(amount) || amount < -3650 || amount > 3650 || amount === 0) {
        throw new Error('Advance amount must be a non-zero integer from -3650 to 3650');
    }
    const multiplier = unit === 'DAYS' ? 86_400_000 : unit === 'HOURS' ? 3_600_000 : 60_000;
    return new Date(value.getTime() + amount * multiplier);
}

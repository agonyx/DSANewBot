export const MAX_SESSION_NOTE_TITLE = 100;
export const MAX_SESSION_NOTE_BODY = 4000;
export const MAX_SESSION_NOTES_PER_GUILD = 100;

export function normalizeSessionNoteTitle(value: string): string {
    const title = String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    if (!title) throw new Error('Session note title is required');
    if (title.length > MAX_SESSION_NOTE_TITLE) {
        throw new Error(`Session note title must be at most ${MAX_SESSION_NOTE_TITLE} characters`);
    }
    return title;
}

export function normalizeSessionNoteBody(value: string): string {
    const body = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .trim();
    if (!body) throw new Error('Session note content is required');
    if (body.length > MAX_SESSION_NOTE_BODY) {
        throw new Error(`Session note content must be at most ${MAX_SESSION_NOTE_BODY} characters`);
    }
    return body;
}

export function normalizeSessionDate(value: string | undefined): string | null {
    if (value === undefined || !value.trim()) return null;
    const date = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Session date must use YYYY-MM-DD');
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Session date is not a valid calendar date');
    }
    return date;
}

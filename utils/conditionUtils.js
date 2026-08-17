/**
 * DSA 5e Condition (Zustände) and Status Effect system.
 *
 * Conditions have levels (Stufen I-IV) and impose cumulative penalties.
 * Status effects are binary (on/off).
 *
 * @module conditionUtils
 * @see DSA 5e Grundregelwerk, Chapter "Zustände & Status"
 *
 * Round-based expiry and rest recovery are orchestrated by
 * services/combatEffects.ts and services/resources.ts.
 */

const { createLogger } = require('./logger');
const log = createLogger('conditionUtils');

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * All DSA 5e conditions (Zustände).
 * Each condition can have levels I-IV. Higher levels impose greater penalties.
 *
 * Note: SCHMERZ is derived from LP thresholds, not stored directly,
 * but included here for reference and display purposes.
 *
 * @enum {string}
 */
const CONDITION_TYPES = Object.freeze({
    SCHMERZ: 'schmerz',
    BETAEUBUNG: 'betaeubung',
    VERWIRRUNG: 'verwirrung',
    FURCHT: 'furcht',
    PARALYSE: 'paralyse',
    BELASTUNG: 'belastung',
    UEBERANSTRENGUNG: 'ueberanstrengung',
    BERAUSCHT: 'berauscht',
    ENTRUECKUNG: 'entrueckung',
    TRANCE: 'trance',
});

/**
 * DSA 5e status effects — binary (active or not).
 * @enum {string}
 */
const STATUS_TYPES = Object.freeze({
    BLUTEND: 'blutend',
    BEWUSSTLOS: 'bewusstlos',
    BLIND: 'blind',
    BRENNEND: 'brennend',
    HANDLUNGSUNFAEHIG: 'handlungsunfaehig',
    LIEGEND: 'liegend',
    STUMM: 'stumm',
    TAUB: 'taub',
    UEBERRASCHT: 'ueberrascht',
    UNSICHTBAR: 'unsichtbar',
    VERGIFTET: 'vergiftet',
    KRANK: 'krank',
    FIXIERT: 'fixiert',
    EINGEENGT: 'eingeengt',
    BEWEGUNGSUNFAEHIG: 'bewegungsunfaehig',
});

// ---------------------------------------------------------------------------
// Labels (German display names)
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const CONDITION_LABELS = Object.freeze({
    [CONDITION_TYPES.SCHMERZ]: 'Schmerz',
    [CONDITION_TYPES.BETAEUBUNG]: 'Betäubung',
    [CONDITION_TYPES.VERWIRRUNG]: 'Verwirrung',
    [CONDITION_TYPES.FURCHT]: 'Furcht',
    [CONDITION_TYPES.PARALYSE]: 'Paralyse',
    [CONDITION_TYPES.BELASTUNG]: 'Belastung',
    [CONDITION_TYPES.UEBERANSTRENGUNG]: 'Überanstrengung',
    [CONDITION_TYPES.BERAUSCHT]: 'Berauscht',
    [CONDITION_TYPES.ENTRUECKUNG]: 'Entrückung',
    [CONDITION_TYPES.TRANCE]: 'Trance',
});

/** @type {Record<string, string>} */
const STATUS_LABELS = Object.freeze({
    [STATUS_TYPES.BLUTEND]: 'Blutend',
    [STATUS_TYPES.BEWUSSTLOS]: 'Bewusstlos',
    [STATUS_TYPES.BLIND]: 'Blind',
    [STATUS_TYPES.BRENNEND]: 'Brennend',
    [STATUS_TYPES.HANDLUNGSUNFAEHIG]: 'Handlungsunfähig',
    [STATUS_TYPES.LIEGEND]: 'Liegend',
    [STATUS_TYPES.STUMM]: 'Stumm',
    [STATUS_TYPES.TAUB]: 'Taub',
    [STATUS_TYPES.UEBERRASCHT]: 'Überrascht',
    [STATUS_TYPES.UNSICHTBAR]: 'Unsichtbar',
    [STATUS_TYPES.VERGIFTET]: 'Vergiftet',
    [STATUS_TYPES.KRANK]: 'Krank',
    [STATUS_TYPES.FIXIERT]: 'Fixiert',
    [STATUS_TYPES.EINGEENGT]: 'Eingeengt',
    [STATUS_TYPES.BEWEGUNGSUNFAEHIG]: 'Bewegungsunfähig',
});

// ---------------------------------------------------------------------------
// Categories (for grouped display)
// ---------------------------------------------------------------------------

/**
 * Groups conditions by thematic category for display.
 * @type {Record<string, string[]>}
 */
const CONDITION_CATEGORIES = Object.freeze({
    Körperlich: [
        CONDITION_TYPES.SCHMERZ,
        CONDITION_TYPES.BETAEUBUNG,
        CONDITION_TYPES.PARALYSE,
        CONDITION_TYPES.BELASTUNG,
        CONDITION_TYPES.UEBERANSTRENGUNG,
    ],
    Geistig: [
        CONDITION_TYPES.VERWIRRUNG,
        CONDITION_TYPES.FURCHT,
        CONDITION_TYPES.BERAUSCHT,
        CONDITION_TYPES.ENTRUECKUNG,
        CONDITION_TYPES.TRANCE,
    ],
});

// ---------------------------------------------------------------------------
// Emojis
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const CONDITION_EMOJIS = Object.freeze({
    [CONDITION_TYPES.SCHMERZ]: '🩸',
    [CONDITION_TYPES.BETAEUBUNG]: '💫',
    [CONDITION_TYPES.VERWIRRUNG]: '😵',
    [CONDITION_TYPES.FURCHT]: '😨',
    [CONDITION_TYPES.PARALYSE]: '🧊',
    [CONDITION_TYPES.BELASTUNG]: '🏋️',
    [CONDITION_TYPES.UEBERANSTRENGUNG]: '😮‍💨',
    [CONDITION_TYPES.BERAUSCHT]: '🍺',
    [CONDITION_TYPES.ENTRUECKUNG]: '✨',
    [CONDITION_TYPES.TRANCE]: '🌀',
});

/** @type {Record<string, string>} */
const STATUS_EMOJIS = Object.freeze({
    [STATUS_TYPES.BLUTEND]: '🩸',
    [STATUS_TYPES.BEWUSSTLOS]: '💤',
    [STATUS_TYPES.BLIND]: '🕶️',
    [STATUS_TYPES.BRENNEND]: '🔥',
    [STATUS_TYPES.HANDLUNGSUNFAEHIG]: '🚫',
    [STATUS_TYPES.LIEGEND]: '🛌',
    [STATUS_TYPES.STUMM]: '🤐',
    [STATUS_TYPES.TAUB]: '🔇',
    [STATUS_TYPES.UEBERRASCHT]: '❗',
    [STATUS_TYPES.UNSICHTBAR]: '👻',
    [STATUS_TYPES.VERGIFTET]: '☠️',
    [STATUS_TYPES.KRANK]: '🤒',
    [STATUS_TYPES.FIXIERT]: '📌',
    [STATUS_TYPES.EINGEENGT]: '🪢',
    [STATUS_TYPES.BEWEGUNGSUNFAEHIG]: '⛓️',
});

// ---------------------------------------------------------------------------
// Recovery-rate reference metadata
// ---------------------------------------------------------------------------

/**
 * Natural recovery rate per condition type.
 * Display/reference data for the condition commands. Combat rounds and
 * regeneration phases apply the supported lifecycle hooks in the services.
 *
 * @type {Record<string, string>}
 */
const CONDITION_RECOVERY_RATES = Object.freeze({
    [CONDITION_TYPES.SCHMERZ]: 'Derived from LP — recovers as LP is healed',
    [CONDITION_TYPES.BETAEUBUNG]: '1 level per 3 hours of rest',
    [CONDITION_TYPES.VERWIRRUNG]: '1 level per hour, or end of combat',
    [CONDITION_TYPES.FURCHT]: '1 level per hour once source removed',
    [CONDITION_TYPES.PARALYSE]: 'Varies by source — poison, spell duration, etc.',
    [CONDITION_TYPES.BELASTUNG]: 'Removed when encumbrance source is removed',
    [CONDITION_TYPES.UEBERANSTRENGUNG]: '1 level per 30 minutes of rest',
    [CONDITION_TYPES.BERAUSCHT]: '1 level per hour',
    [CONDITION_TYPES.ENTRUECKUNG]: '1 level per combat round after source ends',
    [CONDITION_TYPES.TRANCE]: 'Ends when broken by external stimulus',
});

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Calculates pain level (Schmerzstufe) from current and max LP.
 * Based on DSA 5e Grundregelwerk pain thresholds:
 * - Stufe 0: LP > 75% max
 * - Stufe I: LP <= 75% max
 * - Stufe II: LP <= 50% max
 * - Stufe III: LP <= 25% max
 * - Stufe IV: LP <= 5
 *
 * @param {number} currentLP - Current life points
 * @param {number} maxLP - Maximum life points
 * @returns {number} Pain level 0-4
 */
function calculatePainLevel(currentLP, maxLP) {
    if (!Number.isFinite(currentLP) || !Number.isFinite(maxLP) || maxLP <= 0) {
        log.warn({ currentLP, maxLP }, 'Invalid LP values for pain calculation');
        return 0;
    }

    if (currentLP <= 5) return 4;
    if (currentLP <= maxLP * 0.25) return 3;
    if (currentLP <= maxLP * 0.5) return 2;
    if (currentLP <= maxLP * 0.75) return 1;
    return 0;
}

/**
 * Calculates total penalty from all active conditions.
 * DSA 5e rule: sum all condition levels, cap at 5.
 *
 * @param {Array<{ condition_type: string, level: number }>} conditions - Active conditions with levels
 * @returns {number} Total penalty (0-5)
 */
function calculateTotalPenalty(conditions) {
    if (!Array.isArray(conditions) || conditions.length === 0) return 0;

    const total = conditions.reduce((sum, c) => {
        const level = Number.isFinite(c.level) ? c.level : 0;
        return sum + level;
    }, 0);

    return Math.min(total, 5);
}

/**
 * Determines if a character is incapacitated.
 * DSA 5e: Incapacitated when total condition levels >= 8 OR LP <= 5 (Pain IV).
 *
 * @param {Array<{ condition_type: string, level: number }>} conditions - Active conditions
 * @param {number} currentLP - Current life points
 * @returns {boolean} True if incapacitated
 */
function isIncapacitated(conditions, currentLP) {
    if (Number.isFinite(currentLP) && currentLP <= 5) return true;

    if (!Array.isArray(conditions) || conditions.length === 0) return false;

    const total = conditions.reduce((sum, c) => {
        const level = Number.isFinite(c.level) ? c.level : 0;
        return sum + level;
    }, 0);

    return total >= 8;
}

/**
 * Returns the display emoji for a condition type.
 * @param {string} conditionType - One of CONDITION_TYPES values
 * @returns {string} Emoji string
 */
function getConditionEmoji(conditionType) {
    return CONDITION_EMOJIS[conditionType] || '⚠️';
}

/**
 * Returns the display emoji for a status type.
 * @param {string} statusType - One of STATUS_TYPES values
 * @returns {string} Emoji string
 */
function getStatusEmoji(statusType) {
    return STATUS_EMOJIS[statusType] || '⚠️';
}

module.exports = {
    CONDITION_TYPES,
    STATUS_TYPES,
    CONDITION_LABELS,
    STATUS_LABELS,
    CONDITION_CATEGORIES,
    CONDITION_EMOJIS,
    STATUS_EMOJIS,
    CONDITION_RECOVERY_RATES,
    calculatePainLevel,
    calculateTotalPenalty,
    isIncapacitated,
    getConditionEmoji,
    getStatusEmoji,
};

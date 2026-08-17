const { createLogger } = require('./logger');
const log = createLogger('combatUtils');

/**
 * Rolls a single die with the specified number of sides.
 * @param {number} sides - The number of sides on the die (e.g., 6 for d6, 20 for d20).
 * @returns {number} The result of the roll (1 to sides).
 */
function rollDice(sides) {
    if (sides <= 0) return 1; // Avoid errors/infinite loops
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parses a DSA-style damage string (e.g., "1w6+4", "2w6") and rolls the dice.
 * Also handles plain numbers as static damage.
 * @param {string} tpString - The dice string or static damage number string to parse.
 * @returns {number} The total result of the dice roll or the static damage.
 * @throws {Error} If the format is invalid (and not a plain number).
 */
function parseAndRollDamage(tpString) {
    if (tpString === null || tpString === undefined) {
        log.warn('Received null or undefined tpString in parseAndRollDamage. Returning 0.');
        return 0;
    }
    const tpStringTrimmed = String(tpString).trim();
    if (tpStringTrimmed === '') {
        log.warn('Received empty tpString in parseAndRollDamage. Returning 0.');
        return 0;
    }

    // Regex for XdW/D Y [+ Z] format, allows optional space around +
    const tpRegex = /^(\d+)w(\d+)(\s*\+\s*(\d+))?$/i; // W or D for Wuerfel/Dice
    const match = tpStringTrimmed.match(tpRegex);

    if (!match) {
        // If not dice format, check if it's just a plain number
        const staticDamage = parseInt(tpStringTrimmed, 10);
        if (!isNaN(staticDamage)) {
            // console.log(`Interpreting "${tpStringTrimmed}" as static damage ${staticDamage}`);
            return staticDamage;
        }
        // If not dice and not a plain number, throw error
        throw new Error(`Invalid TP format: "${tpStringTrimmed}". Expected like "1w6", "2w6+4", or a plain number.`);
    }

    log.debug({ tpString: tpStringTrimmed }, 'Parsing TP string');
    const numDice = parseInt(match[1], 10);
    const numSides = parseInt(match[2], 10);
    const constant = parseInt(match[4]) || 0;

    if (numSides <= 0) throw new Error('Dice must have at least 1 side.');
    if (numDice <= 0) throw new Error('Must roll at least 1 die.');

    let total = constant;
    const rolls = []; // Keep track of individual rolls for logging if needed
    for (let i = 0; i < numDice; i++) {
        const roll = rollDice(numSides);
        rolls.push(roll);
        total += roll;
    }
    log.debug({ tpString: tpStringTrimmed, rolls, constant, total }, 'Rolled damage');
    return total;
}

/**
 * Resolves a DSA 5 attack roll, including critical/botch checks and confirmation.
 * Based on standard DSA 5 rules (1=Crit check, 20=Botch check).
 * @param {number} attackerAT - The attacker's relevant Attack Value.
 * @returns {{ roll: number, confirmRoll: number|null, outcome: 'CRITICAL_SUCCESS' | 'NORMAL_HIT' | 'NORMAL_MISS' | 'BOTCH' }} Result object.
 */
function resolveAttack(attackerAT) {
    const attackRoll = rollDice(20);
    let confirmRoll = null;
    let outcome;

    log.debug({ attackRoll, attackerAT }, 'Resolve Attack');

    if (attackRoll === 1) {
        confirmRoll = rollDice(20);
        log.debug({ confirmRoll }, 'Potential CRIT');
        if (confirmRoll <= attackerAT) {
            outcome = 'CRITICAL_SUCCESS';
        } else {
            outcome = 'NORMAL_HIT';
        }
    } else if (attackRoll === 20) {
        confirmRoll = rollDice(20);
        log.debug({ confirmRoll }, 'Potential BOTCH');
        if (confirmRoll > attackerAT) {
            outcome = 'BOTCH';
        } else {
            outcome = 'NORMAL_MISS';
        }
    } else {
        if (attackRoll <= attackerAT) {
            outcome = 'NORMAL_HIT';
        } else {
            outcome = 'NORMAL_MISS';
        }
    }

    const result = {
        roll: attackRoll,
        confirmRoll,
        outcome,
    };
    log.debug({ result }, 'Attack result');
    return result;
}
/**
 * Resolves a DSA 5 defense roll (Parry/Dodge).
 * Determines if the defense roll succeeds against the target's PA value.
 * Defense intentionally uses the roadmap's binary d20-vs-PA rule; optional
 * critical-defense and botch tables are outside the committed scope.
 * @param {number} targetPA - The defender's relevant Parry/Dodge Value.
 * @returns {{ roll: number, success: boolean }} Result object indicating the roll and if it succeeded.
 */
function resolveDefense(targetPA) {
    const effectivePA = Number.isFinite(targetPA) ? targetPA : 0;
    const defenseRoll = rollDice(20);
    const success = defenseRoll <= effectivePA;

    log.debug({ defenseRoll, effectivePA, success }, 'Resolve Defense');

    return {
        roll: defenseRoll,
        success,
    };
}

/**
 * Applies Armor Soak (RS) to rolled damage.
 * DSA 5e Rule: If damage > 0 but <= RS/2, deal 1 point of damage (minimum damage).
 * @param {number} damageAmount - The damage rolled (after potential crits).
 * @param {number} targetRS - The target's Armor Soak value (Rüstungsschutz).
 * @returns {number} The final damage dealt after soak (minimum 0).
 */
function applySoak(damageAmount, targetRS) {
    const effectiveDamage = Number.isFinite(damageAmount) ? damageAmount : 0;
    const effectiveRS = Number.isFinite(targetRS) ? targetRS : 0;

    let finalDamage = effectiveDamage - effectiveRS;

    if (finalDamage <= 0 && effectiveDamage > 0 && effectiveDamage <= Math.floor(effectiveRS / 2)) {
        finalDamage = 1;
        log.debug({ effectiveDamage, rsHalf: Math.floor(effectiveRS / 2) }, 'Minimum damage rule applied');
    }

    finalDamage = Math.max(0, finalDamage);

    log.debug({ effectiveDamage, effectiveRS, finalDamage }, 'Apply Soak');
    return finalDamage;
}

module.exports = {
    rollDice,
    parseAndRollDamage,
    resolveAttack,
    resolveDefense,
    applySoak,
};

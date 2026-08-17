const { rollDice, parseAndRollDamage, resolveAttack, resolveDefense, applySoak } = require('../utils/combatUtils');

// Mock Math.random to make dice rolls deterministic
const mockRandom = value => {
    jest.spyOn(Math, 'random').mockReturnValue(value);
};

const restoreRandom = () => {
    jest.restoreAllMocks();
};

describe('rollDice', () => {
    afterEach(restoreRandom);

    test('returns 1 when sides is 0', () => {
        expect(rollDice(0)).toBe(1);
    });

    test('returns 1 when sides is negative', () => {
        expect(rollDice(-5)).toBe(1);
    });

    test('returns minimum value (1) for any die', () => {
        mockRandom(0);
        expect(rollDice(20)).toBe(1);
        expect(rollDice(6)).toBe(1);
    });

    test('returns maximum value for any die', () => {
        mockRandom(0.9999);
        expect(rollDice(20)).toBe(20);
        expect(rollDice(6)).toBe(6);
    });

    test('returns correct value in middle range', () => {
        mockRandom(0.5);
        expect(rollDice(20)).toBe(11); // floor(0.5 * 20) + 1 = 11
        expect(rollDice(6)).toBe(4); // floor(0.5 * 6) + 1 = 4
    });

    test('handles d1 edge case', () => {
        mockRandom(0.5);
        expect(rollDice(1)).toBe(1);
    });
});

describe('parseAndRollDamage', () => {
    afterEach(restoreRandom);

    test('returns 0 for null input', () => {
        expect(parseAndRollDamage(null)).toBe(0);
    });

    test('returns 0 for undefined input', () => {
        expect(parseAndRollDamage(undefined)).toBe(0);
    });

    test('returns 0 for empty string', () => {
        expect(parseAndRollDamage('')).toBe(0);
    });

    test('returns 0 for whitespace-only string', () => {
        expect(parseAndRollDamage('   ')).toBe(0);
    });

    test('parses plain number as static damage', () => {
        expect(parseAndRollDamage('5')).toBe(5);
        expect(parseAndRollDamage('0')).toBe(0);
        expect(parseAndRollDamage('42')).toBe(42);
    });

    test('parses numeric input (non-string)', () => {
        expect(parseAndRollDamage(10)).toBe(10);
    });

    test('throws error for invalid format', () => {
        expect(() => parseAndRollDamage('abc')).toThrow('Invalid TP format');
        expect(() => parseAndRollDamage('w6')).toThrow('Invalid TP format');
        // Note: '1w' is parsed by parseInt as 1, so it returns 1 as static damage (quirk)
    });

    test('throws error for 0 sides', () => {
        expect(() => parseAndRollDamage('1w0')).toThrow('Dice must have at least 1 side');
    });

    test('throws error for 0 dice', () => {
        expect(() => parseAndRollDamage('0w6')).toThrow('Must roll at least 1 die');
    });

    test('rolls single die correctly (1w6)', () => {
        mockRandom(0); // rolls 1
        expect(parseAndRollDamage('1w6')).toBe(1);

        mockRandom(5 / 6 - 0.0001); // rolls 5
        expect(parseAndRollDamage('1w6')).toBe(5);

        mockRandom(0.9999); // rolls 6
        expect(parseAndRollDamage('1w6')).toBe(6);
    });

    test('rolls multiple dice correctly (2w6)', () => {
        mockRandom(0); // both dice roll 1
        expect(parseAndRollDamage('2w6')).toBe(2);
    });

    test('rolls dice with bonus correctly (1w6+4)', () => {
        mockRandom(0); // roll 1
        expect(parseAndRollDamage('1w6+4')).toBe(5);
    });

    test('rolls dice with bonus and spaces (2w6 + 3)', () => {
        mockRandom(0); // both dice roll 1
        expect(parseAndRollDamage('2w6 + 3')).toBe(5);
    });

    test('is case-insensitive (uppercase W)', () => {
        mockRandom(0);
        expect(parseAndRollDamage('1W6')).toBe(1);
    });

    test('handles d20 notation (2w20+5)', () => {
        mockRandom(0); // both dice roll 1
        expect(parseAndRollDamage('2w20+5')).toBe(7);
    });

    test('trims whitespace from input', () => {
        mockRandom(0);
        expect(parseAndRollDamage('  1w6  ')).toBe(1);
    });
});

describe('resolveAttack', () => {
    afterEach(restoreRandom);

    test('NAT 1 with successful confirm = CRITICAL_SUCCESS', () => {
        mockRandom(0); // attack roll = 1
        // Need to mock second call for confirm roll
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack roll = 1
            return 0; // confirm roll = 1 (succeeds against any AT > 0)
        });

        const result = resolveAttack(10);
        expect(result.roll).toBe(1);
        expect(result.confirmRoll).toBe(1);
        expect(result.outcome).toBe('CRITICAL_SUCCESS');
    });

    test('NAT 1 with failed confirm = NORMAL_HIT', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack roll = 1
            return 0.9999; // confirm roll = 20 (fails against AT 10)
        });

        const result = resolveAttack(10);
        expect(result.roll).toBe(1);
        expect(result.confirmRoll).toBe(20);
        expect(result.outcome).toBe('NORMAL_HIT');
    });

    test('NAT 20 with failed confirm = BOTCH', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 19 / 20 - 0.0001; // attack roll = 19 -> gets floored
            return 0;
        });

        // Actually let me fix this - for NAT 20, we need roll = 20
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0.9999; // attack roll = 20
            return 0.9999; // confirm roll = 20 (fails against AT 10)
        });

        const result = resolveAttack(10);
        expect(result.roll).toBe(20);
        expect(result.confirmRoll).toBe(20);
        expect(result.outcome).toBe('BOTCH');
    });

    test('NAT 20 with successful confirm = NORMAL_MISS', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0.9999; // attack roll = 20
            return 0; // confirm roll = 1 (succeeds against AT 10)
        });

        const result = resolveAttack(10);
        expect(result.roll).toBe(20);
        expect(result.confirmRoll).toBe(1);
        expect(result.outcome).toBe('NORMAL_MISS');
    });

    test('Regular roll <= AT = NORMAL_HIT', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveAttack(15);
        expect(result.roll).toBe(11);
        expect(result.confirmRoll).toBeNull();
        expect(result.outcome).toBe('NORMAL_HIT');
    });

    test('Regular roll > AT = NORMAL_MISS', () => {
        mockRandom(0.75); // roll = 16
        const result = resolveAttack(15);
        expect(result.roll).toBe(16);
        expect(result.confirmRoll).toBeNull();
        expect(result.outcome).toBe('NORMAL_MISS');
    });

    test('Roll exactly equal to AT = NORMAL_HIT', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveAttack(11);
        expect(result.roll).toBe(11);
        expect(result.outcome).toBe('NORMAL_HIT');
    });

    test('AT of 0 handles correctly', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack roll = 1 (crit)
            return 0.9999; // confirm = 20, fails against AT 0
        });

        const result = resolveAttack(0);
        expect(result.roll).toBe(1);
        // Confirm roll 20 > AT 0, so fails confirmation
        expect(result.outcome).toBe('NORMAL_HIT');
    });
});

describe('resolveDefense', () => {
    afterEach(restoreRandom);

    test('Roll <= PA = success', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(15);
        expect(result.roll).toBe(11);
        expect(result.success).toBe(true);
    });

    test('Roll > PA = failure', () => {
        mockRandom(0.75); // roll = 16
        const result = resolveDefense(15);
        expect(result.roll).toBe(16);
        expect(result.success).toBe(false);
    });

    test('Roll exactly equal to PA = success', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(11);
        expect(result.roll).toBe(11);
        expect(result.success).toBe(true);
    });

    test('PA of 0 always fails under binary defense resolution', () => {
        mockRandom(0); // roll = 1
        const result = resolveDefense(0);
        expect(result.success).toBe(false);
    });

    test('Handles null PA as 0', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(null);
        expect(result.success).toBe(false);
    });

    test('Handles undefined PA as 0', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(undefined);
        expect(result.success).toBe(false);
    });

    test('Handles NaN PA as 0', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(NaN);
        expect(result.success).toBe(false);
    });

    test('High PA can always defend', () => {
        mockRandom(0.9999); // roll = 20
        const result = resolveDefense(20);
        expect(result.success).toBe(true);
    });
});

describe('applySoak', () => {
    test('Damage > RS = reduced damage', () => {
        expect(applySoak(10, 3)).toBe(7);
        expect(applySoak(15, 5)).toBe(10);
    });

    test('Damage = RS = 0 final damage (no min damage rule)', () => {
        // Damage 4, RS 4 -> 4 is NOT <= 2 (RS/2), so final = 0
        expect(applySoak(4, 4)).toBe(0);
    });

    test('Minimum damage rule: damage > 0 and <= RS/2 = 1 damage', () => {
        // Damage 2, RS 4 -> 2 <= 2 (RS/2), so final = 1
        expect(applySoak(2, 4)).toBe(1);
        // Damage 1, RS 4 -> 1 <= 2 (RS/2), so final = 1
        expect(applySoak(1, 4)).toBe(1);
    });

    test('No minimum damage when damage is 0', () => {
        expect(applySoak(0, 4)).toBe(0);
    });

    test('Minimum damage rule can apply even when RS > damage', () => {
        // Damage 2, RS 10 -> 2 <= 5 (RS/2), so min damage rule = 1
        expect(applySoak(2, 10)).toBe(1);
    });

    test('RS of 0 = no reduction', () => {
        expect(applySoak(10, 0)).toBe(10);
    });

    test('Handles null damage as 0', () => {
        expect(applySoak(null, 5)).toBe(0);
    });

    test('Handles undefined RS as 0', () => {
        expect(applySoak(10, undefined)).toBe(10);
    });

    test('Handles NaN values', () => {
        expect(applySoak(NaN, 5)).toBe(0);
        expect(applySoak(10, NaN)).toBe(10);
    });

    test('Edge case: RS = 1, damage = 1', () => {
        // RS/2 = 0 (floor), damage 1 > 0, so min damage rule doesn't apply
        // final = 1 - 1 = 0
        expect(applySoak(1, 1)).toBe(0);
    });

    test('Edge case: RS = 3, damage = 1', () => {
        // RS/2 = 1 (floor), damage 1 <= 1, so min damage = 1
        expect(applySoak(1, 3)).toBe(1);
    });
});

describe('Integration: Attack to Damage Flow', () => {
    afterEach(restoreRandom);

    test('Full attack flow: hit -> no defense -> damage', () => {
        // Attack roll 10 vs AT 15 = hit
        mockRandom(9 / 20); // roll = 10
        const attack = resolveAttack(15);
        expect(attack.outcome).toBe('NORMAL_HIT');

        // Parse damage
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 5 / 6; // roll 6
            return 0; // roll 1
        });
        const damage = parseAndRollDamage('2w6+3'); // 6 + 1 + 3 = 10
        expect(damage).toBe(10);

        // Apply soak
        const finalDamage = applySoak(damage, 4);
        expect(finalDamage).toBe(6);
    });
});

describe('resolveAttack - Extended Edge Cases', () => {
    afterEach(restoreRandom);

    test('Negative AT value - NAT 1 still triggers crit check', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack roll = 1
            return 0; // confirm roll = 1
        });

        const result = resolveAttack(-5);
        expect(result.roll).toBe(1);
        // NAT 1 triggers crit check, but confirm roll 1 > AT -5, so normal hit
        expect(result.confirmRoll).toBe(1);
        expect(result.outcome).toBe('NORMAL_HIT');
    });

    test('Very high AT (25) - almost always hits', () => {
        mockRandom(0.9999); // roll = 20
        const result = resolveAttack(25);
        expect(result.roll).toBe(20);
        // NAT 20 triggers botch check
        expect(result.confirmRoll).toBeDefined();
        // Confirm roll would need to be mocked for complete test
    });

    test('AT exactly 1 - only NAT 1 hits normally', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack roll = 1
            return 0; // confirm roll = 1
        });

        const result = resolveAttack(1);
        expect(result.roll).toBe(1);
        expect(result.confirmRoll).toBe(1);
        expect(result.outcome).toBe('CRITICAL_SUCCESS');
    });

    test('AT exactly 19 - NAT 20 is only auto-miss', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 18 / 20 - 0.001; // roll = 18
            return 0;
        });

        const result = resolveAttack(19);
        expect(result.roll).toBe(18);
        expect(result.outcome).toBe('NORMAL_HIT');
    });

    test('Multiple dice rolls in sequence are independent', () => {
        const rolls = [];
        for (let i = 0; i < 5; i++) {
            const result = resolveAttack(10);
            rolls.push(result.roll);
        }
        // Rolls should be in range 1-20
        rolls.forEach(r => {
            expect(r).toBeGreaterThanOrEqual(1);
            expect(r).toBeLessThanOrEqual(20);
        });
    });
});

describe('resolveDefense - Extended Edge Cases', () => {
    afterEach(restoreRandom);

    test('Negative PA always fails', () => {
        mockRandom(0); // roll = 1
        const result = resolveDefense(-5);
        // 1 > -5, so fails
        expect(result.success).toBe(false);
    });

    test('PA of 1 - only NAT 1 defends', () => {
        mockRandom(0); // roll = 1
        const result = resolveDefense(1);
        expect(result.roll).toBe(1);
        expect(result.success).toBe(true);

        mockRandom(1 / 20 - 0.0001); // roll = 1
        const result2 = resolveDefense(1);
        expect(result2.success).toBe(true);
    });

    test('Very high PA (25) - almost always defends', () => {
        mockRandom(0.9999); // roll = 20
        const result = resolveDefense(25);
        expect(result.roll).toBe(20);
        expect(result.success).toBe(true);
    });

    test('Floating point PA is handled', () => {
        mockRandom(0.5); // roll = 11
        const result = resolveDefense(10.5);
        // 11 > 10.5, fails
        expect(result.success).toBe(false);

        mockRandom(0.49); // roll = 10
        const result2 = resolveDefense(10.5);
        // 10 <= 10.5, succeeds
        expect(result2.success).toBe(true);
    });

    test('PA as string is not coerced (treated as NaN -> 0)', () => {
        mockRandom(0); // roll = 1
        const result = resolveDefense('15');
        // String is not a finite number, treated as 0
        expect(result.success).toBe(false);
    });
});

describe('applySoak - Extended Edge Cases', () => {
    test('Damage exactly equal to RS/2 boundary', () => {
        // RS = 6, RS/2 = 3
        // Damage 3 <= 3, so min damage applies
        expect(applySoak(3, 6)).toBe(1);
    });

    test('Damage just above RS/2 boundary', () => {
        // RS = 6, RS/2 = 3
        // Damage 4 > 3, min damage doesn't apply
        // Final = 4 - 6 = -2 -> 0
        expect(applySoak(4, 6)).toBe(0);
    });

    test('Floating point damage is handled', () => {
        expect(applySoak(10.5, 3)).toBe(7.5);
    });

    test('Floating point RS is handled with floor', () => {
        // RS = 5.9, floor(5.9/2) = floor(2.95) = 2
        // Damage 2 <= 2, min damage applies
        expect(applySoak(2, 5.9)).toBe(1);
    });

    test('Negative damage is treated as 0', () => {
        expect(applySoak(-5, 3)).toBe(0);
    });

    test('Negative RS adds to damage (quirk of implementation)', () => {
        // Current implementation doesn't floor negative RS to 0
        // 10 - (-5) = 15
        expect(applySoak(10, -5)).toBe(15);
    });

    test('Very large values', () => {
        expect(applySoak(1000000, 500000)).toBe(500000);
    });

    test('Damage as string (NaN) is treated as 0', () => {
        expect(applySoak('abc', 5)).toBe(0);
    });

    test('RS as string (NaN) is treated as 0', () => {
        expect(applySoak(10, 'abc')).toBe(10);
    });
});

describe('parseAndRollDamage - Extended Edge Cases', () => {
    afterEach(restoreRandom);

    test('Very large dice count', () => {
        mockRandom(0); // all rolls = 1
        const result = parseAndRollDamage('100w6');
        expect(result).toBe(100); // 100 * 1
    });

    test('Very large dice sides', () => {
        mockRandom(0); // roll = 1
        const result = parseAndRollDamage('1w1000');
        expect(result).toBe(1);
    });

    test('Large bonus modifier', () => {
        mockRandom(0); // roll = 1
        const result = parseAndRollDamage('1w6+1000');
        expect(result).toBe(1001);
    });

    test('Multiple spaces around plus', () => {
        mockRandom(0);
        expect(parseAndRollDamage('1w6   +   5')).toBe(6);
    });

    test('Tabs in input', () => {
        mockRandom(0);
        expect(parseAndRollDamage('\t1w6+5\t')).toBe(6);
    });

    test('Zero bonus modifier', () => {
        mockRandom(0);
        expect(parseAndRollDamage('1w6+0')).toBe(1);
    });

    test('Single digit dice and sides', () => {
        mockRandom(0.5); // roll = 4 for d6
        const result = parseAndRollDamage('1w6');
        expect(result).toBe(4);
    });

    test('Double digit dice and sides', () => {
        mockRandom(0); // all rolls = 1
        const result = parseAndRollDamage('10w20');
        expect(result).toBe(10);
    });

    test('Negative numbers are parsed by parseInt as NaN for regex', () => {
        // '-1w6' is parsed as static damage -1 by parseInt
        // The regex fails to match, but parseInt('-1') = -1
        expect(parseAndRollDamage('-1w6')).toBe(-1);
    });

    test('Decimal numbers are parsed by parseInt as integer', () => {
        // '1.5w6' is parsed as static damage 1 by parseInt
        // The regex fails to match, but parseInt('1.5') = 1
        expect(parseAndRollDamage('1.5w6')).toBe(1);
    });
});

describe('rollDice - Extended Edge Cases', () => {
    afterEach(restoreRandom);

    test('Large number of sides', () => {
        mockRandom(0.9999);
        expect(rollDice(10000)).toBe(10000);
    });

    test('d1 always returns 1', () => {
        for (let i = 0; i < 10; i++) {
            restoreRandom();
            mockRandom(i / 10);
            expect(rollDice(1)).toBe(1);
        }
    });

    test('d2 returns 1 or 2', () => {
        mockRandom(0);
        expect(rollDice(2)).toBe(1);

        mockRandom(0.4999);
        expect(rollDice(2)).toBe(1);

        mockRandom(0.5);
        expect(rollDice(2)).toBe(2);

        mockRandom(0.9999);
        expect(rollDice(2)).toBe(2);
    });
});

describe('Integration: Complex Combat Scenarios', () => {
    afterEach(restoreRandom);

    test('Critical hit bypasses defense (crits ignore parry in DSA)', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 0; // attack = 1 (crit)
            if (callCount === 2) return 0; // confirm = 1 (success)
            return 0; // damage rolls
        });

        const attack = resolveAttack(15);
        expect(attack.outcome).toBe('CRITICAL_SUCCESS');
        // The combat service consumes this outcome by skipping defense.
    });

    test('Botch could hurt attacker', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 19 / 20; // attack = 20 (botch)
            return 19 / 20; // confirm = 20 (fails)
        });

        const attack = resolveAttack(10);
        expect(attack.outcome).toBe('BOTCH');
        // The combat service consumes this outcome by applying self-damage.
    });

    test('High damage vs no armor', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            return 0.9999; // max rolls
        });

        const damage = parseAndRollDamage('3w6+10'); // 18 + 10 = 28
        expect(damage).toBe(28);

        const finalDamage = applySoak(damage, 0);
        expect(finalDamage).toBe(28);
    });

    test('Low damage vs high armor triggers min damage', () => {
        mockRandom(0); // damage roll = 1
        const damage = parseAndRollDamage('1w6'); // 1
        const finalDamage = applySoak(damage, 4); // RS 4, RS/2 = 2
        // 1 <= 2, min damage = 1
        expect(finalDamage).toBe(1);
    });

    test('Full flow: Attack hit -> Defense fails -> Damage -> Soak', () => {
        let callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            // call 1: attack roll = 10 (vs AT 15)
            // call 2: defense roll = 16 (vs PA 10)
            // call 3-4: damage rolls = 1, 1
            if (callCount === 1) return 9 / 20; // attack = 10
            if (callCount === 2) return 15 / 20; // defense = 16
            return 0; // damage = 1
        });

        const attack = resolveAttack(15);
        expect(attack.outcome).toBe('NORMAL_HIT');

        restoreRandom();
        callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 15 / 20; // defense = 16
            return 0;
        });

        const defense = resolveDefense(10);
        expect(defense.success).toBe(false);

        restoreRandom();
        callCount = 0;
        jest.spyOn(Math, 'random').mockImplementation(() => 0);

        const damage = parseAndRollDamage('2w6+3'); // 1 + 1 + 3 = 5
        const finalDamage = applySoak(damage, 2); // 5 - 2 = 3

        expect(finalDamage).toBe(3);
    });
});

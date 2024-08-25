// utils/rollUtil.js

/**
 * Rolls a dice with the specified number of sides.
 * @param {number} sides - The number of sides on the dice.
 * @returns {number} The result of the dice roll.
 */
function rollDice(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

module.exports = {
    rollDice,
};

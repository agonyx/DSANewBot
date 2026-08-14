const LEGACY_COMMANDS = new Set([
    'add-item',
    'add-mob',
    'add-weapon',
    'attack',
    'cancel-casting',
    'choose-character',
    'combat-log',
    'complete-casting',
    'create-character',
    'delete-character',
    'delete-mob',
    'delete-weapon',
    'edit-item',
    'edit-mob',
    'edit-skills',
    'edit-stats',
    'edit-weapon',
    'end-combat',
    'equip-weapon',
    'evade',
    'export-character',
    'heal',
    'list-maneuvers',
    'list-mobs',
    'park-combat',
    'remove-item',
    'resume-combat',
    'show-items',
    'show-maneuver',
    'show-mob',
    'show-skills',
    'show-stats',
    'show-weapons',
    'start-combat',
    'supernatural-effects',
    'upload-avatar',
    'use-item',
    'use-skill',
]);

const DEVELOPMENT_COMMANDS = new Set(['dev-test-character', 'dev-test-mobs']);

function shouldRegisterCommand(commandName, { includeDevelopment = process.env.DEV_MODE === 'true' } = {}) {
    if (LEGACY_COMMANDS.has(commandName)) return false;
    if (DEVELOPMENT_COMMANDS.has(commandName)) return includeDevelopment;
    return true;
}

module.exports = { DEVELOPMENT_COMMANDS, LEGACY_COMMANDS, shouldRegisterCommand };

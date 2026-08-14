require('tsx/cjs');
require('dotenv').config();

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEVELOPMENT_COMMANDS, LEGACY_COMMANDS, shouldRegisterCommand } = require('../utils/commandRegistration');

const commandsPath = path.join(__dirname, '..', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const modules = [];

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (!command.data || typeof command.execute !== 'function') {
        throw new Error(`${file} must export data and execute`);
    }

    const metadata = command.data.toJSON();
    if (!metadata.name) throw new Error(`${file} has no command name`);
    modules.push({ file, metadata });
}

function validateRegistration(includeDevelopment) {
    const names = new Set();
    for (const { file, metadata } of modules) {
        if (!shouldRegisterCommand(metadata.name, { includeDevelopment })) continue;
        if (names.has(metadata.name)) throw new Error(`Duplicate registered command name: ${metadata.name} (${file})`);
        names.add(metadata.name);
    }
    return names;
}

const productionNames = validateRegistration(false);
const developmentNames = validateRegistration(true);
const metadataByName = new Map(modules.map(({ metadata }) => [metadata.name, metadata]));
const expectedFamilies = new Map([
    ['character', ['create', 'select', 'sheet', 'edit', 'export', 'avatar', 'delete', 'restore-lep']],
    ['combat', ['start', 'end', 'pause', 'resume', 'log']],
    ['inventory', ['add', 'list', 'edit', 'remove', 'use']],
    ['inv', ['add', 'list', 'edit', 'remove', 'use']],
    ['items', ['add', 'list', 'edit', 'remove', 'use']],
    ['weapon', ['add', 'list', 'edit', 'equip', 'delete']],
    ['mob', ['add', 'list', 'show', 'edit', 'delete']],
    ['maneuver', ['list', 'show', 'use']],
    ['casting', ['status', 'complete', 'cancel']],
    ['ability', ['list']],
]);

for (const [name, expectedSubcommands] of expectedFamilies) {
    assert(productionNames.has(name), `Missing canonical production command: ${name}`);
    assert.deepEqual(
        metadataByName.get(name).options.map(option => option.name),
        expectedSubcommands,
        `Unexpected /${name} subcommand tree`
    );
}

assert.deepEqual(
    metadataByName.get('inv').options,
    metadataByName.get('inventory').options,
    '/inv must alias /inventory'
);
assert.deepEqual(
    metadataByName.get('items').options,
    metadataByName.get('inventory').options,
    '/items must alias /inventory'
);
for (const name of LEGACY_COMMANDS) assert(!productionNames.has(name), `Legacy command is still registered: ${name}`);
for (const name of DEVELOPMENT_COMMANDS) {
    assert(!productionNames.has(name), `Development command is registered in production: ${name}`);
    assert(developmentNames.has(name), `Development command is missing in development mode: ${name}`);
}
assert.equal(productionNames.size, 36, 'Unexpected production command count');
assert.equal(developmentNames.size, 38, 'Unexpected development command count');
process.stdout.write(
    `Validated ${modules.length} command modules: ${productionNames.size} production and ${developmentNames.size} development commands.\n`
);

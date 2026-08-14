require('tsx/cjs');
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const commandsPath = path.join(__dirname, '..', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const names = new Set();

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (!command.data || typeof command.execute !== 'function') {
        throw new Error(`${file} must export data and execute`);
    }

    const metadata = command.data.toJSON();
    if (!metadata.name) throw new Error(`${file} has no command name`);
    if (names.has(metadata.name)) throw new Error(`Duplicate command name: ${metadata.name}`);
    names.add(metadata.name);
}

if (names.size !== commandFiles.length) {
    throw new Error(`Validated ${names.size} names for ${commandFiles.length} command files`);
}

process.stdout.write(`Validated ${names.size} Discord commands.\n`);

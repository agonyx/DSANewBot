const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'character',
    description: 'Create, select, inspect, and maintain your characters',
    subcommands: [
        { name: 'create', description: 'Create a new character', command: require('./create-character') },
        { name: 'select', description: 'Select your active character', command: require('./choose-character') },
        { name: 'sheet', description: 'Show the selected character sheet', command: require('./show-stats') },
        { name: 'edit', description: 'Edit the selected character sheet', command: require('./edit-stats') },
        { name: 'export', description: 'Export the selected character sheet', command: require('./export-character') },
        {
            name: 'avatar',
            description: 'Upload an avatar for the selected character',
            command: require('./upload-avatar'),
        },
        {
            name: 'delete',
            description: 'Permanently delete one of your characters',
            command: require('./delete-character'),
        },
        { name: 'restore-lep', description: 'Manually restore Life Points (LeP)', command: require('./heal') },
    ],
});

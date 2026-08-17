const { createDelegatedCommand } = require('../../utils/delegatedCommand');

function createInventoryCommand(name) {
    return createDelegatedCommand({
        name,
        description: 'Manage carried items and consumables',
        subcommands: [
            { name: 'add', command: require('../add-item') },
            { name: 'list', command: require('../show-items') },
            { name: 'edit', command: require('../edit-item') },
            { name: 'remove', command: require('../remove-item') },
            { name: 'use', command: require('../use-item') },
        ],
    });
}

module.exports = { createInventoryCommand };

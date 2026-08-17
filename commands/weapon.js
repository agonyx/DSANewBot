const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'weapon',
    description: 'Create, inspect, edit, equip, or delete weapons',
    subcommands: [
        { name: 'add', command: require('./add-weapon') },
        { name: 'list', command: require('./show-weapons') },
        { name: 'edit', command: require('./edit-weapon') },
        { name: 'equip', command: require('./equip-weapon') },
        { name: 'delete', command: require('./delete-weapon') },
    ],
});

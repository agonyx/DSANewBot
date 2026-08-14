const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'ability',
    description: 'Inspect learned special abilities',
    subcommands: [{ name: 'list', command: require('./show-skills') }],
});

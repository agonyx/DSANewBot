const { createRenamedCommand } = require('../utils/delegatedCommand');

module.exports = createRenamedCommand({
    name: 'attack-check',
    description: 'Roll a standalone attack check outside tracked combat',
    command: require('./attack'),
});

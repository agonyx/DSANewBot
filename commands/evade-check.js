const { createRenamedCommand } = require('../utils/delegatedCommand');

module.exports = createRenamedCommand({
    name: 'evade-check',
    description: 'Roll a standalone evasion check outside tracked combat',
    command: require('./evade'),
});

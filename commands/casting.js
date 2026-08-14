const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'casting',
    description: 'Inspect, complete, or cancel extended supernatural castings',
    subcommands: [
        { name: 'status', command: require('./supernatural-effects') },
        { name: 'complete', command: require('./complete-casting') },
        { name: 'cancel', command: require('./cancel-casting') },
    ],
});

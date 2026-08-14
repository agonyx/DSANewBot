const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'maneuver',
    description: 'Browse, inspect, or use combat maneuvers',
    subcommands: [
        { name: 'list', command: require('./list-maneuvers') },
        { name: 'show', command: require('./show-maneuver') },
        { name: 'use', command: require('./use-skill') },
    ],
});

const { createDelegatedCommand } = require('../utils/delegatedCommand');

module.exports = createDelegatedCommand({
    name: 'combat',
    description: 'Start, pause, resume, end, or review a combat session',
    subcommands: [
        { name: 'start', command: require('./start-combat') },
        { name: 'end', command: require('./end-combat') },
        { name: 'pause', command: require('./park-combat') },
        { name: 'resume', command: require('./resume-combat') },
        { name: 'log', command: require('./combat-log') },
    ],
});

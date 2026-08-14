const { PermissionFlagsBits } = require('discord.js');
const { createDelegatedCommand } = require('../utils/delegatedCommand');

const MANAGE_SUBCOMMANDS = new Set(['add', 'edit', 'delete']);

module.exports = createDelegatedCommand({
    name: 'mob',
    description: 'Create, inspect, edit, or delete combat mob templates',
    subcommands: [
        { name: 'add', command: require('./add-mob') },
        { name: 'list', command: require('./list-mobs') },
        { name: 'show', command: require('./show-mob') },
        { name: 'edit', command: require('./edit-mob') },
        { name: 'delete', command: require('./delete-mob') },
    ],
    async beforeExecute(interaction, subcommand) {
        if (!MANAGE_SUBCOMMANDS.has(subcommand)) return true;
        if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
        await interaction.reply({
            content: '❌ Managing mob templates requires Manage Server permission.',
            ephemeral: true,
        });
        return false;
    },
});

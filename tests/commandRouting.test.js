const { SlashCommandBuilder } = require('discord.js');
const { createDelegatedCommand, createRenamedCommand } = require('../utils/delegatedCommand');
const { shouldRegisterCommand } = require('../utils/commandRegistration');

function leafCommand(name, execute = jest.fn(), autocomplete) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(`${name} description`)
            .addStringOption(option =>
                option.setName('query').setDescription('Query').setRequired(true).setAutocomplete(Boolean(autocomplete))
            ),
        execute,
        autocomplete,
    };
}

describe('delegated command roots', () => {
    it('copies leaf options and delegates execution by subcommand', async () => {
        const execute = jest.fn().mockResolvedValue('done');
        const source = leafCommand('legacy', execute);
        const command = createDelegatedCommand({
            name: 'canonical',
            description: 'Canonical command',
            subcommands: [{ name: 'run', command: source }],
        });
        const metadata = command.data.toJSON();
        expect(metadata.options[0]).toMatchObject({ name: 'run', type: 1 });
        expect(metadata.options[0].options[0]).toMatchObject({ name: 'query', required: true, type: 3 });

        const interaction = { options: { getSubcommand: () => 'run' } };
        await expect(command.execute(interaction)).resolves.toBe('done');
        expect(execute).toHaveBeenCalledWith(interaction);
    });

    it('delegates autocomplete only to the selected subcommand', async () => {
        const autocomplete = jest.fn().mockResolvedValue('choices');
        const command = createDelegatedCommand({
            name: 'canonical',
            description: 'Canonical command',
            subcommands: [{ name: 'find', command: leafCommand('legacy', jest.fn(), autocomplete) }],
        });
        const interaction = { options: { getSubcommand: () => 'find' } };
        await expect(command.autocomplete(interaction)).resolves.toBe('choices');
        expect(autocomplete).toHaveBeenCalledWith(interaction);
    });

    it('runs a root authorization hook before invoking a delegated handler', async () => {
        const execute = jest.fn();
        const beforeExecute = jest.fn().mockResolvedValue(false);
        const command = createDelegatedCommand({
            name: 'canonical',
            description: 'Canonical command',
            subcommands: [{ name: 'restricted', command: leafCommand('legacy', execute) }],
            beforeExecute,
        });
        const interaction = { options: { getSubcommand: () => 'restricted' } };

        await expect(command.execute(interaction)).resolves.toBeUndefined();
        expect(beforeExecute).toHaveBeenCalledWith(interaction, 'restricted');
        expect(execute).not.toHaveBeenCalled();
    });

    it('creates renamed commands without changing their handler behavior', async () => {
        const execute = jest.fn().mockResolvedValue('done');
        const legacy = leafCommand('legacy', execute);
        const renamed = createRenamedCommand({ name: 'new-name', command: legacy });
        expect(renamed.data.toJSON().name).toBe('new-name');
        const interaction = {};
        await expect(renamed.execute(interaction)).resolves.toBe('done');
        expect(execute).toHaveBeenCalledWith(interaction);
    });
});

describe('command registration policy', () => {
    it('hides consolidated legacy commands', () => {
        for (const name of ['show-items', 'create-character', 'start-combat', 'edit-skills', 'attack']) {
            expect(shouldRegisterCommand(name, { includeDevelopment: false })).toBe(false);
        }
    });

    it('registers development commands only in development mode', () => {
        expect(shouldRegisterCommand('dev-test-character', { includeDevelopment: false })).toBe(false);
        expect(shouldRegisterCommand('dev-test-character', { includeDevelopment: true })).toBe(true);
    });
});

const {
    VISIBILITY_OPTION,
    addVisibilityOption,
    interactionVisibility,
    deferWithVisibility,
} = require('../utils/interactionVisibility');
const { SlashCommandBuilder } = require('discord.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function optionNames(metadata) {
    return (metadata.options || []).map(option => option.name);
}

function loadCommandMetadata(commandPath) {
    const absolutePath = path.resolve(__dirname, commandPath).replace(/\\/g, '/');
    const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--eval', `process.stdout.write(JSON.stringify(require('${absolutePath}').data.toJSON()))`],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
    );
    return JSON.parse(output);
}

describe('shared interaction visibility', () => {
    test.each([
        [true, { visible: true, ephemeral: false }],
        [false, { visible: false, ephemeral: true }],
        [null, { visible: false, ephemeral: true }],
    ])('maps visible=%s before acknowledgement', async (value, expected) => {
        const interaction = {
            options: { getBoolean: jest.fn(() => value) },
            deferReply: jest.fn(async () => undefined),
        };
        expect(interactionVisibility(interaction)).toEqual(expected);
        await deferWithVisibility(interaction);
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: expected.ephemeral });
    });

    test('adds the standardized optional command option', () => {
        const metadata = addVisibilityOption(
            new SlashCommandBuilder().setName('sample').setDescription('Sample')
        ).toJSON();
        expect(optionNames(metadata)).toContain(VISIBILITY_OPTION);
        expect(metadata.options.find(option => option.name === VISIBILITY_OPTION).required).not.toBe(true);
    });
});

describe('safe command registration', () => {
    test('target-free checks and safe catalog commands expose visible', () => {
        for (const path of [
            '../commands/attack-check',
            '../commands/attack-resolve',
            '../commands/evade-check',
            '../commands/show-skills',
            '../commands/list-maneuvers',
            '../commands/show-maneuver',
            '../commands/list-mobs',
            '../commands/show-mob',
            '../commands/show-items',
            '../commands/show-weapons',
            '../commands/show-stats',
            '../commands/combat-log',
        ]) {
            expect(optionNames(loadCommandMetadata(path))).toContain(VISIBILITY_OPTION);
        }
    });

    test('attack check is target-free while explicit resolution requires target and confirmation', () => {
        const check = loadCommandMetadata('../commands/attack-check');
        const resolve = loadCommandMetadata('../commands/attack-resolve');
        expect(optionNames(check)).not.toContain('target');
        expect(resolve.options.find(option => option.name === 'target').required).toBe(true);
        expect(resolve.options.find(option => option.name === 'confirm').required).toBe(true);
    });

    test.each([
        ['../commands/equipment', 'show'],
        ['../commands/shop', 'browse'],
        ['../commands/tradition', 'show'],
        ['../commands/background', 'show'],
        ['../commands/party', 'view'],
    ])('%s %s exposes visibility only on its safe display path', (commandPath, safeSubcommand) => {
        const command = loadCommandMetadata(commandPath);
        const display = command.options.find(option => option.name === safeSubcommand);
        expect(optionNames(display)).toContain(VISIBILITY_OPTION);
        for (const subcommand of command.options.filter(option => option.name !== safeSubcommand)) {
            expect(optionNames(subcommand)).not.toContain(VISIBILITY_OPTION);
        }
    });

    test('spell and liturgy visibility is present only on safe presentation subcommands', () => {
        const spells = loadCommandMetadata('../commands/spells');
        const liturgies = loadCommandMetadata('../commands/liturgies');
        for (const name of ['list', 'show', 'cast']) {
            expect(optionNames(spells.options.find(option => option.name === name))).toContain(VISIBILITY_OPTION);
        }
        expect(optionNames(spells.options.find(option => option.name === 'learn'))).not.toContain(VISIBILITY_OPTION);
        for (const name of ['list', 'show', 'perform']) {
            expect(optionNames(liturgies.options.find(option => option.name === name))).toContain(VISIBILITY_OPTION);
        }
        expect(optionNames(liturgies.options.find(option => option.name === 'learn'))).not.toContain(VISIBILITY_OPTION);
    });
});

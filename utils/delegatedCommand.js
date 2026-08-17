const { ApplicationCommandOptionType, SlashCommandBuilder } = require('discord.js');

const OPTION_ADDERS = {
    [ApplicationCommandOptionType.String]: 'addStringOption',
    [ApplicationCommandOptionType.Integer]: 'addIntegerOption',
    [ApplicationCommandOptionType.Boolean]: 'addBooleanOption',
    [ApplicationCommandOptionType.User]: 'addUserOption',
    [ApplicationCommandOptionType.Channel]: 'addChannelOption',
    [ApplicationCommandOptionType.Role]: 'addRoleOption',
    [ApplicationCommandOptionType.Mentionable]: 'addMentionableOption',
    [ApplicationCommandOptionType.Number]: 'addNumberOption',
    [ApplicationCommandOptionType.Attachment]: 'addAttachmentOption',
};

function copyOption(target, source) {
    const adder = OPTION_ADDERS[source.type];
    if (!adder || typeof target[adder] !== 'function') {
        throw new Error(`Unsupported delegated command option type: ${source.type}`);
    }

    target[adder](option => {
        option.setName(source.name).setDescription(source.description);
        if (source.required) option.setRequired(true);
        if (source.name_localizations) option.setNameLocalizations(source.name_localizations);
        if (source.description_localizations) option.setDescriptionLocalizations(source.description_localizations);
        if (source.choices?.length) option.addChoices(...source.choices);
        if (source.autocomplete) option.setAutocomplete(true);
        if (source.min_value !== undefined) option.setMinValue(source.min_value);
        if (source.max_value !== undefined) option.setMaxValue(source.max_value);
        if (source.min_length !== undefined) option.setMinLength(source.min_length);
        if (source.max_length !== undefined) option.setMaxLength(source.max_length);
        if (source.channel_types?.length) option.setChannelTypes(...source.channel_types);
        return option;
    });
}

function addDelegatedSubcommand(builder, definition) {
    const source = definition.command.data.toJSON();
    if (
        source.options?.some(option =>
            [ApplicationCommandOptionType.Subcommand, ApplicationCommandOptionType.SubcommandGroup].includes(
                option.type
            )
        )
    ) {
        throw new Error(`Cannot nest command /${source.name}; it already contains subcommands`);
    }

    builder.addSubcommand(subcommand => {
        subcommand.setName(definition.name).setDescription(definition.description || source.description);
        for (const option of source.options || []) copyOption(subcommand, option);
        return subcommand;
    });
}

function createDelegatedCommand({ name, description, subcommands, beforeExecute }) {
    const data = new SlashCommandBuilder().setName(name).setDescription(description);
    const handlers = new Map();

    for (const definition of subcommands) {
        if (handlers.has(definition.name)) throw new Error(`Duplicate delegated subcommand: ${definition.name}`);
        addDelegatedSubcommand(data, definition);
        handlers.set(definition.name, definition.command);
    }

    return {
        data,
        async autocomplete(interaction) {
            const subcommand = interaction.options.getSubcommand();
            const handler = handlers.get(subcommand);
            if (!handler?.autocomplete) return interaction.respond([]);
            return handler.autocomplete(interaction);
        },
        async execute(interaction) {
            const subcommand = interaction.options.getSubcommand();
            const handler = handlers.get(subcommand);
            if (!handler) throw new Error(`Unknown /${name} subcommand: ${subcommand}`);
            if (beforeExecute && !(await beforeExecute(interaction, subcommand))) return undefined;
            return handler.execute(interaction);
        },
    };
}

function createRenamedCommand({ name, description, command }) {
    const source = command.data.toJSON();
    const data = new SlashCommandBuilder().setName(name).setDescription(description || source.description);
    for (const option of source.options || []) copyOption(data, option);

    return {
        data,
        autocomplete: command.autocomplete?.bind(command),
        execute: command.execute.bind(command),
    };
}

module.exports = { createDelegatedCommand, createRenamedCommand };

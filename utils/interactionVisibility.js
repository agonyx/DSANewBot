const VISIBILITY_OPTION = 'visible';

function addVisibilityOption(builder, description = 'Show this safe result to everyone') {
    return builder.addBooleanOption(option =>
        option.setName(VISIBILITY_OPTION).setDescription(description).setRequired(false)
    );
}

function interactionVisibility(interaction) {
    const visible = interaction.options.getBoolean(VISIBILITY_OPTION) === true;
    return { visible, ephemeral: !visible };
}

async function deferWithVisibility(interaction) {
    const visibility = interactionVisibility(interaction);
    await interaction.deferReply({ ephemeral: visibility.ephemeral });
    return visibility;
}

module.exports = { VISIBILITY_OPTION, addVisibilityOption, interactionVisibility, deferWithVisibility };

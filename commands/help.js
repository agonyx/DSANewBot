const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands and usage information')
        .addStringOption(option =>
            option
                .setName('category')
                .setDescription('Category to get help for')
                .setRequired(false)
                .addChoices(
                    { name: 'Character', value: 'character' },
                    { name: 'Combat', value: 'combat' },
                    { name: 'Items & Inventory', value: 'items' },
                    { name: 'Weapons', value: 'weapons' },
                    { name: 'Skills', value: 'skills' },
                    { name: 'Magic & Karma', value: 'supernatural' },
                    { name: 'Equipment & Economy', value: 'economy' },
                    { name: 'Mobs (DM)', value: 'mobs' },
                    { name: 'Regelwiki', value: 'regelwiki' },
                    { name: 'Utility', value: 'utility' }
                )
        ),

    async execute(interaction) {
        const category = interaction.options.getString('category');

        if (category) {
            return interaction.reply({
                embeds: [getCategoryHelp(category)],
                ephemeral: true,
            });
        }

        const helpEmbed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('📚 DSA Bot Help')
            .setDescription('A Discord bot for **DSA (Das Schwarze Auge) 5th Edition** combat management.')
            .addFields(
                {
                    name: '👤 Character',
                    value: '`/character` `/advance` `/schicksalspunkte` `/asp` `/kap` `/regeneration` `/treat-wounds`',
                    inline: false,
                },
                {
                    name: '⚔️ Combat',
                    value: '`/combat` `/attack-check` `/evade-check` `/maneuver use` `/combat-action` `/condition` `/status` `/effect`',
                    inline: false,
                },
                {
                    name: '🎒 Items & Inventory',
                    value: '`/inventory` (aliases: `/inv`, `/items`)',
                    inline: false,
                },
                {
                    name: '🗡️ Weapons',
                    value: '`/weapon`',
                    inline: false,
                },
                {
                    name: '💰 Equipment & Economy',
                    value: '`/wallet` `/shop` `/equipment` `/trade` `/loot`',
                    inline: false,
                },
                {
                    name: '📋 Skills',
                    value: '`/ability list` `/maneuver` `/probe`',
                    inline: false,
                },
                {
                    name: '🔮 Magic & Karma',
                    value: '`/tradition` `/spells` `/liturgies` `/casting` `/miracle`',
                    inline: false,
                },
                {
                    name: '👾 Mobs (DM Only)',
                    value: '`/mob`',
                    inline: false,
                },
                {
                    name: '📖 Regelwiki',
                    value: '`/regel`',
                    inline: false,
                },
                {
                    name: '🎲 Utility',
                    value: '`/roll` `/macro` `/help`',
                    inline: false,
                }
            )
            .setFooter({ text: 'Use /help category:<category> for detailed information.' });

        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    },
};

function getCategoryHelp(category) {
    const categories = {
        character: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('👤 Character Commands')
            .setDescription('Manage your DSA character')
            .addFields(
                { name: '/character create', value: 'Create a new character' },
                { name: '/character select', value: 'Select which of your characters to play' },
                { name: '/character sheet', value: "View your selected character's complete sheet" },
                { name: '/character edit', value: 'Interactively edit the selected character sheet' },
                { name: '/character export', value: 'Download the selected character sheet as UTF-8 text' },
                { name: '/character avatar', value: 'Upload a custom character avatar' },
                { name: '/character delete', value: 'Permanently delete a character' },
                {
                    name: '/character restore-lep',
                    value: 'Manually restore LeP to yourself, or another character as DM',
                },
                { name: '/schicksalspunkte', value: 'Spend, restore, set, or show Fate Points' },
                { name: '/asp', value: 'Spend, restore, set, or show Astral Points' },
                { name: '/kap', value: 'Spend, restore, set, or show Karma Points' },
                { name: '/regeneration', value: 'Regenerate LeP, AsP, KaP, and one aggregate wound' },
                { name: '/treat-wounds', value: 'Apply a Heilkunde Wunden treatment' },
                {
                    name: '/advance',
                    value: 'Show/award AP and improve attributes, talents, supernatural FW, or abilities',
                }
            ),

        combat: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('⚔️ Combat Commands')
            .setDescription('Combat encounter management')
            .addFields(
                { name: '/combat start', value: 'Initialize a new combat encounter' },
                { name: '/combat end', value: 'End the current combat session as its DM' },
                { name: '/combat pause', value: 'Pause combat to resume later' },
                { name: '/combat resume', value: 'Resume a paused combat session' },
                { name: '/combat log', value: 'Show the latest active or ended log for this channel' },
                { name: '/attack-check', value: 'Make a standalone attack roll outside tracked combat' },
                { name: '/evade-check', value: 'Make a standalone evasion roll outside tracked combat' },
                { name: '/maneuver use', value: 'Use a combat maneuver' },
                {
                    name: '/combat-action',
                    value: 'Use full defense, reload, escape, two-weapon, or opportunity actions',
                },
                { name: '/condition', value: 'Add, remove, or list leveled combat conditions' },
                { name: '/status', value: 'Add, remove, or list binary combat statuses with optional DOT/penalties' },
                { name: '/effect', value: 'Add, remove, or list persistent combat buffs and debuffs (DM)' }
            ),

        items: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('🎒 Items & Inventory Commands')
            .setDescription('Manage your inventory')
            .addFields(
                { name: '/inventory list', value: 'View your carried items and consumables' },
                { name: '/inventory add', value: 'Add an item to your inventory' },
                { name: '/inventory edit', value: 'Edit an owned item and its equipment metadata' },
                { name: '/inventory remove', value: 'Remove an item from inventory' },
                { name: '/inventory use', value: 'Use a consumable item (potions, food, etc.)' },
                { name: '/inv and /items', value: 'Complete aliases for /inventory' }
            ),

        weapons: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('🗡️ Weapon Commands')
            .setDescription('Manage your weapons')
            .addFields(
                { name: '/weapon list', value: 'View your weapons' },
                { name: '/weapon add', value: 'Add a new weapon to your character' },
                { name: '/weapon edit', value: 'Edit weapon stats, ranges, reload, and hand requirement' },
                { name: '/weapon equip', value: 'Equip a weapon to a slot' },
                { name: '/weapon delete', value: 'Remove a weapon permanently' }
            ),

        skills: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('📋 Skill Commands')
            .setDescription('Combat skills and maneuvers')
            .addFields(
                { name: '/ability list', value: 'View learned combat, magical, and karmic special abilities' },
                { name: '/advance special', value: 'Learn a special ability by spending AP' },
                { name: '/maneuver list', value: 'Browse the combat maneuver catalog' },
                { name: '/maneuver show', value: 'Show rules and prerequisites for a maneuver' },
                { name: '/maneuver use', value: 'Use a learned maneuver in combat' },
                { name: '/probe', value: 'Roll a learned talent probe with optional modifier' }
            ),

        supernatural: new EmbedBuilder()
            .setColor(0x6c3483)
            .setTitle('🔮 Magic & Karma Commands')
            .setDescription('Traditions, learned abilities, casting, ceremonies, and miracles')
            .addFields(
                {
                    name: '/tradition',
                    value: 'Show or configure magical/blessed tradition, deity, and favored talents',
                },
                { name: '/spells', value: 'Browse, learn, inspect, and cast spells or rituals' },
                { name: '/liturgies', value: 'Browse, learn, inspect, and perform liturgies or ceremonies' },
                { name: '/casting complete', value: 'Complete a finished extended ritual or ceremony' },
                { name: '/casting cancel', value: 'Interrupt an extended casting and recover half its resource cost' },
                { name: '/miracle', value: 'Spend 4 KaP for +2 to a favored talent, next AT, or next PA' },
                { name: '/casting status', value: 'Show pending castings and active tracked effects' },
                { name: '/asp', value: 'Manage the Astral Point pool used by spells' },
                { name: '/kap', value: 'Manage the Karma Point pool used by liturgies and miracles' }
            ),

        economy: new EmbedBuilder()
            .setColor(0xd4af37)
            .setTitle('💰 Equipment & Economy Commands')
            .setDescription('Money, shopping, load, armor, trades, and post-combat rewards')
            .addFields(
                { name: '/wallet', value: 'Show the ledger or record a signed tabletop money adjustment' },
                { name: '/shop', value: 'Browse the seeded catalog, buy equipment, or sell at half price' },
                { name: '/equipment', value: 'Equip armor/clothing and show RS, weight, capacity, and Belastung' },
                { name: '/trade', value: 'Offer, list, accept, decline, or cancel atomic character trades' },
                { name: '/loot', value: 'Generate and distribute tiered post-combat loot (DM)' }
            ),

        mobs: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('👾 Mob Commands (DM Only)')
            .setDescription('Create and manage NPC templates for combat')
            .addFields(
                { name: '/mob add', value: 'Create a new mob template (Manage Server)' },
                { name: '/mob edit', value: 'Edit an existing mob template (Manage Server)' },
                { name: '/mob delete', value: 'Delete an existing mob template (Manage Server)' },
                { name: '/mob show', value: 'View mob template details' },
                { name: '/mob list', value: 'List all available mob templates' }
            ),

        regelwiki: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('📖 Regelwiki Commands')
            .setDescription('Search the DSA 5e rules database (7,000+ rules from the Regelwiki)')
            .addFields(
                { name: '/regel <suche>', value: 'Search rules by keyword (e.g., `/regel Finte`)' },
                {
                    name: '/regel <suche> kategorie:<filter>',
                    value: 'Filter by category (e.g., Bestiarium, Magie, Kampf-SF)',
                },
                { name: '/regel <suche> anzahl:5', value: 'Show up to 5 results (default 3)' },
                {
                    name: '/regel <suche> visible:true',
                    value: 'Make the search results visible to everyone',
                }
            ),

        utility: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('🎲 Utility Commands')
            .setDescription('General utility commands')
            .addFields(
                { name: '/roll <dice>', value: 'Roll dice using DSA notation (e.g., `/roll 1w20`, `/roll 3w6+2`)' },
                { name: '/roll <dice> visible:true', value: 'Make the roll visible to everyone' },
                { name: '/macro save|roll|list|delete', value: 'Manage reusable, per-character dice expressions' },
                { name: '/help', value: 'Show this help message' },
                { name: '/help <category>', value: 'Get detailed help for a specific category' }
            ),
    };

    return categories[category] || categories.utility;
}

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
                    value: '`/create-character` `/choose-character` `/show-stats` `/export-character` `/edit-stats` `/advance` `/schicksalspunkte` `/asp` `/kap` `/regeneration` `/treat-wounds` `/upload-avatar` `/delete-character`',
                    inline: false,
                },
                {
                    name: '⚔️ Combat',
                    value: '`/start-combat` `/end-combat` `/park-combat` `/resume-combat` `/combat-log` `/attack` `/evade` `/use-skill` `/combat-action` `/condition` `/status` `/effect`',
                    inline: false,
                },
                {
                    name: '🎒 Items & Inventory',
                    value: '`/show-items` `/add-item` `/edit-item` `/remove-item` `/use-item` `/heal`',
                    inline: false,
                },
                {
                    name: '🗡️ Weapons',
                    value: '`/show-weapons` `/add-weapon` `/edit-weapon` `/equip-weapon` `/delete-weapon`',
                    inline: false,
                },
                {
                    name: '💰 Equipment & Economy',
                    value: '`/wallet` `/shop` `/equipment` `/trade` `/loot`',
                    inline: false,
                },
                {
                    name: '📋 Skills',
                    value: '`/show-skills` `/edit-skills` `/list-maneuvers` `/show-maneuver` `/probe`',
                    inline: false,
                },
                {
                    name: '🔮 Magic & Karma',
                    value: '`/tradition` `/spells` `/liturgies` `/complete-casting` `/cancel-casting` `/miracle` `/supernatural-effects`',
                    inline: false,
                },
                {
                    name: '👾 Mobs (DM Only)',
                    value: '`/add-mob` `/edit-mob` `/delete-mob` `/show-mob` `/list-mobs`',
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
            .setFooter({ text: 'Use /help <category> for detailed information on a category.' });

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
                { name: '/create-character', value: 'Create a new character' },
                { name: '/choose-character', value: 'Select which of your characters to play' },
                { name: '/show-stats', value: "View your character's stats and health" },
                { name: '/export-character', value: 'Download the selected character sheet as a UTF-8 text file' },
                { name: '/edit-stats', value: 'Interactively edit your stats' },
                { name: '/schicksalspunkte', value: 'Spend, restore, set, or show Fate Points' },
                { name: '/asp', value: 'Spend, restore, set, or show Astral Points' },
                { name: '/kap', value: 'Spend, restore, set, or show Karma Points' },
                { name: '/regeneration', value: 'Regenerate LeP, AsP, KaP, and one aggregate wound' },
                { name: '/treat-wounds', value: 'Apply a Heilkunde Wunden treatment' },
                { name: '/upload-avatar', value: 'Upload a custom character avatar' },
                { name: '/delete-character', value: 'Permanently delete a character' },
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
                { name: '/start-combat', value: 'Initialize a new combat encounter (DM)' },
                { name: '/end-combat', value: 'End the current combat session' },
                { name: '/park-combat', value: 'Pause combat to resume later' },
                { name: '/resume-combat', value: 'Resume a paused combat session' },
                { name: '/combat-log', value: 'Show the latest active or ended log for this channel' },
                { name: '/attack', value: 'Make an attack roll' },
                { name: '/evade', value: 'Attempt to dodge an attack' },
                { name: '/use-skill', value: 'Use a combat skill/maneuver' },
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
                { name: '/show-items', value: 'View your inventory' },
                { name: '/add-item', value: 'Add an item to your inventory' },
                { name: '/edit-item', value: 'Edit an owned item and its equipment metadata' },
                { name: '/remove-item', value: 'Remove an item from inventory' },
                { name: '/use-item', value: 'Use a consumable item (potions, food, etc.)' },
                { name: '/heal', value: 'Restore HP to your character (or another as DM)' }
            ),

        weapons: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('🗡️ Weapon Commands')
            .setDescription('Manage your weapons')
            .addFields(
                { name: '/show-weapons', value: 'View your equipped weapons' },
                { name: '/add-weapon', value: 'Add a new weapon to your character' },
                { name: '/edit-weapon', value: 'Edit weapon stats, ranges, reload, and hand requirement' },
                { name: '/equip-weapon', value: 'Equip a weapon to a slot' },
                { name: '/delete-weapon', value: 'Remove a weapon permanently' }
            ),

        skills: new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle('📋 Skill Commands')
            .setDescription('Combat skills and maneuvers')
            .addFields(
                { name: '/show-skills', value: 'View learned combat, magical, and karmic special abilities' },
                { name: '/edit-skills', value: 'Legacy alias: learn a special ability using the AP workflow' },
                { name: '/list-maneuvers', value: 'Browse the combat maneuver catalog' },
                { name: '/show-maneuver', value: 'Show rules and prerequisites for a maneuver' },
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
                { name: '/complete-casting', value: 'Complete a finished extended ritual or ceremony' },
                { name: '/cancel-casting', value: 'Interrupt an extended casting and recover half its resource cost' },
                { name: '/miracle', value: 'Spend 4 KaP for +2 to a favored talent, next AT, or next PA' },
                { name: '/supernatural-effects', value: 'Show pending castings and active tracked effects' },
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
                { name: '/add-mob', value: 'Create a new mob template' },
                { name: '/edit-mob', value: 'Edit an existing mob template' },
                { name: '/delete-mob', value: 'Delete an existing mob template' },
                { name: '/show-mob', value: 'View mob template details' },
                { name: '/list-mobs', value: 'List all available mob templates' }
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

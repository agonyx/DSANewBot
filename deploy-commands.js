require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Check for command line argument
const isGuild = process.argv[2] === 'guild';

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        const route = isGuild
            ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
            : Routes.applicationCommands(process.env.CLIENT_ID);
        const data = await rest.put(route, { body: commands });

        if (isGuild) {
            console.log(`Successfully reloaded ${data.length} application (/) commands for guild: ${process.env.GUILD_ID}.`);
        } else {
            console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
        }
    } catch (error) {
        console.error(error);
    }
})();

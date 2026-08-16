require('dotenv').config();

const { searchRules } = require('../utils/rulesClient');
const { closeDb } = require('../db');

async function main() {
    const query = process.argv.slice(2).join(' ');
    if (!query) {
        console.log('Usage: node query-rules.js <search query>');
        console.log('Example: node query-rules.js "how does bleeding work"');
        process.exit(1);
    }

    console.log(`Searching for: "${query}"\n`);

    const results = await searchRules(query, { limit: 3 });

    for (const result of results) {
        console.log(`--- ${result.title} (${(result.similarity * 100).toFixed(1)}%) ---`);
        console.log(`Category: ${result.category}`);
        const content = result.chunk_text || result.content || '';
        console.log(content.substring(0, 500) + '...\n');
    }
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(closeDb);

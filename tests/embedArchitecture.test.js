const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIRECTORIES = ['commands', 'handlers', 'utils'];

function javascriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return javascriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    });
}

describe('embed architecture', () => {
    test('all runtime embeds use the shared constructor', () => {
        const violations = RUNTIME_DIRECTORIES.flatMap(directory => javascriptFiles(path.join(ROOT, directory)))
            .filter(file => path.basename(file) !== 'embedUtils.js')
            .filter(file => fs.readFileSync(file, 'utf8').includes('new EmbedBuilder'))
            .map(file => path.relative(ROOT, file));

        expect(violations).toEqual([]);
    });

    test('raw colors are centralized in the shared presentation layer', () => {
        const violations = RUNTIME_DIRECTORIES.flatMap(directory => javascriptFiles(path.join(ROOT, directory)))
            .filter(file => path.basename(file) !== 'embedUtils.js')
            .filter(file => /\.setColor\(/.test(fs.readFileSync(file, 'utf8')))
            .map(file => path.relative(ROOT, file));

        expect(violations).toEqual([]);
    });
});

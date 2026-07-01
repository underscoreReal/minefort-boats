const path = require("node:path")
const fs = require("node:fs")

module.exports = {
    getImageAsURI: (filePath) => {
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '');
        const mimeType = ext === 'jpg' ? 'jpeg' : (ext === 'svg' ? 'svg+xml' : ext);
        
        return `data:image/${mimeType};base64,${buffer.toString('base64')}`;
    }
}
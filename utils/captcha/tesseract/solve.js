const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

function execFilePromise(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || stdout || error.message));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

async function tesseract_solve(imagePath) {
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Captcha image not found: ${imagePath}`);
    }

    const outputBase = path.join(
        path.dirname(imagePath),
        `ocr-${path.basename(imagePath, path.extname(imagePath))}`
    );
    // Try multiple page segmentation modes and use a whitelist for alphanumeric chars
    const psmModes = [7, 8, 6, 11, 3];
    const whitelist = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    for (const psm of psmModes) {
        try {
            await execFilePromise("tesseract", [
                imagePath,
                outputBase,
                "-l",
                "eng",
                "--oem",
                "3",
                "--psm",
                String(psm),
                "-c",
                `tessedit_char_whitelist=${whitelist}`
            ]);
        } catch (error) {
            // try next psm
            continue;
        }

        const outputTxt = `${outputBase}.txt`;

        if (!fs.existsSync(outputTxt)) {
            continue;
        }

        const rawText = await fs.promises.readFile(outputTxt, "utf8");
        const cleanedText = rawText.replace(/[^a-zA-Z0-9]/g, "").trim();

        if (cleanedText) {
            return cleanedText;
        }
    }

    throw new Error(
        "Tesseract produced no readable output for the captcha. Ensure the tesseract binary is installed and try different solver settings or use manual mode."
    );
}

module.exports = {
    tesseract_solve
};

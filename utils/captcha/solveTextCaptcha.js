const { config } = require("../../config");
const { getImageAsURI } = require("../loadImage");

function normalizeCaptchaText(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "");
}

async function solveTextCaptcha(options = {}) {
    const solver = options.solver || config.offline_captcha_solver || "manual";
    const imagePath = options.imagePath;

    if (!imagePath) {
        throw new Error("solveTextCaptcha requires an imagePath.");
    }

    if (solver === "manual") {
        return {
            mode: "manual",
            imagePath,
            solution: null
        };
    }

    if (solver === "nopecha") {
        const { nopecha_solve } = require("./nopecha/solve");
        const dataUri = getImageAsURI(imagePath);
        const solution = normalizeCaptchaText(await nopecha_solve(dataUri));

        if (!solution) {
            throw new Error("NopeCHA returned an empty captcha solution.");
        }

        return {
            mode: "nopecha",
            imagePath,
            solution
        };
    }

    if (solver === "tesseract") {
        const { tesseract_solve } = require("./tesseract/solve");
        const solution = normalizeCaptchaText(await tesseract_solve(imagePath));

        if (!solution) {
            throw new Error("Tesseract returned an empty captcha solution.");
        }

        return {
            mode: "tesseract",
            imagePath,
            solution
        };
    }

    throw new Error(`Unsupported captcha solver: ${solver}`);
}

module.exports = {
    normalizeCaptchaText,
    solveTextCaptcha
};

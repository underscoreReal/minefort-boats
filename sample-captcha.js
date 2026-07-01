const fs = require("fs");
const path = require("path");
const mineflayer = require("mineflayer");
const { config } = require("./config");
const wait = require("./utils/wait");
const { OfflineCaptchaAuthFlow } = require("./utils/auth/offlineCaptchaAuthFlow");
const crypto = require("crypto");

const HOST = "play.minefort.com";
const PORT = 25565;
const SAMPLE_DIR = path.resolve(__dirname, "captcha-samples");
const MIN_REJOIN_DELAY_MS = 5000;
const MAX_REJOIN_DELAY_MS = 10000;
const CYCLE_TIMEOUT_MS = 30000;

let stopped = false;
let currentBot = null;
let currentCycleTimeout = null;
let nextImageIndex = getNextImageIndex(SAMPLE_DIR);

function log(scope, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${scope}] ${message}`);
}

function ensureSampleDirectory() {
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });
}

function getNextImageIndex(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return 1;
    }

    const matches = fs
        .readdirSync(directoryPath)
        .map((fileName) => /^img-(\d+)\.png$/i.exec(fileName))
        .filter(Boolean)
        .map((match) => Number.parseInt(match[1], 10))
        .filter((value) => Number.isInteger(value) && value > 0);

    return matches.length > 0 ? Math.max(...matches) + 1 : 1;
}

function getRandomDelayMs() {
    return Math.floor(Math.random() * (MAX_REJOIN_DELAY_MS - MIN_REJOIN_DELAY_MS + 1)) + MIN_REJOIN_DELAY_MS;
}
const allowedLetters = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890!@#$%^&*()-=_+{}[]\\|,.<>/?"
function generateUsername(length = 12) {
  const bytes = crypto.randomBytes(length);

  return Array.from(bytes, b => allowedLetters[b % allowedLetters.length]).join("");
}

function getSamplerUsername() {
    const username = generateUsername();

    return username;
}

function clearCycleTimeout() {
    if (currentCycleTimeout) {
        clearTimeout(currentCycleTimeout);
        currentCycleTimeout = null;
    }
}

async function disconnectCurrentBot(reason) {
    clearCycleTimeout();

    if (!currentBot) {
        return;
    }

    const bot = currentBot;
    currentBot = null;

    try {
        if (bot.authFlow) {
            bot.authFlow.destroy();
        }

        if (typeof bot.quit === "function") {
            bot.quit(reason || "Cycle complete");
        } else if (typeof bot.end === "function") {
            bot.end();
        }
    } catch (error) {
        log("disconnect", `Failed to close bot cleanly: ${error.message}`);
    }
}

async function scheduleNextCycle(reason) {
    if (stopped) {
        return;
    }

    const delayMs = getRandomDelayMs();
    const delaySeconds = (delayMs / 1000).toFixed(1);
    log("cycle", `${reason}. Rejoining in ${delaySeconds}s...`);
    await wait(delayMs / 1000);

    if (!stopped) {
        startSamplingCycle().catch((error) => {
            log("cycle", `Restart failed: ${error.message}`);
            scheduleNextCycle("Restart failed").catch(() => {});
        });
    }
}

async function startSamplingCycle() {
    ensureSampleDirectory();

    const username = getSamplerUsername();
    const imagePath = path.join(SAMPLE_DIR, `img-${nextImageIndex}.png`);
    const samplerConfig = {
        ...config,
        offline_captcha_solver: "manual"
    };

    log("cycle", `Starting sample cycle for ${username} -> ${path.basename(imagePath)}`);

    const bot = mineflayer.createBot({
        host: HOST,
        port: PORT,
        username,
        auth: "offline",
        version: false,
        viewDistance: "tiny"
    });

    currentBot = bot;

    const authFlow = new OfflineCaptchaAuthFlow(bot, {
        config: samplerConfig,
        username,
        password: config.offline_password,
        captchaPath: imagePath,
        log: (scope, message) => log(scope, message),
        sendChat: () => {}
    });

    bot.authFlow = authFlow;

    let cycleFinished = false;

    const finishCycle = async (reason) => {
        if (cycleFinished) {
            return;
        }

        cycleFinished = true;
        await disconnectCurrentBot(reason);
    };

    authFlow.on("captchaSaved", async ({ imagePath: savedPath, frameCount }) => {
        log("captcha", `Saved ${frameCount} tiles to ${savedPath}`);
        nextImageIndex += 1;
        await finishCycle("Sample captured");
    });

    authFlow.on("captchaManualRequired", () => {
        log("captcha", "Manual solver disabled for sampler flow; keeping image only.");
    });

    authFlow.on("error", (error) => {
        log("captcha", error.message);
    });

    bot.once("spawn", () => {
        log("bot", `Spawned as ${username}`);
    });

    bot.on("message", async (jsonMessage) => {
        try {
            await authFlow.handleChatMessage(jsonMessage.toString());
        } catch (error) {
            log("chat", error.message);
        }
    });

    bot.once("end", () => {
        clearCycleTimeout();
        if (currentBot === bot) {
            currentBot = null;
        }

        authFlow.destroy();
        scheduleNextCycle("Bot disconnected").catch(() => {});
    });

    bot.on("kicked", (reason) => {
        log("bot", `Kicked: ${reason}`);
    });

    bot.on("error", (error) => {
        log("bot", error.message);
    });

    currentCycleTimeout = setTimeout(() => {
        finishCycle("Timed out waiting for captcha").catch(() => {});
    }, CYCLE_TIMEOUT_MS);

    try {
        await authFlow.attach(bot);
    } catch (error) {
        await finishCycle(`Captcha setup failed: ${error.message}`);
        return;
    }
}

async function shutdown() {
    stopped = true;
    await disconnectCurrentBot("Sampler stopped");
    process.exit(0);
}

process.on("SIGINT", () => {
    shutdown().catch((error) => {
        log("shutdown", error.message);
        process.exit(1);
    });
});

process.on("SIGTERM", () => {
    shutdown().catch((error) => {
        log("shutdown", error.message);
        process.exit(1);
    });
});

startSamplingCycle().catch((error) => {
    log("startup", error.message);
    scheduleNextCycle("Initial start failed").catch(() => {});
});

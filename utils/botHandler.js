const mineflayer = require("mineflayer");
const crypto = require("crypto");
const wait = require("./wait");
const { OfflineCaptchaAuthFlow } = require("./auth/offlineCaptchaAuthFlow");
const { config } = require("../config");
const EventEmitter = require("events");

const bots = [];
const globalEvents = new EventEmitter();

function getBotByUsername(username) {
    return bots.find((bot) => bot.username === username) || null;
}

function removeBot(bot) {
    const index = bots.indexOf(bot);

    if (index !== -1) {
        bots.splice(index, 1);
    }
}

function normalizeUsernames(usernames) {
    if (typeof usernames === "number" && usernames > 0) {
        const generatedUsernames = [];
        for (let i = 0; i < usernames; i++) {
            generatedUsernames.push(generateUsername(12));
        }
        return generatedUsernames;
    }

    if (Array.isArray(usernames)) {
        return usernames
            .map((username) => String(username || "").trim())
            .filter(Boolean);
    }

    if (typeof usernames === "string" && usernames.trim()) {
        return [usernames.trim()];
    }

    return [];
}

const allowedLetters = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890!@#$%^&*()-=_+{}[]\\|,.<>/?"
function generateUsername(length = 12) {
  const bytes = crypto.randomBytes(length);

  return Array.from(bytes, b => allowedLetters[b % allowedLetters.length]).join("");
}

async function createOfflineBot(username, options = {}, logFunc) {
    const existingBot = getBotByUsername(username);
    
    if (existingBot) {
        return existingBot;
    }

    const bot = mineflayer.createBot({
        host: "play.minefort.com",
        port: 25565,
        username,
        auth: "offline",
        version: mineflayer.latestSupportedVersion,
        viewDistance: options.viewDistance || "tiny"
    });

    bot.shouldReconnect = true;

    const accountIndex = Array.isArray(config.offline_accounts)
        ? config.offline_accounts.findIndex((account) => String(account || "").trim() === String(username || "").trim())
        : 0;

    const authFlow = new OfflineCaptchaAuthFlow(bot, {
        config,
        username,
        accountIndex: accountIndex >= 0 ? accountIndex : 0,
        password: config.offline_password,
        log: (scope, message) => logFunc('[' + scope + ' ' + username + ']', message),
        sendChat: (message) => bot.chat(message),
        sendAuthCommand: (type, ctx) => {
            if (type === "register") {
                return bot.chat(`/register ${ctx.password} ${ctx.password}`);
            }

            return bot.chat(`/login ${ctx.password}`);
        }
    });

    bot.authFlow = authFlow;

    try {
        await authFlow.attach(bot);
    } catch (error) {
        if (typeof bot.end === "function") {
            bot.end();
        }

        throw error;
    }

    authFlow.on("captchaManualRequired", ({ imagePath }) => {
        logFunc('[' + "captcha" + ' ' + username + ']', `Manual solver selected. Open ${imagePath} and send the answer in chat.`);
        try {
            globalEvents.emit("manualCaptcha", { username, imagePath, authFlow });
        } catch (e) {
            // ignore
        }
    });

    (function setupInitialAuthPromise() {
        let resolved = false;
        let resolveFn = null;
        const timeoutMs = 15000;

        bot.initialAuth = new Promise((resolve) => {
            resolveFn = (value) => {
                if (!resolved) {
                    resolved = true;
                    try {
                        clearTimeout(timeoutId);
                    } catch (e) {}
                    resolve(value);
                }
            };
        });

        const timeoutId = setTimeout(() => {
            resolveFn({ type: "timeout" });
        }, timeoutMs);

        authFlow.on("sessionAuthed", () => resolveFn({ type: "authed" }));
        authFlow.on("hubTransfer", () => resolveFn({ type: "authed" }));
        authFlow.on("captchaManualRequired", () => resolveFn({ type: "manual" }));
        authFlow.on("captchaVerified", () => resolveFn({ type: "authed" }));
    })();

    authFlow.on("captchaSolved", (payload) => {
        try {
            globalEvents.emit("manualCaptchaSolved", { username, imagePath: payload.imagePath, solution: payload.solution });
        } catch (e) {
            // ignore
        }
    });

    authFlow.on("captchaVerified", () => {
        try {
            globalEvents.emit("manualCaptchaSolved", { username });
        } catch (e) {}
    });

    authFlow.on("hubTransfer", () => {
        try {
            globalEvents.emit("manualCaptchaSolved", { username });
        } catch (e) {
            // ignore
        }
    });

    authFlow.on("wrongPassword", () => {
        logFunc('[' + "auth" + ' ' + username + ']', "Wrong password detected.");
    });

    authFlow.on("error", (error) => {
        logFunc('[' + "auth" + ' ' + username + ']', error.message);
    });

    bot.once("spawn", () => {
        logFunc('[' + "bot" + ' ' + username + ']', "Spawned.");

        if (bot._client && typeof bot._client.write === "function") {
            try {
                bot._client.write('player_loaded', {});
                logFunc('[' + "bot" + ' ' + username + ']', "Sent player_loaded packet.");
            } catch (error) {
                logFunc('[' + "bot" + ' ' + username + ']', `Failed to send player_loaded: ${error.message}`);
            }
        }
    });

    bot.on("message", async (jsonMessage) => {
        try {
            const matched = await authFlow.handleChatMessage(jsonMessage.toString());

            if (matched) {
                logFunc('[' + "match" + ' ' + username + ']', matched);
            }
        } catch (error) {
            logFunc('[' + "chat" + ' ' + username + ']', error.message);
        }
    });

    bot.on("end", (reason) => {
        authFlow.destroy();
        removeBot(bot);
        logFunc('[' + "bot" + ' ' + username + ']', `Disconnected${reason ? `: ${reason}` : "."}`);

        if (bot.shouldReconnect === false) {
            logFunc('[' + "bot" + ' ' + username + ']', "No reconnect scheduled (manual disconnect).");
            return;
        }

        const minDelay = (config.rejoin_delay_min || 5) * 1000;
        const maxDelay = (config.rejoin_delay_max || 10) * 1000;
        const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);

        logFunc('[' + "bot" + ' ' + username + ']', `Reconnecting in ${Math.round(randomDelay / 1000)} seconds...`);

        setTimeout(async () => {
            try {
                const reconnectedBot = await createOfflineBot(username, options, logFunc);
                logFunc('[' + "bot" + ' ' + username + ']', "Reconnected successfully.");
            } catch (error) {
                logFunc('[' + "bot" + ' ' + username + ']', `Reconnection failed: ${error.message}`);
            }
        }, randomDelay);
    });

    bot.on("kicked", (reason) => {
        logFunc('[' + "bot" + ' ' + username + ']',`Kicked: ${reason}`);
    });

    bot.on("error", (error) => {
        logFunc('[' + "bot" + ' ' + username + ']', error.message);
    });

    bots.push(bot);
    return bot;
}

async function initconnectBots(usernames = config.offline_accounts, logFunction) {
    if (config.account_type !== "offline") {
        throw new Error(`Unsupported account type: ${config.account_type}`);
    }

    const normalizedUsernames = normalizeUsernames(usernames);
    const connectedBots = [];

    logFunction('hi', 'world')

    let manualBlocked = false;
    let manualUnlock = null;
    let currentUsername = null;

    const onManual = (payload) => {
        if (!payload || payload.username !== currentUsername) {
            return;
        }
        manualBlocked = true;
    };

    const onSolved = (payload) => {
        if (!payload || payload.username !== currentUsername) {
            return;
        }
        manualBlocked = false;
        if (manualUnlock) {
            manualUnlock();
            manualUnlock = null;
        }
    };

    globalEvents.on("manualCaptcha", onManual);
    globalEvents.on("manualCaptchaSolved", onSolved);

    try {
        for (const username of normalizedUsernames) {
            currentUsername = username;
            logFunction('info', `Starting bot ${username}...`);

            while (manualBlocked) {
                logFunction('info', `Waiting for manual captcha to finish for ${username} before starting next bot.`);
                await new Promise((res) => (manualUnlock = res));
            }

            let bot = null;

            try {
                bot = await createOfflineBot(username, {}, logFunction);
            } catch (error) {
                logFunction('warn', `Failed to create bot ${username}: ${error.message}`);
                continue;
            }

            if (bot && bot.initialAuth) {
                logFunction('info', `Waiting for initial auth on ${username}...`);

                try {
                    const authResult = await bot.initialAuth;
                    logFunction('info', `Initial auth result for ${username}: ${String(authResult?.type)}`);

                    if (authResult && authResult.type === "manual") {
                        logFunction('info', `Manual captcha required for ${username}. Waiting for solve...`);
                        await new Promise((resolve) => {
                            const onSolved = (payload) => {
                                if (!payload) return;
                                if (payload.username === username) {
                                    globalEvents.removeListener("manualCaptchaSolved", onSolved);
                                    resolve();
                                }
                            };

                            globalEvents.on("manualCaptchaSolved", onSolved);
                        });
                    }
                } catch (e) {
                    logFunction('warn', `Error while waiting for initial auth on ${username}: ${e.message}`);
                }
            }

            connectedBots.push(bot);

            if (config.join_delay > 0) {
                await wait(config.join_delay);
            }
        }
    } finally {
        try {
            globalEvents.removeListener("manualCaptcha", onManual);
            globalEvents.removeListener("manualCaptchaSolved", onSolved);
        } catch (e) {}
    }

    return connectedBots;
}

async function disconnectBots() {
    const activeBots = [...bots];

    for (const bot of activeBots) {
        try {
            if (bot.authFlow) {
                bot.authFlow.destroy();
            }

            bot.shouldReconnect = false;

            if (typeof bot.quit === "function") {
                bot.quit("Disconnecting bots");
            } else if (typeof bot.end === "function") {
                bot.end();
            }
        } catch (error) {
            log(bot.username || "unknown", "bot", `Failed to disconnect cleanly: ${error.message}`);
        }
    }

    bots.length = 0;
}

module.exports = {
    bots,
    getBotByUsername,
    createOfflineBot,
    initconnectBots,
    disconnectBots,
    globalEvents
};

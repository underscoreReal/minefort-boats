const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const { config: sharedConfig } = require("../../config");
const { solveTextCaptcha } = require("../captcha/solveTextCaptcha");
const { OFFLINE_AUTH_REGEX } = require("./offlineAuthRegex");
const { resolveOfflinePassword } = require("./passwordResolver");

const FRAME_ENTITY_NAMES = new Set(["item_frame", "glow_item_frame"]);

function clearTimer(timer) {
    if (timer) {
        clearTimeout(timer);
    }

    return null;
}

function clearIntervalRef(intervalRef) {
    if (intervalRef) {
        clearInterval(intervalRef);
    }

    return null;
}

function noop() {}

class OfflineCaptchaAuthFlow extends EventEmitter {
    constructor(bot, options = {}) {
        super();

        this.bot = bot || null;
        this.options = options;
        this.config = options.config || sharedConfig;
        this.regex = options.regex || OFFLINE_AUTH_REGEX;
        this.log = typeof options.log === "function" ? options.log : noop;
        this.isRegisteredUser =
            typeof options.isRegisteredUser === "function"
                ? options.isRegisteredUser
                : () => false;

        this.username =
            options.username ||
            this.bot?.username ||
            this.config.username ||
            this.config.offline_accounts?.[0] ||
            "offline-user";

        this.accountIndex =
            typeof options.accountIndex === "number"
                ? options.accountIndex
                : this.getAccountIndex(this.username, this.config.offline_accounts);

        this.password = resolveOfflinePassword({
            username: this.username,
            passwordConfig: options.password ?? this.config.offline_password,
            accountIndex: this.accountIndex
        });
        this.captchaMinFrames = options.captchaMinFrames ?? this.config.offline_captcha_min_frames ?? 9;
        this.captchaAssemblyDelayMs =
            options.captchaAssemblyDelayMs ?? this.config.offline_captcha_assembly_delay_ms ?? 500;
        this.captchaLookTimeoutMs =
            options.captchaLookTimeoutMs ?? this.config.offline_captcha_look_timeout_ms ?? 15000;
        this.authFallbackDelayMs =
            options.authFallbackDelayMs ?? this.config.offline_auth_fallback_delay_ms ?? 2000;
        
        this.captchaUuid = uuidv4();
        
        const captchaFolder = options.captchaFolder ||
            this.config.offline_captcha_folder ||
            path.join(process.cwd(), "captcha-images");
        
        this.captchaPath = path.resolve(
            path.join(captchaFolder, `${this.captchaUuid}.png`)
        );

        this.sessionAuthed = false;
        this.awaitingCaptcha = false;
        this.captchaImageSaved = false;
        this.captchaPassed = false;
        this.captchaMapsReceived = 0;
        this.captchaSeenMapIds = new Set();
        this.postCaptchaFallbackTimer = null;
        this.captchaLookTimer = null;
        this.captchaLookInterval = null;
        this.captcha = null;
        this.FlayerCaptcha = null;
        this.Vec3 = null;
        this.lastAuthPromptType = null;
        this.lastAuthCommandType = null;
        this.invalidAuthAttemptCount = 0;
        this.authPromptSuppressionUntil = 0;
    }

    getAccountIndex(username, accounts) {
        if (!Array.isArray(accounts)) {
            return 0;
        }

        const normalizedUsername = typeof username === "string" ? username.trim() : "";
        const index = accounts.findIndex((account) => String(account || "").trim() === normalizedUsername);
        return index >= 0 ? index : 0;
    }

    async attach(bot = this.bot) {
        this.bot = bot;

        if (!this.bot) {
            throw new Error("OfflineCaptchaAuthFlow.attach requires a mineflayer bot instance.");
        }

        await this.setupCaptcha(this.bot);
        return this;
    }

    destroy() {
        this.stopCaptchaLookSweep();
        this.postCaptchaFallbackTimer = clearTimer(this.postCaptchaFallbackTimer);

        if (this.captcha) {
            this.captcha.removeAllListeners();

            if (typeof this.captcha.stop === "function") {
                this.captcha.stop();
            }
        }

        this.captcha = null;
    }

    clearPostCaptchaAuthFallback() {
        this.postCaptchaFallbackTimer = clearTimer(this.postCaptchaFallbackTimer);
    }

    schedulePostCaptchaAuthFallback() {
        this.clearPostCaptchaAuthFallback();

        this.postCaptchaFallbackTimer = setTimeout(async () => {
            this.postCaptchaFallbackTimer = null;

            if (this.sessionAuthed) {
                return;
            }

            const type = await this.resolveAuthType();
            this.emit("authFallback", { type });
            this.log("auth", `No auth prompt yet - trying ${type}...`);

            try {
                await this.sendAuthCommand(type);
            } catch (error) {
                this.emit("error", error);
                this.log("auth", `Failed to send ${type}: ${error.message}`);
            }
        }, this.authFallbackDelayMs);
    }

    stopCaptchaLookSweep() {
        this.captchaLookTimer = clearTimer(this.captchaLookTimer);
        this.captchaLookInterval = clearIntervalRef(this.captchaLookInterval);
    }

    getNearbyFrameEntities() {
        if (!this.bot?.entity) {
            return [];
        }

        return Object.values(this.bot.entities)
            .filter((entity) => FRAME_ENTITY_NAMES.has(entity.name))
            .map((entity) => ({
                entity,
                distance: this.bot.entity.position.distanceTo(entity.position)
            }))
            .sort((a, b) => a.distance - b.distance);
    }

    getFrameGridCenter(frames) {
        if (!this.Vec3) {
            throw new Error("Vec3 is not available. Call attach() before using captcha helpers.");
        }

        const sum = { x: 0, y: 0, z: 0 };

        for (const { entity } of frames) {
            sum.x += entity.position.x;
            sum.y += entity.position.y;
            sum.z += entity.position.z;
        }

        const count = frames.length;
        return new this.Vec3(sum.x / count, sum.y / count, sum.z / count);
    }

    startCaptchaLookSweep() {
        this.stopCaptchaLookSweep();

        if (!this.awaitingCaptcha || this.captchaImageSaved) {
            return;
        }

        const frames = this.getNearbyFrameEntities();
        let index = 0;

        if (frames.length === 0) {
            this.log("captcha", "No item frames nearby - waiting for map packets...");
            return;
        }

        this.log("captcha", `Found ${frames.length} item frame(s) - looking at captcha wall...`);

        const lookAtTarget = () => {
            if (!this.awaitingCaptcha || this.captchaImageSaved || !this.bot?.entity) {
                this.stopCaptchaLookSweep();
                return;
            }

            let target;

            if (index % (frames.length + 1) === 0) {
                target = this.getFrameGridCenter(frames);
            } else {
                const currentFrame = frames[(index - 1) % frames.length];
                target = currentFrame.entity.position;
            }

            Promise.resolve(this.bot.lookAt(target, true)).catch((error) => {
                this.emit("error", error);
                this.log("captcha", `Look sweep failed: ${error.message}`);
            });

            index += 1;
        };

        lookAtTarget();
        this.captchaLookInterval = setInterval(lookAtTarget, 2000);

        this.captchaLookTimer = setTimeout(() => {
            this.stopCaptchaLookSweep();

            if (this.awaitingCaptcha && !this.captchaImageSaved) {
                this.log(
                    "captcha",
                    `Still waiting for full ${this.captchaMinFrames}-tile image (${this.captchaMapsReceived} tiles received so far)...`
                );
            }
        }, this.captchaLookTimeoutMs);
    }

    async saveCaptchaImage(image, frameCount) {
        if (!this.awaitingCaptcha || this.captchaImageSaved) {
            return;
        }

        this.captchaImageSaved = true;
        this.stopCaptchaLookSweep();
        fs.mkdirSync(path.dirname(this.captchaPath), { recursive: true });
        await image.toFile(this.captchaPath);

        this.emit("captchaSaved", {
            frameCount,
            imagePath: this.captchaPath
        });

        this.log("captcha", `Saved ${frameCount}-tile image to ${this.captchaPath}`);
        await this.processSavedCaptcha();
    }

    async processSavedCaptcha() {
        const result = await solveTextCaptcha({
            solver: this.config.offline_captcha_solver,
            imagePath: this.captchaPath
        });

        if (result.mode === "manual") {
            this.emit("captchaManualRequired", { imagePath: this.captchaPath });
            this.log("captcha", "Open the image and type the code, then submit it with your own chat flow.");
            return;
        }

        this.emit("captchaSolved", {
            imagePath: this.captchaPath,
            solution: result.solution,
            solver: result.mode
        });

        this.log("captcha", `Captcha solved with ${result.mode} - submitting response...`);
        await this.submitCaptchaSolution(result.solution);
    }

    resetCaptchaState() {
        this.captchaMapsReceived = 0;
        this.captchaSeenMapIds.clear();

        if (this.captcha) {
            if (typeof this.captcha.stop === "function") {
                this.captcha.stop();
            }

            if (typeof this.captcha.resume === "function") {
                this.captcha.resume();
            }
        }
    }

    async setupCaptcha(currentBot) {
        const { FlayerCaptcha, Vec3 } = this.requireCaptchaDependencies();
        this.FlayerCaptcha = FlayerCaptcha;
        this.Vec3 = Vec3;

        if (this.captcha) {
            this.captcha.removeAllListeners();

            if (typeof this.captcha.stop === "function") {
                this.captcha.stop();
            }
        }

        this.captcha = new this.FlayerCaptcha(currentBot, {
            delay: this.captchaAssemblyDelayMs
        });

        this.captcha.on("imageReady", async ({ data, image }) => {
            if (!this.awaitingCaptcha || this.captchaImageSaved) {
                return;
            }

            const frameCount = data.frames.length;
            this.log("captcha", `Assembled ${frameCount}/${this.captchaMinFrames} tile(s)...`);

            if (frameCount < this.captchaMinFrames) {
                this.log("captcha", `Waiting for full ${this.captchaMinFrames}-tile grid...`);
                return;
            }

            try {
                await this.saveCaptchaImage(image, frameCount);
            } catch (error) {
                this.emit("error", error);
                this.log("captcha", `Failed to save or solve captcha image: ${error.message}`);
                this.captchaImageSaved = false;
            }
        });

        this.captcha.on("frameInfo", ({ data }) => {
            if (!this.awaitingCaptcha || this.captchaSeenMapIds.has(data.mapId)) {
                return;
            }

            this.captchaSeenMapIds.add(data.mapId);
            this.captchaMapsReceived = this.captchaSeenMapIds.size;
            this.log("captcha", `Map tile ${this.captchaMapsReceived}/${this.captchaMinFrames} received`);
        });
    }

    handleCaptchaPrompt() {
        this.log("debug", `handleCaptchaPrompt called; awaitingCaptcha=${this.awaitingCaptcha}`);
        this.awaitingCaptcha = true;
        this.captchaPassed = false;
        this.captchaImageSaved = false;
        this.clearPostCaptchaAuthFallback();
        this.resetCaptchaState();
        this.emit("captchaPrompt");
        this.log("captcha", `Prompt detected - waiting for ${this.captchaMinFrames}-tile map...`);
        this.startCaptchaLookSweep();
    }

    handleCaptchaVerified() {
        this.log("debug", "handleCaptchaVerified called");
        this.awaitingCaptcha = false;
        this.captchaImageSaved = false;
        this.captchaMapsReceived = 0;
        this.captchaSeenMapIds.clear();
        this.stopCaptchaLookSweep();

        if (this.captcha && typeof this.captcha.stop === "function") {
            this.captcha.stop();
        }

        this.captchaPassed = true;
        this.emit("captchaVerified");
        this.log("captcha", "Verified! Waiting for register/login...");
        this.schedulePostCaptchaAuthFallback();
    }

    async handleChatMessage(message) {
        const text = String(message || "");

        if (!text) {
            return null;
        }

        const trimmedText = text.trim();
        if (trimmedText.startsWith("/")) {
            return null;
        }

        if (this.regex.captchaPrompt.test(text)) {
            this.handleCaptchaPrompt();
            return "captchaPrompt";
        }

        if (this.regex.captchaVerified.test(text)) {
            this.handleCaptchaVerified();
            return "captchaVerified";
        }

        if (this.regex.registerSuccess.test(text) || this.regex.loginSuccess.test(text)) {
            this.markSessionAuthed();
            return this.regex.registerSuccess.test(text) ? "registerSuccess" : "loginSuccess";
        }

        if (this.regex.wrongPassword.test(text)) {
            this.emit("wrongPassword", { message: text });
            this.log("auth", "Server says the password is wrong.");
            return "wrongPassword";
        }

        if (this.regex.unexpectedError.test(text)) {
            await this.handleUnexpectedAuthError(text);
            return "unexpectedError";
        }

        //if (this.regex.lobbyKick.test(text)) {
        //    this.markSessionUnauthed();
        //    this.emit("lobbyKick", { message: text });
        //    this.log("auth", "Bot was kicked from the server.");
        //    return "lobbyKick";
        //}

        if (this.regex.hubTransfer.test(text)) {
            this.clearPostCaptchaAuthFallback();
            this.stopCaptchaLookSweep();
            this.awaitingCaptcha = false;
            this.captchaImageSaved = false;
            this.captchaMapsReceived = 0;
            this.captchaSeenMapIds.clear();
            this.lastAuthPromptType = null;
            this.lastAuthCommandType = null;
            this.invalidAuthAttemptCount = 0;
            this.markSessionAuthed();
            this.suppressAuthPromptsFor();
            this.emit("hubTransfer", { message: text });
            this.log("auth", "Server is transferring the bot to the hub.");
            return "hubTransfer";
        }

        if ((this.regex.registerPrompt.test(text) || this.regex.notRegistered.test(text) || this.regex.loginPrompt.test(text) || this.regex.alreadyRegistered.test(text)) && this.isAuthPromptSuppressed()) {
            this.log("auth", "Ignoring auth prompt while the bot is settling after a transfer.");
            return "authPromptSuppressed";
        }

        if (this.regex.registerPrompt.test(text) || this.regex.notRegistered.test(text)) {
            this.lastAuthPromptType = "register";
            await this.handleAuthPrompt("register");
            return "registerPrompt";
        }

        if (this.regex.loginPrompt.test(text) || this.regex.alreadyRegistered.test(text)) {
            this.lastAuthPromptType = "login";
            await this.handleAuthPrompt("login");
            return "loginPrompt";
        }

        return null;
    }

    async handleAuthPrompt(type) {
        this.clearPostCaptchaAuthFallback();

        if (this.sessionAuthed) {
            return;
        }

        const normalizedType = type === "register" ? "register" : "login";
        this.lastAuthPromptType = normalizedType;
        this.invalidAuthAttemptCount = 0;
        this.emit("authPrompt", { type: normalizedType });
        this.log("auth", `Prompt detected - sending ${normalizedType}...`);
        await this.sendAuthCommand(normalizedType);
        this.schedulePostCaptchaAuthFallback();
    }

    async handleUnexpectedAuthError(message) {
        if (this.sessionAuthed || !this.lastAuthCommandType) {
            return;
        }

        if (this.invalidAuthAttemptCount > 0) {
            this.log("auth", "Unexpected auth error received after retry; not retrying further.");
            return;
        }

        const alternate = this.lastAuthCommandType === "register" ? "login" : "register";
        this.invalidAuthAttemptCount += 1;
        this.lastAuthPromptType = alternate;
        this.log(
            "auth",
            `Server returned unexpected auth error after ${this.lastAuthCommandType}; retrying ${alternate}...`
        );

        await this.sendAuthCommand(alternate);
        this.schedulePostCaptchaAuthFallback();
    }

    suppressAuthPromptsFor(durationMs = 10000) {
        this.authPromptSuppressionUntil = Date.now() + durationMs;
    }

    isAuthPromptSuppressed() {
        return Date.now() < this.authPromptSuppressionUntil;
    }

    markSessionAuthed() {
        this.sessionAuthed = true;
        this.clearPostCaptchaAuthFallback();
        this.emit("sessionAuthed");
        this.log("auth", "Session authenticated.");
    }

    markSessionUnauthed() {
        this.sessionAuthed = false;
        this.emit("sessionUnauthed");
    }

    async resolveAuthType() {
        if (this.lastAuthPromptType === "register" || this.lastAuthPromptType === "login") {
            return this.lastAuthPromptType;
        }

        const registered = await Promise.resolve(this.isRegisteredUser(this.username));
        return registered ? "login" : "register";
    }

    async sendAuthCommand(type) {
        this.lastAuthCommandType = type;
        const handler =
            typeof this.options.sendAuthCommand === "function"
                ? this.options.sendAuthCommand
                : async (commandType) => {
                      await this.sendChat(`/${commandType} ${this.password}`);
                  };

        await Promise.resolve(handler(type, this));
    }

    async submitCaptchaSolution(solution) {
        const handler =
            typeof this.options.submitCaptchaSolution === "function"
                ? this.options.submitCaptchaSolution
                : async (value) => {
                      await this.sendChat(value);
                  };

        await Promise.resolve(handler(solution, this));
    }

    async sendChat(message) {
        if (typeof this.options.sendChat === "function") {
            await Promise.resolve(this.options.sendChat(message, this));
            return;
        }

        if (!this.bot || typeof this.bot.chat !== "function") {
            throw new Error("No sendChat handler provided and bot.chat is unavailable.");
        }

        await Promise.resolve(this.bot.chat(message));
    }

    requireCaptchaDependencies() {
        try {
            const flayerCaptchaModule = require("flayercaptcha");
            const vec3Module = require("vec3");

            return {
                FlayerCaptcha: flayerCaptchaModule.FlayerCaptcha || flayerCaptchaModule,
                Vec3: vec3Module.Vec3 || vec3Module
            };
        } catch (error) {
            error.message =
                `${error.message}. Install the captcha runtime with "npm install flayer-captcha vec3" before attaching this flow.`;
            throw error;
        }
    }
}

module.exports = {
    OfflineCaptchaAuthFlow,
    OFFLINE_AUTH_REGEX
};

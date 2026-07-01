const blessed = require("blessed");
const { CONFIG_PATH, loadConfigModule, saveConfigModule } = require("./utils/configStore");
const { initconnectBots, bots, globalEvents } = require("./utils/botHandler");
const { spawn } = require("child_process");

const screen = blessed.screen({
    smartCSR: true,
    title: "Minefort",
    dockBorders: true,
    fullUnicode: true
});

const state = {
    botsConnected: false,
    configModule: loadConfigModule(),
    logLines: [],
    commandMatches: [],
    selectedCommandIndex: 0,
    menuVisible: false,
    configVisible: false,
    promptVisible: false,
    sendHookReminderShown: false
};

const CONFIG_FIELDS = [
    {
        key: "account_type",
        label: "Account Type",
        type: "string",
        choices: ["offline"]
    },
    {
        key: "offline_accounts",
        label: "Offline Accounts",
        type: "array"
    },
    {
        key: "offline_password",
        label: "Offline Password",
        type: "string"
    },
    {
        key: "offline_captcha_solver",
        label: "Captcha Solver",
        type: "string",
        choices: ["manual", "nopecha", "tesseract"]
    },
    {
        key: "offline_captcha_folder",
        label: "Captcha Image Folder",
        type: "string"
    },
    {
        key: "join_delay",
        label: "Join Delay",
        type: "float",
        min: 1.5,
        max: 10
    },
    {
        key: "rejoin_delay_min",
        label: "Rejoin Delay Min",
        type: "int",
        min: 1
    },
    {
        key: "rejoin_delay_max",
        label: "Rejoin Delay Max",
        type: "int",
        min: 1
    },
    {
        key: "nopecha_key",
        label: "NopeCHA Key",
        type: "string"
    },
    {
        key: "nopecha_tries",
        label: "NopeCHA Tries",
        type: "int",
        min: 1
    },
    {
        key: "nopecha_interval",
        label: "NopeCHA Interval",
        type: "int",
        min: 1
    }
];

const COMMANDS = [
    {
        name: "!help",
        description: "Show local command help",
        action: showCommandHelp
    },
    {
        name: "!menu",
        description: "Open the center menu",
        action: openMenu
    },
    {
        name: "!connect",
        description: "Connect your bots",
        action: connectBots
    },
    {
        name: "!disconnect",
        description: "Disconnect your bots",
        action: disconnectBots
    },
    {
        name: "!config",
        description: "Open the configuration editor",
        action: openConfigEditor
    },
    {
        name: "!status",
        description: "Show current UI status",
        action: showStatus
    },
    {
        name: "!clear",
        description: "Clear the activity view",
        action: clearLog
    },
    {
        name: "!promote",
        description: "self promotion",
        action: promoteRepo
    },
    {
        name: "!meow",
        description: "Make the bots meow",
        action: meow
    },
    {
        name: "!exit",
        description: "Close the application",
        action: shutdown
    }
];

const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: false,
    style: {
        fg: "white",
        bg: "blue"
    }
});

const chatBox = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: "100%",
    bottom: 3,
    label: " Activity ",
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    border: "line",
    padding: {
        left: 1,
        right: 1
    },
    scrollbar: {
        ch: " ",
        inverse: true
    },
    style: {
        border: {
            fg: "gray"
        }
    }
});

const autocompleteBox = blessed.list({
    parent: screen,
    left: 0,
    width: "100%",
    bottom: 3,
    height: 4,
    label: " Commands ",
    border: "line",
    keys: true,
    mouse: true,
    hidden: true,
    style: {
        fg: "white",
        bg: "black",
        border: {
            fg: "cyan"
        },
        selected: {
            fg: "black",
            bg: "cyan"
        }
    }
});

const inputBox = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    label: " Chat Input ",
    inputOnFocus: true,
    keys: true,
    mouse: true,
    border: "line",
    padding: {
        left: 1,
        right: 1
    },
    style: {
        border: {
            fg: "green"
        },
        focus: {
            border: {
                fg: "green"
            }
        }
    }
});

const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    hidden: true,
    style: {
        bg: "black"
    }
});

const menuBox = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: 40,
    height: 11,
    label: " Menu ",
    border: "line",
    style: {
        fg: "white",
        bg: "black",
        border: {
            fg: "magenta"
        }
    }
});

const menuList = blessed.list({
    parent: menuBox,
    top: 1,
    left: 1,
    width: "100%-2",
    height: "100%-2",
    keys: true,
    mouse: true,
    style: {
        selected: {
            fg: "black",
            bg: "white"
        }
    }
});

const configBox = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "78%",
    height: "78%",
    label: " Configuration ",
    border: "line",
    hidden: true,
    style: {
        fg: "white",
        bg: "black",
        border: {
            fg: "yellow"
        }
    }
});

const configList = blessed.list({
    parent: configBox,
    top: 1,
    left: 1,
    width: "100%-2",
    bottom: 3,
    keys: true,
    mouse: true,
    style: {
        selected: {
            fg: "black",
            bg: "yellow"
        }
    }
});

const configHelp = blessed.box({
    parent: configBox,
    bottom: 0,
    left: 1,
    width: "100%-2",
    height: 3,
    tags: false,
    content: "Enter edit | S save | R reload | Esc back"
});

const prompt = blessed.prompt({
    parent: overlay,
    top: "center",
    left: "center",
    width: "60%",
    height: 9,
    label: " Edit Value ",
    border: "line",
    hidden: true,
    style: {
        fg: "white",
        bg: "black",
        border: {
            fg: "green"
        }
    }
});

const manualCaptchaQueue = [];
let manualProcessing = false;

const isWindows = process.platform === 'win32';

function commandExists(cmd) {
    const check = isWindows ? 'where' : 'which';

    try {
        const result = require('child_process').spawnSync(check, [cmd], { stdio: 'ignore' });
        return result.status === 0;
    } catch (e) {
        return false;
    }
}

function openImageViewer(imagePath) {
    if (isWindows) {
        try {
            const proc = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process', imagePath], {
                detached: true,
                stdio: 'ignore'
            });
            proc.unref();
            return { process: proc, viewer: 'powershell' };
        } catch (e) {
            return null;
        }
    }

    const viewers = process.platform === 'darwin'
        ? ['open']
        : ['eog', 'feh', 'ristretto', 'sxiv', 'qiv', 'display', 'xdg-open'];

    for (const viewer of viewers) {
        if (!commandExists(viewer)) continue;

        try {
            const proc = spawn(viewer, [imagePath], { detached: true, stdio: 'ignore' });
            proc.unref();
            return { process: proc, viewer };
        } catch (e) {
            continue;
        }
    }

    return null;
}

function closeImageViewer(handle) {
    if (!handle || !handle.process) return;
    if (handle.viewer === 'xdg-open') return;
    try {
        if (!handle.process.killed) {
            handle.process.kill('SIGKILL');
        }
    } catch (e) {
        // ignore
    }
}

const { execFile } = require('child_process');

function openExternalCaptchaWindow(item) {
    return new Promise((resolve) => {
        if (isWindows) {
            const script = `Add-Type -AssemblyName Microsoft.VisualBasic; $image = '${item.imagePath.replace(/'/g, "''")}'; Start-Process $image; [Microsoft.VisualBasic.Interaction]::InputBox('Enter captcha for ${item.username}','Captcha for ${item.username}','')`;
            execFile('powershell.exe', ['-NoProfile', '-Command', script], (err, stdout, stderr) => {
                if (err) {
                    pushLog('error', `PowerShell captcha window failed: ${stderr || err.message}`);
                    resolve({ action: 'skip' });
                    return;
                }

                const value = String(stdout || '').trim();
                if (!value) {
                    resolve({ action: 'skip' });
                    return;
                }

                if (item.authFlow && typeof item.authFlow.submitCaptchaSolution === 'function') {
                    item.authFlow.submitCaptchaSolution(value)
                        .then(() => {
                            pushLog('captcha', `Submitted manual captcha for ${item.username}`);
                            resolve({ action: 'submit', value });
                        })
                        .catch((e) => {
                            pushLog('error', `Failed to submit captcha for ${item.username}: ${e.message}`);
                            resolve({ action: 'error', error: e });
                        });
                    return;
                }

                resolve({ action: 'submit', value });
            });
            return;
        }

        if (commandExists('yad')) {
            const args = [
                '--form',
                `--title=Captcha for ${item.username}`,
                `--image=${item.imagePath}`,
                '--field=Captcha'
            ];

            execFile('yad', args, (err, stdout, stderr) => {
                if (err) {
                    pushLog('error', `yad failed: ${stderr || err.message}`);
                    resolve({ action: 'error', error: err });
                    return;
                }

                const value = String(stdout || '').trim();
                if (!value) {
                    resolve({ action: 'skip' });
                    return;
                }

                if (item.authFlow && typeof item.authFlow.submitCaptchaSolution === 'function') {
                    item.authFlow.submitCaptchaSolution(value)
                        .then(() => {
                            pushLog('captcha', `Submitted manual captcha for ${item.username}`);
                            resolve({ action: 'submit', value });
                        })
                        .catch((e) => {
                            pushLog('error', `Failed to submit captcha for ${item.username}: ${e.message}`);
                            resolve({ action: 'error', error: e });
                        });
                    return;
                }

                resolve({ action: 'submit', value });
            });

            return;
        }

        let imageViewer = null;

        if (commandExists('zenity')) {
            imageViewer = openImageViewer(item.imagePath);
            const zenArgs = ['--entry', '--title', `Captcha for ${item.username}`, '--text', 'Enter captcha:'];
            execFile('zenity', zenArgs, (err, stdout, stderr) => {
                if (imageViewer) {
                    closeImageViewer(imageViewer);
                }

                if (err) {
                    resolve({ action: 'skip' });
                    return;
                }

                const value = String(stdout || '').trim();
                if (!value) {
                    resolve({ action: 'skip' });
                    return;
                }

                if (item.authFlow && typeof item.authFlow.submitCaptchaSolution === 'function') {
                    item.authFlow.submitCaptchaSolution(value)
                        .then(() => {
                            pushLog('captcha', `Submitted manual captcha for ${item.username}`);
                            resolve({ action: 'submit', value });
                        })
                        .catch((e) => {
                            pushLog('error', `Failed to submit captcha for ${item.username}: ${e.message}`);
                            resolve({ action: 'error', error: e });
                        });
                    return;
                }

                resolve({ action: 'submit', value });
            });

            return;
        }

        imageViewer = openImageViewer(item.imagePath);
        (async () => {
            try {
                const r = await showCaptchaModalForTerminal(item);
                resolve(r);
            } finally {
                if (imageViewer) {
                    closeImageViewer(imageViewer);
                }
            }
        })();
    });
}

function showCaptchaModalForTerminal(item) {
    return new Promise((resolve) => {
        captchaImagePath.setContent(`Image: ${item.imagePath}`);
        captchaModal.show();
        overlay.show();
        captchaInput.setValue('');
        captchaInput.focus();
        screen.render();

        const cleanup = () => {
            captchaModal.hide();
            overlay.hide();
            screen.render();
            captchaSubmit.removeListener('press', onSubmit);
            captchaSkip.removeListener('press', onSkip);
        };

        const onSubmit = async () => {
            const value = String(captchaInput.getValue() || '').trim();
            cleanup();
            if (!value) {
                pushLog('info', `No captcha provided for ${item.username}`);
                resolve({ action: 'skip' });
                return;
            }

            if (item.authFlow && typeof item.authFlow.submitCaptchaSolution === 'function') {
                try {
                    await item.authFlow.submitCaptchaSolution(value);
                    pushLog('captcha', `Submitted manual captcha for ${item.username}`);
                    resolve({ action: 'submit', value });
                } catch (e) {
                    pushLog('error', `Failed to submit captcha for ${item.username}: ${e.message}`);
                    resolve({ action: 'error', error: e });
                }
                return;
            }

            resolve({ action: 'submit', value });
        };

        const onSkip = () => {
            cleanup();
            pushLog('info', `Skipped captcha for ${item.username}`);
            resolve({ action: 'skip' });
        };

        captchaSubmit.on('press', onSubmit);
        captchaSkip.on('press', onSkip);
    });
}

async function processManualQueue() {
    if (manualProcessing) return;
    if (manualCaptchaQueue.length === 0) return;

    manualProcessing = true;
    const item = manualCaptchaQueue.shift();
    const { username } = item;

    pushLog("captcha", `Manual captcha required for ${username}: ${item.imagePath}`);

    try {
        await openExternalCaptchaWindow(item);
    } catch (error) {
        pushLog('error', `Captcha window failed for ${username}: ${error.message}`);
    } finally {
        manualProcessing = false;
        screen.render();
        processManualQueue();
    }
}

globalEvents.on("manualCaptcha", (payload) => {
    manualCaptchaQueue.push(payload);
    processManualQueue();
});

function setHeader() {
    const botState = state.botsConnected ? "Connected" : "Disconnected";
    header.setContent(
        ` ESC Menu | Tab Complete | Up/Down Select Command | Enter Send | Ctrl+C Exit | Bots: ${botState} `
    );
}

function pushLog(prefix, message) {
    const timestamp = new Date().toLocaleTimeString();
    state.logLines.push(`[${timestamp}] ${prefix} ${message}`);

    if (state.logLines.length > 300) {
        state.logLines.shift();
    }

    chatBox.setContent(state.logLines.join("\n"));
    chatBox.setScrollPerc(100);
    screen.render();
}

function showCommandHelp() {
    pushLog("info", "Available local commands:");
    COMMANDS.forEach((command) => {
        pushLog("cmd ", `${command.name.padEnd(12, " ")} ${command.description}`);
    });
}

function showStatus() {
    const offlineAccounts = state.configModule.config.offline_accounts;
    const accountCount = typeof offlineAccounts === "number" ? offlineAccounts : offlineAccounts.length;
    pushLog(
        "info",
        `Bots ${state.botsConnected ? "connected" : "disconnected"} | offline accounts: ${accountCount} | config path: ${CONFIG_PATH}`
    );
}

function clearLog() {
    state.logLines = [];
    chatBox.setContent("");
    screen.render();
}

async function connectBots() {
    if (state.botsConnected) {
        pushLog("info", "Bots are already marked as connected.");
        return;
    }
    await initconnectBots(state.configModule.config.offline_accounts, pushLog)

    state.botsConnected = true;
    setHeader();
    refreshMenuItems();
}

async function disconnectBots() {
    if (!state.botsConnected) {
        pushLog("info", "Bots are already marked as disconnected.");
        return;
    }

    await require("./utils/botHandler").disconnectBots();
    state.botsConnected = false;
    setHeader();
    refreshMenuItems();
}

const selfpromoteMessages = [
    "get this bot at: github․com/",
    "stop skidding and use: github․com/",
    "want to use something better? github․com/ is the best",
]
function promoteRepo() {
    for (const bot of bots) {
        bot.chat(selfpromoteMessages[Math.floor(Math.random() * selfpromoteMessages.length)])
    }
}

const meows = [
    "meow",
    "mew",
    "mrrp",
    "mrrrp",
    "mrrp!",
    "mrrwp",
    "mrreow",
    "mrraow",
    "mrrow",
    "mrroww",
    "mraow",
    "mraoww",
    "mrow",
    "mroww",
    "mrowr",
    "mreow",
    "mreeow",
    "mrrrow",
    "mrrraow",
    "mrrreow",
    "mrrrwp",
    "mrrroww",
    "mrrrowr",
    "mrrraw",
    "mraw",
    "mrawr",
    "mrao",
    "mrrt",
    "mrrrt",
    "mrrr",
    "prrp",
    "prrrp",
    "prrr",
    "prrrow",
    "purrr",
    "purr",
    "purrrr",
    "brrp",
    "brrrp",
    "nya",
    "nya~",
    "nyao",
    "nyaow",
    "nyaa",
    "nyaaow",
    "nyaoww",
    "miep",
    "miow",
    "miaow",
    "miao",
    "miyaow",
    "mrriaow",
    "eow",
    "reow",
    "raow",
    "rowr",
    "rawr",
    "mrrrr",
    "mrrrrp",
    "mrrrrrow",
    "mrrrrreow",
    "mrrraww",
    "mrryaow",
    "mrrmrr",
    "mewp",
    "mewrp",
    "meeep",
    "mewow",
    "meeow",
    "miaaaw",
    "nyrrp",
    "nyrrow",
    "prrroww",
    "prrreow",
    "prraow",
    "mrp",
    "mrpp",
    "mrp!",
    "mrrrp!",
    "mrrrrowww",
    "mrawww",
    "mreeeow",
    "myaow",
    "myaoww",
    "myeow",
    "mrryeow",
    "rrmeow",
    "rrmrrp",
    "mrrrp?"
];
function meow() {
    for (const bot of bots) {
        bot.chat(meows[Math.floor(Math.random() * meows.length)])
    }
}

function shutdown() {
    screen.destroy();
    process.exit(0);
}

function getMenuItems() {
    return [
        state.botsConnected ? "Disconnect Bots" : "Connect Bots",
        "Promote Repo",
        "Configuration",
        "Exit"
    ];
}

function refreshMenuItems() {
    menuList.setItems(getMenuItems());
    screen.render();
}

function hideAutocomplete() {
    state.commandMatches = [];
    state.selectedCommandIndex = 0;
    autocompleteBox.hide();
}

function commandSummary(command) {
    return `${command.name.padEnd(12, " ")} ${command.description}`;
}

function updateAutocomplete() {
    if (state.menuVisible || state.configVisible || state.promptVisible) {
        hideAutocomplete();
        screen.render();
        return;
    }

    const rawValue = inputBox.getValue().trim();

    if (!rawValue.startsWith("!")) {
        hideAutocomplete();
        screen.render();
        return;
    }

    state.commandMatches = COMMANDS.filter((command) =>
        command.name.toLowerCase().startsWith(rawValue.toLowerCase())
    );

    if (state.commandMatches.length === 0) {
        hideAutocomplete();
        screen.render();
        return;
    }

    if (state.selectedCommandIndex >= state.commandMatches.length) {
        state.selectedCommandIndex = 0;
    }

    autocompleteBox.setItems(state.commandMatches.map(commandSummary));
    autocompleteBox.select(state.selectedCommandIndex);
    autocompleteBox.height = Math.min(state.commandMatches.length + 2, 8);
    autocompleteBox.show();
    screen.render();
}

function moveAutocomplete(delta) {
    if (state.commandMatches.length === 0) {
        return;
    }

    state.selectedCommandIndex =
        (state.selectedCommandIndex + delta + state.commandMatches.length) %
        state.commandMatches.length;

    autocompleteBox.select(state.selectedCommandIndex);
    screen.render();
}

function applyAutocompleteSelection() {
    if (state.commandMatches.length === 0) {
        return;
    }

    const selectedCommand = state.commandMatches[state.selectedCommandIndex];
    inputBox.setValue(`${selectedCommand.name} `);
    updateAutocomplete();
    inputBox.focus();
    screen.render();
}

function openMenu() {
    state.menuVisible = true;
    state.configVisible = false;
    overlay.show();
    configBox.hide();
    menuBox.show();
    refreshMenuItems();
    menuList.focus();
    menuList.select(0);
    hideAutocomplete();
    screen.render();
}

function closeOverlay() {
    state.menuVisible = false;
    state.configVisible = false;
    overlay.hide();
    menuBox.hide();
    configBox.hide();
    inputBox.focus();
    updateAutocomplete();
    screen.render();
}

function openConfigEditor() {
    state.menuVisible = false;
    state.configVisible = true;
    overlay.show();
    menuBox.hide();
    configBox.show();
    renderConfigList();
    configList.focus();
    configList.select(0);
    hideAutocomplete();
    screen.render();
}

function formatEditableValue(field, value) {
    if (field.key === "offline_accounts") {
        if (typeof value === "number") {
            return String(value);
        }
        return value.join(", ");
    }

    if (field.key === "offline_password") {
        if (typeof value === "string") {
            return value;
        }

        return JSON.stringify(value);
    }

    if (field.type === "array") {
        return value.join(", ");
    }

    return String(value);
}

function renderConfigList() {
    const items = CONFIG_FIELDS.map((field) => {
        const value = state.configModule.config[field.key];
        const label = field.label.padEnd(20, " ");
        return `${label} ${formatEditableValue(field, value)}`;
    });

    configList.setItems(items);
    screen.render();
}

function parseFieldValue(field, rawInput) {
    const value = rawInput.trim();

    if (field.key === "offline_accounts") {
        if (/^\d+$/.test(value)) {
            const num = Number.parseInt(value, 10);
            if (num > 0) {
                return num;
            }
            throw new Error("Expected a positive number or comma-separated usernames.");
        }

        if (value.startsWith("[") && value.endsWith("]")) {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) {
                throw new Error("Expected a JSON array.");
            }
            return parsed.map((entry) => String(entry));
        }

        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    if (field.key === "offline_password") {
        if (value.startsWith("[") && value.endsWith("]")) {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) {
                throw new Error("Expected a JSON array.");
            }
            return parsed.map((entry) => String(entry));
        }

        if (value.startsWith("{") && value.endsWith("}")) {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Expected a JSON object.");
            }
            return Object.fromEntries(
                Object.entries(parsed).map(([key, entryValue]) => [String(key), String(entryValue)])
            );
        }

        return value;
    }

    if (field.type === "string") {
        if (field.choices && !field.choices.includes(value)) {
            throw new Error(`Expected one of: ${field.choices.join(", ")}`);
        }

        return value;
    }

    if (field.type === "array") {
        if (value.startsWith("[") && value.endsWith("]")) {
            const parsed = JSON.parse(value);

            if (!Array.isArray(parsed)) {
                throw new Error("Expected a JSON array.");
            }

            return parsed.map((entry) => String(entry));
        }

        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    if (field.type === "int") {
        const parsed = Number.parseInt(value, 10);

        if (Number.isNaN(parsed)) {
            throw new Error("Expected an integer.");
        }

        if (typeof field.min === "number" && parsed < field.min) {
            throw new Error(`Expected a value >= ${field.min}.`);
        }

        if (typeof field.max === "number" && parsed > field.max) {
            throw new Error(`Expected a value <= ${field.max}.`);
        }

        return parsed;
    }

    if (field.type === "float") {
        const parsed = Number.parseFloat(value);

        if (Number.isNaN(parsed)) {
            throw new Error("Expected a number.");
        }

        if (typeof field.min === "number" && parsed < field.min) {
            throw new Error(`Expected a value >= ${field.min}.`);
        }

        if (typeof field.max === "number" && parsed > field.max) {
            throw new Error(`Expected a value <= ${field.max}.`);
        }

        return parsed;
    }

    throw new Error(`Unsupported field type: ${field.type}`);
}

function editSelectedConfigField() {
    const selectedIndex = configList.selected;
    const field = CONFIG_FIELDS[selectedIndex];
    const currentValue = state.configModule.config[field.key];
    const choiceHint = field.choices ? ` (${field.choices.join(" | ")})` : "";

    state.promptVisible = true;

    prompt.input(
        `Edit ${field.label}${choiceHint}`,
        formatEditableValue(field, currentValue),
        (error, nextValue) => {
            state.promptVisible = false;

            if (error || nextValue === null || typeof nextValue === "undefined") {
                configList.focus();
                screen.render();
                return;
            }

            try {
                state.configModule.config[field.key] = parseFieldValue(field, nextValue);
                renderConfigList();
                pushLog("info", `Updated ${field.key}. Press S in configuration to save to disk.`);
            } catch (parseError) {
                pushLog("warn", parseError.message);
            }

            configList.focus();
            screen.render();
        }
    );
}

function saveCurrentConfig() {
    saveConfigModule(state.configModule);
    pushLog("info", `Saved configuration to ${CONFIG_PATH}`);
}

function reloadConfigFromDisk() {
    state.configModule = loadConfigModule();
    renderConfigList();
    pushLog("info", "Reloaded configuration from disk.");
}

function handleMenuSelection() {
    const selectedItem = menuList.getItem(menuList.selected);

    if (!selectedItem) {
        return;
    }

    const selectedText = selectedItem.getText();

    if (selectedText === "Connect Bots") {
        closeOverlay();
        connectBots();
        return;
    }

    if (selectedText === "Disconnect Bots") {
        closeOverlay();
        disconnectBots();
        return;
    }

    if (selectedText === "Promote Repo") {
        closeOverlay();
        promoteRepo();
        return;
    }

    if (selectedText === "Configuration") {
        openConfigEditor();
        return;
    }

    if (selectedText === "Exit") {
        shutdown();
    }
}

async function handleCommand(text) {
    const commandName = text.trim().split(/\s+/)[0].toLowerCase();
    const command = COMMANDS.find((entry) => entry.name === commandName);

    if (!command) {
        pushLog("warn", `Unknown command: ${commandName}`);
        return;
    }

    await command.action();
}

function sendChatMessage(message) {
    pushLog("you ", message);
    for (const bot of bots) {
        bot.chat(message)
    }
}

async function handleInputSubmission(rawValue) {
    const value = rawValue.trim();

    inputBox.clearValue();
    hideAutocomplete();
    screen.render();

    if (!value) {
        return;
    }

    if (value.startsWith("!")) {
        await handleCommand(value);
        return;
    }

    sendChatMessage(value);
}

inputBox.on("keypress", (_, key) => {
    if (!key) {
        return;
    }

    if (key.name === "up" && state.commandMatches.length > 0) {
        moveAutocomplete(-1);
        return;
    }

    if (key.name === "down" && state.commandMatches.length > 0) {
        moveAutocomplete(1);
        return;
    }

    if (key.name === "tab") {
        applyAutocompleteSelection();
        return;
    }

    process.nextTick(updateAutocomplete);
});

inputBox.on("submit", (value) => {
    handleInputSubmission(value).catch((error) => {
        pushLog("warn", error.message);
    });
});

autocompleteBox.on("select", (_, index) => {
    state.selectedCommandIndex = index;
    applyAutocompleteSelection();
});

menuList.on("select", () => {
    handleMenuSelection();
});

configList.on("select", () => {
    editSelectedConfigField();
});

configList.key(["s", "S"], () => {
    saveCurrentConfig();
});

configList.key(["r", "R"], () => {
    reloadConfigFromDisk();
});

screen.key(["escape"], () => {
    if (state.promptVisible) {
        return;
    }

    if (state.configVisible) {
        openMenu();
        return;
    }

    if (state.menuVisible) {
        closeOverlay();
        return;
    }

    openMenu();
});

screen.key(["C-c"], () => {
    shutdown();
});

setHeader();
refreshMenuItems();
pushLog("info", "Mineflayer terminal UI started.");
pushLog("info", "Type chat in the bottom box. Start with ! to see local commands.");
pushLog("info", "Press ESC to open the center menu.");
inputBox.focus();
screen.render();

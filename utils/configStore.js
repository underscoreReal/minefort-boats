const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(__dirname, "..", "config.js");

const CONFIG_GROUPS = [
    {
        title: "ACCOUNT",
        fields: [
            { key: "account_type", comment: "offline is the only option currently" },
            { key: "offline_accounts", comment: "number or comma-separated usernames" },
            { key: "offline_password" },
            { key: "offline_captcha_solver", comment: "manual, nopecha, tesseract" },
            { key: "offline_captcha_folder", comment: "folder to save captcha images" },
            { key: "join_delay", comment: "min 1.5 | max 10. prevents connection throb" },
            { key: "rejoin_delay_min", comment: "minimum reconnect delay in seconds" },
            { key: "rejoin_delay_max", comment: "maximum reconnect delay in seconds" }
        ]
    },
    {
        title: "NOPECHA",
        fields: [
            { key: "nopecha_key" },
            { key: "nopecha_tries" },
            { key: "nopecha_interval" }
        ]
    }
];

const INTERNAL_GROUP = {
    headerComments: [
        "These are variables that you the user should not modify/edit",
        "You might either break or soft lock the entire thing!"
    ],
    fields: [
        { key: "chat_recieve_leader" }
    ]
};

function cloneJsonValue(value) {
    if (typeof value === "undefined") {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
}

function requireFreshConfig() {
    delete require.cache[require.resolve(CONFIG_PATH)];
    return require(CONFIG_PATH);
}

function loadConfigModule() {
    const loaded = requireFreshConfig();

    return {
        config: cloneJsonValue(loaded.config || {}),
        internal_runtime_variables_do_not_modify: cloneJsonValue(
            loaded.internal_runtime_variables_do_not_modify || {}
        )
    };
}

function formatPrimitive(value) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }

    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
    ) {
        return String(value);
    }

    return null;
}

function formatValue(value, indentSize) {
    const primitive = formatPrimitive(value);

    if (primitive !== null) {
        return primitive;
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => formatValue(entry, indentSize)).join(", ")}]`;
    }

    if (typeof value === "object" && value !== null) {
        const indent = " ".repeat(indentSize);
        const childIndent = " ".repeat(indentSize + 4);
        const entries = Object.entries(value);

        if (entries.length === 0) {
            return "{}";
        }

        const lines = ["{"];

        entries.forEach(([key, nestedValue]) => {
            lines.push(`${childIndent}${key}: ${formatValue(nestedValue, indentSize + 4)},`);
        });

        lines.push(`${indent}}`);
        return lines.join("\n");
    }

    return JSON.stringify(value);
}

function formatPropertyLine(key, value, indentSize, comment) {
    const indent = " ".repeat(indentSize);
    const serializedValue = formatValue(value, indentSize);
    const suffix = comment ? ` // ${comment}` : "";

    if (!serializedValue.includes("\n")) {
        return [`${indent}${key}: ${serializedValue},${suffix}`];
    }

    const [firstLine, ...rest] = serializedValue.split("\n");
    const lines = [`${indent}${key}: ${firstLine}${suffix}`];

    rest.forEach((line) => {
        lines.push(`${indent}${line}`);
    });

    lines[lines.length - 1] = `${lines[lines.length - 1]},`;
    return lines;
}

function appendGroupedFields(lines, source, groups, indentSize) {
    const usedKeys = new Set();

    groups.forEach((group, groupIndex) => {
        if (groupIndex > 0) {
            lines.push("");
        }

        lines.push(`${" ".repeat(indentSize)}// ${group.title}`);

        group.fields.forEach((field) => {
            usedKeys.add(field.key);

            if (!Object.prototype.hasOwnProperty.call(source, field.key)) {
                return;
            }

            lines.push(...formatPropertyLine(field.key, source[field.key], indentSize, field.comment));
        });
    });

    const extraKeys = Object.keys(source).filter((key) => !usedKeys.has(key));

    if (extraKeys.length > 0) {
        lines.push("");
        lines.push(`${" ".repeat(indentSize)}// OTHER`);

        extraKeys.forEach((key) => {
            lines.push(...formatPropertyLine(key, source[key], indentSize));
        });
    }
}

function serializeConfigModule(moduleData) {
    const config = moduleData.config || {};
    const internal = moduleData.internal_runtime_variables_do_not_modify || {};
    const lines = ["module.exports = {", "    config: {"];

    appendGroupedFields(lines, config, CONFIG_GROUPS, 8);

    lines.push("    },", "");

    INTERNAL_GROUP.headerComments.forEach((comment) => {
        lines.push(`    // ${comment}`);
    });

    lines.push("    internal_runtime_variables_do_not_modify: {");

    INTERNAL_GROUP.fields.forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(internal, field.key)) {
            return;
        }

        lines.push(...formatPropertyLine(field.key, internal[field.key], 8));
    });

    const extraInternalKeys = Object.keys(internal).filter(
        (key) => !INTERNAL_GROUP.fields.some((field) => field.key === key)
    );

    extraInternalKeys.forEach((key) => {
        lines.push(...formatPropertyLine(key, internal[key], 8));
    });

    lines.push("    }", "}");

    return `${lines.join("\n")}\n`;
}

function saveConfigModule(moduleData) {
    fs.writeFileSync(CONFIG_PATH, serializeConfigModule(moduleData), "utf8");
}

module.exports = {
    CONFIG_PATH,
    loadConfigModule,
    saveConfigModule
};

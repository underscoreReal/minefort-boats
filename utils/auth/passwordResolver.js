function resolveOfflinePassword({ username, passwordConfig, accountIndex }) {
    if (typeof username === "string") {
        username = username.trim();
    }

    if (typeof passwordConfig === "string") {
        return passwordConfig;
    }

    if (Array.isArray(passwordConfig)) {
        if (typeof accountIndex === "number" && accountIndex >= 0 && accountIndex < passwordConfig.length) {
            return String(passwordConfig[accountIndex]);
        }

        return String(passwordConfig[0] || "");
    }

    if (passwordConfig && typeof passwordConfig === "object") {
        if (typeof username === "string" && Object.prototype.hasOwnProperty.call(passwordConfig, username)) {
            return String(passwordConfig[username]);
        }

        if (typeof username === "string") {
            const normalizedUsername = username.toLowerCase();
            for (const [key, value] of Object.entries(passwordConfig)) {
                if (String(key).toLowerCase() === normalizedUsername) {
                    return String(value);
                }
            }
        }

        if (typeof accountIndex === "number" && Object.prototype.hasOwnProperty.call(passwordConfig, String(accountIndex))) {
            return String(passwordConfig[String(accountIndex)]);
        }
    }

    return "";
}

module.exports = {
    resolveOfflinePassword
};

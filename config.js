module.exports = {
    config: {
        // ACCOUNT
        account_type: "offline", // offline is the only option currently
        offline_accounts: ["awpisthebest101"],
        offline_password: "password123!",
        offline_captcha_solver: "manual", // manual, nopecha, tesseract (manual is the best cause YOUR accuracy is 100% so fuck you)
        join_delay: 1.5, // min 1.5 | max 10. prevents connection throb

        // NOPECHA
        nopecha_key: "",
        nopecha_tries: 60,
        nopecha_interval: 5,

        // OTHER
        offline_captcha_folder: "captcha-images",
        rejoin_delay_min: 5,
        rejoin_delay_max: 10,
    },

    // These are variables that you the user should not modify/edit
    // You might either break or soft lock the entire thing!
    internal_runtime_variables_do_not_modify: {
        chat_recieve_leader: null,
    }
}

# minefort-boats

Minefort boats is a locally run Minecraft bot controller for the Minefort server. It can connect multiple offline accounts (for now), and manage bot sessions from a terminal UI.

## Features

- Support for single password, password array, or username-keyed password mapping
- Captcha handling with manual, NopeCHA, or Tesseract modes (they all suck btw.)
- Built-in terminal UI (AI FOR NOW) with commands for connect, disconnect, config, and status
- Automatic reconnection and authentication flow handling (for offline accounts)

## Requirements

- Node.js 18 or later
- npm
- Access to a Minefort server

## Installation

1. Clone the repository:

```bash
git clone https://github.com/underscoreReal/minefort-boats.git
cd minefort-boats
```

2. Install dependencies:

```bash
npm install
```

## Configuration

Edit `config.js` to set your bot details.

Example values:

```js
module.exports = {
  config: {
    account_type: "offline",
    offline_accounts: ["BotOne", "BotTwo"],
    offline_password: ["pass1", "pass2"],
    offline_captcha_solver: "manual",
    offline_captcha_folder: "captcha-images",
    join_delay: 1.5,
    rejoin_delay_min: 5,
    rejoin_delay_max: 10,
    nopecha_key: "",
    nopecha_tries: 60,
    nopecha_interval: 5
  },
  internal_runtime_variables_do_not_modify: {
    chat_recieve_leader: null
  }
}
```

### Password options

- Single password string for all accounts
- Array of passwords matched by account index
- Object keyed by username for per-account passwords

## Running the bot controller

Start the application with:

```bash
npm start
```

The terminal UI provides commands like:

- `!connect` to connect bots
- `!disconnect` to disconnect bots
- `!config` to open the config editor
- `!status` to show current status
- `!clear` to clear the activity view

## Captcha handling

The bot can use manual mode or automatic solvers:

- `manual`: save captcha image and allow manual input
- `nopecha`: use NopeCHA API
- `tesseract`: use Tesseract OCR

If manual solving is selected, a captcha prompt appears and the image is saved to the configured folder.

## Notes

- The bot attempts to handle auth prompts, hub transfers, and captcha flows automatically.
- If you use manual captcha mode, complete the input when prompted to allow the bot to proceed.
- I hate working on this including the offline auth flow.

# Roadmap

1. make a offline auth flow **(DONE)**
2. add nopcha **(DONE)**
3. add tesseract **(DONE)**
4. add session auth flow
5. add microsoft auth flow
6. remake the terminal ui
7. clean up this code base cause what the fuck did i do
8. fix kicking issues

## License

GPL-3.0-only

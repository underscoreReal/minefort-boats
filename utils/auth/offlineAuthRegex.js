const OFFLINE_AUTH_REGEX = {
    captchaPrompt: /please (?:enter|solve).+captcha|captcha(?: prompt)?|solve the captcha/i,
    captchaVerified: /captcha verified|captcha accepted|verification successful/i,
    hubTransfer: /sending you to hub_[1-3]/i,
    lobbyKick: /you were kicked from the server|kicked from the server/i,
    registerPrompt: /\/register|please register|not registered|register with|type \/register|enter.*register/i,
    loginPrompt: /\/login|please login|must login|already registered|type \/login|enter.*login/i,
    registerSuccess: /register(?:ation)? (?:completed|successful|success|done)|you are registered|account created|registered successfully/i,
    loginSuccess: /login (?:successful|success|complete|completed)|welcome back|you are logged in|logged in successfully/i,
    alreadyRegistered: /already registered/i,
    notRegistered: /not registered/i,
    wrongPassword: /wrong password|incorrect password/i,
    unexpectedError: /an unexpected error occurred|unexpected error occurred|unexpected error/i
};

module.exports = {
    OFFLINE_AUTH_REGEX
};

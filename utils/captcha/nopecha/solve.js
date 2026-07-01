const { default: axios } = require("axios");
const wait = require("../../wait");
const { config } = require("../../../config");

module.exports = {
    nopecha_solve: async (img) => {
        const post = await axios.post(
            "https://api.nopecha.com/v1/recognition/textcaptcha",
            { image_data: [img] },
            { headers: { "Content-Type": "application/json", Authorization: "Basic " + config.nopecha_key } }
        );

        const jobId = post?.data?.data;
        if (!jobId) throw new Error("Nopecha: failed to get job id from post response");

        const url = "https://api.nopecha.com/v1/recognition/textcaptcha?id=" + jobId;

        let attempts = 0;
        while (attempts < config.nopecha_tries) {
            await wait(config.nopecha_interval);

            let res;
            try {
                res = await axios.get(url, { headers: { Authorization: "Basic " + config.nopecha_key } });
            } catch (err) {
                console.error("Nopecha: polling error, attempt", attempts + 1, err.message || err);
                attempts += 1;
                continue;
            }

            const body = res?.data;
            if (body && Array.isArray(body.data) && body.data.length > 0 && typeof body.data[0] === "string") {
                return body.data[0].trim();
            }

            attempts += 1;
        }

        throw new Error("Nopecha: timeout waiting for job result");
    }
}
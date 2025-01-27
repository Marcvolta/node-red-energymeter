module.exports = function (RED) {
    var fs = require("fs-extra");
    //const file = "~/.node-red/energymeter_pers.json";
    //const file = "C:/Users/Marco/.node-red/energymeter_pers.json";

    function EnergyMeter(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        const accuracy = Number(config.accuracy);
        const SECONDS_HOUR = 3600;
        const COMMAND_TYPES = ["status", "set", "resetAll", "resetDaily", "resetWeekly", "resetMonthly", "resetYearly"];
        const filePath = config.filepath;

        // Initialize energy values
        initData();

        // Helper function to calculate energy
        function calcEnergy(interval, kwatts) {
            return (interval * kwatts) / SECONDS_HOUR;
        }

        // Helper function to round numbers
        function customRound(val, accuracy) {
            return Math.round(val * accuracy) / accuracy;
        }

        // Build the payload for sending
        function buildPayload(accuracy) {
            return {
                daily: customRound(node.oValues.daily.value, accuracy),
                weekly: customRound(node.oValues.weekly, accuracy),
                monthly: customRound(node.oValues.monthly, accuracy),
                yearly: customRound(node.oValues.yearly, accuracy),
            };
        }

        // Set values
        function setValsToNode(oVals) {
            Object.keys(oVals).forEach((key) => {
                if (node.oValues[key] !== undefined) {
                    key === "daily" ? (node.oValues[key]["value"] = oVals[key]) : (node.oValues[key] = oVals[key]);
                }
            });
        }

        // Calculate costs
        function calculateCosts(dailyValue, price) {
            return customRound(dailyValue * Number(price), 100);
        }

        // Save oValues to persistent context
        function saveValues() {
            // Persist data
            if (filePath && filePath !== "") {
                return fs.outputJson(filePath, node.oValues);
            } else {
                return node.context().set("oValues", node.oValues);
            }
        }

        async function initData() {
            var today = new Date();
            node.oValues = {
                daily: { date: today, value: 0 },
                weekly: 0,
                monthly: 0,
                yearly: 0,
            };

            if (filePath && filePath !== "") {
                try {
                    await fs.ensureFile(filePath);
                    let data = await fs.readFile(filePath, { encoding: "utf8" });
                    if (data && Object.keys(data).length > 0) setValsToNode(JSON.parse(data));
                } catch (err) {
                    console.error(err);
                    throw err;
                }
            } else {
                node.context().set("oValues", node.oValues);
            }
        }

        node.on("oneditsave", function (msg) {
            console.log("Edited...");
        });

        // Node input handler
        node.on("input", async function (msg) {
            // Validate price and format
            this.price = config.price ? config.price / 100 : 0;
            msg.topic = config.topic || "energy"; // Default to "energy" if topic is undefined

            // Handle status request or different commands
            // Could it be more ugly?
            if (isNaN(msg.payload)) {
                msg.payload = handleCommands(msg.payload);
                if (msg.error) {
                    this.error(msg.error);
                    node.send(msg);
                    return;
                }
                // Persist the values after change
                try {
                    await saveValues();
                } catch (err) {
                    console.log(err);
                }

                node.send(msg);
                return;
            }

            // Validate number payload
            const inputFormats = { w: 1000, kw: 1, mw: 1 / 1000 };
            this.toKwh = inputFormats[config.inputformat] || 0;
            var kwatts = msg.payload / this.toKwh;

            // Check if input msg is a number, else warn & exit
            if (isNaN(kwatts)) {
                this.error("Invalid number input.");
                return;
            }

            // Calculate energy
            var hrtime = process.hrtime();
            var secsnow = hrtime[0] + hrtime[1] / 1e9;
            var lastms = node.lastms || secsnow;
            var interval = secsnow - lastms;
            node.lastms = secsnow;

            var energy = calcEnergy(interval, kwatts);
            var today = new Date();

            // Reset daily values at midnight => add to weekly
            // node.oValues.daily.date.getDate()
            if (!node.oValues.daily.date || new Date(node.oValues.daily.date).getDate() != today.getDate()) {
                node.oValues.daily.date = today;
                node.oValues.weekly += node.oValues.daily.value;
                node.oValues.daily.value = 0;
                // Every monday
                if (today.getDay() === 1) {
                    node.oValues.monthly += node.oValues.weekly;
                    node.oValues.weekly = 0;
                }

                // Every first of month
                if (today.getDate() === 1) {
                    node.oValues.yearly += node.oValues.monthly;
                    node.oValues.monthly = 0;
                }
            }

            node.oValues.daily.value += energy;
            msg.payload = buildPayload(accuracy);

            if (this.price) {
                let costs = calculateCosts(node.oValues.daily.value, this.price);
                msg.payload["costs"] = costs;
            }

            try {
                await saveValues();
            } catch (err) {
                console.log(err);
            }
            node.send(msg);
        });

        /**
         * This function handles different command option.
         * Currently supported commands see COMMANT_TYPES.
         * New values are also set to node in here.
         *
         * @param {*} oPayload Command or command object
         * @returns A paylod object
         */
        function handleCommands(oPayload) {
            var oMessagePaylod = null;

            if (typeof oPayload === "string" && COMMAND_TYPES.find((cmd) => cmd === oPayload)) {
                switch (oPayload) {
                    case "status":
                        oMessagePaylod = buildPayload(accuracy);

                        if (this.price) {
                            let costs = calculateCosts(node.oValues.daily.value, this.price);
                            oMessagePaylod["costs"] = costs;
                        }
                        break;
                    case "resetDaily":
                        node.oValues = {
                            daily: { date: null, value: 0 },
                            weekly: node.oValues.weekly,
                            monthly: node.oValues.monthly,
                            yearly: node.oValues.yearly,
                        };

                        oMessagePaylod = buildPayload(accuracy);
                        node.lastms = null;
                        break;
                    case "resetWeekly":
                        node.oValues = {
                            daily: { date: node.oValues.daily.date, value: node.oValues.daily.value },
                            weekly: 0,
                            monthly: node.oValues.monthly,
                            yearly: node.oValues.yearly,
                        };

                        oMessagePaylod = buildPayload(accuracy);
                        node.lastms = null;
                        break;
                    case "resetMonthly":
                        node.oValues = {
                            daily: { date: node.oValues.daily.date, value: node.oValues.daily.value },
                            weekly: node.oValues.weekly,
                            monthly: 0,
                            yearly: node.oValues.yearly,
                        };

                        oMessagePaylod = buildPayload(accuracy);
                        node.lastms = null;
                        break;
                    case "resetYearly":
                        node.oValues = {
                            daily: { date: node.oValues.daily.date, value: node.oValues.daily.value },
                            weekly: node.oValues.weekly,
                            monthly: node.oValues.monthly,
                            yearly: 0,
                        };

                        oMessagePaylod = buildPayload(accuracy);
                        node.lastms = null;
                        break;
                    case "resetAll":
                        node.oValues = {
                            daily: { date: null, value: 0 },
                            weekly: 0,
                            monthly: 0,
                            yearly: 0,
                        };

                        oMessagePaylod = buildPayload(accuracy);
                        node.lastms = null;
                        break;
                }
            }

            // These are 'setting' type commands
            if (typeof oPayload === "object" && Object.keys(oPayload).find((cmd) => cmd === "set")) {
                // Look for properties to set...
                setValsToNode(oPayload.set);
                oMessagePaylod = buildPayload(accuracy);

                if (this.price) {
                    let costs = calculateCosts(node.oValues.daily.value, this.price);
                    oMessagePaylod["costs"] = costs;
                }
            }

            // Must be an invalid command
            if (!oMessagePaylod) {
                var sSupportedCommands = COMMAND_TYPES.join(", ");
                oMessagePaylod = { error: "The input msg is not a supported command. Only the following are supported: " + sSupportedCommands };
            }
            return oMessagePaylod;
        }
    }
    RED.nodes.registerType("energyMeter", EnergyMeter);
};

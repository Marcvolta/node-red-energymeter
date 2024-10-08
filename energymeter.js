module.exports = function(RED) {
    function EnergyMeter(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        const SECONDS_IN_HOUR = 3600;

        // Initialize energy values or load from persistent storage
        node.oValues = node.context().get('oValues') || { 
            daily: { date: null, value: 0 }, 
            weekly: 0, 
            monthly: 0, 
            yearly: 0 
        };

        // Helper function to calculate energy
        function calcEnergy(interval, kwatts) {
            return (interval * kwatts) / SECONDS_IN_HOUR;
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
                yearly: customRound(node.oValues.yearly, accuracy)
            };
        }

        // Calculate costs
        function calculateCosts(dailyValue, price) {
            return customRound(dailyValue * Number(price), 100);
        }

        // Save oValues to persistent context
        function saveValues() {
            node.context().set('oValues', node.oValues);
        }

        // Node input handler
        node.on('input', function(msg) {
            // Validate price and format
            this.price = config.price ? (config.price / 100) : 0;
            msg.topic = config.topic || "energy";  // Default to "energy" if topic is undefined

            // Handle status request or "set" command
            if (typeof msg.payload === "string" || typeof msg.payload === "object") {
                if (msg.payload === "status") {
                    msg.payload = buildPayload(this.accuracy);
                    if (this.price) msg.payload.costs = calculateCosts(node.oValues.daily.value, this.price);
                    node.send(msg);
                    return;
                }

                if (msg.payload.set) {
                    Object.keys(msg.payload.set).forEach(key => {
                        if (node.oValues[key] !== undefined) node.oValues[key] = msg.payload.set[key];
                    });
                    msg.payload = buildPayload(this.accuracy);
                    if (this.price) msg.payload.costs = calculateCosts(node.oValues.daily.value, this.price);
                    saveValues();  // Persist the values after change
                    node.send(msg);
                    return;
                }

                this.error("The input msg is not a number or supported command.");
                return;
            }

            // Validate number payload
            const inputFormats = { "w": 1000, "kw": 1, "mw": 1 / 1000 };
            this.toKwh = inputFormats[config.inputformat] || 1;
            this.accuracy = Number(config.accuracy);
            let kwatts = msg.payload / this.toKwh;

            if (isNaN(kwatts)) {
                this.error("Invalid number input");
                return;
            }

            // Calculate energy
            var hrtime = process.hrtime();
            var secsnow = hrtime[0] + (hrtime[1] / 1e9);
            var lastms = node.lastms || secsnow;
            var interval = secsnow - lastms;
            node.lastms = secsnow;

            var energy = calcEnergy(interval, kwatts);
            var today = new Date();

            // Reset daily values at midnight
            if (!node.oValues.daily.date || node.oValues.daily.date.getDate() !== today.getDate()) {
                node.oValues.daily.date = today;
                node.oValues.weekly += node.oValues.daily.value;
                node.oValues.daily.value = 0;

                // Every Monday
                if (today.getDay() === 1) {
                    node.o

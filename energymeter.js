module.exports = function(RED) {
    function EnergyMeter(config) {
        RED.nodes.createNode(this,config);
        var node = this;
        var oRes = {daily: {date: null, value: 0}, weekly: 0, monthly: 0, yearly: 0};
        node.oValues = oRes;

        function calcEnergy(interval, kwatts) {
            let hourToSec = 60*60;
            return (interval*kwatts)/hourToSec;
        }

        function customRound(val, accuracy) {
            return Math.round(val*accuracy)/accuracy;
        }

        function buildPayload(accuracy) {
            return {
                daily: customRound(node.oValues.daily.value, accuracy), 
                weekly: customRound(node.oValues.weekly, accuracy), 
                monthly: customRound(node.oValues.monthly, accuracy), 
                yearly: customRound(node.oValues.yearly, accuracy)
            };
        }

        node.on('input', function(msg) {
            this.price = config.price / 100;
            msg.topic = config.topic;

                if (isNaN(msg.payload)) {
                if (msg.payload === "status") {
                    msg.payload = {daily: node.oValues.daily.value, weekly: node.oValues.weekly, monthly: node.oValues.monthly, yearly: node.oValues.yearly};
        
                    if (this.price) {
                        let costs = customRound(node.oValues.daily.value * Number(this.price), 100);
                        msg.payload["costs"] = costs;
                    }
                    node.send(msg);
                    return;
                }

                if (Object.keys(msg.payload).length > 0 && Object.keys(msg.payload).includes("set")) {
                    var toSet = Object.keys(msg.payload.set);
                    toSet.forEach(key => {
                        var valToSet = msg.payload.set[key];
                        node.oValues[key] = valToSet;
                    })
                    msg.payload = buildPayload(this.accuracy);
        
                    if (this.price) {
                        let costs = customRound(node.oValues.daily.value * Number(this.price), 100);
                        msg.payload["costs"] = costs;
                    }
                    node.send(msg);
                    return;
                }

                this.error("The input msg is not a number, neither a supported command.");
		        return;
            }

            const inputFormats = {"w": 1000, "kw": 1, "mw": 1/1000};
            this.toKwh = inputFormats[config.inputformat] || 0;
            this.accuracy = Number(config.accuracy);
            var kwatts = (msg.payload / this.toKwh);
            	// Check if input msg is a number, else warn & exit
	        if (isNaN (kwatts)){
		        this.error("The input msg can not be calculated to a number");
		        return;
		    } 
            
            var hrtime = process.hrtime();
            var secsnow = ((hrtime[0]) + (hrtime[1] / 1e9));
            var lastms = node.lastms||secsnow;
	        var interval = secsnow - lastms;
            node.lastms = secsnow;

            var energy = calcEnergy(interval, kwatts);
            var today = new Date();

            if (!node.oValues.daily.date) {
                node.oValues.daily.date = today;
            }
            
            if (node.oValues.daily.date.getDate() != today.getDate()) {
                node.oValues.daily.date = today;
                node.oValues.weekly += node.oValues.daily.value;
                node.oValues.daily.value = 0;
                // Every monday
                if (today.getDay() === 1) {
                    node.oValues.monthly += node.oValues.weekly;
                    node.oValues.weekly = 0;
                }
            }

            node.oValues.daily.value += energy;
            msg.payload = buildPayload(this.accuracy);
        
            if (this.price) {
                let costs = customRound(node.oValues.daily.value * Number(this.price), 100);
                msg.payload["costs"] = costs;
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("energyMeter",EnergyMeter);
}

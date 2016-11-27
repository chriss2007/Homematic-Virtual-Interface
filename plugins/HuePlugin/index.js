var HueBridge = require(__dirname + '/HueBridge.js').HueBridge;


module.exports = function(server,name,logger) {
	
	this.bridge = new HueBridge(this,name,server,logger);
	this.bridge.init();
	this.name = name;
	
	this.handleConfigurationRequest = function(dispatched_request) {
		this.bridge.handleConfigurationRequest(dispatched_request);
    };
}

 
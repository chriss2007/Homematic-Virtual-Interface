//
//  NanoLeafDevice.js
//  Homematic Virtual Interface Plugin
//
//  Created by Thomas Kluge on 22.10.2017.
//  thanks to https://github.com/JensBonse for investigation on NanoLeaf Aurora ...
//
//  Copyright © 2017 kSquare.de. All rights reserved.
//

'use strict'
var path = require('path')
var AuroraApi = require(path.join(__dirname,'lib','aurora.js'))
var HomematicDevice;

function NanoLeafDevice (plugin,deviceName) {
	this.plugin = plugin
	this.devName = deviceName
	this.bridge = plugin.bridge	
	this.config = plugin.config
}
	
	
NanoLeafDevice.prototype.init = function (ip,token,id) {
	var that = this
	
	this.ip = ip
	this.token = token
	HomematicDevice = this.plugin.server.homematicDevice;
	
	
	this.hmDevice = new HomematicDevice(this.plugin.getName())
	var devName = 'Aurora_' + this.devName

	this.hmDevice.initWithType('HM-LC-RGBW-WM', devName)
	this.bridge.addDevice(this.hmDevice)

	// this will trigered when a value of a channel was changed by the ccu
	this.hmDevice.on('device_channel_value_change', function (parameter) {
		var newValue = parameter.newValue
		
		if (that.api) {
			var channel = that.hmDevice.getChannel(parameter.channel)
			if (parameter.name === 'LEVEL') {
				if (newValue == 0) {
					that.log.debug("turnOff")
					that.api.turnOff().then(function(result) { 
						that.log.debug('Turned off with result %s',result)
						clearTimeout(that.refreshTimer)
						that.fetchValues()
					}).catch(function(err) {that.log.error('Turn Off Error %s',err)})
				} else {
					that.lastLevel = newValue

					that.log.debug('turnOn')
					that.api.turnOn().then(function(result) { 
						that.log.debug('Turned On with result %s',result)
						var newBrightness = Math.ceil(newValue*100)
						that.log.debug('setBrightness %s',newBrightness)
						that.api.setBrightness(newBrightness).then(function(bresult) {
							that.log.debug('setBrightness  with result %s',bresult)
							clearTimeout(that.refreshTimer)
							that.fetchValues()
						}).catch(function(err) {that.log.error('Set Bri Error %s',err)})
					}).catch(function(err) {that.log.error('Turn On Error %s',err)})
				}
			}

			if (parameter.name === 'OLD_LEVEL') {
				that.log.debug('turnOn - OLD_LEVEL')
				that.api.turnOn().then(function(result) { 
					that.log.debug('Turned On with result %s',result)
					if ((that.lastLevel == 0) || (that.lastLevel == undefined)) {
						  that.lastLevel = 1;
					}
					var newBrightness = Math.ceil(that.lastLevel*100)
					that.log.debug('setBrightness %s',newBrightness)
					that.api.setBrightness(newBrightness).then(function(bresult) {
						that.log.debug('setBrightness  with result %s',bresult)
						clearTimeout(that.refreshTimer)
						that.fetchValues()
					}).catch(function(err) {that.log.error('Set Bri Error %s',err)})
				}).catch(function(err) {that.log.error('Turn On Error %s',err)})
			}
		
			if (parameter.name == "COLOR") {
				var newHue = Math.ceil((newValue*360)/199)
				that.log.debug('setHue %s',newHue)
				that.api.setEffect('Static').then(function(result) {
					that.api.setHue(newHue).then(function(result) {
						 that.log.debug('setHue  with result %s',result)
					}).catch(function(err) {that.log.error('Set Hue Error %s',err)})
				}).catch(function(err) {that.log.error('Set Effect Error %s',err)})
			}

			if (parameter.name == "PROGRAM") {
				var progrId  = newValue
				if (progrId == 0) {
					that.log.debug('setEffect OFF');
					that.api.turnOff().then(function(result) { 
						that.log.debug('Turned off with result %s',result)
						clearTimeout(that.refreshTimer)
						that.fetchValues()
					}).catch(function(err) {that.log.error('Turn Off Error %s',err)})
				} else {
					if (that.effects.length>progrId) {
						var efname = that.effects[progrId]
						if (efname) {
							that.log.debug('setEffect to %s',efname)
							that.api.setEffect(efname).then(function(result) {
								that.log.debug('setEffect with result %s',result)
								clearTimeout(that.refreshTimer)
								that.fetchValues()
							}).catch(function(err) {that.log.error('setEffect Error %s',err)})
						}
					}
				}
			}
		}
	})

	this.hmDevice.on('device_channel_install_test', function(parameter){
		if (that.api) {
			that.api.identify().then(function() {}).catch(function(err) {that.log.error('Identification Error %s',err)})
			var channel = that.hmDevice.getChannel(parameter.channel)
			channel.endUpdating('INSTALL_TEST')
		} else {
			that.log.error('Identification Error , API is not active')
		}
	})
  
	if (this.api) {
		this.fetchValues()
	}
}


NanoLeafDevice.prototype.initApi = function() {
    var that = this
	
    var pluginEffectList = this.config.getValueForPlugin(this.name,'effects')
	this.log.debug("Plugin Effect List: %s", pluginEffectList)

	this.effects = [];
	
	if (pluginEffectList) {
		pluginEffectList.split(",").some(function (efname){
			that.effects.push(efname)
		})
	} else {
		this.effects.push('*Static*');	// no effect -> *Static*
	}
	    
	if (this.ip) {
		this.api = new AuroraApi({
  		  host: this.ip,
  		  base: '/api/v1/',
  		  port: '16021',
  		  accessToken: this.token || 'dummy'
  		})
	}
 
  	if ((this.api) && (!this.token)) {
	  	this.generateToken()
    } else {
	    // fetch Info and generate List of available effects
	    this.api.listEffects().then(function (result) {
		    try {
				that.log.debug("Aurora Effect List: %s", result)
			    var effectListObject = JSON.parse(result)
			    if (effectListObject) {
				    that.effectList = effectListObject
			    }
		    } catch (e) {
			    that.log.error("Aurora Effect List Error: %s", e)
		    }
		}).catch(function(err) {that.log.error('listEffects Error %s',err)})
    }
}

NanoLeafDevice.prototype.generateToken = function() {
	var that = this
	this.log.info('Holding the on-off button down for 5-7 seconds until the LED starts flashing in a pattern ')
	this.api.getToken().then(function(result){
		that.log.info('TokenResult : %s',result)
		try {
		  // result is like {"auth_token":"wFqJI0exC1oJjiuzzguholknjjz1m"} so parse that
		  var resultObject = JSON.parse(result)
		  if (resultObject) {
		  	var token = resultObject['auth_token']
				that.token = token
			}
		} catch (err) {
			 that.log.error('error while parsing the token %s',err) 
		}
	  }).catch(function(err) {that.log.error('GetToken Error %s',err)})
}

NanoLeafDevice.prototype.fetchValues = function () {
	var that = this
	try {
		if ((this.api) && (this.token)) {
			var di_channel = this.hmDevice.getChannelWithTypeAndIndex('DIMMER','1');
			var pr_channel = this.hmDevice.getChannelWithTypeAndIndex('RGBW_AUTOMATIC','3');
			if ((di_channel) && (pr_channel)) {
				this.api.getInfo().then(function (result) {
					that.log.debug('Aurora Status is %s',result)
					var auroraStatus = JSON.parse(result)
					// {"name":"Nanoleaf Aurora","serialNo":"S1111111111","manufacturer":"Nanoleaf","firmwareVersion":"2.1.3","model":"NL22","state":{"on":{"value":false},"brightness":{"value":17,"max":100,"min":0},"hue":{"value":0,"max":360,"min":0},"sat":{"value":100,"max":100,"min":0},"ct":{"value":4000,"max":6500,"min":1200},"colorMode":"effects"},"effects":{"select":"Forest","effectsList":["Color Burst","Fireplace","Fireworks","Flames","Forest","Inner Peace","Meteor Shower","Nemo","Northern Lights","Paint Splatter","Pulse Pop Beats","Rhythmic Northern Lights","Ripple","Romantic","Snowfall","Sound Bar","Streaking Notes","Sunset"]},"panelLayout":{"layout":{"numPanels":20,"sideLength":150,"positionData":[{"panelId":217,"x":-449,"y":259,"o":240},{"panelId":215,"x":-299,"y":433,"o":180},{"panelId":150,"x":-74,"y":129,"o":240},{"panelId":38,"x":-299,"y":173,"o":180},{"panelId":213,"x":-149,"y":173,"o":300},{"panelId":220,"x":-224,"y":129,"o":120},{"panelId":131,"x":-374,"y":303,"o":60},{"panelId":56,"x":-374,"y":389,"o":240},{"panelId":247,"x":-299,"y":259,"o":0},{"panelId":87,"x":-449,"y":433,"o":60},{"panelId":207,"x":-449,"y":519,"o":120},{"panelId":63,"x":-524,"y":562,"o":60},{"panelId":193,"x":-599,"y":519,"o":120},{"panelId":187,"x":-599,"y":433,"o":180},{"panelId":176,"x":-674,"y":562,"o":60},{"panelId":209,"x":-749,"y":519,"o":120},{"panelId":95,"x":-674,"y":649,"o":120},{"panelId":19,"x":-749,"y":692,"o":180},{"panelId":151,"x":-74,"y":43,"o":60},{"panelId":410,"x":-524,"y":389,"o":240}]},"globalOrientation":{"value":0,"max":360,"min":0}}}
					
					var rgb = (auroraStatus["state"]["hue"]["value"]*199)/360
					that.log.debug('Aurora Hue is %s',result)
					var co_channel = that.hmDevice.getChannelWithTypeAndIndex('RGBW_COLOR','2')
					if (co_channel) {
						 co_channel.updateValue('COLOR',rgb,true,true)
					}

					//var ct = auroraStatus["state"]["ct"]["value"]
					that.log.debug('Aurora ColourTemperature/Sat is %s',auroraStatus["state"]["hue"]["value"])

					var brightness = auroraStatus["state"]["brightness"]["value"]
					var bri = Math.floor(brightness)/100
					that.log.debug('Aurora Brightness is %s',brightness)
					
					var power = auroraStatus["state"]["on"]["value"]
					that.log.debug('Aurora Power Status is %s',auroraStatus["state"]["on"]["value"])
					if (power == false) {
						var bri = Math.floor(brightness["value"])/100
						that.log.debug('HM Brightness (OLD_LEVEL) will be set to %s',bri)
						that.lastLevel = bri
						di_channel.updateValue('OLD_LEVEL',bri,true,true)

						// Off is off so ignore the brightness and set it to zero
						di_channel.updateValue('LEVEL',0,true,true)
						pr_channel.updateValue('PROGRAM',0,true,true)
					} else {
						that.log.debug('HM Brightness (LEVEL) will be set to %s',bri)
						that.lastLevel = bri
						di_channel.updateValue('LEVEL',bri,true,true)

						// Check Effect
						var currentEffect = auroraStatus["effects"]["select"]
						that.log.debug('Aurora getEffect is %s', currentEffect)
						var program = that.effects.indexOf(currentEffect)
						if (program >= 0) {
							that.log.debug('HM Program will be set to %s',program)
							pr_channel.updateValue('PROGRAM',program,true,true)
						} else {
							that.log.error('Unmatched Aurora effect %s', currentEffect)
							pr_channel.updateValue('PROGRAM',0,true,true)
						}
					}
				}).catch(function(err) {that.log.error('getInfo Error %s',err)})
			}
		} 
	} catch (error) {
		this.log.error('General fetch Error %s',error)
	}
	var refreshrate = this.config.getValueForPluginWithDefault(this.name,"refresh",30)
	this.refreshTimer = setTimeout(function() {that.fetchValues()}, (refreshrate * 1000));
}


module.exports = NanoLeafDevice

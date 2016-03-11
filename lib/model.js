"use strict";
module.exports = {

	'add': function(soajsRequest, config, cb) {
		var data = soajsRequest.dataMw.data;

		for(var fieldName in soajsRequest.inputmaskData) {
			//if(fieldName === '__env'){ continue; }
			if(Object.hasOwnProperty.call(soajsRequest.inputmaskData, fieldName)) {
				data[fieldName] = soajsRequest.inputmaskData[fieldName];
			}
		}

		return cb(null, data);
	},

	'update': function(soajsRequest, config, cb) {
		var data = soajsRequest.dataMw.data;
		data['$set'] ={};
		for(var fieldName in soajsRequest.inputmaskData) {
			//if(fieldName === '__env'){ continue; }
			if(Object.hasOwnProperty.call(soajsRequest.inputmaskData, fieldName)) {
				if(fieldName === 'id') {
					continue;
				}

				data['$set']["fields." + fieldName] = soajsRequest.inputmaskData[fieldName];
			}
		}
		return cb(null, data);
	}
};
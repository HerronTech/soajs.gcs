"use strict";
var fs = require("fs");
var assert = require('assert');
var request = require("request");
var soajs = require('soajs');
var util = require('soajs.core.libs').utils;
var helper = require("../helper.js");

var dbConfig = require("./db.config.test.js");
var GCDBConfig = dbConfig();
var mongo;

var soajs = require('soajs');
var serviceGenerator = helper.requireModule("lib/sg");
/*
 1- deploy at least 2 environments
 2- store a gc in db that has [add - update - get - delete - list] apis
 3- pass the env variables for the new gc service and create it
 4- make a call to all its apis.
 */

var extKey = 'aa39b5490c4a4ed0e56d7ec1232a428f771e8bb83cfcee16de14f735d0f5da587d5968ec4f785e38570902fd24e0b522b46cb171872d1ea038e88328e7d973ff47d9392f72b2d49566209eb88eb60aed8534a965cf30072c39565bd8d72f68ac';

function executeMyRequest(params, apiPath, method, cb) {
	requester(apiPath, method, params, function (error, body) {
		assert.ifError(error);
		assert.ok(body);
		return cb(body);
	});
	
	function requester(apiName, method, params, cb) {
		var options = {
			uri: 'http://127.0.0.1:4000/' + apiName,
			headers: {
				"key": extKey
			},
			json: true
		};
		
		if (params.headers) {
			for (var h in params.headers) {
				if (params.headers.hasOwnProperty(h)) {
					options.headers[h] = params.headers[h];
				}
			}
		}
		
		if (params.form) {
			options.body = params.form;
		}
		
		if (params.qs) {
			options.qs = params.qs;
		}
		
		if (params.formData) {
			options.formData = params.formData;
		}
		request[method](options, function (error, response, body) {
			assert.ifError(error);
			assert.ok(body);
			return cb(null, body);
		});
	}
}

describe("GCS Tests", function () {
	
	var access_token;
	before(function (done) {
		
		executeMyRequest({}, "oauth/authorization", "get", function (body) {
			assert.ok(body);
			var authorization = body.data;
			var options = {
				headers: {
					'Authorization': authorization,
					'Content-Type': 'application/json'
				},
				form: {
					"grant_type": "password",
					"username": "owner",
					"password": "123456"
				}
			};
			executeMyRequest(options, "oauth/token", "post", function (body) {
				assert.ok(body);
				access_token = body.access_token;
				done();
			});
		});
	});
	
	describe("Create Sample MT GC Data", function () {
		var gcService;
		
		after(function (done) {
			fs.unlinkSync("./test.txt");
			setTimeout(function () {
				done()
			}, 1000);
		});
		
		before(function (done) {
			
			var serviceInfo = {
				"name": "gc_pages",
				"version": 1
			};
			
			soajs.contentBuilder(serviceInfo, function (error, config) {
				assert.ifError(error);
				assert.ok(config);
				
				gcService = new serviceGenerator(config);
				//Initialize and deploy the service
				gcService.buildService(function () {
					console.log('Service ' + serviceInfo.name + ' Generated and Deployed...');
					
					GCDBConfig.name = 'TEST_gc_pages';
					mongo = new soajs.mongo(GCDBConfig);
					fs.writeFileSync("./test.txt", "good morning everyone...");
					mongo.dropDatabase(function (error) {
						assert.ifError(error);
						done();
					});
				});
			});
		});
		
		var dataId;
		it("success - waiting for service to register to resume", function (done) {
			setTimeout(function () {
				request.get("http://localhost:5000/reloadRegistry", function (error, response, body) {
					assert.ifError(error);
					assert.ok(body);
					body = JSON.parse(body);
					//console.log(body.data.services);
					request.get("http://localhost:5000/awarenessStat", function (error, response, body) {
						assert.ifError(error);
						assert.ok(body);
						body = JSON.parse(body);
						//console.log(body.data);
						done();
					});
				});
			}, 2000);
		});
		
		it("success - calling getSchema", function (done) {
			var params = {
				"qs": {
					"access_token": access_token
				}
			};
			executeMyRequest(params, "gc_pages/schema", "get", function (body) {
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling add", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV"
				},
				"form": {
					"title": "my page",
					"content": "this is my page content"
				}
			};
			
			executeMyRequest(params, "gc_pages/add", "post", function (body) {
				assert.ok(body.result);
				assert.ok(body.data);
				dataId = body.data[0]._id;
				
				params = {
					"qs": {
						"env": "DEV",
						"nid": dataId,
						"action": "add",
						"position": 0,
						"field": "attachments",
						"media": "document",
						"access_token": access_token
					},
					"formData": {
						"my_file": fs.createReadStream("test.txt")
					}
				};
				executeMyRequest(params, "gc_pages/upload", "post", function (body) {
					assert.ok(body.result);
					assert.ok(body.data);
					done();
				});
			});
		});
		
		it("success - calling get", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				}
			};
			executeMyRequest(params, "gc_pages/get", "get", function (body) {
				assert.ok(body.result);
				assert.ok(body.data);
				
				params = {
					"qs": {
						"env": "DEV",
						"id": body.data.fields.attachments[0]._id
					}
				};
				executeMyRequest(params, "gc_pages/download", "get", function (body) {
					console.log(JSON.stringify(body));
					done();
				});
			});
		});
		
		it("success - calling upload a new file", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"nid": dataId,
					"action": "add",
					"position": 1,
					"field": "attachments",
					"media": "document"
				},
				"formData": {
					"my_file": fs.createReadStream("test.txt")
				}
			};
			executeMyRequest(params, "gc_pages/upload", "post", function (body) {
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling update", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				},
				"form": {
					"title": "my page updated",
					"content": "this is my page content"
				}
			};
			executeMyRequest(params, "gc_pages/update", "post", function (body) {
				assert.ok(body.result);
				assert.ok(body.data);
				
				params = {
					"qs": {
						"access_token": access_token,
						"env": "DEV",
						"nid": dataId,
						"action": "edit",
						"position": 0,
						"field": "attachments",
						"media": "document"
					},
					"formData": {
						"my_file": fs.createReadStream("test.txt")
					}
				};
				executeMyRequest(params, "gc_pages/upload", "post", function (body) {
					assert.ok(body.result);
					assert.ok(body.data);
					done();
				});
			});
		});
		
		it("success - calling remove a file", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				}
			};
			executeMyRequest(params, "gc_pages/get", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				
				var params = {
					"qs": {
						"access_token": access_token,
						"env": "DEV",
						"id": body.data.fields.attachments[1]._id
					}
				};
				executeMyRequest(params, "gc_pages/deleteFile", "get", function (body) {
					assert.ok(body.result);
					assert.ok(body.data);
					done();
				});
			});
		});
		
		it("success - calling list", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV"
				}
			};
			executeMyRequest(params, "gc_pages/list", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling delete", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				}
			};
			executeMyRequest(params, "gc_pages/delete", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("killin pages gcs", function (done) {
			gcService.stopService(function () {
				console.log("gc_pages stopped.")
				done();
			});
		});
	});
	
	describe("Create Sample Standalone GC Data", function () {
		var gcService;
		
		before(function (done) {
			var serviceInfo = {
				"name": "gc_posts",
				"version": 1
			};
			
			soajs.contentBuilder(serviceInfo, function (error, config) {
				assert.ifError(error);
				assert.ok(config);
				
				gcService = new serviceGenerator(config);
				//Initialize and deploy the service
				gcService.buildService(function () {
					console.log('Service ' + serviceInfo.name + ' Generated and Deployed...');
					
					GCDBConfig.name = 'TEST_gc_posts';
					mongo = new soajs.mongo(GCDBConfig);
					mongo.dropDatabase(function (error) {
						assert.ifError(error);
						done();
					});
				});
			});
		});
		
		var dataId;
		it("success - waiting for service to register to resume", function (done) {
			setTimeout(function () {
				request.get("http://localhost:5000/reloadRegistry", function (error, response, body) {
					assert.ifError(error);
					assert.ok(body);
					body = JSON.parse(body);
					//console.log(body.data.services);
					request.get("http://localhost:5000/awarenessStat", function (error, response, body) {
						assert.ifError(error);
						assert.ok(body);
						body = JSON.parse(body);
						//console.log(body.data);
						done();
					});
				});
			}, 2000);
		});
		
		it("success - calling getSchema", function (done) {
			var params = {
				"qs": {
					"access_token": access_token
				}
			};
			executeMyRequest(params, "gc_posts/schema", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling add", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV"
				},
				"form": {
					"title": "my page",
					"content": "this is my page content"
				}
			};
			
			executeMyRequest(params, "gc_posts/add", "post", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				dataId = body.data[0]._id;
				done();
			});
		});
		
		it("success - calling get", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				}
			};
			executeMyRequest(params, "gc_posts/get", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling update", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				},
				"form": {
					"title": "my page updated",
					"content": "this is my page content"
				}
			};
			executeMyRequest(params, "gc_posts/update", "post", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling list", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV"
				}
			};
			executeMyRequest(params, "gc_posts/list", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("success - calling delete", function (done) {
			var params = {
				"qs": {
					"access_token": access_token,
					"env": "DEV",
					"id": dataId
				}
			};
			executeMyRequest(params, "gc_posts/delete", "get", function (body) {
				console.log(JSON.stringify(body));
				assert.ok(body.result);
				assert.ok(body.data);
				done();
			});
		});
		
		it("killin pages gcs", function (done) {
			gcService.stopService(function () {
				console.log("gc_posts stopped.");
				done();
			});
		});
	});
});
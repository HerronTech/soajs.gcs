"use strict";
var assert = require('assert');
var shell = require('shelljs');
var helper = require("../helper.js");
var sampleData = require("soajs.mongodb.data/modules/gcs");
var controller, oauth;

describe("importing sample data", function () {

	it("do import", function (done) {
		shell.pushd(sampleData.dir);
		shell.exec("chmod +x " + sampleData.shell, function (code) {
			assert.equal(code, 0);
			shell.exec(sampleData.shell, function (code) {
				assert.equal(code, 0);
				shell.popd();
				done();
			});
		});
	});

	after(function (done) {
		process.env.SOAJS_ENV = "dev";
		//process.env.SOAJS_SRVIP = "127.0.0.1";
		console.log('test data imported.');
		controller = require("soajs.controller");
		setTimeout(function () {
			oauth = require("soajs.oauth");
			setTimeout(function () {
				require("./soajs.gc.test.js");
				done();
			}, 1000);
		}, 1000);
	});
});
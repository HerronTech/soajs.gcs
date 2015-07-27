"use strict";
var fs = require('fs');
var Grid = require('gridfs-stream');

var soajs = require('soajs');
var Mongo = soajs.mongo;
var mongoCore;
function checkForMongoCore(config, req, cb) {
    var connectionInfo;
    if (!mongoCore) {
        mongoCore = new Mongo(req.soajs.registry.coreDB.provision);
    }

    mongoCore.findOne("environment", {"code": req.soajs.inputmaskData['__env'].toUpperCase()}, {"dbs": 1}, function (error, envInfo) {
        if (error) {
            return cb(error);
        }

        if (!envInfo) {
            return cb(new Error('This Environment has no Database Connection'));
        }

        var dbInfo = config.db.config[req.soajs.inputmaskData['__env'].toUpperCase()];
        var dbToUse = Object.keys(dbInfo)[0];
        for (var dbName in envInfo.dbs.databases) {
            if (dbName === dbToUse) {
                connectionInfo = envInfo.dbs.clusters[dbInfo[dbToUse].cluster];
                connectionInfo.name = dbToUse;

                if (dbInfo[dbToUse].tenantSpecific) {
                    var tenantCode = req.soajs.session.getUrac().tenant.code;
                    connectionInfo.name = tenantCode + '_' + config.serviceName;
                }
            }
        }
        if (!connectionInfo) {
            return cb(new Error('This Environment has no Database Connection'));
        }

        return cb(null, connectionInfo);
    });
}

var dataMw = function (config, formFields) {
    this.mongo = {};
    this.formFields = formFields;
    this.config = config || {};

    //build the context of the middleware
    this.context = {
        'db': {
            'collection': (this.config && this.config.db && this.config.db.collection) ? this.config.db.collection : this.this.config.db.collection,
            'options': (this.config && this.config.db && this.config.db.options) ? this.config.db.options : {},
            'condition': (this.config && this.config.db && this.config.db.condition) ? this.config.db.condition : {}
        },
        model: null
    };

    for (var operationName in this.config.mw) {
        if (Object.hasOwnProperty.call(this.config.mw, operationName)) {
            if (!this.context.model) {
                this.context.model = {};
            }
            this.context.model[operationName] = this.config.mw[operationName].model || null;
        }
    }

    //initialize the supported functionality: list - get - delete - add - update
    var self = this;
    /*
     The list functionality provides the ability to fetch records from the database.
     it only requires that an error code value be present in the configuration
     */
    this.list = {
        'initialize': function (req, res, next) {
            //if multitenant, on each request build a new mongo connection
            if (self.config.db.multitenant) {
                checkForMongoCore(config, req, function (error, connectionInfo) {
                    if (error) {
                        res.jsonp(req.soajs.buildResponse({"code": self.config.mw.list.code, "msg": error.message}));
                    }
                    self.mongo = new Mongo(connectionInfo);
                    //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                    req.soajs.dataMw = {"data": null, "db": self.context.db, "mongo": self.mongo};
                    next();
                });
            }
            else {
                //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                req.soajs.dataMw = {"data": null, "db": self.context.db, "mongo": self.mongo};
                next();
            }
        },

        'exec': function (req, res, next) {
            self.mongo.find(self.context.db.collection, self.context.db.condition || {}, self.context.db.options || {}, function (error, records) {
                if (error || !records) {
                    if (self.config.db.multitenant) {
                        self.mongo.closeDb();
                    }
                    if (error) {
                        req.soajs.log.error(error);
                    }
                    var msg = (error) ? error.message : self.config.errors[self.config.mw.list.code];
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.list.code, "msg": msg}));
                }
                req.soajs.dataMw.data = records;
                next();
            });
        },

        'response': function (req, res) {
            //if multitenant, on each request close the mongo connection
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            //return valid response
            return res.jsonp(req.soajs.buildResponse(null, req.soajs.dataMw.data));
        }
    };

    /*
     The get functionality provides the ability to fetch one record from the database.
     it only requires that an error code value be present in the configuration
     */
    this.get = {
        'initialize': function (req, res, next) {
            //if multitenant, on each request build a new mongo connection
            if (self.config.db.multitenant) {
                checkForMongoCore(config, req, function (error, connectionInfo) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.get.code,
                            "msg": error.message
                        }));
                    }
                    self.mongo = new Mongo(connectionInfo);
                    proceed();
                });
            }
            else {
                proceed();
            }

            function proceed() {
                //id is needed, attempt to parse it to mongo ObjectId and added it to the condition, used in exec
                try {
                    self.context.db.condition = {
                        '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                    };
                } catch (e) {
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.get.code, "msg": e.message}));
                }
                //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                req.soajs.dataMw = {"data": null, "db": self.context.db, "mongo": self.mongo};
                next();
            }
        },

        'exec': function (req, res, next) {
            self.mongo.findOne(self.context.db.collection, self.context.db.condition || {}, function (error, oneRecord) {
                if (error) {
                    if (self.config.db.multitenant) {
                        self.mongo.closeDb();
                    }
                    if (error) {
                        req.soajs.log.error(error);
                    }
                    var msg = (error) ? error.message : self.config.errors[self.config.mw.get.code];
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.get.code, "msg": msg}));
                }
                self.context.db.condition = {};
                req.soajs.dataMw.data = oneRecord;

                var fileFields = {};
                self.formFields.forEach(function (oneEntry) {
                    if (oneRecord[oneEntry.name] && ['audio', 'video', 'image', 'document'].indexOf(oneEntry.type) !== -1) {
                        fileFields[oneEntry.name] = oneRecord[oneEntry.name];
                    }
                });

                if (Object.keys(fileFields).length > 0) {
                    self.getUploadedFileNames(fileFields, function (error) {
                        if (error) {
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            req.soajs.log.error(error);
                            var msg = (error) ? error.message : self.config.errors[self.config.mw.get.code];
                            return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.get.code, "msg": msg}));
                        }
                        for (var field in fileFields) {
                            req.soajs.dataMw.data[field] = fileFields[field];
                        }
                        next();
                    });
                }
                else {
                    next();
                }
            });
        },

        'response': function (req, res) {
            //if multitenant, on each request close the mongo connection
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            //return valid response
            return res.jsonp(req.soajs.buildResponse(null, req.soajs.dataMw.data));
        }
    };

    /*
     The delete functionality provides the ability to flag one record in the database as deleted.
     it only requires that an error code value be present in the configuration
     */
    this.delete = {
        'initialize': function (req, res, next) {
            //if multitenant, on each request build a new mongo connection
            if (self.config.db.multitenant) {
                checkForMongoCore(config, req, function (error, connectionInfo) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.delete.code,
                            "msg": error.message
                        }));
                    }
                    self.mongo = new Mongo(connectionInfo);
                    proceed();
                });
            }
            else {
                proceed();
            }

            function proceed() {
                //id is needed, attempt to parse it to mongo ObjectId and added it to the condition, used in exec
                try {
                    self.context.db.condition = {
                        '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                    };
                } catch (e) {
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.delete.code, "msg": e.message}));
                }

                //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                req.soajs.dataMw = {"data": null, "db": self.context.db, "mongo": self.mongo};
                next();
            }
        },

        'exec': function (req, res, next) {
            self.mongo.findOne(self.context.db.collection, self.context.db.condition || {}, function (error, oneRecord) {
                if (error) {
                    if (self.config.db.multitenant) {
                        self.mongo.closeDb();
                    }
                    req.soajs.log.error(error);
                    var msg = (error) ? error.message : self.config.errors[self.config.mw.delete.code];
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.delete.code, "msg": msg}));
                }

                var fileFields = {};
                self.formFields.forEach(function (oneEntry) {
                    if (oneRecord[oneEntry.name] && ['audio', 'video', 'image', 'document'].indexOf(oneEntry.type) !== -1) {
                        fileFields[oneEntry.name] = oneRecord[oneEntry.name];
                    }
                });

                if (Object.keys(fileFields).length === 0) {
                    removeDataRecord();
                }
                else {
                    self.removeUploadedFile(fileFields, function (error) {
                        if (error) {
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            req.soajs.log.error(error);
                            var msg = (error) ? error.message : self.config.errors[self.config.mw.delete.code];
                            return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.delete.code, "msg": msg}));
                        }
                        removeDataRecord();
                    });
                }
            });

            function removeDataRecord() {
                self.mongo.remove(self.context.db.collection, self.context.db.condition || {}, function (error) {
                    if (error) {
                        if (self.config.db.multitenant) {
                            self.mongo.closeDb();
                        }
                        req.soajs.log.error(error);
                        var msg = (error) ? error.message : self.config.errors[self.config.mw.delete.code];
                        return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.delete.code, "msg": msg}));
                    }
                    self.context.db.condition = {};
                    next();
                });
            }
        },

        'response': function (req, res) {
            //if multitenant, on each request close the mongo connection
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            //return valid response
            return res.jsonp(req.soajs.buildResponse(null, true));
        }
    };

    /*
     The add functionality provides the ability to insert one record in the database.
     it requires an error code value and a model to be present in the configuration
     */
    this.add = {
        'initialize': function (req, res, next) {
            //add requires a model to be provided or it cannot function. throw error if no model found
            if (!self.context.model || !self.context.model.add) {
                var error = new Error("No model for add functionality was found, unable to proceed");
                return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.add.code, "msg": error.message}));
            }

            //if multitenant, on each request build a new mongo connection
            if (self.config.db.multitenant) {
                checkForMongoCore(config, req, function (error, connectionInfo) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.add.code,
                            "msg": error.message
                        }));
                    }
                    self.mongo = new Mongo(connectionInfo);

                    //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                    req.soajs.dataMw = {"data": {}, "db": self.context.db, "mongo": self.mongo};
                    next();
                });
            }
            else {
                //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                req.soajs.dataMw = {"data": {}, "db": self.context.db, "mongo": self.mongo};
                next();
            }
        },

        'exec': function (req, res, next) {
            try {
                //call the model and attempt to build the data object
                self.context.model.add(req.soajs, self.config, function (error, data) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.add.code,
                            "msg": error.message
                        }));
                    }

                    var author;
                    if (req.soajs.session) {
                        author = req.soajs.session.getUrac().username;
                    }

                    req.soajs.dataMw.data = {
                        "created": new Date().getTime(),
                        "fields": data
                    };
                    if (author) {
                        req.soajs.dataMw.data['author'] = author;
                    }

                    //execute insert
                    self.mongo.insert(self.context.db.collection, req.soajs.dataMw.data, function (error, record) {
                        if (error) {
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            return res.jsonp(req.soajs.buildResponse({
                                "code": self.config.mw.add.code,
                                "msg": error.message
                            }));
                        }
                        self.context.response = record;
                        next();
                    });
                });
            }
            catch (e) {
                if (self.mongo && self.config.db.multitenant) {
                    self.mongo.closeDb();
                }
                return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.add.code, "msg": e.message}));
            }
        },

        'response': function (req, res) {
            //if multitenant, on each request close the mongo connection
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            //return valid response
            var response = self.context.response;
            delete self.context.response;
            return res.jsonp(req.soajs.buildResponse(null, response));
        }
    };

    /*
     The update functionality provides the ability to modify one record in the database.
     it requires an error code value and a model to be present in the configuration
     */
    this.update = {
        'initialize': function (req, res, next) {
            //update requires a model to be provided or it cannot function. throw error if no model found
            if (!self.context.model || !self.context.model.update) {
                var error = new Error("No model for update functionality was found, unable to proceed");
                return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.update.code, "msg": error.message}));
            }

            //if multitenant, on each request build a new mongo connection
            if (self.config.db.multitenant) {

                checkForMongoCore(config, req, function (error, connectionInfo) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.update.code,
                            "msg": error.message
                        }));
                    }
                    self.mongo = new Mongo(connectionInfo);
                    proceed();
                });
            }
            else {
                proceed();
            }

            function proceed() {
                //id is needed, attempt to parse it to mongo ObjectId and added it to the condition, used in exec
                try {
                    self.context.db.condition = {
                        '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                    };
                } catch (e) {
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.update.code, "msg": e.message}));
                }

                //store an empty data object, the db info and the mongo instance, might be used by preExec and postExec
                req.soajs.dataMw = {"data": {}, "db": self.context.db, "mongo": self.mongo};

                next();
            }
        },

        'exec': function (req, res, next) {
            try {
                //call the model and attempt to build the data object
                self.context.model.update(req.soajs, self.config, function (error, data) {
                    if (error) {
                        return res.jsonp(req.soajs.buildResponse({
                            "code": self.config.mw.update.code,
                            "msg": error.message
                        }));
                    }

                    //create the options object for update
                    if (!self.config.db.options || JSON.stringify(self.config.db.options) === "{}") {
                        self.config.db.options = {'safe': true, 'upsert': false};
                    }

                    req.soajs.dataMw.data = data;
                    req.soajs.dataMw.data['$set'].modified = new Date().getTime();

                    //execute update
                    self.mongo.update(self.context.db.collection, self.context.db.condition, req.soajs.dataMw.data, self.context.db.options, function (error) {
                        if (error) {
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            return res.jsonp(req.soajs.buildResponse({
                                "code": self.config.mw.update.code,
                                "msg": error.message
                            }));
                        }
                        self.context.db.condition = {};
                        next();
                    });
                });
            }
            catch (e) {
                if (self.mongo && self.config.db.multitenant) {
                    self.mongo.closeDb();
                }
                return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.update.code, "msg": e.message}));
            }
        },

        'response': function (req, res) {
            //if multitenant, on each request close the mongo connection
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            //return valid response
            return res.jsonp(req.soajs.buildResponse(null, {'_id': req.soajs.inputmaskData.id}));
        }
    };

    this.saveUploadedFile = function (req, res, fileInfo, cb) {
        req.soajs.inputmaskData['__env'] = fileInfo.fields.env;
        //if multitenant, on each request build a new mongo connection
        if (self.config.db.multitenant) {
            checkForMongoCore(config, req, function (error, connectionInfo) {
                if (error) {
                    return res.jsonp(req.soajs.buildResponse({
                        "code": self.config.mw.update.code,
                        "msg": error.message
                    }));
                }
                self.mongo = new Mongo(connectionInfo);
                proceed();
            });
        }
        else {
            proceed();
        }

        function proceed() {
            var condition = {};
            try {
                condition = {
                    '_id': self.mongo.ObjectId(fileInfo.fields.nid)
                };
            } catch (e) {
                return cb(e);
            }

            self.mongo.getMongoSkinDB(function (error, db) {
                if (error) {
                    return cb(error);
                }

                var gfs = Grid(db, self.mongo.mongoSkin);
                var writestream = gfs.createWriteStream({
                    filename: fileInfo.file.name,

                });
                fs.createReadStream(fileInfo.file.path).pipe(writestream);
                writestream.on('close', function (file) {
                    fs.unlinkSync(fileInfo.file.path);
                    var update = {
                        '$push': {}
                    };
                    update['$push'][fileInfo.fields.field] = file._id.toString();
                    self.mongo.update(self.context.db.collection, condition, update, {upsert: false}, cb);
                });

            });
        }
    };

    this.removeUploadedFile = function (fileFields, cb) {
        self.mongo.getMongoSkinDB(function (error, db) {
            if (error) {
                return cb(error);
            }

            var count = 0;
            for (var oneFileField in fileFields) {
                fileFields[oneFileField].forEach(function (oneEntryInFileField) {
                    var condition = {
                        '_id': self.mongo.ObjectId(oneEntryInFileField)
                    };

                    var gfs = Grid(db, self.mongo.mongoSkin);
                    gfs.remove(condition, function (err) {
                        if (err) {
                            req.soajs.log.error(error);
                        }
                        count++;
                        if (count === Object.keys(fileFields).length) {
                            return cb();
                        }
                    });
                });
            }
        });
    };

    this.removeOneUploadedFile = function (req, res) {
        req.soajs.inputmaskData = req.query;
        req.soajs.inputmaskData['__env'] = req.soajs.inputmaskData.env;
        //if multitenant, on each request build a new mongo connection
        if (self.config.db.multitenant) {
            checkForMongoCore(config, req, function (error, connectionInfo) {
                if (error) {
                    return res.jsonp(req.soajs.buildResponse({
                        "code": self.config.mw.update.code,
                        "msg": error.message
                    }));
                }
                self.mongo = new Mongo(connectionInfo);
                proceed();
            });
        }
        else {
            proceed();
        }

        function proceed() {
            self.mongo.getMongoSkinDB(function (error, db) {
                if (error) {
                    return cb(error);
                }

                var condition = {
                    '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                };

                var gfs = Grid(db, self.mongo.mongoSkin);
                gfs.remove(condition, function (err) {
                    if (err) {
                        return res.jsonp(req.soajs.buildResponse({code: 401, msg: err.message}));
                    }

                    var dbCondition = {'_id': self.mongo.ObjectId(req.soajs.inputmaskData.refId)};

                    var doc = {
                        '$pull': {}
                    };
                    doc['$pull'][req.soajs.inputmaskData.n] = req.soajs.inputmaskData.id;

                    self.mongo.update(self.context.db.collection, dbCondition, doc, {'upsert': false}, function (err) {
                        if (err) {
                            return res.jsonp(req.soajs.buildResponse({code: 401, msg: err.message}));
                        }

                        return res.jsonp(req.soajs.buildResponse(null, true));
                    });
                });
            });
        }
    };

    this.getUploadedFileNames = function (fileFields, cb) {
        var count = 0;
        for (var oneFileField in fileFields) {
            var condition = {'_id': {'$in': []}};
            fileFields[oneFileField].forEach(function (oneEntryInFileField) {
                condition['_id']['$in'].push(self.mongo.ObjectId(oneEntryInFileField));
            });
            self.mongo.find('fs.files', condition, function (err, files) {
                if (err) {
                    return cb(err);
                }
                fileFields[oneFileField] = files;
                count++;
                if (count === Object.keys(fileFields).length) {
                    return cb(null, true);
                }

            });
        }
    };

    this.getUploadedFile = function (req, res) {
        req.soajs.inputmaskData = req.query;
        req.soajs.inputmaskData['__env'] = req.soajs.inputmaskData.env;
        //if multitenant, on each request build a new mongo connection
        if (self.config.db.multitenant) {
            checkForMongoCore(config, req, function (error, connectionInfo) {
                if (error) {
                    return res.jsonp(req.soajs.buildResponse({
                        "code": self.config.mw.update.code,
                        "msg": error.message
                    }));
                }
                self.mongo = new Mongo(connectionInfo);
                proceed();
            });
        }
        else {
            proceed();
        }

        function proceed() {
            try {
                var condition = {
                    '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                };
            } catch (e) {
                return res.jsonp(req.soajs.buildResponse({'code': 401, 'msg': e.message}));
            }

            self.mongo.getMongoSkinDB(function (error, db) {
                if (error) {
                    if (self.config.db.multitenant) {
                        self.mongo.closeDb();
                    }
                    return res.jsonp(req.soajs.buildResponse({
                        "code": 400,
                        "msg": error.message
                    }));
                }

                self.mongo.findOne('fs.files', condition, function (error, fileInfo) {
                    if (error) {
                        if (self.config.db.multitenant) {
                            self.mongo.closeDb();
                        }
                        return res.jsonp(req.soajs.buildResponse({
                            "code": 400,
                            "msg": error.message
                        }));
                    }

                    var gfs = Grid(db, self.mongo.mongoSkin);
                    var gs = new gfs.mongo.GridStore(db, self.mongo.ObjectId(req.soajs.inputmaskData.id), 'r',{ root: 'fs', w:1, fsync: true});
                    gs.open(function(error, gstore){
                        if(error){
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            return res.jsonp(req.soajs.buildResponse({
                                "code": 400,
                                "msg": error.message
                            }));
                        }

                        gstore.read(function (error, filedata) {
                            if(error){
                                if (self.config.db.multitenant) {
                                    self.mongo.closeDb();
                                }
                                return res.jsonp(req.soajs.buildResponse({
                                    "code": 400,
                                    "msg": error.message
                                }));
                            }
                            gstore.close();
                            res.end(filedata);
                        });
                    });
                });
            });
        }
    };
};

module.exports = dataMw;
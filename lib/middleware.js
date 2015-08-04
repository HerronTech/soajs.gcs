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

function checkForMongoAndGridFs(config, req, inst, cb) {
    if (inst.config.db.multitenant) {
        checkForMongoCore(config, req, function (error, connectionInfo) {
            if (error) {
                return cb(error);
            }
            inst.mongo = new Mongo(connectionInfo);
            proceed();
        });
    }
    else {
        proceed();
    }

    function proceed() {
        inst.mongo.getMongoSkinDB(function (error, db) {
            if (error) {
                return cb(error);
            }

            var gfs = Grid(db, inst.mongo.mongoSkin);
            return cb(null, {'db': db, 'gfs': gfs});
        });
    }
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
                    if (oneRecord.fields[oneEntry.name] && ['audio', 'video', 'image', 'document'].indexOf(oneEntry.type) !== -1) {
                        fileFields[oneEntry.name] = oneRecord.fields[oneEntry.name];
                    }
                });
                if (Object.keys(fileFields).length > 0) {
                    getUploadedFileInfo(fileFields, oneRecord._id.toString(), function (error) {
                        if (error) {
                            if (self.config.db.multitenant) {
                                self.mongo.closeDb();
                            }
                            req.soajs.log.error(error);
                            var msg = (error) ? error.message : self.config.errors[self.config.mw.get.code];
                            return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.get.code, "msg": msg}));
                        }
                        for (var field in fileFields) {
                            req.soajs.dataMw.data.fields[field] = fileFields[field];
                        }
                        next();
                    });
                }
                else {
                    next();
                }
            });

            function getUploadedFileInfo(fileFields, refId, cb) {
                var condition = {'metadata.nid': refId};
                self.mongo.find('fs.files', condition, {}, {sort: {'metadata.position': 1}}, function (err, files) {
                    if (err) {
                        return cb(err);
                    }
                    files.forEach(function (oneFileRecord) {
                        for (var oneFileField in fileFields) {
                            if (oneFileField === oneFileRecord.metadata.field) {
                                var i = fileFields[oneFileField].indexOf(oneFileRecord._id.toString());
                                fileFields[oneFileField][i] = oneFileRecord;
                            }
                        }
                    });
                    return cb(null, true);
                });
            }
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
            removeUploadedFiles(req.soajs.inputmaskData.id, function (error) {
                if (error) {
                    if (self.config.db.multitenant) {
                        self.mongo.closeDb();
                    }
                    req.soajs.log.error(error);
                    var msg = (error) ? error.message : self.config.errors[self.config.mw.delete.code];
                    return res.jsonp(req.soajs.buildResponse({"code": self.config.mw.delete.code, "msg": msg}));
                }


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
            });

            function removeUploadedFiles(refId, cb) {
                self.mongo.getMongoSkinDB(function (error, db) {
                    if (error) {
                        return cb(error);
                    }

                    var gfs = Grid(db, self.mongo.mongoSkin);
                    self.mongo.find('fs.files', {'metadata.nid': refId}, {}, {sort: {'metadata.position': 1}}, function (err, files) {
                        if (err) {
                            return cb(err);
                        }
                        if (files.length === 0) {
                            return cb(null, true);
                        }
                        var count = 0;
                        files.forEach(function (oneFile) {
                            gfs.remove({'_id': oneFile._id}, function (err) {
                                if (err) {
                                    return cb(err);
                                }

                                count++;
                                if (count === files.length) {
                                    return cb(null, true);
                                }
                            });
                        });
                    });
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

    /*
     This method loads one uploaded file from the filesystem, and streams it to GridFs.
     Then it updates the data record the file belongs to with the _id of the file from GridFs.
     Then it removes the file from the file system
     */
    this.saveUploadedFile = function (req, form, cb) {
        var fileInfo = req.query;
        req.soajs.inputmaskData['__env'] = fileInfo.env;
        delete fileInfo.env;

        function closeAndLeave(error) {
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            return cb(error);
        }

        function removeFileBasedOnPosition(gfs, fileInfo, cb) {
            var condition = {
                'metadata.nid': fileInfo.nid,
                'metadata.position': fileInfo.position,
                'metadata.media': fileInfo.media
            };
            self.mongo.findOne('fs.files', condition, function (err, oneFile) {
                if (err) {
                    return cb(err);
                }
                if (oneFile) {
                    gfs.remove({_id: oneFile._id}, function(error){
                        if(error){ return cb(error); }

                        var dbCondition = {'_id': self.mongo.ObjectId(fileInfo.nid)};
                        var doc = {
                            '$pull': {}
                        };
                        doc['$pull']['fields.' + oneFile.metadata.field] = oneFile._id.toString();
                        self.mongo.update(self.context.db.collection, dbCondition, doc, {'upsert': false}, cb);
                    });
                }
                else {
                    return cb(null, true);
                }
            });
        }

        function createWStream(gfs, condition){
            form.onPart = function (part) {
                if (!part.filename) return form.handlePart(part);

                var writestream = gfs.createWriteStream({
                    filename: part.filename
                });

                part.pipe(writestream);
                writestream.on('close', function (file) {
                    var update = {
                        '$push': {}
                    };
                    update['$push']['fields.' + fileInfo.field] = file._id.toString();
                    self.mongo.update(self.context.db.collection, condition, update, {upsert: false}, function(error){
                        if(error){ return closeAndLeave(error); }

                        delete fileInfo.action;
                        fileInfo.mime = part.mime;
                        var updateMetaData = {
                            '$set': {
                                'metadata': fileInfo
                            }
                        };
                        self.mongo.update('fs.files', {_id: file._id}, updateMetaData, {upsert: false}, function(error){
                            if(error){ return closeAndLeave(error); }
                            return cb(null, true);
                        });
                    });
                });
            };
            form.parse(req);
        }

        checkForMongoAndGridFs(config, req, self, function (error, configObj) {
            if (error) {
                return closeAndLeave(error);
            }
            else {
                var condition = {};
                try {
                    condition = {
                        '_id': self.mongo.ObjectId(fileInfo.nid)
                    };
                } catch (e) {
                    return closeAndLeave(e);
                }

                self.mongo.getMongoSkinDB(function (error, db) {
                    if (error) { return closeAndLeave(error); }

                    if (fileInfo.action === 'edit') {
                        removeFileBasedOnPosition(configObj.gfs, fileInfo, function (error) {
                            if (error) { return closeAndLeave(error); }
                            createWStream(configObj.gfs, condition);
                        });
                    }
                    else {
                        createWStream(configObj.gfs, condition);
                    }
                });
            }
        });
    };

    /*
     This method removes one file from GridFs, then it updates the data record the file belongs to.
     */
    this.removeOneUploadedFile = function (req, res) {
        req.soajs.inputmaskData = req.query;
        req.soajs.inputmaskData['__env'] = req.soajs.inputmaskData.env;
        function closeAndLeave(error) {
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            return res.jsonp(req.soajs.buildResponse({
                "code": 400,
                "msg": error.message
            }));
        }

        checkForMongoAndGridFs(config, req, self, function (error, configObj) {
            if (error) {
                return closeAndLeave(error);
            }
            else {
                var condition = {
                    '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                };
                self.mongo.findOne('fs.files', condition, function(error, oneFile){
                    if(error){ return closeAndLeave(error); }
                    else{
                        configObj.gfs.remove(condition, function (err) {
                            if (error) {
                                return closeAndLeave(error);
                            }
                            else {
                                var dbCondition = {'_id': self.mongo.ObjectId(oneFile.metadata.nid)};
                                var doc = {
                                    '$pull': {}
                                };
                                doc['$pull']['fields.' + oneFile.metadata.field] = req.soajs.inputmaskData.id;
                                self.mongo.update(self.context.db.collection, dbCondition, doc, {'upsert': false}, function (error) {
                                    if (error) {
                                        return closeAndLeave(error);
                                    }
                                    else {
                                        return res.jsonp(req.soajs.buildResponse(null, true));
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    };

    /*
     This method streas out one file from GridFs based on the file id provided in the request as a querystring.
     */
    this.getUploadedFile = function (req, res) {
        req.soajs.inputmaskData = req.query;
        req.soajs.inputmaskData['__env'] = req.soajs.inputmaskData.env;

        function closeAndLeave(error) {
            if (self.config.db.multitenant) {
                self.mongo.closeDb();
            }
            return res.jsonp(req.soajs.buildResponse({
                "code": 400,
                "msg": error.message
            }));
        }

        checkForMongoAndGridFs(config, req, self, function (error, configObj) {
            if (error) {
                return closeAndLeave(error);
            }
            else {
                try {
                    var condition = {
                        '_id': self.mongo.ObjectId(req.soajs.inputmaskData.id)
                    };
                } catch (e) {
                    return res.jsonp(req.soajs.buildResponse({'code': 401, 'msg': e.message}));
                }

                self.mongo.findOne('fs.files', condition, function (error, fileInfo) {
                    if (error) {
                        return closeAndLeave(error);
                    }
                    else {

                        var gs = new configObj.gfs.mongo.GridStore(configObj.db, self.mongo.ObjectId(req.soajs.inputmaskData.id), 'r', {
                            root: 'fs',
                            w: 1,
                            fsync: true
                        });
                        gs.open(function (error, gstore) {
                            if (error) {
                                return closeAndLeave(error);
                            }
                            else {
                                gstore.read(function (error, filedata) {
                                    if (error) {
                                        return closeAndLeave(error);
                                    }
                                    else {
                                        gstore.close();
                                        res.writeHead(200, {'Content-Type': fileInfo.contentType});
                                        res.end(filedata);
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    };
};

module.exports = dataMw;
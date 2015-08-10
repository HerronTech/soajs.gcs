# soajs.GCS
[![Build Status](https://travis-ci.org/soajs/soajs.GCS.svg?branch=master)](https://travis-ci.org/soajs/soajs.GCS)
[![Coverage Status](https://coveralls.io/repos/soajs/soajs.GCS/badge.png)](https://coveralls.io/r/soajs/soajs.GCS)

SOAJS GCS is Generic Content Service Generator. 

This module reads 2 environment variables: SOAJS_GC_NAME & SOAJS_GC_VERSION and looks for Generic Content Schema that matches them in the core database.

Once found, the module loads the configuration, deploys a new service and starts it.

The newly created GCS behaves exactly like every other service built on top of SOAJS.

---

##Installation

```sh
$ npm install soajs.GCS
```

---

##Usage

```sh
$ export SOAJS_GC_NAME=%MY_SERVICE_NAME%
$ export SOAJS_GC_VERSION=%MY_SERVICE_VERSION%
$ cd soajs.GCS/
$ node.
```

---

##features
* Supports ADD - EDIT - GET - DELETE - LIST APIs to add & manage data in static and multitenant databases.
* Supports Uploading and Streaming Media Files into and out of GridFS
* Ability to manage data across different environments
* Can have multiple nodes for the same service for load distribution
* Supports Multiple versions for both Service & Data schemas

##Configuration
* GCS provides the ability to have multiple schema with multiple versions all configurable and manageable from SOAJS UI Dashboard
* GCS provides the ability to manage the data of all deployed GCS services via SOAJS UI Dashboard


More information is available on the website section [GCS](http://www.soajs.org/#/documentation/services/gcs).
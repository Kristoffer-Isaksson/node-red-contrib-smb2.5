/*
Copyright 2018 Smart-Tech Controle e Automação
Copyright 2023 Y., Ryota <tryjsky@gmail.com>
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
/* jshint node: true, esversion: 6 */
"use strict";

const SMB = require('@tryjsky/v9u-smb2');

/**
 * Handles pre-1.0 Node-RED gracefully
 */
function nrInputShim(node, fn) {
    function doErr(msg) { return (err) => err && node.error(err, msg) }
    function doSend() { node.send.apply(node, arguments) }
    node.on('input', function (msg, send, done) {
        send = send || doSend;
        done = done || doErr;
        fn(msg, send, done);
    });
}

module.exports = function (RED) {

    function SmbConfig(values) {
        RED.nodes.createNode(this, values);

        let self = this;

        var _a, _b;
        var sysCfg = ((_b = (_a = self.context()) === null || _a === void 0 ? void 0 : _a.global) === null || _b === void 0 ? void 0 : _b.get("SYSCONFIG")) || {};
        var sambaCfg = (sysCfg === null || sysCfg === void 0 ? void 0 : sysCfg.samba) || {};

        var address = (sambaCfg === null || sambaCfg === void 0 ? void 0 : sambaCfg.address);
        var domain = (sambaCfg === null || sambaCfg === void 0 ? void 0 : sambaCfg.domain);
        var username = (sambaCfg === null || sambaCfg === void 0 ? void 0 : sambaCfg.username);
        var password = (sambaCfg === null || sambaCfg === void 0 ? void 0 : sambaCfg.password);
        var timeout = (sambaCfg === null || sambaCfg === void 0 ? void 0 : sambaCfg.timeout);

        self.share = address || values.share || "";
        self.domain = domain || values.domain || ".";
        self.username = username || values.username || "";
        self.password = password || values.password || "";
        self.autoCloseTimeout = Number(timeout || values.timeout || 0);

        self.on("close", (done) => {
            if (self.smbClient) self.smbClient.disconnect();
            done();
        });

        function connect() {

            if (self.smbClient) {
                self.smbClient.disconnect();
            }

            self.smbClient = new SMB({
                share: self.share,
                domain: self.domain,
                username: self.username,
                password: self.password,
                autoCloseTimeout: self.autoCloseTimeout
            });
        }

        connect();

        if (!self.smbClient) {
            self.error("Error smbClient not available");
            return;
        }

        self.readDir = function readDir(path, callback) {
            let readdir = self.smbClient.readdir(path);

            readdir.then((data) => {
                callback(null, data);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.readFile = function readFile(path, callback) {
            let readFile = self.smbClient.readFile(path);

            readFile.then((data) => {
                callback(null, data);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.unlink = function unlink(path, callback) {

            let unlink = self.smbClient.unlink(path);

            unlink.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });

        };

        self.rename = function rename(oldPath, newPath, callback) {

            let rename = self.smbClient.rename(oldPath, newPath);

            rename.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.writeFile = function writeFile(fileName, data, callback) {

            if (!(data instanceof Buffer || typeof data === "string")){
                // force-cast to a string
                data = (data || "").toString();
            }

            let writeFile = self.smbClient.writeFile(fileName, data);

            writeFile.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.mkdir = function mkdir(path, callback) {

            let mkdir = self.smbClient.mkdir(path);

            mkdir.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.rmdir = function rmdir(path, callback) {

            let rmdir = self.smbClient.rmdir(path);

            rmdir.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.exists = function exists(path, callback) {

            let exists = self.smbClient.exists(path);

            exists.then((data) => {
                callback(null, data);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.ensureDir = function ensureDir(path, callback) {

            async function customEnsureDir() {
                if (await self.smbClient.exists(path)) return null; //fast path, folder already exist

                let parts = path.split('\\').map((e,i,a) => a.slice(0,i+1).join('\\'));
                for (const part of parts) {
                    try {
                        await self.smbClient.mkdir(part);
                    } catch (e) {
                        if(e && e.code == 'STATUS_OBJECT_NAME_COLLISION') {
                            continue;
                        } else {
                            throw e;
                        }
                    }
                }

                return null;
            }

            let ensureDir = self.smbClient.ensureDir ? self.smbClient.ensureDir(path) : customEnsureDir();

            ensureDir.then(() => {
                callback(null);
            }).catch((err) => {
                callback(err);
                connect();
            });
        };

        self.info = function info(path, callback) {

            let status = self.smbClient.stat(path);

            status.then((data) => {
                callback(null, {
                    birthtime: data.birthtime,
                    mtime: data.mtime,
                    atime: data.atime,
                    ctime: data.ctime,
                    isDirectory: data.isDirectory()
                });
            }).catch((err) => {
                callback(err);
                connect();
            });
        };
    }
    RED.nodes.registerType("smb config", SmbConfig);

    function SmbFunction(values) {

        let node = this;

        RED.nodes.createNode(node, values);

        node.config = RED.nodes.getNode(values.config);
        node.operation = values.operation;
        node.path = values.path;
        node.newPath = values.path_new;
        node.format = values.format || "string";


        if (!node.config) {
            node.error("Missing or invalid SMB endpoint configuration");
            return;
        }

        node.statusProcess = function statusProcess() {
            node.status({
                fill: "blue",
                shape: "dot",
                text: "process"
            });
        };

        node.statusDone = function statusDone() {
            node.status({
                fill: "green",
                shape: "dot",
                text: "done"
            });
        };

        node.statusError = function statusError() {
            node.status({
                fill: "red",
                shape: "dot",
                text: "error"
            });
        };

        // clear status on init
        node.status({});

        function onNewMsg(msg, send, done) {

            let filename = node.path;

            if(!filename && msg.filename !== undefined){
                filename = msg.filename;
            }

            switch (node.operation) {

                case "read-dir":

                    node.statusProcess();
                    node.config.readDir(filename, (err, files) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        msg.payload = files;
                        send(msg);
                        done();
                    });

                    break;

                case "read-file":

                    node.statusProcess();
                    node.config.readFile(filename, (err, data) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        if (node.format === "string") {
                            data = data.toString();
                        }

                        node.statusDone();
                        msg.payload = data;
                        send(msg);
                        done();
                    });

                    break;

                case "unlink":

                    node.statusProcess();
                    node.config.unlink(filename, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "rename":

                    let new_filename = node.newPath;
                    if(!new_filename && msg.new_filename !== undefined){
                        new_filename = msg.new_filename;
                    }

                    node.statusProcess();
                    node.config.rename(filename, new_filename, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "create":

                    let data = "";
                    if (msg.hasOwnProperty("payload")) {
                        data = msg.payload;
                    }

                    node.statusProcess();
                    node.config.writeFile(filename, data, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "mkdir":

                    node.statusProcess();
                    node.config.mkdir(filename, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "rmdir":

                    node.statusProcess();
                    node.config.rmdir(filename, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "exists":

                    node.statusProcess();
                    node.config.exists(filename, (err, data) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        msg.exists = data;
                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "ensure-dir":

                    node.statusProcess();
                    node.config.ensureDir(filename, (err) => {

                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }

                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;

                case "info":
                    node.statusProcess();
                    node.config.info(filename, (err, data) => {
                        
                        if (err) {
                            node.statusError();
                            done(err);
                            return;
                        }
                        msg.payload = data;
                        node.statusDone();
                        send(msg);
                        done();
                    });

                    break;
            }

        }
        nrInputShim(node, onNewMsg);
    }
    RED.nodes.registerType("SMB", SmbFunction);
};
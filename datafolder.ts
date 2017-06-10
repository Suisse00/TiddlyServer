import { StateObject, keys, ServerConfig, AccessPathResult, AccessPathTag } from "./server-types";
import { Observable } from "./lib/rx";

import * as path from 'path';
import * as http from 'http';
import { TiddlyWiki, $tw } from 'tiddlywiki';
import { EventEmitter } from "events";

var settings: ServerConfig = {} as any;

export function init(eventer: EventEmitter) {
    eventer.on('settings', function (set: ServerConfig) {
        settings = set;
    })
}

type FolderData = {
    $tw: any, //$tw.global,
    prefix: string,
    folder: string,
    server: any, //$tw.core.modules.commands.server.Server,
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
};
const loadedFolders: { [k: string]: FolderData } = {};

export function datafolder(obs: Observable<AccessPathResult<AccessPathTag>>) {
    return obs.mergeMap(res => {
        let { tag, type, statItem, statTW, end, isFullpath } = res;
        /**
         * reqpath  is the prefix for the folder in the folder tree
         * item     is the folder string in the category tree that reqpath led to
         * filepath is the path relative to them
         */
        let { state, item, filepath, reqpath } = tag;

        //TiddlyWiki requires a trailing slash for the root url
        if (isFullpath && !state.url.pathname.endsWith("/")) {
            state.res.writeHead(302, {
                'Location': state.url.pathname + "/"
            });
            state.res.end();
            return Observable.empty();
        }

        let suffix = filepath.split('/').slice(0, end).join('/');

        let prefix = ["", reqpath, suffix].join('/').split('/');
        let prefixURI = state.url.pathname.split('/').slice(0, prefix.length).join('/');

        let folder = path.join(item as string, suffix);
        //console.log('%s %s', prefix, folder);
        loadTiddlyWiki(prefixURI, folder).then(handler => {
            handler(state.req, state.res);
        });
        return Observable.empty<StateObject>();
    })
}

function loadTiddlyWiki(prefix: string, folder: string) {
    if (loadedFolders[prefix]) return Promise.resolve(loadedFolders[prefix].handler);
    else return new Promise(resolve => {
        const $tw = require("tiddlywiki/boot/boot.js").TiddlyWiki();
        $tw.boot.argv = [folder];
        const execute = $tw.boot.executeNextStartupTask;
        $tw.boot.executeNextStartupTask = function () {
            const res = execute();
            if (res === false) complete();
        }
        function complete() {
            //we use $tw.modules.execute so that the module has its respective $tw variable.
            var serverCommand = $tw.modules.execute('$:/core/modules/commands/server.js').Command;
            var command = new serverCommand([], { wiki: $tw.wiki });
            var server = command.server;

            server.set({
                rootTiddler: "$:/core/save/all",
                renderType: "text/plain",
                serveType: "text/html",
                username: "",
                password: "",
                pathprefix: prefix
            });

            loadedFolders[prefix] = {
                $tw,
                prefix,
                folder,
                server,
                handler: server.requestHandler.bind(server)
            }
            resolve(loadedFolders[prefix].handler);
        }
        $tw.boot.boot();
        $tw.wiki.addTiddler({
            "text": "$protocol$//$host$" + prefix + "/",
            "title": "$:/config/tiddlyweb/host"
        });
    })
};
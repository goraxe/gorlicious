
// Changes XML to JSON
function xmlToJson(xml) {

    // Create the return object
    var obj = {};

    if (xml.nodeType == 1) { // element
        // do attributes
        if (xml.attributes.length > 0) {
            obj["@attributes"] = {};
            for (var j = 0; j < xml.attributes.length; j++) {
                var attribute = xml.attributes.item(j);
                obj["@attributes"][attribute.nodeName] = attribute.nodeValue;
            }
        }
    } else if (xml.nodeType == 3) { // text
        obj = xml.nodeValue;
    }

    // do children
    if (xml.hasChildNodes()) {
        for(var i = 0; i < xml.childNodes.length; i++) {
            var item = xml.childNodes.item(i);
            var nodeName = item.nodeName;
            if (typeof(obj[nodeName]) == "undefined") {
                obj[nodeName] = xmlToJson(item);
            } else {
                if (typeof(obj[nodeName].push) == "undefined") {
                    var old = obj[nodeName];
                    obj[nodeName] = [];
                    obj[nodeName].push(old);
                }
                obj[nodeName].push(xmlToJson(item));
            }
        }
    }
    return obj;
};

function makeRequest(method, url, callback) {
    var xhr = new XMLHttpRequest();
    var user = localStorage['user'];
    var password = localStorage['password'];
    xhr.onreadystatechange = function () {
        // console.log('ready state: ' + xhr.readyState);
        if (xhr.readyState == 4) {
            //console.log(xhr.responseText);
            parser = new DOMParser();
            xmlDoc = parser.parseFromString(xhr.responseText, 'text/xml');
            callback(xmlToJson(xmlDoc));
        }
    };
    console.log('making request');
    xhr.open(method, url, true, user,  password);
    xhr.send();
}

function checkPosts() {
    makeRequest("GET", "https://api.delicious.com/v1/posts/update", function(data) {
        var update = data.update['@attributes'].time;
        if (update != localStorage['update']) {
            fetchPosts(localStorage['update']);
            // FIXME: proper success fail detecction
            localStorage['update'] = update;
        }
    });
}

function fetchPosts(fromdt) {
    console.log('fetchPosts');
    makeRequest("GET",'https://api.delicious.com/v1/posts/all?meta=yes' + ( fromdt ? '&fromdt=' + fromdt : '') ,function(data) {
        //console.log('data: ' + JSON.stringify(data));
        var posts = data.posts.post;
        var cnt = posts.length;
        var transaction = db.transaction(['Posts'], 'readwrite');
        var Posts = transaction.objectStore('Posts');
        posts.forEach(function (p) {
            var post = p['@attributes'];
            post.tags = post.tag.split(/ /);
            delete post.tag;
            req = Posts.put(post);
            req.onsuccess = function () {
                console.log('put success');
                cnt--;
                if (cnt==0) {
                    updateFolders();
                }
            }
            req.onerror = function(e) {
                console.log('we got the error' + e);
            }
        });
    });
}


function fetchBundles() {
    console.log('fetchBundles');
    makeRequest("GET",'https://api.delicious.com/v1/tags/bundles/all',function(data) {
       // console.log('got data: ' + JSON.stringify(data));
        var transaction = db.transaction(['Bundles'], 'readwrite');
        var Bundles = transaction.objectStore('Bundles');
        var cnt = 0;
        data.bundles.bundle.forEach(function(bundle) {
            bundle = bundle['@attributes'];
            var request = Bundles.get(bundle.name);
            request.onsuccess = function() {
                if (!request.result) {
                    Bundles.put(bundle);
                }
                cnt++;
                if (cnt == data.bundles.bundle) {
                    updateFolders();
                }
            }
        });
    });
}

function updateFolders() {
    var tree    = chrome.bookmarks.getSubTree('1', function(nodes) {
        var bookmarkbar = nodes[0];
        var folders = {};
        bookmarkbar.children.forEach(function(node) {
            folders[node.title] = node;
        });
        var transaction = db.transaction(['Bundles'], 'readwrite');
        var Bundles = transaction.objectStore('Bundles');
        var request = Bundles.openCursor();
        request.onsuccess = function() {
            var cursor = request.result;
            if (cursor) {
                var bundle = cursor.value;
                if (!folders[bundle.name]) {
                    console.log('creating new bundle folder for: ' +name);
                    chrome.bookmarks.create({
                        parentId: '1',
                        title: bundle.name,
                    },
                    function (newFolder) {
                        folders[bundle.name] = newFolder;
                        createBundleTags(newFolder, bundle.tags);
                    });
                }
                else {
                    createBundleTags(folders[bundle.name], bundle.tags);
                }
                cursor.continue();
            }
        }
    });
}

function createBundleTags(folder, tags) {
    var tree    = chrome.bookmarks.getSubTree(folder.id, function(nodes) {
        var bookmarkbar = nodes[0];
        var folders = {};


        bookmarkbar.children.forEach(function(node) {
            folders[node.title] = node;
        });

        tags.split(/ /).forEach(function(tag) {
            function addBookmarks(folder) {
                var transaction = db.transaction(['Posts'], 'readwrite');
                var Posts = transaction.objectStore('Posts');
                var tags_index = Posts.index('Tags');
                var range = IDBKeyRange.only(tag);
                var request = tags_index.openCursor(range);
                request.onsuccess = function() {
                    var cursor = request.result;
                    if (cursor) {
                        var post = cursor.value;
                        var create = true;
                        if (folder.children) {
                            folder.children.forEach(function(node) {
                                if (node.title == post.description.replace(/\s+/g,' ')) {
                                    create = false;
                                }
                            });
                        }
                        if (create) {
                            console.log('adding post: ' + post.description + ' to folder: ' + folder.title);
                            chrome.bookmarks.create({
                                parentId: folder.id,
                                title: post.description,
                                url: post.href
                            });
                        }
                        cursor.continue();
                    }
                }
            }
            if(!folders[tag]) {
                console.log('creating new tag folder for: ' + tag);
                chrome.bookmarks.create({
                    parentId: folder.id,
                    title: tag,
                },
                function (newFolder) {
                    folders[folder.title] = newFolder;
                    addBookmarks(newFolder);
                });
            }
            else {
                    addBookmarks(folders[tag]);
            }
        });
    });
}

var db;

function openDatabase(callback) {
    console.log('in open database');
    dbOpenRequest = indexedDB.open('GorliciousDB', 2);

    dbOpenRequest.onsuccess = function(event) {

        console.log('successfully opened db');
        db = dbOpenRequest.result;
        callback();
    }
    dbOpenRequest.onupgradeneeded = function(e) {
        db = dbOpenRequest.result;
        //transaction = dbOpenRequest.transaction(';
        if (!db.objectStoreNames.contains('Posts')) {
            var Posts = db.createObjectStore('Posts', {
                keyPath: 'hash',
                autoIncrement: false
            });
            Posts.createIndex('Tags', 'tags', { 
                multiEntry: true,
                unique: false
            });
        }

        if (!db.objectStoreNames.contains('Bundles')) {
            var Bundles = db.createObjectStore('Bundles', {
                keyPath: 'name',
                autoIncrement: false
            });
        }
    }
    dbOpenRequest.onerror = function(e) {
        console.log('got error: ' + JSON.stringify(e));
    }
    dbOpenRequest.onblocked = function(e) {
        console.log('got blocked: ' + e);
    }
    console.log('f00');
    return dbOpenRequest;
}


function onInit() {
    console.log('onInit');

    chrome.alarms.create('bundle_refresh',{ delayInMinutes: 5, periodInMinutes: 5 });
    chrome.alarms.create('post_refresh',{ delayInMinutes: 5, periodInMinutes: 15 });

    openDatabase(function() {
        fetchBundles();
        checkPosts();
    });
}

function onAlarm(alarm) {
    console.log('alarm triggered');
    if (alarm.name == 'bundle_refresh') {
        fetchBundles();
    }
    else if (alarm.name == 'post_refresh') {
        checkPosts();
    }
}

chrome.runtime.onInstalled.addListener(onInit);
chrome.alarms.onAlarm.addListener(onAlarm);

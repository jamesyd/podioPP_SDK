var jive = require("jive-sdk");
var url = require('url');
var util = require('util');
var sampleOauth = require('./routes/oauth/sampleOauth');
var q = require('q');
var querier = require('./query');

var metadataCollection = "podioActivityMetadata";
var metadataStore = jive.service.persistence();

exports.getLastTimePulled = getLastTimePulled;
exports.getMetadataByInstance = getMetadataByInstance;
exports.pullActivity = pullActivity;
exports.pullComments = pullComments;
exports.pullProjectInfo = pullProjectInfo;
exports.updateLastTimePulled = updateLastTimePulled;
exports.recordSyncFromJive = recordSyncFromJive;


function extractActivity( parent, rawActivityEntry ) {
    var data = rawActivityEntry['data'];

    var description = data['rich_value'] || data['text'] || data['value'];
    var actor = {
        'name' : rawActivityEntry['created_by']['name'],
        'email' : ''
    };

    if (data['description'] != undefined)
    {
        description += " : "  ;
        description += data['description'] ;
    }
    var parentTitle = parent['title'] || parent['name'] || parent['text'];
    var parentType = parent['type'];
    var type = rawActivityEntry['type'];

    if (type != 'task' && type != 'comment')
        data.value = "";

    var title = ( type.charAt(0).toUpperCase() + type.slice(1) ) +" '" + (data.text || data.value) + "' by " + actor['name'];
    if ( parent != rawActivityEntry ) {
        title += " @ " + parentTitle;

    }

    var trgUrl = rawActivityEntry['data']['link']  ;
    if (trgUrl == undefined || trgUrl == "")
        trgUrl = parent['link'];

    var object = {
        'url' : trgUrl,
        'description' : description,
        'title' : title
    };

    var timestamp = rawActivityEntry['created_on'];
    var externalID =  rawActivityEntry['type'] + '-' + (data[rawActivityEntry['type'] + '_id'] ||  data['item_id']);
    var parentData = parent['data'];
    var parentExternalID =  parent['type'] + '-' + (parentData[parent['type'] + '_id'] ||  parentData['item_id']);
    var jiveID = undefined;

    if ( type == 'comment' ) {
        // try to find its jiveID, scan through parent object comments to try and find it
        var podioCommentID = data['comment_id'];
        var parentComments = parent['comments'];
        if ( parentComments ) {
            parentComments.forEach( function(comment) {
                if ( comment['comment_id'] == podioCommentID ) {
                    jiveID = comment['external_id'] && comment['external_id'].indexOf('jive-') > - 1 ? comment['external_id'] : undefined;
                }
            });
        }

    }

    var activity = {
        'type' : rawActivityEntry['type'],
        'description' : description,
        'actor' : actor,
        'object' : object,
        'externalID' : externalID,
        'parentExternalID' : parentExternalID,
        'timestamp' : timestamp,
        'jiveID' : jiveID
    };


//    console.log(JSON.stringify(activity, null, 4));

    return activity;
}
function extractComment( parent, rawCommentEntry ) {

    var description = rawCommentEntry['rich_value'] || rawCommentEntry['value'];
    var actor = {
        'name' : rawCommentEntry['user']['name'],
        'email' : ''
    };

    var parentType = 'task'; // we're only processing comments on tasks in here ...

    var title = "title placeholder";
    if ( parent != rawCommentEntry ) {
        //title += " @ " + parentTitle;
    }

    var object = {
        'url' : '',
        'description' : description,
        'title' : title
    };

    var timestamp = rawCommentEntry['created_on'];
    var externalID =  'comment' + '-' + rawCommentEntry['comment_id'];
    var parentData = parent['data'];
    var parentExternalID =  'task' + '-' + rawCommentEntry.ref.id;
    var jiveID = undefined;
    var type = 'comment';

    var comment = {
        'type' : 'comment',
        'description' : description,
        'actor' : actor,
        'object' : object,
        'externalID' : externalID,
        'parentExternalID' : parentExternalID,
        'timestamp' : timestamp,
        'jiveID' : jiveID
    };


//    console.log(JSON.stringify(activity, null, 4));

    return comment;
}

function getAllActivity(extstreamInstance, converter, activityType) {
    return getLastTimePulled(extstreamInstance, activityType).then(function (lastTimePulled) {

        var date = new Date(lastTimePulled);
        //console.log("getAllActivity: activity=", activityType, " lastTimePulled=", date.getTime(), " ", date.toISOString())
        var query = "/stream/";

        var config = extstreamInstance['config'];
        if (config && config['projectID'] != undefined)
        {
            var projectID = extstreamInstance['config']['projectID'] ;
            if (Number(projectID))
            {
                // we have a project ID now .. make the query more specific ...
                query += "item/" + projectID;
            }
        }

        return querier.doGet(query, extstreamInstance).then(function (response) {
            var activities = response['entity'];

            var activityEntries = [];
            var addIt = function (extractedActivity) {
                var elapsedTime =  (new Date(extractedActivity['timestamp']).getTime() - date.getTime());
                if (extractedActivity.type == 'comment')
                {
                //console.log( "activity: type=" + extractedActivity.type + " d:'" + extractedActivity.description +
                //"' eID:" + extractedActivity.externalID + " jID:" + extractedActivity.jiveIDi +
                 //   " pID:" + extractedActivity.parentExternalID + " t:'" + extractedActivity.object.title + " ' " + elapsedTime) ;
                //if (!elapsedTime)
                //    console.log( "elapsed = 0? ts=", new Date(extractedActivity['timestamp']).getTime(), " ct=",date.getTime());
                }
                if (extractedActivity && new Date(extractedActivity['timestamp']).getTime() > date.getTime()) {
                    // do we match what we are looking for?
                    if (activityType == 'comment' && extractedActivity.type == 'comment')
                    {
                        //console.log( activityType, " post comment! '" + extractedActivity.description) + "'" ;
                        activityEntries.push(extractedActivity);
                    }
                    else if (activityType == 'activity' && extractedActivity.type != 'comment')
                    {
                        //console.log( activityType, " post activity!") ;
                        activityEntries.push(extractedActivity);
                    }
                }
            };


            if (!Number(projectID))
            {
                // processing global stream ...
                activities.forEach(function (object) {
                    var objectActivity = object['activity'];

                    if (!objectActivity || objectActivity.length < 1) {
                        addIt(extractActivity(object, object));
                    } else {
                        // its the first time
                        objectActivity.forEach(function (rawActivityEntry) {
                            addIt(extractActivity(object, rawActivityEntry));
                        });
                    }
                });

                return converter(activityEntries, lastTimePulled, extstreamInstance);
            }
            else
            {
                // processing specific Project stream ..
                var objectActivity = activities['activity'];

                if (!objectActivity || objectActivity.length < 1) {
                    addIt(extractActivity(activities, activities));
                    return converter(activityEntries, lastTimePulled, extstreamInstance);
                } else {
                    // its the first time
                    var taskCount=-1;
                    var deferred = q.defer();
                    objectActivity.forEach(function (rawActivityEntry) {
                        addIt(extractActivity(activities, rawActivityEntry));
                        // testing out for dealing with processing each individual task to extract comments ...
                        if (activityType == "comment" && rawActivityEntry.type == "task")
                        {
                            //console.log( "process task id=" + rawActivityEntry.id)    ;
                            taskCount++;
                            var taskQuery = "task/" + rawActivityEntry.id;
                            querier.doGet(taskQuery, extstreamInstance).then(function (response) {
                                var task = response.entity ;
                                //console.log( "good task query for task=" + task.task_id + " number of comments="+task.comments.length);
                                task.comments.forEach(function(comment) {
                                    //console.log( extractComment(comment, comment)) ;
                                    //console.log( "add comment .... task count=" + taskCount)
                                    addIt(extractComment(comment,comment))  ;

                                });
                                if (--taskCount == 0)
                                {
                                    //console.log( "return " + activityEntries.length + " item(s) at pt 1");
                                    deferred.resolve(converter(activityEntries, lastTimePulled, extstreamInstance));
                                }
                            },
                            function(error)
                            {
                                console.log("bad task query");
                            } );
                        }
                         // end of testing out for dealing with ....

                    });
                    if (taskCount < 0)
                    {
                        // this is the case where we didn't process any tasks ...
                        //console.log( "return " + activityEntries.length + " item(s) at pt 2")
                        return converter(activityEntries, lastTimePulled, extstreamInstance);
                    }
                    else return deferred.promise;
                }
                //return converter(activityEntries, lastTimePulled, extstreamInstance);
            }

            // this was commented out for the testing of getting comments on tasks ...
            //return converter(activityEntries, lastTimePulled, extstreamInstance);
        });
    }).catch(function (err) {
            jive.logger.error('Error querying Podio', err);
    });
}

// this function is meant to just get the info for the specific project we are monitoring and push it
// once in a lifetime to Jive so that any comments that come in later has an object to attach to
// it isn't clear that Podio sends us an activity record for project creation, thus making this step required

function getProjectInfo(extstreamInstance, activityType) {
    var activityID = activityType;
    var projectID = extstreamInstance['config']['projectID'] ;
    if (Number(projectID))
        activityID += ("-" + projectID);

    return getLastTimePulled(extstreamInstance, activityID).then(function (lastTimePulled) {

        var date = new Date(lastTimePulled);
        var query;
        var config = extstreamInstance['config'];
        if (config && config['projectID'] != undefined)
        {
            var projectID = extstreamInstance['config']['projectID'] ;
            if (Number(projectID))
            {
                // we have a project ID now .. make the query more specific ...
                query = "/item/" + projectID;
            }
        }
        else
            return ;  // if not project centric, don't need to post specific project info ...

        return querier.doGet(query, extstreamInstance).then(function (response) {
            var record = response['entity'];
            var createdDate = new Date(record['created_on']).getTime();
            if (createdDate <= lastTimePulled)    return;   // we've already pushed this item, don't do it again
            var actor = {
                'name' : record['created_by']['name'],
                'email' : ''
            };

            var projectInfo = {
                "podioCreatedDate" : createdDate,
                    "activity" : {
                    "action":{
                        "name":"posted",
                            "description": "New Activity"
                    },
                    "actor":actor,
                        "object":{
                        "type":"website",
                            "image" : "http://www.theappchamp.com/wp-content/uploads/2013/05/podioApp1.jpg",
                            "url": record.link,
                            "title": record.fields[0].values[0].value,
                            "description":record.fields[3].values[0].value
                    },
                    "externalID" : "item-" + record.item_id
                    }
                } ;
            lastTimePulled = Math.max(lastTimePulled, projectInfo['podioCreatedDate'] );
            return updateLastTimePulled(extstreamInstance, lastTimePulled, activityID).thenResolve(projectInfo);
        });
    }).catch(function (err) {
            jive.logger.error('Error querying Podio', err);
        });
}
function pullActivity(extstreamInstance, converter) {
    return getAllActivity(extstreamInstance, convertToActivities, 'activity');
}

function pullComments(extstreamInstance) {
    return getAllActivity(extstreamInstance, convertToComments, 'comment');
}

function pullProjectInfo(extstreamInstance) {
    return getProjectInfo(extstreamInstance, 'project');
}
function convertToActivities(entity, lastTimePulled, instance) {
    var records = entity;

    var tempActivities = records.map(function (record) {
        if ( record['type'] == 'comment' ) {
            // comments handled elsewhere
            return null;
        }

        record['projectName']  = instance.config['project'];
        var json = getActivityJSON(record);

        if (!isNaN(json['podioCreatedDate'])) {
            lastTimePulled = Math.max(lastTimePulled, json['podioCreatedDate']);
            return json;
        } else {
            return null;
        }
    });

    // now get rid of NULL entries in the array   (these will be the comments ...)
    var numActivities = tempActivities.length;
    var activities = [];
    var activityCounter=0;
    if (numActivities > 0)
    {
        for (var i=(numActivities-1); i >= 0; i--)
            if (tempActivities[i] != null)
                activities[activityCounter++] = tempActivities[i];
    }
    return updateLastTimePulled(instance, lastTimePulled, 'activity').thenResolve(activities);
}

function convertToComments(entity, lastTimePulled, instance) {
    var records = entity;
    var comments = [];
    var promise = q.resolve(null);

    records.forEach(function (record) {
        if (record['type'] == "comment" && !record['jiveID'] )
        {
            var podioCommentID = record['externalID'];
            record['projectName']  = instance.config['project'];
            var nIdx1 = record['externalID'].lastIndexOf("-");

            if (nIdx1 > 0)
            {
                podioCommentID = record['externalID'].substring(nIdx1+1);
                // make sure we have a number and not a string to allow the sync compare to work ...
                podioCommentID = Number(podioCommentID);
            }
            console.log( "podioCommentID type=" + typeof(podioCommentID)) ;

            promise = promise.thenResolve(
                wasSynced(instance, podioCommentID).then(function (wasItSynced) {
                    if (wasItSynced) {
                        return;
                    }
                    var json = getCommentJSON(record);

                    if (!isNaN(json['podioCreatedDate'])) {
                        lastTimePulled = Math.max(lastTimePulled, json['podioCreatedDate']);
                    }
                    comments.push(json);
                }));
        }
    });

    return promise.then(function() {
        return updateLastTimePulled(instance, lastTimePulled, 'comment').thenResolve(comments);
    });
}
function getActivityJSON(record) {
    var createdDate = new Date(record['timestamp']).getTime();
    return {

        "podioCreatedDate" : createdDate,
        "activity" : {
            "action":{
                "name":"posted",
                "description": "New Activity"
            },
            "actor": record['actor'],
            "object":{
                "type":"website",
                    "image" : "http://www.theappchamp.com/wp-content/uploads/2013/05/podioApp1.jpg",
                    "url": record['object']['url'],
                    "title": record['object']['title'],
                    "description":record['object']['description']
            },
            "externalID" : record['externalID']
        }
    }
};

function getCommentJSON(record) {
    var createdDate = new Date(record['timestamp']).getTime();
    var gName="";
    var fName="";
    var names = record['actor'] ['name'].split(" ")  ;
    var email = record['actor']['email'] || "";
    if (names.length)
    {
        gName=names[0];
        fName = names[names.length - 1] ;
    }

    return {
        "podioCreatedDate" : createdDate,
        "author" : {
            name: {
                "givenName" : gName ,
                "familyName"  : fName
            } ,
            "email" : email
        },
        "content" : {"type" : "text/html", "text" : "<p>" + record['object']['description'] +"</p>"},
        "type" : "comment",
        "externalID": '' + record['externalID'],
        "externalActivityID" : '' + record['parentExternalID']
    }
}

function getMetadataByInstance(instance) {
    return metadataStore.find(metadataCollection, {'instanceID': instance['id']}).then(function (results) {
        if (results.length <= 0) {
            return null;
        }
        return results[0];
    });
}

function getLastTimePulled(instance, type) {
    return getMetadataByInstance(instance).then(function (metadata) {

        var lastTimePulled = metadata && metadata.lastTimePulled && metadata.lastTimePulled[type];

        if (!lastTimePulled) {

             // set to something way before we (this application) were born!
            lastTimePulled = new Date("2013-08-05T16:26:53.664Z").getTime();
            return updateLastTimePulled(instance, lastTimePulled, type).thenResolve(lastTimePulled);
        }
        return lastTimePulled;
    });
}

function updateLastTimePulled(instance, lastTimePulled, type) {
    return getMetadataByInstance(instance).then(function (metadata) {
        var changed = false;
        if (!metadata) {
            metadata = { "instanceID": instance['id'] };
        }
        if (!metadata.lastTimePulled) {
            metadata.lastTimePulled = {};
        }
        if (!metadata.lastTimePulled[type]) {
            metadata.lastTimePulled[type] = lastTimePulled;
            changed = true;
        }
        else {
            if (metadata.lastTimePulled[type] < lastTimePulled) {
                changed = true;
                metadata.lastTimePulled[type] = lastTimePulled;
            }
        }
        if (changed) {
            return metadataStore.save(metadataCollection, instance['id'], metadata);
        }
        return metadata;
    });
}
function recordSyncFromJive(instance, podioCommentID) {
    return getMetadataByInstance(instance).then(function (metadata) {
        if (!metadata) {
            metadata = {"instanceID": instance['id'], "syncs": []};
        }
        if (!metadata.syncs) {
            metadata.syncs = [];
        }
        var changed = false;
        if (metadata.syncs.indexOf(podioCommentID) < 0) {
            metadata.syncs.push(podioCommentID);
            changed = true;
        }
        if (changed) {
            console.log( "Jive comment sync id='" + podioCommentID + "'") ;
            return metadataStore.save(metadataCollection, instance['id'], metadata);
        }
        return metadata;
    });
}
function wasSynced(instance, podioCommentID) {
    return getMetadataByInstance(instance).then(function (metadata) {
        if (metadata && metadata.syncs && metadata.syncs.indexOf(podioCommentID) >= 0) {
            return true;
        }
        return false;

    });
}
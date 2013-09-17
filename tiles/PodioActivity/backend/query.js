var q = require('q');
var jive = require("jive-sdk");
var oauth = require('./routes/oauth/sampleOauth');

var refreshToken = "";
var doRefreshToken = false;

exports.doGet = function(query, instance) {
    var deferred = q.defer();

    if (doRefreshToken && refreshToken.length)     {
        console.log( 'refreshing token in PodioActiviy ...')
        oauth.refreshToken( refreshToken, instance['config']['ticketID'] );
        doRefreshToken = false;
    }
    var ticketID = instance['config']['ticketID'];

    var tokenStore = jive.service.persistence();
    tokenStore.find('tokens', {'ticket': ticketID }).then(function (found) {
        if (found) {
            var accessToken = found[0]['accessToken']['access_token'];
            refreshToken = found[0]['accessToken']['refresh_token'];

            jive.util.buildRequest(
                    "https://api.podio.com/" + query + ( query.indexOf('?') < 0 ? "?" : "&"  ) + "oauth_token=" + accessToken,
                    'GET'
                ).then(
                // success
                function (response) {
                    deferred.resolve(response);
                },

                // fail
                function (response) {
                    if (response.statusCode == 401)
                    {
                        // do a token refresh next time around ...
                        doRefreshToken = true;
                    }
                    deferred.reject(response);
                }
            );
        }
    });

    return deferred.promise;
};

exports.doPost = function(query, body, instance) {
    var deferred = q.defer();

    if (doRefreshToken && refreshToken.length)     {
        console.log( 'refreshing token in PodioActiviy ...')
        oauth.refreshToken( refreshToken, instance['config']['ticketID'] );
        doRefreshToken = false;
    }

    var ticketID = instance['config']['ticketID'];

    var tokenStore = jive.service.persistence();
    tokenStore.find('tokens', {'ticket': ticketID }).then(function (found) {
        if (found) {
            var accessToken = found[0]['accessToken']['access_token'];
            refreshToken = found[0]['accessToken']['refresh_token'];

            jive.util.buildRequest(
                    "https://api.podio.com/" + query + ( query.indexOf('?') < 0 ? "?" : "&"  ) + "oauth_token=" + accessToken,
                    'POST', body
                ).then(
                // success
                function (response) {
                    deferred.resolve(response);
                },

                // fail
                function (response) {
                    if (response.statusCode == 401)
                    {
                        // do a token refresh next time around ...
                        doRefreshToken = true;
                    }
                    deferred.reject(response);
                }
            );
        }
    });

    return deferred.promise;
};
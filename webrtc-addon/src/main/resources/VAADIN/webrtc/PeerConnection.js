// Muaz Khan     - https://github.com/muaz-khan
// MIT License   - https://www.webrtc-experiment.com/licence/
// Documentation - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/socket.io
// Modified by Johannes Tuikkala @ vaadin.com (2017)
(function() {

    window.PeerConnection = function(parent, socketURL, socketEvent, userid) {
        this.userid = userid || getToken();
        this.peers = { };

        if (!socketURL) throw 'Socket-URL is mandatory.';
        if (!socketEvent) socketEvent = 'message';

        new Signaler(this, socketURL, socketEvent);
		
		this.addStream = function(stream) {	
			this.MediaStreamTrack = stream;
		};

        this.disconnectionHappened = function () {
            parent.disconnectionHappened();
        };
    };

    function Signaler(root, socketURL, socketEvent) {
        var self = this;

        root.startBroadcasting = function() {
			if(!root.MediaStreamTrack) throw 'Offerer must have media stream.';
			
            (function transmit() {
                socket.send({
                    userid: root.userid,
                    broadcasting: true
                });
                !self.participantFound &&
                    !self.stopBroadcasting &&
                        setTimeout(transmit, 3000);
            })();
        };

        root.sendParticipationRequest = function(userid) {
            socket.send({
                participationRequest: true,
                userid: root.userid,
                to: userid
            });
        };

        // if someone shared SDP
        this.onsdp = function(message) {
            var sdp = message.sdp;

            if (sdp.type === 'offer') {
                root.peers[message.userid] = Answer.createAnswer(merge(options, {
                    MediaStreamTrack: root.MediaStreamTrack,
                    sdp: sdp
                }), root);
            }

            if (sdp.type === 'answer') {
                root.peers[message.userid].setRemoteDescription(sdp);
            }
        };

        root.acceptRequest = function(userid) {
            root.peers[userid] = Offer.createOffer(merge(options, {
                MediaStreamTrack: root.MediaStreamTrack
            }));
        };

        var candidates = [];
        // if someone shared ICE
        this.onice = function(message) {
            var peer = root.peers[message.userid];
            if (peer) {
                peer.addIceCandidate(message.candidate);
                for (var i = 0; i < candidates.length; i++) {
                    peer.addIceCandidate(candidates[i]);
                }
                candidates = [];
            } else candidates.push(candidates);
        };

        // it is passed over Offer/Answer objects for reusability
        var options = {
            onsdp: function(sdp) {
                socket.send({
                    userid: root.userid,
                    sdp: sdp,
                    to: root.participant
                });
            },
            onicecandidate: function(candidate) {
                socket.send({
                    userid: root.userid,
                    candidate: candidate,
                    to: root.participant
                });
            },
            onStreamAdded: function(stream) {
                stream.onended = function() {
                    if (root.onStreamEnded) root.onStreamEnded(streamObject);
                };

                var mediaElement = document.createElement('video');
                mediaElement.id = root.participant;
                mediaElement.srcObject = stream;
                mediaElement.autoplay = true;
                mediaElement.controls = true;
                mediaElement.play();

                var streamObject = {
                    mediaElement: mediaElement,
                    stream: stream,
                    participantid: root.participant
                };

                function afterRemoteStreamStartedFlowing() {
                    if (!root.onStreamAdded) return;
                    root.onStreamAdded(streamObject);
                }

                afterRemoteStreamStartedFlowing();
            }
        };

        function closePeerConnections() {
            self.stopBroadcasting = true;
            if (root.MediaStreamTrack) root.MediaStreamTrack.getVideoTracks()[0].stop();

            for (var userid in root.peers) {
                root.peers[userid].peer.close();
            }
            root.peers = { };
        }

        root.close = function() {
            socket.send({
                userLeft: true,
                userid: root.userid,
                to: root.participant
            });
            closePeerConnections();
        };

        window.onbeforeunload = function() {
            root.close();
        };

        window.onkeyup = function(e) {
            if (e.keyCode === 116)
                root.close();
        };

		function onmessage(message) {
			if (message.userid === root.userid) return;
            root.participant = message.userid;

            // for pretty logging
            console.debug(JSON.stringify(message, function(key, value) {
                if (value && value.sdp) {
                    console.log(value.sdp.type, '---', value.sdp.sdp);
                    return '';
                } else return value;
            }, '---'));

            // if someone shared SDP
            if (message.sdp && message.to === root.userid) {
                self.onsdp(message);
            }

            // if someone shared ICE
            if (message.candidate && message.to === root.userid) {
                self.onice(message);
            }

            // if someone sent participation request
            if (message.participationRequest && message.to === root.userid) {
                self.participantFound = true;

                if (root.onParticipationRequest) {
                    root.onParticipationRequest(message.userid);
                } else root.acceptRequest(message.userid);
            }

            // if someone is broadcasting himself!
            if (message.broadcasting && root.onUserFound) {
                root.onUserFound(message.userid);
            }

            if (message.userLeft && message.to === root.userid) {
                closePeerConnections();
            }
		}
		
		var socket = socketURL;
        socket.on(socketEvent, onmessage);
    }

    var STUN = {
        urls: 'stun:23.21.150.121'
    };

    var iceServers = {
        iceServers: [STUN]
    };

    var optionalArgument = {
        optional: [{
            DtlsSrtpKeyAgreement: true
        }]
    };

    var offerAnswerConstraints = {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true
        }
    };

    function getToken() {
        return Math.round(Math.random() * 9999999999) + 9999999999;
    }
	
	function onSdpError() {}

    var Offer = {
        createOffer: function(config) {
            var peer = new RTCPeerConnection(iceServers, optionalArgument);

            if (config.MediaStreamTrack) peer.addStream(config.MediaStreamTrack);
            peer.ontrack = function(event) {
                config.onStreamAdded(event.streams[0]);
            };

            peer.onicecandidate = function(event) {
                if (event.candidate)
                    config.onicecandidate(event.candidate);
            };

            peer.createOffer(function(sdp) {
                peer.setLocalDescription(sdp);
                config.onsdp(sdp);
            }, onSdpError, offerAnswerConstraints);

            this.peer = peer;

            return this;
        },
        setRemoteDescription: function(sdp) {
            this.peer.setRemoteDescription(new RTCSessionDescription(sdp));
        },
        addIceCandidate: function(candidate) {
            this.peer.addIceCandidate(new RTCIceCandidate({
                sdpMLineIndex: candidate.sdpMLineIndex,
                candidate: candidate.candidate
            }));
        }
    };

    var Answer = {
        createAnswer: function(config, root) {
            var peer = new RTCPeerConnection(iceServers, optionalArgument);

            if (config.MediaStreamTrack) peer.addStream(config.MediaStreamTrack);
            peer.ontrack = function(event) {
                config.onStreamAdded(event.streams[0]);
            };

            peer.onicecandidate = function(event) {
                if (event.candidate)
                    config.onicecandidate(event.candidate);
            };

            peer.setRemoteDescription(new RTCSessionDescription(config.sdp));
            peer.createAnswer(function(sdp) {
                peer.setLocalDescription(sdp);
                config.onsdp(sdp);
            }, onSdpError, offerAnswerConstraints);

            this.peer = peer;

            peer.oniceconnectionstatechange = function(event) {
                if (peer.iceConnectionState==="disconnected" || peer.iceConnectionState==="failed") {
                    root.disconnectionHappened();
                }
            };

            return this;
        },
        addIceCandidate: function(candidate) {
            this.peer.addIceCandidate(new RTCIceCandidate({
                sdpMLineIndex: candidate.sdpMLineIndex,
                candidate: candidate.candidate
            }));
        }
    };

    function merge(mergein, mergeto) {
        for (var t in mergeto) {
            mergein[t] = mergeto[t];
        }
        return mergein;
    }
})();
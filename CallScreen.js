import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";

import {
  View,
  Platform,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Image,
  Modal,
  Vibration,
  AppState,
  Alert,
} from "react-native";
import InCallManager from "react-native-incall-manager";
import constants from "./constants";
import VoipPushNotification from "react-native-voip-push-notification";
import RNCallKeep from "react-native-callkeep";
import Timer from "./Timer";
import soundUtils from "./utils/sound-utils";
import BandwidthHandler from "./BandwidthHandler";
import stringUtils from "mainam-react-native-string-utils";
import CallManager from "./CallManager";
import { NativeModules } from "react-native";
import PropTypes from "prop-types";

const { VideoCallModule } = NativeModules;

const { height } = Dimensions.get("screen");

const ONE_SECOND_IN_MS = 1000;

const PATTERN = [
  1 * ONE_SECOND_IN_MS,
  2 * ONE_SECOND_IN_MS,
  3 * ONE_SECOND_IN_MS,
];
const isFront = true; // Use Front camera?

const CallScreen = (props, ref) => {
  const refCreateOfferOrAnswer = useRef(null);
  const refCallId = useRef(null);
  const refOffer = useRef(null);
  const refAnswer = useRef(null);
  const refPeer = useRef(null);
  const refSocket = useRef(null);
  const refConnected = useRef(null);
  const refSettingCallKeep = useRef(null);
  const refDeviceToken = useRef(null);
  const refCallingData = useRef(null);
  const refIgnoreCallIds = useRef([]);
  const refAppState = useRef(AppState.currentState);
  const refLoginToken = useRef(null);
  const refUserId = useRef(null);
  const refTimeout = useRef(null);
  const refPendingCandidates = useRef([]);
  const refOfferReceiverd = useRef(null);
  const refMakeCall = useRef(false);
  const [localStream, setLocalStream] = useState(false);
  const [remoteStreamURL, setRemoteStreamURL] = useState(false);
  const [isMuted, setMute] = useState(false);
  const [isSpeak, setSpeak] = useState(true);
  const [isOfferReceiverd, setOfferReceiverd] = useState(false);
  const [isAnswerSuccess, setAnswerSuccess] = useState(false);
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    addEventCallKeep();
    registerSocket();
    AppState.addEventListener("change", handleAppStateChange);
    return () => {
      removeEventCallKeep();
      AppState.removeEventListener("change", handleAppStateChange);
    };
  }, []);
  useEffect(()=>{
    refUserId.current = props.userId;
  },[props.loginToken, props.userId])
  useImperativeHandle(ref, () => ({
    startCall,
  }));
  useEffect(() => {
    if (refLoginToken.current != props.loginToken) {
      refLoginToken.current = props.loginToken;
      refConnected.current = false; //bỏ đánh dấu là đã connect
      if (!props.loginToken) {
        refSocket.current?.emit(
          constants.socket_type.DISCONNECT,
          { token: refDeviceToken.current, platform: Platform.OS },
          (data) => {
            refSocket.current.disconnect();
            refSocket.current = null;
          }
        );
      } else {
        registerSocket();
      }
    }
  }, [props.loginToken]);
  const handleAppStateChange = (nextAppState) => {
    if (
      refAppState.current.match(/inactive|background/) &&
      nextAppState === "active"
    ) {
      console.log("App has come to the foreground!");
    }

    refAppState.current = nextAppState;
  };
  const getCallingName = () => {
    if (refCallingData.current) {
      if (props.userId == refCallingData.current.from) {
        return refCallingData.current.toName;
      } else {
        return refCallingData.current.fromName;
      }
    } else return "";
  };
  const startSound = () => {
    InCallManager.startRingtone("_BUNDLE_");
    Vibration.vibrate(PATTERN, true);
  };
  const stopSound = () => {
    InCallManager.stopRingtone();
    InCallManager.stop();
    Vibration.cancel();
  };

  const getVideoDevice = () => {
    return new Promise((resolve, reject) => {
      const facing = isFront ? "front" : "environment";
      try {
        mediaDevices.enumerateDevices().then((devices) => {
          const videoSourceId = devices.find(
            (device) => device.kind === "videoinput" && device.facing === facing
          );
          if (videoSourceId) resolve(videoSourceId);
          else reject(null);
        });
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  };
  const createPeer = () => {
    const peer = new RTCPeerConnection({'iceServers': CallManager.DEFAULT_ICE.iceServers});
    peer.onicecandidate = onICECandiate;
    peer.onaddstream = onAddStream;
    refPeer.current = peer;
    return peer;
  };

  const initLocalVideo = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const videoSourceId = await getVideoDevice();
        const constraints = {
          audio: true,
          video: {
            mandatory: {
              minWidth: 500, // Provide your own width, height and frame rate here
              minHeight: 300,
              minFrameRate: 30,
            },
            facingMode: isFront ? "user" : "environment",
            optional: videoSourceId ? [{ sourceId: videoSourceId }] : [],
          },
        };
        const stream = await mediaDevices.getUserMedia(constraints);
        resolve(stream);
      } catch (error) {
        reject(error);
      }
    });
  };

  const setupWebRTC = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await initLocalVideo();
        setLocalStream(stream);
        const peer = createPeer();
        peer.addStream(stream);
        if(!refOfferReceiverd.current) //chi khi thuc hien cuoc goi thi moi tao offer
        {
          const offer = await peer.createOffer();
          refOffer.current = offer;
          peer.setLocalDescription(offer)
        }
        resolve(stream);
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  };

  const startCall = async ({ from, fromName, to, toName } = {}) => {
    try {
      fetch(CallManager.host+"/api/call/create-call", {
        method: 'POST', // *GET, POST, PUT, DELETE, etc.
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: from,
          fromName,
          to: to, 
          toName,
        }) // body data type must match "Content-Type" header
      }).then(s=>s.json()
      ).then(async s=>{
        switch(s?.code)
        {
          case 0:
            refCallId.current = s.data.call?.callId;
            refCreateOfferOrAnswer.current=false;
            await setupWebRTC();
            setVisible(true);
            break;
          default: 
            props.onLeave&&props.onLeave({ reason: s.message, code: 0 });
        } 
      }).catch(e=>{
        props.onLeave&&props.onLeave({reason: e?.message, code: 0 });
      });
      // createPeer();
      // return;
      // refCallId.current = stringUtils.guid();
      // refCallingData.current = {
      //   from,
      //   fromName,
      //   to,
      //   toName,
      // };
      // refCallingParter.current = to
      //   // return;
      // await setupWebRTC();
      // const offer = await refPeer.current.createOffer();
      // refOffer.current = offer;
      // refPeer.current.setLocalDescription(offer).then((s) => {
      //   // InCallManager.start({media: 'audio', ringback: '_BUNDLE_'});
      //   soundUtils.play("call_phone.mp3"); //bật âm thanh đang chờ bắt mày
      //   refMakeCall.current = false;
      //   setVisible(true);
      // });

      // Create Offer
    } catch (e) {}
  };
  const onSwitchCamera = () => {
    localStream?.getVideoTracks().forEach((track) => track._switchCamera());
    // setState({ isCamFront: !state.isCamFront });
  };
  const onTimeOut = () => {
    refTimeout.current = setTimeout(() => {
      onReject();
    }, 30 * 60 * 1000);
  };

  // Mutes the local's outgoing audio
  const onToggleMute = () => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setMute(!track.enabled);
    });
  };
  const onToggleSpeaker = () => {
    const newValue = !isSpeak;
    setSpeak(newValue);
    InCallManager.setForceSpeakerphoneOn(newValue);
  };
  // const onICEConnectionStateChange = (e) => {
  //   switch (e.target.iceConnectionState) {
  //     case "completed":
  //       break;
  //     case "connected":
  //       onTimeOut();
  //       setAnswerSuccess(true);
  //       break;
  //     case "closed":
  //     case "disconnected":
  //       break;
  //     case "failed":
  //       // onReject()
  //       break;
  //   }
  // };

  const onICECandiate = (e) => {
    const { candidate } = e;
    if (candidate) {
      if(!refOfferReceiverd.current)
      {
        if (!refCreateOfferOrAnswer.current && refCallId.current) {
          refCreateOfferOrAnswer.current =true;
            fetch(CallManager.host+"/api/call/calling/"+refCallId.current, {
              method: 'PUT', // *GET, POST, PUT, DELETE, etc.
              headers: {
                'Content-Type': 'application/json'
              }, // body data type must match "Content-Type" header
              body: JSON.stringify({
                userId: refUserId.current,
                ice: candidate,
                offer: refOffer.current
              }) 
            },).then(s=>s.json()
            ).then(s=>{
              switch(s?.code)
              {
                case 0:
                  break;
                default: 
                  props.onLeave&&props.onLeave({ reason: s.message, code: 0 });
              } 
            }).catch(e=>{
              props.onLeave&&props.onLeave({reason: e?.message, code: 0 });
            });    
          // sendMessage(
          //   refOfferReceiverd.current
          //     ? constants.socket_type.ANSWER
          //     : constants.socket_type.OFFER,
          //   {
          //     to: refCallingParter.current,
          //     ices: [{ userId: props.userId, ice: candidate }],
          //     // description: refPeer.current.localDescription,
          //     // candidates: refPendingCandidates.current,
          //     callId: refCallId.current,
          //     // sdp: refOffer.current,
          //     from: props.userId,
          //     data: refCallingData.current,
          //   }
          // );
          // refCreateOfferOrAnswer.current = true;
          // refPendingCandidates.current.push(candidate);
        }
      }else
      {
          sendMessage(constants.socket_type.CANDIDATE,
          {
            userId: props.userId,
            ice: candidate,
            callId: refCallId.current,
          });
      }      
    }
  };

  const onAddStream = (e) => {
    setRemoteStreamURL(e.stream.toURL());
  };

  //const onRNCallKitDidActivateAudioSession = (data) => {
  //   // AudioSession đã được active, có thể phát nhạc chờ nếu là outgoing call, answer call nếu là incoming call.
  //   onAnswer(true)();
  // };
  const onCallKeepAnswer = ({ callUUID }) => {
    if (refAppState.current.match(/inactive|background/)) {
      Alert.alert("Thông báo", "Nhấn đồng ý để trở lại cuộc gọi", [
        { text: "Đồng ý", onPress: () => console.log("OK Pressed") },
      ]);
    } else {
      if (Platform.OS == "ios") RNCallKeep.reportEndCallWithUUID(callUUID, 2);
    }
    onAnswer(true, callUUID)();
  };
  const onCallKeepEndCall = ({ callUUID }) => {
    if (!isAnswerSuccess) onReject();
  };
  const addEventCallKeep = () => {
    if (Platform.OS == "ios") {
      RNCallKeep.addEventListener("answerCall", onCallKeepAnswer);
      RNCallKeep.addEventListener("endCall", onCallKeepEndCall);
    }
  };
  const removeEventCallKeep = () => {
    if (Platform.OS == "ios") {
      RNCallKeep.removeEventListener("answerCall", onCallKeepAnswer);
      RNCallKeep.removeEventListener("endCall", onCallKeepEndCall);
      VoipPushNotification.removeEventListener("register");
    }
  };
  const onOfferReceived = async (data = {}) => {
    // if (refCallId.current) {
    //   //Nếu đang trong cuộc gọi thì kêt thúc cuộc gọi
    //   console.log("reject-call", data.callId);
    //   if (Platform.OS == "ios")
    //     RNCallKeep.reportEndCallWithUUID(data.callId, 2);

    //   if (data.callId && VideoCallModule?.reject) {
    //     VideoCallModule.reject(data.callId);
    //   }
    //   refSocket.current.emit(constants.socket_type.LEAVE, {
    //     to: data.from,
    //     callId: data.callId, // state.callId,
    //     type: constants.socket_type.REJECT,
    //   });
    //   return;
    // }
    // if (
    //   data.from == props.userId ||
    //   refIgnoreCallIds.current.includes(data.callId)
    // ) {
    //   //nếu offer nhận được được thực hiện từ chính bạn thì bỏ qua
    //   return;
    // }
    refOffer.current = data.offer;
    refCallId.current = data.callId;
    refCallingData.current = data.data || {};
    refOfferReceiverd.current = true;
    setOfferReceiverd(true);
    refCreateOfferOrAnswer.current=false;
    await setupWebRTC();
    refPeer.current.addIceCandidate(new RTCIceCandidate(data.ice))
    setVisible(true);
    startSound();
  };

  const onTimeOutPair = (data = {}) => {
  };
  const onCandidate = async (data = {}) => {
    if(refPeer.current && data.callId == refCallId.current && data.ice)
    {
      if(data.ice.sdp)
      {
        await refPeer.current.setRemoteDescription(
          new RTCSessionDescription(data.ice)
        );    
      }else
      {
        refPeer.current.addIceCandidate(new RTCIceCandidate(data.ice))
      }
    }    
  };

  const onAnswerReceived = async (data) => {
    await refPeer.current.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );    
    setAnswerSuccess(true);
  };
  const onLeave = (data = {}) => {
    refIgnoreCallIds.current.push(data.callId);
    if (refIgnoreCallIds.current.length > 10) {
      refIgnoreCallIds.current.shift();
    }

    if (data.callId == refCallId.current) {
      let reason = "";
      if (data.status && data.code == 1 && !isAnswerSuccess) {
        reason = "Máy bận";
      } else {
        reason = "Kết thúc cuộc gọi";
      }
      handleReject();
      props.onLeave &&
        props.onLeave({ callId: refCallId.current, reason, code: data.code });
    }
    if (data.callId && VideoCallModule?.reject) {
      VideoCallModule.reject(data.callId);
    }
  };

  const onAnswer = (fromCallKeep, callUUid) => async () => {
    try {
      if (refCallId.current && VideoCallModule?.reject) {
        VideoCallModule.reject(refCallId.current);
      }
      if (!refPeer.current) return;
      if (callUUid && refCallId.current != callUUid) return;
      if (refCallId.current && !fromCallKeep) {
        if (Platform.OS == "ios")
          RNCallKeep.reportEndCallWithUUID(refCallId.current, 2);
      }
      await refPeer.current.setRemoteDescription(
        new RTCSessionDescription(refOffer.current)
      );
      const answer = await refPeer.current.createAnswer();
      refAnswer.current=answer;
      await refPeer.current.setLocalDescription(answer);
      sendMessage(constants.socket_type.ANSWER,
      {
          callId: refCallId.current,
          answer: answer,
          userId: props.userId,
          data: refCallingData.current,
        }
      );
      setAnswerSuccess(true);
      stopSound();
    } catch (error) {
      console.log(error);
    }
  };

  const handleReject = () => {
    if (refCallId.current && VideoCallModule?.reject) {
      VideoCallModule.reject(refCallId.current);
    }
    if (refPeer.current) refPeer.current.close();
    soundUtils.stop();
    stopSound();
    if (refTimeout.current) {
      clearTimeout(refTimeout.current);
      refTimeout.current = null;
    }
    if (refCallId.current) {
      if (Platform.OS == "ios")
        RNCallKeep.reportEndCallWithUUID(refCallId.current, 2);
    }
    refCallId.current = null;
    refCallingData.current = null;
    // refPendingCandidates.current = [];
    refOfferReceiverd.current = false;
    refCreateOfferOrAnswer.current = false;
    refOffer.current=null
    refAnswer.current=null;
    refPeer.current=null;
    refMakeCall.current = false;
    setLocalStream(null);
    setRemoteStreamURL(null);
    setMute(false);
    setSpeak(true);
    setOfferReceiverd(false);
    setAnswerSuccess(false);
    setVisible(false);
  };

  const sendMessage = (type, msgObj) => {
    if (refSocket.current) {
      refSocket.current.emit(type, msgObj, (data) => {});
    } else {
      const e = {
        code: "websocket_error",
        message: "WebSocket state:" + ws.readyState,
      };
      throw e;
    }
  };

  const onReject = () => {
    props.onLeave && props.onLeave({ callId: refCallId.current });
    let type =
      isAnswerSuccess || refMakeCall.current
        ? constants.socket_type.LEAVE
        : constants.socket_type.REJECT;
    refSocket.current.emit(constants.socket_type.LEAVE, {
      userId: props.userId,
      callId: refCallId.current, // state.callId,
      type,
    });
    handleReject();
  };
  const setupCallKeep = () => {
    return new Promise((resolve, reject) => {
      if (!refSettingCallKeep.current) {
        const options = {
          ios: {
            appName: "ISOFHCARE",
          },
          android: {
            alertTitle: "Thông báo",
            alertDescription: "Cho phép iSofHcare truy cập cuộc gọi của bạn",
            cancelButton: "Huỷ",
            okButton: "Đồng ý",
            imageName: "ic_launcher",
            // additionalPermissions: [PermissionsAndroid.PERMISSIONS.example]
          },
        };
        if (Platform.OS == "ios")
          RNCallKeep.setup(options)
            .then((res) => {
              refSettingCallKeep.current = true;
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        // RNCallKeep.setAvailable(true);
      } else {
        resolve({});
      }
    });
  };
  const onSocketDisconnect = async (data2) => {
    refConnected.current = false;
  };
  const onSocketConnected = async (data2) => {
    try {
      if (refConnected.current) return; // nếu đã connect rồi thì bỏ qua
      refConnected.current = true; //đánh dấu là đã connect
      if (Platform.OS == "ios") {
        setupCallKeep();
        VoipPushNotification.requestPermissions();
        VoipPushNotification.addEventListener("register", (token) => {
          // send token to your apn provider server
          refDeviceToken.current = token;
          connectToSocket(token);
        });
        // VoipPushNotification.registerVoipToken();
        // VoipPushNotification.addEventListener('notification', notification => {
        //   // Handle incoming pushes
        //   if (!refCallId.current) {
        //     refCallId.current = notification.getData().data.UUID;
        //   } else {
        //     // if Callkit already exists then end Callkit wiht the callKitUUID
        //     RNCallKeep.endCall(refCallId.current);
        //   }
        // });
        VoipPushNotification.registerVoipToken();
      } else {
        const token = await CallManager.firebase.messaging().getToken();
        refDeviceToken.current = token;
        connectToSocket(token);
      }
    } catch (error) {
      console.log(error);
    }
  };
  const connectToSocket = (token) => {
    refSocket.current &&
      refSocket.current.emit(constants.socket_type.CONNECT, {
        token,
        id: props.userId,
        platform: Platform.OS,
        deviceId: CallManager.deviceId,
        packageName: CallManager.packageName,
      });
  };
  const registerSocket = () => {
    if (props.loginToken && !refSocket.current) {
      refSocket.current = props.io.connect(CallManager.host, {
        transports: ["websocket"],
        query: {
          token: props.loginToken, //verify socket io với login token,
          userId: props.userId
        },
        upgrade: true,
        reconnection: true,
        autoConnect: true,
        timeout: 30000,
        rememberUpgrade: true,
      });
      refSocket.current.on(constants.socket_type.CONNECT, onSocketConnected);
      refSocket.current.on(
        constants.socket_type.DISCONNECT,
        onSocketDisconnect
      );
      refSocket.current.on(constants.socket_type.CANDIDATE, onCandidate);
      refSocket.current.on(constants.socket_type.TIMEOUT_PAIR, onTimeOutPair);
      refSocket.current.on(constants.socket_type.OFFER, onOfferReceived);
      refSocket.current.on(constants.socket_type.ANSWER, onAnswerReceived);
      refSocket.current.on(constants.socket_type.LEAVE, onLeave);
      refSocket.current.connect();
    }
  };

  return (
    <Modal
      animated={true}
      animationType="slide"
      transparent={false}
      visible={isVisible}
    >
      <View style={styles.container}>
        <StatusBar translucent={true} backgroundColor={"transparent"} />
        <View
          style={[
            styles.rtcview,
            { height, ...StyleSheet.absoluteFillObject, zIndex: 0 },
          ]}
        >
          {remoteStreamURL ? (
            <RTCView
              style={styles.rtc}
              zOrder={-1}
              mirror={false}
              objectFit="cover"
              streamURL={remoteStreamURL}
            />
          ) : null}
        </View>

        {/* {localPC.current ? <BandWidth localPc={localPC.current} /> : null} */}
        {localStream && localStream.toURL && (
          <View style={[styles.groupLocalSteam]}>
            <RTCView
              style={[styles.rtc]}
              zOrder={1}
              // mirror={isCamFront}
              streamURL={localStream.toURL()}
            />
            <TouchableOpacity
              onPress={onSwitchCamera}
              style={styles.buttonSwitch}
            >
              <Image
                source={require("./images/camera_switch.png")}
                style={styles.iconSwitch}
              />
            </TouchableOpacity>
          </View>
        )}
        <Timer
          data={{
            mediaConnected: isAnswerSuccess,
          }}
          callingName={getCallingName()}
        />
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
          }}
        >
          {localStream && (refMakeCall.current || isAnswerSuccess) && (
            <View style={styles.toggleButtons}>
              <TouchableOpacity onPress={onToggleMute} style={{ padding: 10 }}>
                {isMuted ? (
                  <Image
                    source={require("./images/mute_selected.png")}
                    style={styles.icon}
                  />
                ) : (
                  <Image
                    source={require("./images/mute.png")}
                    style={styles.icon}
                  />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onToggleSpeaker}
                style={{ padding: 10 }}
              >
                {isSpeak ? (
                  <Image
                    source={require("./images/speaker_selected.png")}
                    style={styles.icon}
                  />
                ) : (
                  <Image
                    source={require("./images/speaker.png")}
                    style={styles.icon}
                  />
                )}
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.toggleButtons}>
            {isOfferReceiverd && !isAnswerSuccess ? (
              <TouchableOpacity
                onPress={onAnswer(false)}
                style={{ padding: 10 }}
              >
                <Image
                  source={require("./images/accept_call.png")}
                  style={styles.icon}
                />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onReject} style={{ padding: 10 }}>
              <Image
                source={require("./images/end_call.png")}
                style={styles.icon}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

CallScreen.propTypes = {};

const styles = StyleSheet.create({
  textWarning: {
    color: "#FFF",
    textAlign: "center",
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 20,
  },
  groupLocalSteam: {
    height: "30%",
    width: "40%",
    borderRadius: 5,
    alignSelf: "flex-end",
    marginRight: 10,
    marginTop: 10,
    marginBottom: 5,
    zIndex: 10,
  },
  icon: {
    height: 60,
    width: 60,
  },
  buttonSwitch: {
    padding: 10,
    position: "absolute",
    bottom: 10,
    marginBottom: 10,
    alignSelf: "center",
  },
  iconSwitch: {
    height: 40,
    width: 40,
  },
  container: {
    backgroundColor: "#313131",
    // justifyContent: 'space-between',
    // alignItems: 'center',
    flex: 1,
    paddingTop: 10,
  },
  text: {
    fontSize: 30,
  },
  rtcview: {
    // backgroundColor: 'black',
  },
  rtc: {
    width: "100%",
    height: "100%",
  },
  toggleButtons: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
  },
});

export default forwardRef(CallScreen);

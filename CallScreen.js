import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useMemo,
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
  Text,
  Platform,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  Modal,
  Vibration,
  AppState,
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

const { VideoCallModule } = NativeModules;

const ONE_SECOND_IN_MS = 1000;

const PATTERN = [
  1 * ONE_SECOND_IN_MS,
  2 * ONE_SECOND_IN_MS,
  3 * ONE_SECOND_IN_MS,
];
const isFront = true; // Use Front camera?

const CallScreen = (props, ref) => {
  const refCreateOfferOrAnswer = useRef(null);
  const refTimeOutToast = useRef(null);
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
  const refOfferReceiverd = useRef(null);
  const refMakeCall = useRef(false);
  const refOfferData = useRef(null);
  const [localStream, setLocalStream] = useState(false);
  const [remoteStreamURL, setRemoteStreamURL] = useState(false);
  const [isOfferReceiverd, setOfferReceiverd] = useState(false);
  const [isAnswerSuccess, setAnswerSuccess] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [state, _setState] = useState({
    isMuted: false,
    isSpeak: true,
    isVisible: false,
  });
  const setState = (data = {}) => {
    _setState((state) => ({ ...state, ...data }));
  };
  useEffect(() => {
    addEventCallKeep();
    registerSocket();
    AppState.addEventListener("change", handleAppStateChange);
    if (InCallManager.recordPermission !== "granted") {
      InCallManager.requestRecordPermission();
    }
    return () => {
      removeEventCallKeep();
      AppState.removeEventListener("change", handleAppStateChange);
    };
  }, []);
  useEffect(() => {
    refUserId.current = props.userId;
  }, [props.loginToken, props.userId]);
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

  const showNotice = ({ message }) => {
    if (refTimeOutToast.current) {
      clearTimeout(refTimeOutToast.current);
      refTimeOutToast.current = null;
    }
    setState({
      toastMessage: message,
      showToast: true,
    });
    refTimeOutToast.current = setTimeout(() => {
      setState({
        showToast: false,
      });
    }, 5000);
  };
  useEffect(() => {
    showNotice({
      message:
        "Nếu gặp phải tình trạng mất tiếng, hay mất hình. Vui lòng thực hiện lại cuộc gọi khác",
      type: 0,
    });
  }, [isAnswerSuccess, appState]);

  const handleAppStateChange = (nextAppState) => {
    if (
      refAppState.current.match(/inactive|background/) &&
      nextAppState === "active"
    ) {
    }
    refAppState.current = nextAppState;
    setAppState(nextAppState);
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
  const incomingSound = () => {
    InCallManager.startRingtone("_BUNDLE_");
    Vibration.vibrate(PATTERN, true);
  };
  const outcomingSound = () => {
    soundUtils.play("call_phone.mp3"); //bật âm thanh đang chờ bắt mày
  };

  const stopSound = () => {
    soundUtils.stop();
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.stop();
    Vibration.cancel();
  };

  const callPickUp = () => {
    soundUtils.stop();
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.stop();
    Vibration.cancel();
    InCallManager.start({ media: "video", auto: true });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setSpeakerphoneOn(true);
    InCallManager.setKeepScreenOn(true);
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
    const peer = new RTCPeerConnection({
      iceServers: CallManager.DEFAULT_ICE.iceServers,
    });
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
          // audio: true,
          // video: {
          //   mandatory: {
          //     minWidth: 500, // Provide your own width, height and frame rate here
          //     minHeight: 300,
          //     minFrameRate: 30,
          //   },
          //   facingMode: isFront ? "user" : "environment",
          //   optional: videoSourceId ? [{ sourceId: videoSourceId }] : [],
          // },
          video: true,
          audio: true,
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
        // for (const track of stream.getTracks()) {
        //   peer.addTrack(track);
        // }
        peer.addStream(stream);
        if (!refOfferReceiverd.current) {
          //chi khi thuc hien cuoc goi thi moi tao offer
          const offer = await peer.createOffer();
          refOffer.current = offer;
          peer.setLocalDescription(offer);
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
      fetch(CallManager.host + "/api/call/create-call?force=true", {
        method: "POST", // *GET, POST, PUT, DELETE, etc.
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: from,
          fromName,
          to: to,
          toName,
        }), // body data type must match "Content-Type" header
      })
        .then((s) => s.json())
        .then(async (s) => {
          switch (s?.code) {
            case 0:
              refMakeCall.current = true;
              refCallingData.current = s.data.call?.data || {};
              refCallId.current = s.data.call?.callId;
              refCreateOfferOrAnswer.current = false;
              await setupWebRTC();
              setState({ isVisible: true });
              InCallManager.setKeepScreenOn(true);
              outcomingSound();
              break;
            default:
              props.showMessage &&
                props.showMessage({ message: s.message, type: 0 });
          }
        })
        .catch((e) => {
          props.showMessage &&
            props.showMessage({ message: e?.message, type: 2 });
        });
    } catch (e) {}
  };
  const onSwitchCamera = () => {
    if (localStream?.getVideoTracks) {
      localStream?.getVideoTracks().forEach((track) => track._switchCamera());
    }
  };
  useEffect(() => {
    setTimeout(async () => {
      if (Platform.OS == "ios") {
        if (
          localStream?.getVideoTracks &&
          localStream?.getVideoTracks()?.length
        ) {
          localStream?.getVideoTracks().forEach((tract) => {
            try {
              track.enabled = false;
              track.enabled = true;
              track._switchCamera();
              track._switchCamera();
            } catch (error) {}
          });
        }
        if (
          localStream?.getAudioTracks &&
          localStream?.getAudioTracks()?.length
        ) {
          localStream?.getAudioTracks().forEach((tract) => {
            try {
              track.enabled = false;
              track.enabled = true;
            } catch (error) {}
          });
        }
      }
    }, 2000);
  }, [appState, localStream, isAnswerSuccess, state.isVisible]);
  useEffect(() => {
    //     const date = new Date();
    // date.setMinutes(date.getMinutes() + 1);
    // const notification =
    //             new firebase.notifications.Notification()
    //               .setNotificationId(stringUtils.guid())
    //               .setTitle("Cuộc gọi video call")
    //               .setBody("Nhấn vào đây để quay về cuộc gọi");
    //     new firebase.notifications().displayNotification(notification)
    // if((appState ||"").match(/inactive|background/) && isVisible)
    // {
    // console.log("nammn",appState);
    // const notification =
    //       new CallManager.firebase.notifications.Notification()
    //         .setNotificationId(stringUtils.guid())
    //         .setTitle("Cuộc gọi video call")
    //         .setBody("Nhấn vào đây để quay về cuộc gọi");
    //     new CallManager.firebase.notifications().displayNotification(
    //       notification
    //     );
    // }
  }, [appState]);
  // },[appState])
  const onTimeOut = () => {
    refTimeout.current = setTimeout(() => {
      onReject();
    }, 30 * 60 * 1000);
  };

  // Mutes the local's outgoing audio
  const onToggleMute = () => {
    if (localStream?.getAudioTracks) {
      localStream?.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        setState({
          isMuted: !track.enabled,
        });
      });
    } else {
      if (localStream?.getVideoTracks) {
        localStream?.getVideoTracks().forEach((track) => {
          track.enabled = !track.enabled;
          setState({
            isMuted: !track.enabled,
          });
        });
      }
    }
  };
  const onToggleSpeaker = () => {
    const newValue = !state.isSpeak;
    setState({
      isSpeak: newValue,
    });
    InCallManager.setForceSpeakerphoneOn(newValue);
  };

  const onICECandiate = (e) => {
    const { candidate } = e;
    if (candidate) {
      if (!refOfferReceiverd.current) {
        if (
          !refCreateOfferOrAnswer.current &&
          refCallId.current &&
          candidate.sdpMid == "video"
        ) {
          refCreateOfferOrAnswer.current = true;
          fetch(CallManager.host + "/api/call/calling/" + refCallId.current, {
            method: "PUT", // *GET, POST, PUT, DELETE, etc.
            headers: {
              "Content-Type": "application/json",
            }, // body data type must match "Content-Type" header
            body: JSON.stringify({
              userId: refUserId.current,
              ice: candidate,
              offer: refOffer.current,
            }),
          })
            .then((s) => s.json())
            .then((s) => {
              switch (s?.code) {
                case 0:
                  break;
                default:
                  props.showMessage &&
                    props.showMessage({ message: s.message, type: 0 });
              }
            })
            .catch((e) => {
              props.showMessage &&
                props.showMessage({ message: e.message, type: 2 });
            });
        }
      } else {
        sendMessage(constants.socket_type.CANDIDATE, {
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

  const onCallKeepAnswer = ({ callUUID }) => {
    if (refAppState.current.match(/inactive|background/)) {
      setState({ isVisible: true });
    } else {
      if (Platform.OS == "ios") RNCallKeep.reportEndCallWithUUID(callUUID, 2);
    }
    setTimeout(() => {
      onAnswer(callUUID)();
    }, 1000);
  };
  const onCallKeepEndCall = ({ callUUID }) => {
    if (!refCallId.current) refCallId.callId = callUUID;
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
    if (refCallId.current) {
      if (Platform.OS == "ios")
        RNCallKeep.reportEndCallWithUUID(data.callId, 2);

      if (data.callId && VideoCallModule?.reject) {
        VideoCallModule.reject(data.callId);
      }

      refSocket.current.emit(constants.socket_type.LEAVE, {
        callId: data.callId, // state.callId,
        userId: props.userId,
        type: constants.socket_type.BUSY,
      });
      return;
    }

    if (
      data.from == props.userId ||
      refIgnoreCallIds.current.includes(data.callId)
    ) {
      //nếu offer nhận được được thực hiện từ chính bạn thì bỏ qua
      return;
    }

    refCallId.current = data.callId;
    refOfferData.current = data;
    refCallingData.current = data.data;
    refOfferReceiverd.current = true;
    setOfferReceiverd(true); //đánh dấu là cuộc gọi đến
    if (Platform.OS == "ios") {
      // nếu là thiết bị ios thì hiển thị callkeep
      RNCallKeep.displayIncomingCall(data.callId, "", data.data.fromName);
    } //ngược lại với thiết bị android thì hiển thị chuông báo cuộc gọi đến

    if (Platform.OS == "android") incomingSound();
    setState({ isVisible: true });
  };

  const onTimeOutPair = (data = {}) => {};
  const onCandidate = async (data = {}) => {
    if (refPeer.current && data.callId == refCallId.current && data.ice) {
      if (data.ice.sdp) {
        await refPeer.current.setRemoteDescription(
          new RTCSessionDescription(data.ice)
        );
      } else {
        refPeer.current.addIceCandidate(new RTCIceCandidate(data.ice));
      }
    }
  };

  const onAnswerReceived = async (data) => {
    onTimeOut();
    callPickUp();
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
      props.showMessage && props.showMessage({ message: reason, type: 0 });
    }
    if (data.callId && VideoCallModule?.reject) {
      VideoCallModule.reject(data.callId);
    }
  };
  const showPushNotification = (message, title) => {
    const notification = new CallManager.firebase.notifications.Notification()
      .setNotificationId(stringUtils.guid())
      .setTitle(title)
      .setBody(message);
    new CallManager.firebase.notifications().displayNotification(notification);
  };

  const onAnswer = (callUUid) => async () => {
    try {
      setAnswerSuccess(true);
      setState({ isVisible: true });
      onTimeOut();
      const answer = async () => {
        const data = refOfferData.current;
        refOffer.current = refOfferData.current?.offer;
        refCallingData.current = refOfferData.current?.data || {};
        refCreateOfferOrAnswer.current = false;
        await setupWebRTC();
        refPeer.current.addIceCandidate(
          new RTCIceCandidate(refOfferData.current?.ice)
        );
        refOffer.current = data.offer;
        if (refCallId.current && VideoCallModule?.reject) {
          VideoCallModule.reject(refCallId.current);
        }
        if (!refPeer.current) return;
        if (callUUid && refCallId.current != callUUid) return;
        await refPeer.current.setRemoteDescription(
          new RTCSessionDescription(refOffer.current)
        );
        const answer = await refPeer.current.createAnswer();
        refAnswer.current = answer;
        await refPeer.current.setLocalDescription(answer);
        sendMessage(constants.socket_type.ANSWER, {
          callId: refCallId.current,
          answer: answer,
          userId: props.userId,
          data: refCallingData.current,
        });
        callPickUp();
      };
      if (Platform.OS == "ios") {
        RNCallKeep.reportEndCallWithUUID(refCallId.current, 2);
        setTimeout(answer, 1000);
      } else {
        answer();
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleReject = () => {
    stopSound();
    if (refCallId.current && VideoCallModule?.reject) {
      VideoCallModule.reject(refCallId.current);
    }
    if (refPeer.current) refPeer.current.close();
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
    refOffer.current = null;
    refAnswer.current = null;
    refPeer.current = null;
    refMakeCall.current = false;
    if (localStream) {
      try {
        if (localStream.getTracks)
          localStream.getTracks().forEach((track) => track.stop());
        if (localStream.getVideoTracks)
          localStream.getVideoTracks().forEach((track) => track.stop());
        localStream.release();
      } catch (error) {}
    }
    setLocalStream(null);
    setRemoteStreamURL(null);
    setState({
      isMute: false,
      isSpeak: true,
      isVisible: false,
    });
    setOfferReceiverd(false);
    setAnswerSuccess(false);
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
          refDeviceToken.current = token;
          connectToSocket(token);
        });
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
        fullName: props.fullName,
      });
  };
  const registerSocket = () => {
    if (props.loginToken && !refSocket.current) {
      refSocket.current = props.io.connect(CallManager.host, {
        transports: ["websocket"],
        query: {
          token: props.loginToken, //verify socket io với login token,
          userId: props.userId,
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

  const buttonEndCall = (
    <View style={{ flex: 1, alignItems: "center" }}>
      <TouchableOpacity onPress={onReject} style={{ padding: 10, flex: 1 }}>
        <Image source={require("./images/end_call.png")} style={styles.icon} />
      </TouchableOpacity>
    </View>
  );

  const buttonAcceptCall = isOfferReceiverd && !isAnswerSuccess && (
    <View style={{ flex: 1, alignItems: "center" }}>
      <TouchableOpacity onPress={onAnswer()} style={{ padding: 10, flex: 1 }}>
        <Image
          source={require("./images/accept_call.png")}
          style={styles.icon}
        />
      </TouchableOpacity>
    </View>
  );

  const buttonSpeaker = useMemo(
    () =>
      isAnswerSuccess && (
        <View style={{ flex: 1, alignItems: "center" }}>
          <TouchableOpacity onPress={onToggleSpeaker} style={{ padding: 10 }}>
            {state.isSpeak ? (
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
      ),
    [state.isSpeak, isAnswerSuccess]
  );

  const buttonMute = useMemo(
    () =>
      isAnswerSuccess && (
        <View style={{ flex: 1, alignItems: "center" }}>
          <TouchableOpacity onPress={onToggleMute} style={{ padding: 10 }}>
            {state.isMuted ? (
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
        </View>
      ),
    [state.isMuted, isAnswerSuccess]
  );

  const viewActionBottom = useMemo(
    () => (
      <View
        style={{
          position: "absolute",
          bottom: 50,
          display: "flex",
          flexDirection: "row",
          zIndex: 4,
        }}
      >
        {buttonMute}
        {buttonAcceptCall}
        {buttonEndCall}
        {buttonSpeaker}
      </View>
    ),
    [isAnswerSuccess, state.isMuted, state.isSpeak, isOfferReceiverd]
  );

  const viewCalling = useMemo(
    () =>
      !isAnswerSuccess && (
        <View
          style={{ flex: 1, position: "relative", backgroundColor: "#6df7db" }}
        >
          {localStream && (
            <RTCView
              style={{ width: "100%", height: "100%" }}
              zOrder={-1}
              mirror={false}
              objectFit="cover"
              streamURL={localStream.toURL()}
            />
          )}
          <View
            style={{
              position: "absolute",
              top: 100,
              alignItems: "center",
              left: 0,
              right: 0,
            }}
          >
            <View
              style={{
                width: 120,
                height: 120,
                borderWidth: 2,
                borderColor: "#FFF",
                borderRadius: 110,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 50,
              }}
            >
              <Image
                source={CallManager.userAvatar}
                style={{ width: 100, height: 100 }}
              />
            </View>
            {refMakeCall.current && (
              <Text style={{ fontSize: 15, color: "#FFF" }}>Đang gọi</Text>
            )}
            <Text
              style={{
                marginTop: 30,
                fontSize: 25,
                color: "#FFF",
                fontWeight: "700",
              }}
            >
              {getCallingName()}
            </Text>
            {!refMakeCall.current && (
              <Text style={{ fontSize: 15, color: "#FFF" }}>
                Đang gọi cho bạn
              </Text>
            )}
          </View>
          {viewActionBottom}
        </View>
      ),
    [localStream, isOfferReceiverd, isAnswerSuccess, props.userId]
  );

  const myStream = useMemo(() => {
    return (
      localStream && (
        <View
          style={{
            width: 150,
            height: 200,
            position: "absolute",
            right: 20,
            top: 50,
            zIndex: 2,
            borderStyle: "dashed",
            borderRadius: 0.5,
            borderWidth: 2,
            borderColor: "#FFF",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <TouchableOpacity
            onPress={onSwitchCamera}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 4,
              alignItems: "center",
            }}
          >
            <Image
              source={require("./images/camera_switch.png")}
              style={styles.iconSwitch}
            />
          </TouchableOpacity>
          <RTCView
            style={{
              width: "100%",
              height: "100%",
              zIndex: 3,
            }}
            zOrder={1}
            mirror={false}
            objectFit="cover"
            streamURL={localStream.toURL()}
          />
        </View>
      )
    );
  }, [localStream, isAnswerSuccess]);

  const partnerStream = useMemo(() => {
    return (
      remoteStreamURL && (
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1,
          }}
        >
          <RTCView
            style={{
              width: "100%",
              height: "100%",
              zIndex: 2,
              position: "absolute",
            }}
            zOrder={-1}
            mirror={false}
            objectFit="cover"
            streamURL={remoteStreamURL}
          />
        </View>
      )
    );
  }, [remoteStreamURL, isAnswerSuccess]);
  const toastMessage = useMemo(() => {
    return (
      state.showToast && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            paddingTop: 30,
            backgroundColor: "#00000090",
            paddingBottom: 10,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <Text style={{ color: "#FFF", fontSize: 16 }}>
            {state.toastMessage}
          </Text>
        </View>
      )
    );
  }, [state.showToast, state.toastMessage]);

  const connectedCall = useMemo(
    () =>
      isAnswerSuccess && (
        <View
          style={{ flex: 1, position: "relative", backgroundColor: "#6df7db" }}
        >
          {partnerStream}
          {myStream}
          {toastMessage}
          <View style={{ zIndex: 3, top: 300, alignItems: "center" }}>
            <Timer
              data={{
                mediaConnected: isAnswerSuccess,
              }}
              callingName={getCallingName()}
            />
          </View>
          {viewActionBottom}
        </View>
      ),
    [
      state.toastMessage,
      state.showToast,
      remoteStreamURL,
      localStream,
      isOfferReceiverd,
      isAnswerSuccess,
      state.isMuted,
      state.isSpeak,
      props.userId,
    ]
  );

  return (
    <Modal
      animated={true}
      animationType="slide"
      transparent={false}
      visible={state.isVisible}
    >
      <StatusBar translucent={true} backgroundColor={"transparent"} />
      {viewCalling}
      {connectedCall}
    </Modal>
  );
};

CallScreen.propTypes = {};

const styles = StyleSheet.create({
  icon: {
    height: 60,
    width: 60,
  },
  iconSwitch: {
    height: 40,
    width: 40,
  },
});

export default forwardRef(CallScreen);

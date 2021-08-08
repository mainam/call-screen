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
  const refState = useRef(null);
  const refCreateOfferOrAnswer = useRef(null);
  const refPendingCandidates = useRef([]);
  const refTimeoutCreateCalling = useRef(null);
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
  const refReceiverd = useRef(null);
  const refMakeCall = useRef(false);
  const refOfferData = useRef(null);
  const [localStream, setLocalStream] = useState(false);
  const [remoteStreamURL, setRemoteStreamURL] = useState(false);
  const [state, _setState] = useState({
    isMuted: false,
    isSpeak: true,
    isVisible: false,
    appState: AppState.currentState,
  });
  const setState = (data = {}) => {
    _setState((state) => {
      refState.current = {
        ...(refState.current ? refState.current : state),
        ...data,
      };
      return refState.current;
    });
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
  }, [state.isAnswerSuccess, state.appState]);

  const handleAppStateChange = (nextAppState) => {
    if (
      refAppState.current.match(/inactive|background/) &&
      nextAppState === "active"
    ) {
    }
    refAppState.current = nextAppState;
    setState({
      appState: nextAppState,
    });
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
    debugger;
    refPeer.current = peer;
    peer.onicecandidate = onICECandiate;
    peer.onaddstream = onAddStream;
    peer.onicegatheringstatechange = onICEGratherStateChange;
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
        if (!refReceiverd.current) {
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
  }, [state.appState, localStream, state.isAnswerSuccess, state.isVisible]);
  // useEffect(() => {
  //   const notification =
  //         new CallManager.firebase.notifications.Notification()
  //           .setNotificationId(stringUtils.guid())
  //           .setTitle("Cuộc gọi video call")
  //           .setBody("Nhấn vào đây để quay về cuộc gọi");
  //       new CallManager.firebase.notifications().displayNotification(
  //         notification
  //       );
  // }, [state.appState]);
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

  const onICEGratherStateChange = (e) => {
    switch (refPeer.current?.iceGatheringState) {
      case "complete":
        if (
          refPendingCandidates.current.length > 0 &&
          !refCreateOfferOrAnswer.current
        ) {
          if (refTimeoutCreateCalling.current) {
            clearTimeout(refTimeoutCreateCalling.current);
            refTimeoutCreateCalling.current = null;
          }
          onCreateCalling();
        }
        break;
    }
  };

  const onCreateCalling = () => {
    refCreateOfferOrAnswer.current = true;
    if (!refOffer.current) return;
    refOffer.current.sdp = BandwidthHandler.getSdp(refOffer.current.sdp);
    fetch(CallManager.host + "/api/call/calling/" + refCallId.current, {
      method: "PUT", // *GET, POST, PUT, DELETE, etc.
      headers: {
        "Content-Type": "application/json",
      }, // body data type must match "Content-Type" header

      body: JSON.stringify({
        userId: refUserId.current,
        ices: refPendingCandidates.current,
        offer: refOffer.current,
      }),
    })
      .then((s) => s.json())
      .then((s) => {
        switch (s?.code) {
          case 0:
            break;
          default:
            refCreateOfferOrAnswer.current = false;
            props.showMessage &&
              props.showMessage({ message: s.message, type: 0 });
        }
      })
      .catch((e) => {
        refCreateOfferOrAnswer.current = false;
        props.showMessage && props.showMessage({ message: e.message, type: 2 });
      });
  };

  const onICECandiate = (e) => {
    const { candidate } = e;
    if (candidate) {
      if (!refReceiverd.current) {
        refPendingCandidates.current.push(candidate);
        if (refTimeoutCreateCalling.current) {
          clearTimeout(refTimeoutCreateCalling.current);
        }
        refTimeoutCreateCalling.current = setTimeout(() => {
          onCreateCalling();
        }, 3000);
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
    console.log("nammn", "begin setRemoteStreamURL", e.stream);
    setRemoteStreamURL(e.stream.toURL());
    console.log("nammn", "end setRemoteStreamURL", e.stream);
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
    if (!state.isAnswerSuccess) onReject();
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
    if (refCallId.current || props.userId != data.data.to) {
      if (Platform.OS == "ios") {
        //mà device là ios thì tắt callkeep (androi không dùng callkeep) và đánh dấu reject trong appdelegate
        RNCallKeep.reportEndCallWithUUID(data.callId, 2);
        if (data.callId && VideoCallModule?.reject) {
          VideoCallModule.reject(data.callId);
        }
      }
      if (refCallId.current) {
        //nếu client đang handle 1 cuộc gọi khác
        refSocket.current.emit(constants.socket_type.LEAVE, {
          // gửi 1 emit lên server để báo bận
          callId: data.callId,
          userId: props.userId,
          type: constants.socket_type.BUSY,
        });
      } else {
        if (props.userId != data.data.to) {
          //nếu user của call <> với user đang dăng nhập thì reject cuộc gọi và emit event logout theo device id và useId
          refSocket.current.emit(constants.socket_type.LEAVE_AND_SIGNOUT, {
            // gửi 1 emit lên server để báo bận và remove token theo deviceId
            userId: data.data.to,
            deviceId: CallManager.deviceId,
          });
        }
      }
      return;
    }

    if (
      data.from == props.userId ||
      refIgnoreCallIds.current.includes(data.callId)
    ) {
      //nếu offer nhận được được thực hiện từ chính bạn thì bỏ qua
      return;
    }

    refOfferData.current = data;
    refCallId.current = data.callId;
    refReceiverd.current = true;
    if (Platform.OS == "ios") {
      // nếu là thiết bị ios thì hiển thị callkeep
      RNCallKeep.displayIncomingCall(data.callId, "", data.data.fromName);
    } //ngược lại với thiết bị android thì hiển thị chuông báo cuộc gọi đến
    else {
      incomingSound();
    }
    setState({ isVisible: true, isOfferReceiverd: true });
  };

  const onAnswer = (callUUid) => async () => {
    try {
      if (callUUid && refCallId.current != callUUid) return;
      setState({ isVisible: true, isAnswerSuccess: true });
      onTimeOut();

      const answer = () => {
        return new Promise(async (resolve, reject) => {
          refOffer.current = refOfferData.current?.offer; //lấy offer từ call data
          refCallingData.current = refOfferData.current?.data || {}; //lấy info cuộc gọi
          refCreateOfferOrAnswer.current = false; //đánh dấu là chưa tạo xong offer answer
          await setupWebRTC(); //setup webrtc và tạo peer
          if (!refPeer.current) {
            reject({ code: 1, message: "peer null" });
            return; //nếu peer tạo khôgn thành công thì return
          }
          await refPeer.current.setRemoteDescription(
            //setRemoteDescription từ remote offer, cần thực hiện trước khi add ice
            new RTCSessionDescription(refOffer.current)
          );
          refOfferData.current?.ices?.forEach((ice) => {
            //duyệt qua danh sách ice, add các ice vào local peer.
            refPeer.current.addIceCandidate(new RTCIceCandidate(ice));
          });
          if (refCallId.current && VideoCallModule?.reject) {
            //gọi lên native module để đánh dấu bỏ qua nếu sau này gặp phải callId này
            VideoCallModule.reject(refCallId.current);
          }
          const answer = await refPeer.current.createAnswer(); //sau khi RTCSessionDescription và add ice thì tiến hành tạo answer
          answer.sdp = BandwidthHandler.getSdp(answer.sdp);
          await refPeer.current.setLocalDescription(answer); //sau khi tạo xong answer thì set vào setLocalDescription
          sendMessage(constants.socket_type.ANSWER, {
            //đồng thời emit event tới socket server để đánh dấu là đã answer call này.
            callId: refCallId.current, //ở đây phải dùng socket emit để broadcast tới các connection khác reject call khi 1 user đã answer
            answer: answer, //trong emit này thì có đẩy answer lên cùng.
            userId: props.userId,
          });
          callPickUp();
          resolve(true);
        });
      };
      if (Platform.OS == "ios") {
        // nếu là ios thì endcall callkeep
        RNCallKeep.reportEndCallWithUUID(refCallId.current, 2);
        setTimeout(answer, 1000); //chờ khoảng 1s để callkeep tắt.
      } else {
        answer(); //ngược lại với android thì answer luôn.
      }
    } catch (error) {
      console.log(error);
    }
  };

  const onCandidate = async (data = {}) => {
    if (refPeer.current && data.callId == refCallId.current && data.ice) {
      // if (data.ice.sdp) { //không bao giờ xảy ra case này vì sdp offer gửi kèm từ emit offer answer
      //   await refPeer.current.setRemoteDescription(
      //     new RTCSessionDescription(data.ice)
      //   );
      // } else {
      setTimeout(
        (ice) => {
          refPeer.current &&
            refPeer.current.addIceCandidate(new RTCIceCandidate(ice));
        },
        3000,
        data.ice
      );
      // }
    }
  };
  const onAnswerReceived = async (data) => {
    onTimeOut();
    callPickUp();
    if (refPeer.current) {
      console.log("nammn", "offer: begin setRemoteDescription", data.answer);
      await refPeer.current.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
      console.log("nammn", "offer: end setRemoteDescription", data.answer);
      setState({
        isAnswerSuccess: true,
      });
    }
  };

  const onTimeOutPair = (data = {}) => {};

  const onLeave = (data = {}) => {
    refIgnoreCallIds.current.push(data.callId);
    if (refIgnoreCallIds.current.length > 10) {
      refIgnoreCallIds.current.shift();
    }

    if (data.callId == refCallId.current) {
      let reason = "";
      if (data.status && data.code == 1 && !state.isAnswerSuccess) {
        reason = "Máy bận";
      } else {
        reason = "Kết thúc cuộc gọi";
      }
      resetState();
      props.showMessage && props.showMessage({ message: reason, type: 0 });
    }
    if (data.callId && VideoCallModule?.reject) {
      VideoCallModule.reject(data.callId);
    }
  };

  const resetState = () => {
    stopSound();
    if (refCallId.current && VideoCallModule?.reject) {
      VideoCallModule.reject(refCallId.current);
    }
    if (refCallId.current) {
      if (Platform.OS == "ios")
        RNCallKeep.reportEndCallWithUUID(refCallId.current, 2);
    }

    if (refPeer.current) {
      refPeer.current.close();
      refPeer.current = null;
    }

    if (refTimeout.current) {
      clearTimeout(refTimeout.current);
      refTimeout.current = null;
    }

    refCallId.current = null;
    refCallingData.current = null;
    refPendingCandidates.current = [];
    refReceiverd.current = false;
    refCreateOfferOrAnswer.current = false;
    refOffer.current = null;
    refMakeCall.current = false;
    if (localStream) {
      try {
        if (localStream.getTracks)
          localStream.getTracks().forEach((track) => track.stop());
        if (localStream.getAudioTracks)
          localStream.getAudioTracks().forEach((track) => track.stop());
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
      isOfferReceiverd: false,
      isAnswerSuccess: false,
    });
  };

  const sendMessage = (type, msgObj) => {
    return new Promise((resolve, reject) => {
      if (refSocket.current) {
        refSocket.current.emit(type, msgObj, (data) => {
          resolve(data);
        });
      } else {
        const e = {
          code: "websocket_error",
          message: "WebSocket state:" + ws.readyState,
        };
        reject(e);
      }
    });
  };
  const onReject = () => {
    let type =
      state.isAnswerSuccess || refMakeCall.current
        ? constants.socket_type.LEAVE
        : constants.socket_type.REJECT;
    refSocket.current.emit(constants.socket_type.LEAVE, {
      userId: props.userId,
      callId: refCallId.current, // state.callId,
      type,
    });
    resetState();
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

  const buttonAcceptCall = state.isOfferReceiverd && !state.isAnswerSuccess && (
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
      state.isAnswerSuccess && (
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
    [state.isSpeak, state.isAnswerSuccess]
  );

  const buttonMute = useMemo(
    () =>
      state.isAnswerSuccess && (
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
    [state.isMuted, state.isAnswerSuccess]
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
    [
      state.isAnswerSuccess,
      state.isMuted,
      state.isSpeak,
      state.isOfferReceiverd,
    ]
  );

  const viewCalling = useMemo(
    () =>
      !state.isAnswerSuccess && (
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
    [localStream, state.isOfferReceiverd, state.isAnswerSuccess, props.userId]
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
  }, [localStream, state.isAnswerSuccess]);

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
  }, [remoteStreamURL, state.isAnswerSuccess]);
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
      state.isAnswerSuccess && (
        <View
          style={{ flex: 1, position: "relative", backgroundColor: "#6df7db" }}
        >
          {partnerStream}
          {myStream}
          {toastMessage}
          <View style={{ zIndex: 3, top: 300, alignItems: "center" }}>
            <Timer
              data={{
                mediaConnected: state.isAnswerSuccess,
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
      state.isOfferReceiverd,
      state.isAnswerSuccess,
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

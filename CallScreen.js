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
import ActionSheet from "react-native-actionsheet";

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
  const refLoginToken = useRef(null);
  const refUserId = useRef(null);
  const refPhoneNumber = useRef(null);
  const refActionSheet = useRef(null);
  const refState = useRef(null);
  const refCreateCalling = useRef(null);
  const refPendingCandidates = useRef([]);
  const refTimeoutCreateCalling = useRef(null);
  const refTimeOutToast = useRef(null);
  const refCallId = useRef(null);
  const refOffer = useRef(null);
  const refPeer = useRef(null);
  const refSocket = useRef(null);
  const refConnected = useRef(null);
  const refSettingCallKeep = useRef(null);
  const refDeviceToken = useRef(null);
  const refCallingData = useRef(null);
  const refIgnoreCallIds = useRef([]);
  const refAppState = useRef(AppState.currentState);
  const refTimeout = useRef(null);
  const refReceiverd = useRef(null);
  const refMakeCall = useRef(false);
  const refOfferData = useRef(null);
  const [localStream, setLocalStream] = useState(false);
  const refLocalStream = useRef(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState(false);
  const [isDisableVideo, setDisableVideo] = useState(false);
  const [isMuted, setMuted] = useState(false);
  const [isPartnerTurnOfVideo, setPartnerTurnOfVideo] = useState(false);
  const [isPartnerMuted, setPartnerMute] = useState(false);
  const [state, _setState] = useState({
    isSpeak: true,
    isVisible: false,
    appState: AppState.currentState,
    isFullPartner: false,
  });
  const setState = (data = {}) => {
    _setState((state) => {
      refState.current = {
        ...(refState.current ? refState.current : state),
        ...data,
      };
      return { ...refState.current };
    });
  };
  useEffect(() => {
    addEventCallKeep();
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
    refPhoneNumber.current = props.phone;
  }, [props.phone]);
  useEffect(()=>{ //khi c?? th??ng tin ????ng nh???p th?? th???c hi???n k???t n???i t???i socket server
    refUserId.current = props.userId;
    refLoginToken.current = props.loginToken;
    if (refUserId.current && refLoginToken.current) {
      onConnectSocket();
    }
  },[props.loginToken, props.userId])
  useEffect(() => {
    if (!state.isVisible) {
      resetState();
    }
  }, [state.isVisible]);
  useImperativeHandle(ref, () => ({
    startCall,
  }));
  useEffect(() => {
    if (!props.userId && refConnected.current && refSocket.current) { //n???u ch??a ????ng nh???p m?? ???? k???t n???i t???i server socket
      refSocket.current?.emit( //th?? th???c hi???n disconnect t???i server socket
        constants.socket_type.DISCONNECT,
        { token: refDeviceToken.current, platform: Platform.OS },
        (data) => {
          refSocket.current.disconnect(); 
          refSocket.current = null;
          refConnected.current =false;
        }
      );
    }
  }, [props.userId]);

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
  const rnCallKeepEndCall = (callId, status) => {
    if (!callId) return;
    else RNCallKeep.reportEndCallWithUUID(callId, status);
  };
  useEffect(() => {
    showNotice({
      message:
        "N???u g???p ph???i t??nh tr???ng m???t ti???ng, hay m???t h??nh. Vui l??ng th???c hi???n l???i cu???c g???i kh??c",
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
      if (refUserId.current == refCallingData.current.from) {
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
    soundUtils.play("call_phone.mp3"); //b???t ??m thanh ??ang ch??? b???t m??y
  };
  const stopSound = () => {
    soundUtils.stop();
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.stop();
    Vibration.cancel();
  };

  const callPickUp = () => {
    if (refMakeCall.current) {
      soundUtils.stop();
    }
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
  const getStatusFromStream = (stream) => {
    let isMuted = !(
      stream.getAudioTracks && stream?.getAudioTracks()[0]?.enabled
    );
    let isDisableVideo = !(
      stream.getVideoTracks && stream?.getVideoTracks()[0]?.enabled
    );
    return { isMuted, isDisableVideo };
  };

  const setupWebRTC = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await initLocalVideo();
        refLocalStream.current = stream;
        setLocalStream(stream);
        const peer = createPeer();
        const { isMuted, isDisableVideo } = getStatusFromStream(stream);
        setDisableVideo(isDisableVideo);
        setMuted(isMuted);
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

  const startCall = async ({
    from,
    fromName,
    to,
    toName,
    bookingId,
    hospitalId,
    hospitalName,
  } = {}) => {
    try {
      fetch(CallManager.host + "/api/call/create-call?force=true", {
        method: "POST", // *GET, POST, PUT, DELETE, etc.
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          fromName,
          to,
          toName,
          bookingId,
          hospitalId,
          hospitalName,
          groups: [
            {
              id: from,
              name: fromName,
              phone: refPhoneNumber.current,
              deviceInfo: CallManager.deviceInfo,
              swVersion: require('./package.json').version,
            },
            {
              id: to,
              name: toName,
            },
          ],
        }), // body data type must match "Content-Type" header
      })
        .then((s) => s.json())
        .then(async (s) => {
          switch (s?.code) {
            case 0:
              refMakeCall.current = true;
              refCallingData.current = s.data.call?.data || {};
              refCallId.current = s.data.call?.callId;
              refCreateCalling.current = false; //danh d???u l?? ch??a th???c hi???n cu???c g???i
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
  const refreshMyVideo = () => {
    if (
      refLocalStream.current?.getVideoTracks &&
      refLocalStream.current?.getVideoTracks()?.length
    ) {
      refLocalStream.current?.getVideoTracks().forEach((tract) => {
        try {
          track.enabled = false;
          track.enabled = true;
          track._switchCamera();
          track._switchCamera();
        } catch (error) {}
      });
    }
    if (
      refLocalStream.current?.getVideoTracks &&
      refLocalStream.current?.getVideoTracks()?.length
    ) {
      refLocalStream.current?.getVideoTracks().forEach((tract) => {
        try {
          track.enabled = false;
          track.enabled = true;
        } catch (error) {}
      });
    }
  };
  useEffect(() => {
    setTimeout(async () => {
      if (Platform.OS == "ios") {
        refreshMyVideo();
      }
    }, 2000);
  }, [state.appState, localStream, state.isAnswerSuccess, state.isVisible]);

  useEffect(() => {
    //t??? ?????ng turn off video khi app inactive
    if (refCallId.current) {
      if (state.appState != "active") {
        sendMessage(constants.socket_type.TURN_OFF_VIDEO, {
          userId: refUserId.current,
          callId: refCallId.current,
          status: true,
        });
      } else {
        sendMessage(constants.socket_type.TURN_OFF_VIDEO, {
          userId: refUserId.current,
          callId: refCallId.current,
          status: isDisableVideo,
        });
      }
    }
  }, [state.appState]);

  const onTimeOut = () => {
    refTimeout.current = setTimeout(() => {
      onReject();
    }, 30 * 60 * 1000);
  };

  const onToggle = (type) => () => {
    let tracks = null;
    switch (type) {
      case "video":
        tracks = refLocalStream.current?.getVideoTracks
          ? refLocalStream.current?.getVideoTracks()
          : [];
        if (tracks?.length) {
          const isEnabled = !tracks[0].enabled;
          tracks.forEach((track) => {
            track.enabled = isEnabled;
          });
          setDisableVideo(!isEnabled);
          sendMessage(constants.socket_type.TURN_OFF_VIDEO, {
            userId: refUserId.current,
            callId: refCallId.current,
            status: !isEnabled,
          });
        }
        break;
      case "mute":
        tracks = refLocalStream.current?.getAudioTracks
          ? refLocalStream.current?.getAudioTracks()
          : [];
        if (tracks?.length) {
          const isEnabled = !tracks[0].enabled;
          tracks.forEach((track) => {
            track.enabled = isEnabled;
          });
          setMuted(!isEnabled);
          sendMessage(constants.socket_type.TURN_OFF_AUDIO, {
            userId: refUserId.current,
            callId: refCallId.current,
            status: !isEnabled,
          });
        }
        break;
      case "speak":
        const newValue = !state.isSpeak;
        setState({
          isSpeak: newValue,
        });
        InCallManager.setForceSpeakerphoneOn(newValue);
        break;
      case "camera":
        if (refLocalStream.current?.getVideoTracks) {
          refLocalStream.current
            ?.getVideoTracks()
            .forEach((track) => track._switchCamera());
        }
        break;
      case "showMore":
        refActionSheet.current && refActionSheet.current.show();
        break;
      case "fullPartner":
        setState({
          isFullPartner: !state.isFullPartner,
        });
        break;
      case "refreshMyVideo":
        refreshMyVideo();
        break;
    }
  };

  const onICEGratherStateChange = (e) => {
    switch (refPeer.current?.iceGatheringState) {
      case "complete": //khi ice ???? chuy???n tr???ng th??i sang complete
        if (
          //ki???m tra danh s??ch candidate c?? kh??ng.
          refPendingCandidates.current.length > 0
        ) {
          if (!refCreateCalling.current) {
            //ki???m tra xem ???? th???c hi???n cu???c g???i ch??a. n???u ch??a th?? th???c hi???n, n???u r???i th?? b??? qua kh??ng th???c hi???n n???a
            if (refTimeoutCreateCalling.current) {
              //ki???m tra xem c?? time out cu???c g???i n??o kh??ng. n???u c?? th?? clear timeout
              clearTimeout(refTimeoutCreateCalling.current);
              refTimeoutCreateCalling.current = null;
            }
            onCreateCalling(); //th???c hi???n cu???c g???i
          }
        } else {
          // if(refFinishAnswer.current) //ki???m tra xem ???? th???c hi???n finish answer ch??a.
          // {
          //   if (refTimeoutFinishAnswer.current) { //ki???m tra xem c?? time out finish answer n??o kh??ng. n???u c?? th?? clear timeout
          //     clearTimeout(refTimeoutFinishAnswer.current);
          //     refTimeoutFinishAnswer.current = null;
          //   }
          // }
          // onFinishAnswer(); //th???c hi???n finish answer
        }
        break;
    }
  };

  const onCreateCalling = () => {
    if (!refOffer.current) return; //n???u ch??a t???o ???????c offer th?? b??? qua.
    refCreateCalling.current = true; //khi th???c hi???n cu???c g???i th?? ????nh d???u l?? ???? th???c hi???n cu???c g???i ????? cancel nh???ng request kh??c.
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
        refPendingCandidates.current = []; //sau khi t???o calling xong th?? clear danh s??ch candidate lu??n, v?? c??ng kh??ng d??ng ?????n n???a.
        switch (s?.code) {
          case 0:
            break;
          default:
            refCreateCalling.current = false; //ng?????c l???i n???u c?? error th?? ????nh d???u l?? ch??a t???o xong calling.
            props.showMessage &&
              props.showMessage({ message: s.message, type: 0 });
        }
      })
      .catch((e) => {
        refPendingCandidates.current = []; //sau khi t???o offer xong th?? clear danh s??ch candidate lu??n.
        refCreateCalling.current = false;
        props.showMessage && props.showMessage({ message: e.message, type: 2 });
      });
  };

  const onSocketCandidate = async (data = {}) => {
    if (refPeer.current && data.callId == refCallId.current && data.ice) {
      //sau khi nh???n dc ice t??? partner th?? s??? add v??o danh s??ch pending candidas
      refPendingCandidates.current.push(data.ice);
      if (refPeer.current.remoteDescription) {
        //ki???m tra xem peer ???? add xong remote description ch??a
        //n???u ???? add xong r???i th?? ti???n h??nh add c??c pending remote ic g???i t??? partner
        addRemoteICE();
      }
    }
  };
  const onICECandiate = (e) => {
    const { candidate } = e;
    if (candidate) {
      if (refReceiverd.current) {
        //n???u l?? ng?????i nh???n
        sendMessage(constants.socket_type.CANDIDATE, {
          //sau khi l???y dc candidate xong th?? emit l??n server socket ????? b???n sang ng?????i g???i lu??n
          userId: refUserId.current,
          ice: candidate,
          callId: refCallId.current,
        });
      } else {
        //ng?????c l???i n???u l?? ng?????i g???i
        refPendingCandidates.current.push(candidate); //th?? th??m c??c candidate v??o list
        if (refTimeoutCreateCalling.current)
          // ?????ng th???i n???u c?? 1 timeout ????? th???c hi???n cu???c g???i th?? cancel timeout ?????y ??i
          clearTimeout(refTimeoutCreateCalling.current);
      }
      refTimeoutCreateCalling.current = setTimeout(() => {
        //?????ng th???i set 1 timeout m???i ????? th???c hi???n cu???c g???i
        onCreateCalling();
      }, 2000);
    }
  };

  const onAddStream = (e) => {
    setRemoteStreamURL(e.stream.toURL());
    setTimeout(() => {
      //sau khi ???? c?? remote stream th?? b???t ?????u ph??t loa cu???c g???i
      callPickUp();
    }, 1000);
  };

  const onCallKeepAnswer = ({ callUUID }) => {
    if (refAppState.current.match(/inactive|background/)) {
      setState({ isVisible: true });
    } else {
      if (Platform.OS == "ios") rnCallKeepEndCall(callUUID, 2);
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
  const onSocketOffer = async (data = {}) => {
    if (refCallId.current || refUserId.current != data.data.to) {
      if (Platform.OS == "ios") {
        //m?? device l?? ios th?? t???t callkeep (androi kh??ng d??ng callkeep) v?? ????nh d???u reject trong appdelegate
        rnCallKeepEndCall(data.callId, 2);
        if (data.callId && VideoCallModule?.reject) {
          VideoCallModule.reject(data.callId);
        }
      }
      if (refCallId.current) {
        //n???u client ??ang handle 1 cu???c g???i kh??c
        refSocket.current.emit(constants.socket_type.LEAVE, {
          // g???i 1 emit l??n server ????? b??o b???n
          callId: data.callId,
          userId: refUserId.current,
          type: constants.socket_type.BUSY,
        });
      } else {
        if (refUserId.current != data.data.to) {
          //n???u user c???a call <> v???i user ??ang d??ng nh???p th?? reject cu???c g???i v?? emit event logout theo device id v?? useId
          refSocket.current.emit(constants.socket_type.LEAVE_AND_SIGNOUT, {
            // g???i 1 emit l??n server ????? b??o b???n v?? remove token theo deviceId
            userId: data.data.to,
            deviceId: CallManager.deviceInfo?.deviceId,
          });
        }
      }
      return;
    }

    if (
      data.from == refUserId.current ||
      refIgnoreCallIds.current.includes(data.callId)
    ) {
      //n???u offer nh???n ???????c ???????c th???c hi???n t??? ch??nh b???n th?? b??? qua
      return;
    }

    refOfferData.current = data; // gi??? l???i th??ng tin cu???c g???i
    refCallingData.current = data.data || {}; // gi??? l???i th??ng tin user trong cu???c g???i
    refCallId.current = data.callId; //gi??? l???i callId
    refReceiverd.current = true; //????nh d???u l?? ???? nh???n cu???c g???i
    if (Platform.OS == "ios") {
      // n???u l?? thi???t b??? ios th?? hi???n th??? callkeep
      RNCallKeep.displayIncomingCall(data.callId, "", data.data.fromName);
    } //ng?????c l???i v???i thi???t b??? android th?? hi???n th??? chu??ng b??o cu???c g???i ?????n
    else {
      incomingSound();
    }
    setState({ isVisible: true, isReceiverd: true }); //khi cu???c g???i ?????n th?? hi???n thi lu??n m??n h??nh cu???c g???i
  };

  const getCallData = ({ callId }) => {
    return new Promise((resolve, reject) => {
      fetch(CallManager.host + "/api/call/" + callId, {
        method: "GET", // *GET, POST, PUT, DELETE, etc.
        headers: {
          "Content-Type": "application/json",
        }, // body data type must match "Content-Type" header
      })
        .then((s) => s.json())
        .then(async (s) => {
          switch (s?.code) {
            case 0:
              resolve(s.data);
              break;
            default:
              props.showMessage &&
                props.showMessage({ message: s.message, type: 0 });
              resolve(null);
          }
        })
        .catch((e) => {
          props.showMessage &&
            props.showMessage({ message: e?.message, type: 2 });
          resolve(null);
        });
    });
  };

  const onAnswer = (callId) => async () => {
    try {
      if (!refOfferData.current) {
        // n???u nh???n t??? callkeep m?? trong app ch??a c?? th??ng tin cu???c g???i
        if (!callId) {
          rnCallKeepEndCall(callId, 2); //th?? th???c hi???n endcall callkeep
          setState({ isVisible: false }); // t???t popup call
          return;
        }
        const data = await getCallData({ callId: callId }); // th?? th???c hi???n g???i l??n server ????? l???y th??ng tin cu???c g???i
        refOfferData.current = data;
        if (!refOfferData.current) {
          //n???u v???n kh??ng l???y ??c th??ng tin cu???c g???i
          rnCallKeepEndCall(callId, 2); //th?? th???c hi???n endcall callkeep
          setState({ isVisible: false }); // t???t popup call
        }
        refCallingData.current = data.data || {}; // gi??? l???i th??ng tin user trong cu???c g???i
        refCallId.current = data.callId; //gi??? l???i callId
        refReceiverd.current = true; //????nh d???u l?? ???? nh???n cu???c g???i
      }
      if (callId && refCallId.current != callId) {
        rnCallKeepEndCall(callId, 2); //th?? th???c hi???n endcall callkeep
        return;
      }

      setState({ isVisible: true, isAnswerSuccess: true });
      onTimeOut();

      const answer = () => {
        return new Promise(async (resolve, reject) => {
          stopSound();
          refOffer.current = refOfferData.current?.offer; //l???y offer t??? call data
          refCallingData.current = refOfferData.current?.data || {}; //l???y info cu???c g???i
          refCreateCalling.current = false; //????nh d???u l?? ch??a t???o xong offer answer
          await setupWebRTC(); //setup webrtc v?? t???o peer
          if (!refPeer.current) {
            reject({ code: 1, message: "peer null" });
            return; //n???u peer t???o kh??gn th??nh c??ng th?? return
          }
          await refPeer.current.setRemoteDescription(
            //setRemoteDescription t??? remote offer, c???n th???c hi???n tr?????c khi add ice
            new RTCSessionDescription(refOffer.current)
          );
          refOfferData.current?.ices?.forEach((ice) => {
            //duy???t qua danh s??ch ice, add c??c ice v??o local peer.
            refPeer.current.addIceCandidate(new RTCIceCandidate(ice));
          });
          if (refCallId.current && VideoCallModule?.reject) {
            //g???i l??n native module ????? ????nh d???u b??? qua n???u sau n??y g???p ph???i callId n??y
            VideoCallModule.reject(refCallId.current);
          }
          const answer = await refPeer.current.createAnswer(); //sau khi RTCSessionDescription v?? add ice th?? ti???n h??nh t???o answer
          answer.sdp = BandwidthHandler.getSdp(answer.sdp);
          await refPeer.current.setLocalDescription(answer); //sau khi t???o xong answer th?? set v??o setLocalDescription
          sendMessage(constants.socket_type.ANSWER, {
            //?????ng th???i emit event t???i socket server ????? ????nh d???u l?? ???? answer call n??y.
            callId: refCallId.current, //??? ????y ph???i d??ng socket emit ????? broadcast t???i c??c connection kh??c reject call khi 1 user ???? answer
            answer: answer, //trong emit n??y th?? c?? ?????y answer l??n c??ng.
            userId: refUserId.current,
            myInfo: {
              id: refUserId.current,
              deviceInfo: CallManager.deviceInfo,
              phone: refPhoneNumber.current,
              swVersion: require('./package.json').version,
            },
          });
          resolve(true);
        });
      };
      if (Platform.OS == "ios") {
        // n???u l?? ios th?? endcall callkeep
        rnCallKeepEndCall(refCallId.current, 2);
        setTimeout(answer, 1000); //ch??? kho???ng 1s ????? callkeep t???t.
      } else {
        answer(); //ng?????c l???i v???i android th?? answer lu??n.
      }
    } catch (error) {
      rnCallKeepEndCall(refCallId.current || callId, 2);
      console.log(error);
    }
  };

  const addRemoteICE = () => {
    console.log("addRemoteICE");
    if (refPeer.current)
      refPendingCandidates.current.forEach((item) => {
        if (item && !item.added) {
          item.aded = true;
          refPeer.current.addIceCandidate(new RTCIceCandidate(item));
        }
      });
  };

  const onSocketAnswer = async (data) => {
    onTimeOut();
    if (refPeer.current) {
      await refPeer.current.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
      console.log("RTCSessionDescription");
      //sau khi nh???n cu???c g???i xong th?? ti???n h??nh add remote ice v??o peer
      addRemoteICE();
      setState({
        isAnswerSuccess: true,
      });
    }
  };

  const onTurnOffAudio = async (data = {}) => {
    if (refCallId.current) {
      const { audio = [], callId } = data;
      if (callId == refCallId.current) {
        const partnerSetting = audio.find(
          (item) => item.userId != refUserId.current
        );
        setPartnerMute(partnerSetting?.mute);
      }
    }
  };

  const onTurnOffVideo = async (data = {}) => {
    if (refCallId.current) {
      const { video = [], callId } = data;
      if (callId == refCallId.current) {
        const partnerSetting = video.find(
          (item) => item.userId != refUserId.current
        );
        setPartnerTurnOfVideo(partnerSetting?.disable);
      }
    }
  };

  const onSocketTimeOutPair = (data = {}) => {};

  const onLeave = (data = {}) => {
    refIgnoreCallIds.current.push(data.callId);
    if (refIgnoreCallIds.current.length > 10) {
      refIgnoreCallIds.current.shift();
    }

    if (data.callId == refCallId.current) {
      let reason = "";
      if (data.status && data.code == 1 && !state.isAnswerSuccess) {
        reason = "M??y b???n";
      } else {
        reason = "K???t th??c cu???c g???i";
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
      if (Platform.OS == "ios") rnCallKeepEndCall(refCallId.current, 2);
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
    refCreateCalling.current = false;
    refOffer.current = null;
    refMakeCall.current = false;
    if (refLocalStream.current) {
      try {
        if (refLocalStream.current.getTracks)
          refLocalStream.current.getTracks().forEach((track) => track.stop());
        if (refLocalStream.current.getAudioTracks)
          refLocalStream.current
            .getAudioTracks()
            .forEach((track) => track.stop());
        if (refLocalStream.current.getVideoTracks)
          refLocalStream.current
            .getVideoTracks()
            .forEach((track) => track.stop());
        refLocalStream.current.release();
      } catch (error) {}
    }
    setLocalStream(null);
    refLocalStream.current = null;
    setRemoteStreamURL(null);
    setDisableVideo(false);
    setMuted(false);
    setPartnerTurnOfVideo(false);
    setPartnerMute(false);
    setState({
      isSpeak: true,
      isFullPartner: false,
      isVisible: false,
      isReceiverd: false,
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
      userId: refUserId.current,
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
            alertTitle: "Th??ng b??o",
            alertDescription: "Cho ph??p iSofHcare truy c???p cu???c g???i c???a b???n",
            cancelButton: "Hu???",
            okButton: "?????ng ??",
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
      if (refConnected.current) return; // n???u ???? connect r???i th?? b??? qua
      refConnected.current = true; //????nh d???u l?? ???? connect
      if (Platform.OS == "ios") {
        setupCallKeep();
        VoipPushNotification.requestPermissions();
        VoipPushNotification.addEventListener("register", (token) => {
          refDeviceToken.current = token;
          onRegisterToken(token);
        });
        VoipPushNotification.registerVoipToken();
      } else {
        const token = await CallManager.firebase.messaging().getToken();
        refDeviceToken.current = token;
        onRegisterToken(token);
      }
    } catch (error) {
      console.log(error);
    }
  };
  const onRegisterToken = (token) => {
    refSocket.current &&
      refSocket.current.emit(constants.socket_type.CONNECT, {
        token,
        id: refUserId.current,
        userId: refUserId.current,
        platform: Platform.OS,
        deviceId: CallManager.deviceInfo?.deviceId,
        deviceInfo: CallManager.deviceInfo,
        swVersion: require('./package.json').version,
        packageName: CallManager.packageName,
        fullName: props.fullName,
      });
  };
  const onConnectSocket = () => {
    if (refLoginToken.current && refUserId.current && !refSocket.current) {
      //ki???m tra khi n??o c?? userId v?? loginToken
      refSocket.current = props.io.connect(CallManager.host, {
        transports: ["websocket"],
        query: {
          token: refLoginToken.current, //verify socket io v???i login token,
          userId: refUserId.current,
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
      refSocket.current.on(constants.socket_type.CANDIDATE, onSocketCandidate);
      refSocket.current.on(
        constants.socket_type.TIMEOUT_PAIR,
        onSocketTimeOutPair
      );
      refSocket.current.on(constants.socket_type.OFFER, onSocketOffer);
      refSocket.current.on(constants.socket_type.ANSWER, onSocketAnswer);
      refSocket.current.on(
        constants.socket_type.TURN_OFF_VIDEO,
        onTurnOffVideo
      );
      refSocket.current.on(
        constants.socket_type.TURN_OFF_AUDIO,
        onTurnOffAudio
      );
      refSocket.current.on(constants.socket_type.LEAVE, onLeave);
      refSocket.current.connect();
    }
  };

  const buttonEndCall = (
    <View style={styles.btnAction}>
      <TouchableOpacity onPress={onReject} style={styles.btnStyle}>
        <Image source={require("./images/end_call.png")} style={styles.icon} />
      </TouchableOpacity>
    </View>
  );

  const buttonAcceptCall = state.isReceiverd && !state.isAnswerSuccess && (
    <View style={styles.btnAction}>
      <TouchableOpacity onPress={onAnswer()} style={styles.btnStyle}>
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
        <View style={styles.btnAction}>
          <TouchableOpacity
            onPress={onToggle("showMore")}
            style={styles.btnStyle}
          >
            <Image
              source={require("./images/ic-more.png")}
              style={styles.icon}
            />
          </TouchableOpacity>
        </View>
      ),
    [state.isSpeak, state.isAnswerSuccess]
  );

  const buttonMute = useMemo(
    () =>
      state.isAnswerSuccess && (
        <View style={styles.btnAction}>
          <TouchableOpacity onPress={onToggle("mute")} style={styles.btnStyle}>
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
        </View>
      ),
    [isMuted, state.isAnswerSuccess]
  );

  const buttonDisableVideo = useMemo(
    () =>
      state.isAnswerSuccess && (
        <View style={styles.btnAction}>
          <TouchableOpacity onPress={onToggle("video")} style={styles.btnStyle}>
            {isDisableVideo ? (
              <Image
                source={require("./images/disable-camera.png")}
                style={styles.icon}
              />
            ) : (
              <Image
                source={require("./images/enable-camera.png")}
                style={styles.icon}
              />
            )}
          </TouchableOpacity>
        </View>
      ),
    [isDisableVideo, state.isAnswerSuccess]
  );

  const viewActionBottom = useMemo(
    () => (
      <View style={styles.viewActionBottom}>
        {buttonDisableVideo}
        {buttonMute}
        {buttonAcceptCall}
        {buttonEndCall}
        {buttonSpeaker}
      </View>
    ),
    [
      state.isAnswerSuccess,
      isDisableVideo,
      isMuted,
      state.isSpeak,
      state.isReceiverd,
    ]
  );

  const viewCalling = useMemo(
    () =>
      !state.isAnswerSuccess && (
        <View style={styles.callingScreen}>
          {localStream && (
            <RTCView
              style={styles.rtcFullScreen}
              zOrder={-1}
              mirror={false}
              objectFit="cover"
              streamURL={localStream.toURL()}
            />
          )}
          <View style={styles.centerView}>
            <View style={styles.avatarView}>
              <Image source={CallManager.userAvatar} style={styles.avatar} />
            </View>
            {refMakeCall.current && (
              <Text style={styles.calling}>??ang g???i</Text>
            )}
            <Text style={styles.callInfo}>{getCallingName()}</Text>
            {!refMakeCall.current && (
              <Text style={styles.calling}>??ang g???i cho b???n</Text>
            )}
          </View>
          {viewActionBottom}
        </View>
      ),
    [localStream, state.isReceiverd, state.isAnswerSuccess, props.userId]
  );

  const myStream = useMemo(() => {
    return (
      localStream && (
        <View style={styles.viewMyStream}>
          {!isDisableVideo ? (
            <>
              <TouchableOpacity
                onPress={onToggle("camera")}
                style={styles.btnSwitchCamera}
              >
                <Image
                  source={require("./images/camera_switch.png")}
                  style={styles.iconSwitch}
                />
              </TouchableOpacity>
              <RTCView
                style={styles.rtcMyStream}
                zOrder={1}
                mirror={false}
                objectFit="cover"
                streamURL={localStream?.toURL()}
              />
            </>
          ) : (
            <View style={styles.viewMyStreamEmpty}>
              <Text style={styles.tipTurnOfVideo}>
                B???n kh??ng chia s??? h??nh ???nh
              </Text>
            </View>
          )}
        </View>
      )
    );
  }, [localStream, state.isAnswerSuccess, isDisableVideo]);

  const partnerStream = useMemo(() => {
    return (
      remoteStreamURL && (
        <View style={styles.viewPartnerStream}>
          {!isPartnerTurnOfVideo ? (
            <RTCView
              style={styles.rtcPartnerStream}
              zOrder={-1}
              mirror={false}
              objectFit="cover"
              streamURL={remoteStreamURL}
            />
          ) : (
            <View style={styles.rtcPartnerStreamEmpty}>
              <Text style={styles.tipPartnerTurnOfVideo}>
                {getCallingName() + " ??ang kh??ng chia s??? h??nh ???nh"}
              </Text>
            </View>
          )}
        </View>
      )
    );
  }, [
    remoteStreamURL,
    state.isAnswerSuccess,
    isPartnerTurnOfVideo,
    isPartnerMuted,
  ]);
  const toastMessage = useMemo(() => {
    return (
      state.showToast && (
        <View style={styles.toastView}>
          <Text style={styles.toastContent}>{state.toastMessage}</Text>
        </View>
      )
    );
  }, [state.showToast, state.toastMessage]);

  const connectedCall = useMemo(
    () =>
      state.isAnswerSuccess && (
        <View style={styles.connectedScreen}>
          {partnerStream}
          {!state.isFullPartner && myStream}
          {toastMessage}
          <View
            style={[styles.timerView, { top: state.isFullPartner ? 50 : 300 }]}
          >
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
      state.isReceiverd,
      state.isAnswerSuccess,
      isDisableVideo,
      isMuted,
      state.isSpeak,
      props.userId,
      state.isFullPartner,
      isPartnerTurnOfVideo,
      isPartnerMuted,
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

      <ActionSheet
        title={"L???a ch???n kh??c"}
        ref={refActionSheet}
        options={[
          state.isSpeak ? "T???t loa ngo??i" : "B???t loa ngo??i",
          state.isFullPartner ? "Hi???n th??ng tin c???a t??i" : "M??? r???ng m??n h??nh",
          "L??m m???i camera c???a t??i",
          "Hu???",
        ]}
        cancelButtonIndex={3}
        destructiveButtonIndex={3}
        onPress={(index) => {
          switch (index) {
            case 0:
              onToggle("speak")();
              break;
            case 1:
              onToggle("fullPartner")();
              break;
            case 2:
              onToggle("refreshMyVideo")();
              break;
          }
        }}
      />
    </Modal>
  );
};

CallScreen.propTypes = {};

const styles = StyleSheet.create({
  btnAction: { flex: 1, alignItems: "center" },
  viewActionBottom: {
    position: "absolute",
    bottom: 0,
    display: "flex",
    flexDirection: "row",
    zIndex: 4,
    backgroundColor: "#00000080",
    margin: 20,
    borderRadius: 20,
  },
  callingScreen: { flex: 1, position: "relative", backgroundColor: "#3e3e3e" },
  connectedScreen: {
    flex: 1,
    position: "relative",
    backgroundColor: "#3e3e3e",
  },
  timerView: { zIndex: 3, alignItems: "center" },
  callInfo: {
    marginTop: 30,
    fontSize: 25,
    color: "#FFF",
    fontWeight: "700",
  },
  calling: { fontSize: 15, color: "#FFF" },
  avatarView: {
    width: 120,
    height: 120,
    borderWidth: 2,
    borderColor: "#FFF",
    borderRadius: 110,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 50,
  },
  avatar: { width: 100, height: 100 },
  centerView: {
    position: "absolute",
    top: 100,
    alignItems: "center",
    left: 0,
    right: 0,
  },
  rtcFullScreen: { width: "100%", height: "100%" },
  viewMyStream: {
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
  },
  viewMyStreamEmpty: {
    width: "100%",
    height: "100%",
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF20",
  },
  btnSwitchCamera: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
    alignItems: "center",
  },
  rtcMyStream: {
    width: "100%",
    height: "100%",
    zIndex: 3,
  },
  tipTurnOfVideo: { color: "#FFF", textAlign: "center" },
  icon: {
    height: 60,
    width: 60,
  },
  viewPartnerStream: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  rtcPartnerStream: {
    width: "100%",
    height: "100%",
    zIndex: 2,
    position: "absolute",
  },
  rtcPartnerStreamEmpty: {
    width: "100%",
    height: "100%",
    zIndex: 2,
    backgroundColor: "#3e3e3e",
    position: "absolute",
    justifyContent: "flex-end",
    alignContent: "flex-end",
  },
  tipPartnerTurnOfVideo: {
    color: "#fff",
    marginBottom: 150,
    textAlign: "center",
  },
  iconSwitch: {
    height: 40,
    width: 40,
  },
  btnStyle: { padding: 10, flex: 1 },
  toastView: {
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
  },
  toastContent: { color: "#FFF", fontSize: 16 },
});

export default forwardRef(CallScreen);

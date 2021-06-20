import React from "react";
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
  Text,
  Dimensions,
  StatusBar,
  Image,
  Modal,
  Vibration,
} from "react-native";
import InCallManager from "react-native-incall-manager";
import constants from "./constants";
import VoipPushNotification from "react-native-voip-push-notification";
import RNCallKeep from "react-native-callkeep";
// import Timer from "./Timer";
import soundUtils from "./utils/sound-utils";
import BandwidthHandler from "./BandwidthHandler";
import stringUtils from "mainam-react-native-string-utils";
import CallManager from "./CallManager";
const { height } = Dimensions.get("screen");

const ONE_SECOND_IN_MS = 1000;

const PATTERN = [
  1 * ONE_SECOND_IN_MS,
  2 * ONE_SECOND_IN_MS,
  3 * ONE_SECOND_IN_MS,
];
const isFront = true; // Use Front camera?

class CallScreen extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      pendingCandidates: [],
      isCamFront: true,
      isVisible: false,
      isAnswerSuccess: false,
      makeCall: false,
      isSpeak: true,
    };
    this.refCallId = React.createRef();
    this.refOffer = React.createRef();
    this.refPeer = React.createRef();
    this.refSocket = React.createRef();
    this.refCandidates = React.createRef();
    this.refLocalStream = React.createRef();
    this.refConnected = React.createRef();
    this.refSettingCallKeep = React.createRef();
    this.refDeviceToken = React.createRef();
    this.refCallingParter = React.createRef();
    this.refCallingData = React.createRef();
  }

  getCallingName = () => {
    if (this.refCallingData.current)
    {
      if ((this.props.userId == this.refCallingData.current.from)) {
        return this.refCallingData.current.toName;
      } else {
        return this.refCallingData.current.fromName;
      }
    }
    else return "";
  };

  render() {
    const {
      remoteStreamURL,
      callStatus,
      isAnswerSuccess,
      isVisible,
      makeCall,
      isCamFront,
      localStreamURL,
      isSpeak,
      isOfferReceiverd,
      isMuted,
    } = this.state;
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
          <View style={[styles.groupLocalSteam]}>
            {localStreamURL && (
              <RTCView
                style={[styles.rtc]}
                zOrder={1}
                mirror={isCamFront}
                streamURL={localStreamURL}
              />
            )}
            <TouchableOpacity
              onPress={this.onSwitchCamera}
              style={styles.buttonSwitch}
            >
              <Image
                source={require("./images/camera_switch.png")}
                style={styles.iconSwitch}
              />
            </TouchableOpacity>
          </View>
          {/* <Timer
            data={{
              mediaConnected: isAnswerSuccess,
            }}
            callingName={this.getCallingName()}
          />   */}
          {callStatus && !isAnswerSuccess ? (
            <Text style={styles.statusCall}>{callStatus}</Text>
          ) : null}
          <View
            style={{
              flex: 1,
              justifyContent: "flex-end",
            }}
          >
            {localStreamURL && (makeCall || isAnswerSuccess) && (
              <View style={styles.toggleButtons}>
                <TouchableOpacity
                  onPress={this.onToggleMute}
                  style={{ padding: 10 }}
                >
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
                  onPress={this.onToggleSpeaker}
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
                  onPress={this.handleAnswer}
                  style={{ padding: 10 }}
                >
                  <Image
                    source={require("./images/accept_call.png")}
                    style={styles.icon}
                  />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={this.rejectCall}
                style={{ padding: 10 }}
              >
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
  }
  startSound = () => {
    InCallManager.startRingtone("_BUNDLE_");
    Vibration.vibrate(PATTERN, true);
  };
  stopSound = () => {
    InCallManager.stopRingtone();
    InCallManager.stop();
    Vibration.cancel();
  };
  getVideoDevice = ()=>{
    return new Promise((resolve, reject)=>{
      const facing = isFront ? "front" : "environment";
      try {
        mediaDevices.enumerateDevices().then(devices=>{
       const videoSourceId = devices.find(
        (device) => device.kind === "videoinput" && device.facing === facing
      );
      if(videoSourceId)
      resolve(videoSourceId);
      reject(null);
        })
      } catch (error) {
        console.log(error);
        reject(error);        
      }
    });

  }
  setupWebRTC = () => {
    return new Promise( (resolve,reject)=>{
      this.getVideoDevice().then(videoSourceId=>{
        const facingMode = isFront ? "user" : "environment";
        const constraints = {
          audio: true,
          video: {
            mandatory: {
              minWidth: 500, // Provide your own width, height and frame rate here
              minHeight: 300,
              minFrameRate: 30,
            },
            facingMode,
            optional: videoSourceId ? [{ sourceId: videoSourceId }] : [],
          },
        };
        const peer = new RTCPeerConnection(CallManager.DEFAULT_ICE);
        peer.oniceconnectionstatechange = this.onICEConnectionStateChange;
        peer.onaddstream = this.onAddStream;
        peer.onicecandidate = this.onICECandiate;
        peer.onicegatheringstatechange = this.onICEGratherStateChange;
        mediaDevices.getUserMedia(constraints).then(newStream=>{
          peer.addStream(newStream);
          this.refLocalStream.current = newStream;
          this.refPeer.current = peer;
          resolve(newStream.toURL());
          // this.setState({
          //   localStreamURL: ,
          // });
        }).catch(e=>{
          reject(e)
        });
      }).catch(e=>{
        reject(e)
      })

      
    });
  };
  onICEGratherStateChange = (ev) => {
    switch (this.refPeer.current.iceGatheringState) {
      case "gathering":
        if (!this.state.makeCall) this.setState({ callStatus: "Đang kết nối" });
        break;
      case "complete":        
        if (this.state.pendingCandidates.length > 0 && this.refCallId.current) {
          this.sendMessage(
            this.state.isOfferReceiverd
              ? constants.socket_type.ANSWER
              : constants.socket_type.OFFER,
            {
              to: this.refCallingParter.current,
              description: this.refPeer.current.localDescription,
              candidates: this.state.pendingCandidates,
              callId: this.refCallId.current,
              sdp: this.refOffer.current,
              from: this.props.userId,
              data: this.refCallingData.current,
            }
          );
        } else {
          //
        }
        break;
      default:
        break;
    }
  };
  startCall = async ({ from, fromName, to, toName } = {}) => {
    try {
      this.refCallId.current = stringUtils.guid();
      this.refCallingData.current={
        from,
        fromName,
        to,
        toName,
      },
      this.refCallingParter.current=to;
      this.setupWebRTC().then(async localStreamURL=>{
        this.refPeer.current.createOffer().then(offer=>{
          this.refOffer.current=offer;
          this.refPeer.current.setLocalDescription(offer).then(s=>{
            InCallManager.start({ media: "video" });
            soundUtils.play("call_phone.mp3");
            this.setState({
              isVisible: true,        
              makeCall: true,
              callStatus: "",
              localStreamURL
            });  
          })
        })  
      });
      
      
      // Create Offer
     } catch (e) {}
  };
  onSwitchCamera = async () => {
    if (this.refLocalStream.current) {
      this.refLocalStream.current
        .getVideoTracks()
        .forEach((track) => track._switchCamera());
      this.setState({ isCamFront: !this.state.isCamFront });
    }
  };
  onTimeOut = () => {
    this.timeout = setTimeout(() => {
      this.rejectCall();
    }, 30 * 60 * 1000);
  };

  // Mutes the local's outgoing audio
  onToggleMute = () => {
    this.refLocalStream.current &&
      this.refLocalStream.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        this.setState({ isMuted: !track.enabled });
      });
  };
  onToggleSpeaker = () => {
    const isSpeak = !this.state.isSpeak;
    this.setState({ isSpeak });
    InCallManager.setForceSpeakerphoneOn(isSpeak);
  };
  onICEConnectionStateChange = (e) => {
    const newState = {};
    switch (e.target.iceConnectionState) {
      case "completed":
        break;
      case "connected":
        this.onTimeOut();
        newState.isAnswerSuccess = true;
        break;
      case "closed":
      case "disconnected":
        break;
      case "failed":
        // this.rejectCall()
        break;
    }
    this.setState(newState);
  };

  onICECandiate = (e) => {
    const { candidate } = e;
    if (candidate) {
      let pendingRemoteIceCandidates = this.state.pendingCandidates;
      if (Array.isArray(pendingRemoteIceCandidates)) {
        this.setState({
          pendingCandidates: [...pendingRemoteIceCandidates, candidate],
        });
      } else {
        this.setState({
          pendingCandidates: [candidate],
        });
      }
    }
  };

  onAddStream = (e) => {
    this.setState({
      remoteStreamURL: e.stream.toURL(),
    });
  };

  resetState = () => {
    this.refCallId.current = "";
    this.refLocalStream.current = "";
    this.refCallingParter.current = "";
    this.refCallingData.current = "";
    this.setState({
      isOfferReceiverd: false,
      isOfferAnswered: false,
      isVisible: false,
      data: {},
      callingName: "",
      remoteStreamURL: null,
      pendingCandidates: [],
      data: null,
      localStreamURL: null,
      isSpeak: true,
      isMuted: false,
      isCamFront: true,
      callStatus: null,
      isAnswerSuccess: false,
      makeCall: false,
    });
  };

  onRNCallKitDidActivateAudioSession = (data) => {
    // AudioSession đã được active, có thể phát nhạc chờ nếu là outgoing call, answer call nếu là incoming call.
    this.handleAnswer();
  };
  answerCallEvent = () => {};
  endCallEvent = ({ callUUid }) => {
    if (!this.state.isAnswerSuccess) this.rejectCall();
  };
  addEventCallKeep = () => {
    RNCallKeep.addEventListener("answerCall", this.answerCallEvent);
    RNCallKeep.addEventListener("endCall", this.endCallEvent);
    RNCallKeep.addEventListener(
      "didActivateAudioSession",
      this.onRNCallKitDidActivateAudioSession
    );
  };
  removeEvent = () => {
    RNCallKeep.removeEventListener("answerCall", this.answerCallEvent);
    RNCallKeep.removeEventListener("endCall", this.endCallEvent);
    RNCallKeep.removeEventListener(
      "didActivateAudioSession",
      this.onRNCallKitDidActivateAudioSession
    );
    VoipPushNotification.removeEventListener("register");
  };
  onOfferReceived = (data ={}) => {
    if (data.from == this.props.userId) {
      //nếu offer nhận được được thực hiện từ chính bạn thì bỏ qua
      return;
    }
    this.refOffer.current = data.description;
    this.refCandidates.current = data.candidates;
    this.refCallId.current = data.callId;
    this.refCallingData.current = data.data || {};
    this.refCallingParter.current = data.from;
    this.setupWebRTC().then(localStreamURL=>{
      this.startSound();
      this.setState({
        localStreamURL,
        isOfferReceiverd: true,
        isOfferAnswered: false,
        isVisible: true,
        statusCall:""
      });  
    }).catch(e=>{
    });
};

  onAnswerReceived = async (data) => {
    soundUtils.stop();
    const { description, candidates } = data;
    description.sdp = BandwidthHandler.getSdp(description.sdp);
    await this.refPeer.current.setRemoteDescription(
      new RTCSessionDescription(description)
    );
    candidates.forEach((c) =>
      this.refPeer.current.addIceCandidate(new RTCIceCandidate(c))
    );
  };
  onLeave = (data = {}) => {
    if (data.callId == this.refCallId.current) {
      const newState = { statusCall: "" };
      if (data.status && data.code == 1 && !this.state.isAnswerSuccess) {
        newState.callStatus = "Máy bận";
        setTimeout(this.handleReject, 1500);
      } else {
        newState.callStatus = "Kết thúc cuộc gọi";
        this.handleReject();
      }
      this.setState(newState);
    } else {
    }
  }

  handleReject = async () => {
    if (this.refPeer.current) this.refPeer.current.close();
    soundUtils.stop();
    this.stopSound();
    if (this.timeout) clearTimeout(this.timeout);
    if (this.refCallId.current) {
      // if (this.state.callId) {
      RNCallKeep.reportEndCallWithUUID(this.refCallId.current, 2);
    }
    this.resetState();
  };
  handleAnswer = async () => {
    try {
      await this.refPeer.current.setRemoteDescription(
        new RTCSessionDescription(this.refOffer.current)
      );
      InCallManager.stopRingtone();
      InCallManager.start({ media: "video" });
      Vibration.cancel();
      if (Array.isArray(this.refCandidates.current)) {
        this.refCandidates.current.forEach((c) =>
          this.refPeer.current.addIceCandidate(new RTCIceCandidate(c))
        );
      }
      const answer = await this.refPeer.current.createAnswer();
      await this.refPeer.current.setLocalDescription(answer);
      this.setState({
        isOfferAnswered: true,
      });
    } catch (error) {}
  };

  sendMessage = (type, msgObj) => {
    if (this.refSocket.current) {
      this.refSocket.current.emit(type, msgObj, (data) => {});
    } else {
      const e = {
        code: "websocket_error",
        message: "WebSocket state:" + ws.readyState,
      };
      throw e;
    }
  };

  rejectCall = () => {
    let type =
      this.state.isAnswerSuccess || this.state.makeCall
        ? constants.socket_type.LEAVE
        : constants.socket_type.REJECT;
    this.refSocket.current.emit(constants.socket_type.LEAVE, {
      to: this.refCallingParter.current,
      callId: this.refCallId.current, // this.state.callId,
      type,
    });
    this.handleReject();
  };
  componentWillUnmount() {
    this.removeEvent();
  }
  setupCallKeep = () => {
    return new Promise((resolve, reject) => {
      if (!this.refSettingCallKeep.current) {
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
        RNCallKeep.setup(options)
          .then((res) => {
            this.refSettingCallKeep.current = true;
            resolve(res);
          })
          .catch((err) => {
            reject(err);
          });
        RNCallKeep.setAvailable(true);
      } else {
        resolve({});
      }
    });
  };
  onDisconnect = async (data2) => {
    this.refConnected.current = false;
  };
  onConnected = async (data2) => {
    try {
      if (this.refConnected.current) return; // nếu đã connect rồi thì bỏ qua
      this.refConnected.current = true; //đánh dấu là đã connect
      if (Platform.OS == "ios") {
        this.setupCallKeep();
        VoipPushNotification.requestPermissions();
        VoipPushNotification.addEventListener("register", (token) => {
          // send token to your apn provider server
          this.refDeviceToken.current = token;
          this.connectToSocket(token);
        });
        // VoipPushNotification.registerVoipToken();
        // VoipPushNotification.addEventListener('notification', notification => {
        //   // Handle incoming pushes
        //   if (!this.refCallId.current) {
        //     this.refCallId.current = notification.getData().data.UUID;
        //   } else {
        //     // if Callkit already exists then end Callkit wiht the callKitUUID
        //     RNCallKeep.endCall(this.refCallId.current);
        //   }
        // });
        VoipPushNotification.registerVoipToken();
      } else {
        const token = await CallManager.firebase.messaging().getToken();
        this.refDeviceToken.current = token;
        this.connectToSocket(token);
      }
    } catch (error) {
      console.log(error);
    }
  };
  connectToSocket = (token) => {
    this.refSocket.current &&
      this.refSocket.current.emit(constants.socket_type.CONNECT, {
        token,
        id: this.props.userId,
        platform: Platform.OS,
        deviceId: CallManager.deviceId,
        packageName: CallManager.packageName,
      });
  };
  componentDidUpdate = (preProps, nextProps) => {
    if (preProps.loginToken != this.props.loginToken) {
      this.refConnected.current = false; //bỏ đánh dấu là đã connect
      if (!this.props.loginToken) {
        this.refSocket.current.emit(
          constants.socket_type.DISCONNECT,
          { token: this.refDeviceToken.current, platform: Platform.OS },
          (data) => {
            this.refSocket.current.disconnect();
            this.refSocket.current = null;
          }
        );
      } else {
        this.registerSocket();
      }
    }
  };
  registerSocket = () => {
    if (this.props.loginToken && !this.refSocket.current) {
      this.refSocket.current = this.props.io.connect(CallManager.host, {
        transports: ["websocket"],
        query: {
          token: this.props.loginToken, //verify socket io với login token
        },
        upgrade: true,
        reconnection: true,
        autoConnect: true,
        timeout: 30000,
        rememberUpgrade: true,
      });
      this.refSocket.current.on(
        constants.socket_type.CONNECT,
        this.onConnected
      );
      this.refSocket.current.on(
        constants.socket_type.DISCONNECT,
        this.onDisconnect
      );
      this.refSocket.current.on(
        constants.socket_type.OFFER,
        this.onOfferReceived
      );
      this.refSocket.current.on(
        constants.socket_type.ANSWER,
        this.onAnswerReceived
      );
      this.refSocket.current.on(constants.socket_type.LEAVE, this.onLeave);
      this.refSocket.current.connect();
    }
  };
  componentDidMount() {
    this.addEventCallKeep();
    this.registerSocket();
  }
}

const styles = StyleSheet.create({
  statusCall: {
    color: "#FFF",
    textAlign: "center",
    fontSize: 16,
    paddingBottom: 15,
    paddingTop: 10,
  },
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
    marginRight: 5,
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

export default CallScreen;

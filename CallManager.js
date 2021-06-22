class CallManager {
  _defaultCall = null;
  host = "";
  deviceId = "";
  packageName = "";
  firebase = null;
  DEFAULT_ICE = {
    iceServers: [
      // {
      //   urls: ["stun:stun.l.google.com:19302"],
      // },
      // {
      //   urls: "turn:54.251.13.109:3478?transport=tcp",
      //   username: "mainam",
      //   credential: "123456",
      // },
    ],
  };
  init(
    {
      iceServer = [],
      socketHost,
      deviceId,
      packageName,
      firebase,
      callingName,
    } = payload || {}
  ) {
    if(this.hasInited){
      console.log("CallManager inited");
      return;
    }
    this.hasInited =true;
    this.DEFAULT_ICE.iceServers = [
      ...this.DEFAULT_ICE.iceServers,
      ...iceServer,
    ];
    this.host = socketHost;
    this.deviceId = deviceId;
    this.packageName = packageName;
    this.firebase = firebase;
    this.callingName = callingName;
  }
  startCall(booking, isOffer) {
    const ref = this.getDefault();

    if (!!ref) {
      ref.startCall(booking, isOffer);
    } else {
      alert(JSON.stringify(ref));
    }
  }
  register(_ref) {
    if (!this._defaultCall) {
      this._defaultCall = _ref;
    }
  }

  unregister(_ref) {
    if (!!this._defaultCall) {
      this._defaultCall = null;
    }
  }

  getDefault() {
    return this._defaultCall;
  }
}

export default new CallManager();

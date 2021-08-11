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
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "stun:stun1.l.google.com:19302",
      },
      {
        urls: "stun:stun2.l.google.com:19302",
      },
      {
        urls: "stun:stun3.l.google.com:19302",
      },      
      // {
      //   urls: "stun:stun.services.mozilla.com",
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
      userAvatar
    } = payload || {}
  ) {
    if (this.hasInited) {
      console.log("CallManager inited");
      return;
    }
    this.hasInited = true;
    this.DEFAULT_ICE.iceServers = [
      ...iceServer,
      ...this.DEFAULT_ICE.iceServers
    ];
    this.host = socketHost;
    this.deviceId = deviceId;
    this.packageName = packageName;
    this.firebase = firebase;
    this.callingName = callingName;
    this.userAvatar = userAvatar;
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

import React, { useEffect, useState, useRef } from "react";
import { View, StyleSheet, Text } from "react-native";
import dateUtils from "mainam-react-native-date-utils";
export default function Timer(props) {
  const WARNING_TIME = 25 * 60 * 1000;
  const TOTAL_TIME = 31 * 60 * 1000;
  const inteval = useRef(null);
  const time = useRef(0);
  const [state, _setState] = useState({});
  const setState = (
    data = {
      warn: false,
      time: 0,
      timeRemain,
    }
  ) => {
    _setState((state) => {
      return { ...state, ...data };
    });
  };
  const countUpTimer = () => {
    if (!inteval.current)
      inteval.current = setInterval(() => {
        time.current += 1000;
        let warn = state.warn;
        let timeRemain = TOTAL_TIME - time.current;
        if (time.current > WARNING_TIME) {
          warn = true;
        }
        setState({
          time: time.current,
          warn,
          timeRemain,
        });
      }, 1000);
  };

  useEffect(() => {
    setState(props.data);
    if (props.data.mediaConnected) {
      countUpTimer();
    } else {
    }

    return () => {
      if (inteval.current) {
        try {
          clearInterval(inteval.current);
          inteval.current = null;
        } catch (error) {}
      }
    };
  }, [props.data]);

  return (
    <View>
      <Text style={styles.userId}>
        {props.renderUserInCall && props.renderUserInCall()}
      </Text>
      {state.mediaConnected ? (
        <Text style={styles.callState}>
          {state.time?.toDateObject().format("mm:ss")}
        </Text>
      ) : null}
      {state.warn ? (
        <Text
          style={{
            color: "#FFF",
            fontSize: 20,
            textAlign: "center",
            paddingHorizontal: 20,
          }}
        >
          Thời gian gọi còn lại của bạn là{" "}
          {state.timeRemain?.toDateObject().format("mm")} phút
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  userId: {
    color: "white",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
  },

  callState: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    marginTop: 20,
    textAlign: "center",
  },
});

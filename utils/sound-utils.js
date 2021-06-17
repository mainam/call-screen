import Sound from 'react-native-sound';

function play(uri) {
    // Sound.setMode('VideoChat')
    var sound = new Sound(uri, Sound.MAIN_BUNDLE, (error) => {
        if (error) {
            console.log('failed to load the sound', error);
            return;
        }
        if (global.sound) {
            global.sound.stop();
            global.sound.release();
        }
        global.sound = sound;
        sound.play((success) => {
            if (success) {
                play(uri);
                console.log('successfully finished playing');
            } else {
                console.log('playback failed due to audio decoding errors');
                // reset the player to its uninitialized state (android only)
                // this is the only option to recover after an error occured and use the player again


            }
            sound.release()
        });

    });

}
function stop() {
    if (global.sound) {
        global.sound.stop()
        global.sound.release();
    }
}
export default {
    play,
    stop
}

import TrackPlayer, { Event } from 'react-native-track-player';

try {
  TrackPlayer.registerPlaybackService(() => async () => {
    TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
    TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
    TrackPlayer.addEventListener(Event.RemoteSeek, (e) =>
      TrackPlayer.seekTo(e.position),
    );
    TrackPlayer.addEventListener(Event.RemoteNext, () =>
      TrackPlayer.skipToNext(),
    );
    TrackPlayer.addEventListener(Event.RemotePrevious, () =>
      TrackPlayer.skipToPrevious(),
    );
  });
} catch {
  // TrackPlayer service registration can fail on some devices/simulators.
  // Audio playback will still work for foreground listening.
}

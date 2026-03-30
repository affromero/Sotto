import TrackPlayer, { Event } from 'react-native-track-player';

try {
  TrackPlayer.registerPlaybackService(() => async () => {
    TrackPlayer.addEventListener(Event.RemotePlay, () => { TrackPlayer.play().catch(() => {}); });
    TrackPlayer.addEventListener(Event.RemotePause, () => { TrackPlayer.pause().catch(() => {}); });
    TrackPlayer.addEventListener(Event.RemoteSeek, (e) => { TrackPlayer.seekTo(e.position).catch(() => {}); });
    TrackPlayer.addEventListener(Event.RemoteNext, () => { TrackPlayer.skipToNext().catch(() => {}); });
    TrackPlayer.addEventListener(Event.RemotePrevious, () => { TrackPlayer.skipToPrevious().catch(() => {}); });
  });
} catch {
  // TrackPlayer service registration can fail on some devices/simulators.
  // Audio playback will still work for foreground listening.
}

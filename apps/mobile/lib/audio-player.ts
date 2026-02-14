import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
} from 'react-native-track-player';

let isInitialized = false;

export async function setupPlayer(): Promise<void> {
  if (isInitialized) {
    return;
  }

  await TrackPlayer.setupPlayer({
    autoHandleInterruptions: true,
  });

  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
    android: {
      appKilledPlaybackBehavior:
        AppKilledPlaybackBehavior.ContinuePlayback,
    },
  });

  isInitialized = true;
}

export async function loadTrack(
  id: string,
  url: string,
  title: string,
  artist: string,
  artwork?: string,
): Promise<void> {
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id,
    url,
    title,
    artist,
    artwork,
  });
}

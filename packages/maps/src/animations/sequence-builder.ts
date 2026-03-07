import type { PlaceMetadata, CameraKeyframe, AnimationSequence } from '../types';

export class SequenceBuilder {
  private readonly keyframes: CameraKeyframe[] = [];
  private readonly places: PlaceMetadata[];

  constructor(places: PlaceMetadata[]) {
    this.places = places;

    // Start at first place
    if (places.length > 0) {
      this.keyframes.push({
        center: places[0].coordinates,
        zoom: 12,
        pitch: 0,
        bearing: 0,
        duration: 0,
        easing: 'linear',
      });
    }
  }

  flyBetween(from: PlaceMetadata, to: PlaceMetadata, duration: number): this {
    this.keyframes.push({
      center: to.coordinates,
      zoom: 10,
      pitch: 45,
      bearing: this.calculateBearing(from.coordinates, to.coordinates),
      duration,
      easing: 'easeInOut',
    });
    return this;
  }

  zoomTo(place: PlaceMetadata, zoom: number, duration: number): this {
    this.keyframes.push({
      center: place.coordinates,
      zoom,
      pitch: 0,
      bearing: 0,
      duration,
      easing: 'easeInOut',
    });
    return this;
  }

  hold(duration: number): this {
    if (this.keyframes.length === 0) return this;
    const last = this.keyframes[this.keyframes.length - 1];
    this.keyframes.push({ ...last, duration, easing: 'linear' });
    return this;
  }

  build(): AnimationSequence {
    const totalDuration = this.keyframes.reduce((sum, kf) => sum + kf.duration, 0);
    return {
      id: `seq-${Date.now()}`,
      keyframes: [...this.keyframes],
      totalDuration,
      places: [...this.places],
    };
  }

  static cinematic(places: PlaceMetadata[], durationPerPlace: number): AnimationSequence {
    const builder = new SequenceBuilder(places);

    for (let i = 0; i < places.length - 1; i++) {
      builder.hold(durationPerPlace * 0.3);
      builder.flyBetween(places[i], places[i + 1], durationPerPlace * 0.7);
    }

    // Hold on last place
    if (places.length > 0) {
      builder.hold(durationPerPlace * 0.3);
    }

    return builder.build();
  }

  private calculateBearing(from: [number, number], to: [number, number]): number {
    const [lng1, lat1] = from.map((d) => (d * Math.PI) / 180);
    const [lng2, lat2] = to.map((d) => (d * Math.PI) / 180);
    const dLng = lng2 - lng1;
    const x = Math.sin(dLng) * Math.cos(lat2);
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }
}

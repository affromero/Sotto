export interface PitchDocument {
  filename: string;
  displayName: string;
  order: number;
  sourceMarkdown: string;
}

export interface PitchVersion {
  date: string;
  buildTime: string;
  documents: PitchDocument[];
}

export interface PitchManifest {
  versions: PitchVersion[];
  latest: string;
}

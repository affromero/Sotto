export interface InteractionRequest {
  question: string;
  timestamp: number;
}

export interface InteractionResponse {
  id: string;
  answer: string;
  resolved: boolean;
}

export interface ResolutionChoice {
  interactionId: string;
  resolved: boolean;
  incorporate: boolean;
}

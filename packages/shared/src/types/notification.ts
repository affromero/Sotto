export interface NotificationData {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, string> | null;
  read: boolean;
  createdAt: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type DemoAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string; speed?: { min: number; max: number } }
  | { type: 'wait'; ms: number }
  | { type: 'scroll'; distance: number; duration?: number }
  | { type: 'zoom'; selector: string; scale?: number; duration?: number }
  | { type: 'zoomReset'; duration?: number }
  | { type: 'hover'; selector: string }
  | { type: 'waitForSelector'; selector: string; timeout?: number }
  | { type: 'intercept'; name: string; options: Record<string, unknown> }
  | { type: 'clearIntercept'; name: string }
  | { type: 'keypress'; key: string }
  | { type: 'screenshot'; label?: string };

export type GenerationMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'component-to-video'
  | 'text-to-image'
  | 'image-to-image'
  | 'agent';

export interface TestConfig {
  url: string;
  startIndex: number;
  prompt: string;
  prompts?: string[];
  mode?: GenerationMode;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  outputCount?: number; // 1, 2, 4
  videoLength?: '5s' | '8s' | '10s';
  model?: string; // 'Veo 2', 'Imagen 3'
  concurrentPrompts?: number;
  delayRange?: [number, number]; // [minSeconds, maxSeconds]
  download?: {
    enabled?: boolean;
    folder?: string;
    quality?: '1080p' | '2K' | '4K';
    autoRename?: boolean;
  };
  options?: {
    dropdown?: string;
    checkbox?: boolean;
    autoAddCharacter?: boolean;
    characterName?: string;
    speakerName?: string;
  };
  timeout: number;
  extensionPath: string;
  group?: string;
  folder?: string;
  profileId?: string;
  userDataDir?: string;
  shardBrowserPath?: string;
  keepOpen?: boolean;
  debugPort?: number;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

export interface BrowserSession {
  browser: any;
  page: any;
  cdpUrl: string;
  profileName?: string;
}

export interface ExtensionUI {
  popupSelector: string;
  startIndexSelector: string;
  promptSelector: string;
  startButtonSelector: string;
  dropdownSelector?: string;
  checkboxSelector?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  step?: string;
  data?: any;
}
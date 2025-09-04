import { LocalAudioTrack, LocalVideoTrack, videoCodecs } from 'livekit-client';
import { VideoCodec } from 'livekit-client';

export interface SessionProps {
  roomName: string;
  identity: string;
  audioTrack?: LocalAudioTrack;
  videoTrack?: LocalVideoTrack;
  region?: string;
  turnServer?: RTCIceServer;
  forceRelay?: boolean;
}

export interface TokenResult {
  identity: string;
  accessToken: string;
}

export function isVideoCodec(codec: string): codec is VideoCodec {
  return videoCodecs.includes(codec as VideoCodec);
}

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

export interface TranscriptEntry {
  id: string;
  participantIdentity: string;
  participantName: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  language?: string; // Added language metadata
  seq?: number; // sequence number for incremental updates
  segments?: TranscriptSegment[]; // optional segmented transcript
}

export interface TranscriptData {
  type: 'transcript';
  entry: TranscriptEntry;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  completed: boolean;
}

// Language configuration interface
export interface InputLanguage {
  code: string;
  name: string;
  flag: string;
}

// Supported input languages
export const INPUT_LANGUAGES: InputLanguage[] = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' }
];

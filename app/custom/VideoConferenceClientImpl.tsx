'use client';

import { formatChatMessageLinks, RoomContext, VideoConference } from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  LogLevel,
  Room,
  RoomConnectOptions,
  RoomOptions,
  VideoPresets,
  type VideoCodec,
} from 'livekit-client';
import { DebugMode } from '@/lib/Debug';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import { TranscriptPanel } from '@/lib/TranscriptPanel';
import { useTranscriptDataChannel } from '@/lib/useTranscriptDataChannel';

export function VideoConferenceClientImpl(props: {
  liveKitUrl: string;
  token: string;
  codec: VideoCodec | undefined;
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = useState(false);
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [inputLanguage, setInputLanguage] = useState('vi');

  const roomOptions = useMemo((): RoomOptions => {
    return {
      publishDefaults: {
        videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h216],
        red: !e2eeEnabled,
        videoCodec: props.codec,
      },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      e2ee: e2eeEnabled
        ? {
            keyProvider,
            worker,
          }
        : undefined,
    };
  }, [e2eeEnabled, props.codec, keyProvider, worker]);

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  const connectOptions = useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  useEffect(() => {
    if (e2eeEnabled) {
      keyProvider.setKey(e2eePassphrase).then(() => {
        room.setE2EEEnabled(true).then(() => {
          setE2eeSetupComplete(true);
        });
      });
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, e2eePassphrase, keyProvider, room, setE2eeSetupComplete]);

  useEffect(() => {
    if (e2eeSetupComplete) {
      room.connect(props.liveKitUrl, props.token, connectOptions).catch((error) => {
        console.error(error);
      });
      room.localParticipant.enableCameraAndMicrophone().catch((error) => {
        console.error(error);
      });
    }
  }, [room, props.liveKitUrl, props.token, connectOptions, e2eeSetupComplete]);

  useLowCPUOptimizer(room);

  // Initialize transcript data channel với input language
  const {
    transcripts,
    isConnected: transcriptConnected,
    addTranscript,
    sendTranscriptToAgents,
    clearTranscripts
  } = useTranscriptDataChannel(room, inputLanguage);

  const handleLanguageChange = (language: string) => {
    setInputLanguage(language);
    console.log('Input language changed to:', language);
  };

  // Demo function với language support
  const addSampleTranscript = () => {
    addTranscript(
      'Đây là một ví dụ về transcript được gửi qua data channel.',
      undefined,
      undefined,
      true,
      true, // Send to agents only
      inputLanguage // Use current input language
    );
  };

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={
            process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU === 'true' ? SettingsMenu : undefined
          }
        />
        <DebugMode logLevel={LogLevel.debug} />

        {/* Enhanced Transcript Panel với language selector */}
        <TranscriptPanel
          transcripts={transcripts}
          isVisible={transcriptVisible}
          onToggle={() => setTranscriptVisible(!transcriptVisible)}
          inputLanguage={inputLanguage}
          onInputLanguageChange={handleLanguageChange}
          enableLanguageSelector={true}
        />

        {/* Demo button for testing transcript functionality */}
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={addSampleTranscript}
            style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              zIndex: 1000,
              padding: '10px 15px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            title="Thêm transcript mẫu (chỉ trong development)"
          >
            📝 Test Transcript
          </button>
        )}

        {/* Removed agent map payload dev button */}
      </RoomContext.Provider>
    </div>
  );
}

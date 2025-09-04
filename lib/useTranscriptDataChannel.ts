import { useEffect, useState, useCallback } from 'react';
import { Room, RoomEvent, DataPacket_Kind, Participant } from 'livekit-client';
import { TranscriptEntry, TranscriptData, TranscriptSegment } from './types';

const TRANSCRIPT_TOPIC = 'transcript';

export function useTranscriptDataChannel(room: Room | null, inputLanguage?: string) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Send transcript data to other participants (including agents)
  const sendTranscript = useCallback(async (entry: TranscriptEntry) => {
    if (!room || !room.localParticipant) {
      console.warn('Room or local participant not available');
      return;
    }

    try {
      const transcriptData: TranscriptData = {
        type: 'transcript',
        entry
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(transcriptData));

      // Send reliable data to all participants with transcript topic
      await room.localParticipant.publishData(data, {
        reliable: true,
        topic: TRANSCRIPT_TOPIC
      });

      console.log('Transcript sent:', entry);
    } catch (error) {
      console.error('Failed to send transcript:', error);
    }
  }, [room]);

  // Send transcript specifically to agents only
  const sendTranscriptToAgents = useCallback(async (entry: TranscriptEntry) => {
    if (!room || !room.localParticipant) {
      console.warn('Room or local participant not available');
      return;
    }

    try {
      // Find all agent participants (assuming agents have specific naming pattern or metadata)
      const agentIdentities = Array.from(room.remoteParticipants.values())
        .filter(participant => 
          participant.identity.includes('agent') || 
          participant.metadata?.includes('agent') ||
          participant.name?.toLowerCase().includes('agent')
        )
        .map(participant => participant.identity);

      if (agentIdentities.length === 0) {
        console.log('No agents found in room');
        return;
      }

      const transcriptData: TranscriptData = {
        type: 'transcript',
        entry
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(transcriptData));

      // Send reliable data specifically to agents
      await room.localParticipant.publishData(data, {
        reliable: true,
        topic: TRANSCRIPT_TOPIC,
        destinationIdentities: agentIdentities
      });

      console.log('Transcript sent to agents:', agentIdentities, entry);
    } catch (error) {
      console.error('Failed to send transcript to agents:', error);
    }
  }, [room]);

  // Enhanced createTranscriptEntry với language metadata
  const createTranscriptEntry = useCallback((
    text: string,
    participantIdentity: string,
    participantName: string,
    isFinal: boolean = true,
    language?: string
  ): TranscriptEntry => {
    return {
      id: `${participantIdentity}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      participantIdentity,
      participantName,
      text,
      timestamp: Date.now(),
      isFinal,
      language: language || inputLanguage || 'vi' // Include language metadata
    };
  }, [inputLanguage]);

  // Enhanced addTranscript với language support
  const addTranscript = useCallback(async (
    text: string,
    participantIdentity?: string,
    participantName?: string,
    isFinal: boolean = true,
    sendToAgentsOnly: boolean = false,
    language?: string
  ) => {
    if (!room) return;

    const identity = participantIdentity || room.localParticipant?.identity || 'unknown';
    const name = participantName || room.localParticipant?.name || 'Unknown User';
    const entryLanguage = language || inputLanguage || 'vi';

    const entry = createTranscriptEntry(text, identity, name, isFinal, entryLanguage);

    // Add to local state
    setTranscripts(prev => [...prev, entry]);

    // Send to other participants
    if (sendToAgentsOnly) {
      await sendTranscriptToAgents(entry);
    } else {
      await sendTranscript(entry);
    }
  }, [room, inputLanguage, createTranscriptEntry, sendTranscript, sendTranscriptToAgents]);

  // Clear all transcripts
  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  // Merge helper for segment-based transcripts by participant only
  const upsertSegmentedEntry = useCallback((incoming: TranscriptEntry) => {
    setTranscripts(prev => {
      const idx = prev.findIndex(e => e.participantIdentity === incoming.participantIdentity);

      if (idx === -1) {
        // Build text from segments if provided
        const built = { ...incoming } as TranscriptEntry;
        if (incoming.segments && incoming.segments.length > 0) {
          const sorted = [...incoming.segments].sort((a, b) => a.start - b.start);
          built.text = sorted.map(s => s.text).join(' ').trim();
          // derive final if not explicitly provided
          if (typeof built.isFinal !== 'boolean') {
            built.isFinal = sorted.every(s => s.completed);
          }
        }
        return [...prev, built];
      }

      const current = prev[idx];
      // Sequence guard: keep the newer seq
      if (typeof current.seq === 'number' && typeof incoming.seq === 'number' && incoming.seq < current.seq) {
        return prev; // ignore stale update
      }

      const next = { ...current } as TranscriptEntry;
      next.seq = incoming.seq ?? current.seq;
      next.isFinal = incoming.isFinal ?? current.isFinal;
      next.language = incoming.language ?? current.language;
      // preserve existing timestamp to avoid regrouping
      next.timestamp = current.timestamp;

      if (incoming.segments && incoming.segments.length > 0) {
        const existingSegments: TranscriptSegment[] = Array.isArray(current.segments) ? [...current.segments] : [];
        const incomingSegments: TranscriptSegment[] = [...incoming.segments].sort((a, b) => a.start - b.start || a.end - b.end);

        const removeOverlaps = (base: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[] => {
          return base.filter(s => (s.end <= seg.start) || (s.start >= seg.end));
        };

        let merged: TranscriptSegment[] = [];
        const firstIncoming = incomingSegments[0];
        const existingSorted = [...existingSegments].sort((a, b) => a.start - b.start || a.end - b.end);

        if (firstIncoming) {
          const existingFirstText = existingSorted[0]?.text;
          const compareTarget = existingFirstText ?? current.text;
          const firstMatches = firstIncoming.text === compareTarget;

          if (firstIncoming.completed && firstMatches) {
            const base: TranscriptSegment[] = existingSorted.length > 0 ? [existingSorted[0]] : [];
            const preservedEnd = base.length > 0 ? base[0].end : -Infinity;
            const tail = incomingSegments.slice(1).filter(s => s.start >= preservedEnd);
            merged = [...base];
            for (const seg of tail) {
              merged = removeOverlaps(merged, seg);
              merged.push(seg);
            }
          } else if (firstIncoming.completed && !firstMatches) {
            const firstIncompleteIdx = existingSorted.findIndex(s => !s.completed);
            const cutIdx = firstIncompleteIdx === -1 ? existingSorted.length : firstIncompleteIdx;
            const base = existingSorted.slice(0, cutIdx);
            const preservedEnd = base.length > 0 ? base[base.length - 1].end : -Infinity;
            const add = incomingSegments.filter(s => s.start >= preservedEnd);
            merged = [...base, ...add];
          } else if (!firstIncoming.completed) {
            const firstIncompleteIdx = existingSorted.findIndex(s => !s.completed);
            const cutIdx = firstIncompleteIdx === -1 ? existingSorted.length : firstIncompleteIdx;
            const base = existingSorted.slice(0, cutIdx);
            const preservedEnd = base.length > 0 ? base[base.length - 1].end : -Infinity;
            const add = incomingSegments.filter(s => s.start >= preservedEnd);
            merged = [...base, ...add];
          } else {
            // Fallback: overlay by removing overlaps, keep earlier non-overlapping existing
            merged = [...existingSorted];
            for (const seg of incomingSegments) {
              merged = removeOverlaps(merged, seg);
              merged.push(seg);
              merged.sort((a, b) => a.start - b.start || a.end - b.end);
            }
          }
        } else {
          merged = existingSorted;
        }

        // Normalize: collapse consecutive duplicates by same text+completed, and coalesce time ranges
        const normalized: TranscriptSegment[] = [];
        for (const s of merged) {
          const last = normalized[normalized.length - 1];
          if (last && last.text === s.text && last.completed === s.completed) {
            // coalesce time window
            last.start = Math.min(last.start, s.start);
            last.end = Math.max(last.end, s.end);
          } else {
            normalized.push({ ...s });
          }
        }
        next.segments = normalized;
        next.text = normalized.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
        if (incoming.isFinal === undefined) {
          next.isFinal = normalized.every(s => s.completed);
        }
      } else if (incoming.text) {
        // No segments provided, just update text
        next.text = incoming.text;
      }

      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }, []);

  // No map sending in legacy mode

  // Handle incoming transcript data
  useEffect(() => {
    if (!room) {
      setIsConnected(false);
      return;
    }

    const handleDataReceived = (
      payload: Uint8Array,
      participant: Participant | undefined,
      kind?: DataPacket_Kind,
      topic?: string
    ) => {
      // Only process transcript data
      if (topic !== TRANSCRIPT_TOPIC) {
        return;
      }

      try {
        const decoder = new TextDecoder();
        const dataStr = decoder.decode(payload);
        const parsed = JSON.parse(dataStr);

        // Agent payload shape with optional segments
        const data = parsed as TranscriptData;
        if (data.type === 'transcript' && data.entry) {
          const entry = data.entry;
          // If entry has id, keep duplicate guard; but we still want to merge segments for same participant+timestamp
          if (entry.segments && entry.segments.length > 0) {
            upsertSegmentedEntry(entry);
          } else {
            setTranscripts(prev => {
              const exists = entry.id ? prev.some(t => t.id === entry.id) : false;
              if (exists) return prev;
              return [...prev, entry];
            });
          }

          console.log('Received transcript from:', participant?.identity, data.entry);
        }
      } catch (error) {
        console.error('Failed to parse transcript data:', error);
      }
    };

    const handleRoomConnected = () => {
      setIsConnected(true);
      console.log('Transcript data channel connected');
    };

    const handleRoomDisconnected = () => {
      setIsConnected(false);
      console.log('Transcript data channel disconnected');
    };

    // Set up event listeners
    room.on(RoomEvent.DataReceived, handleDataReceived);
    room.on(RoomEvent.Connected, handleRoomConnected);
    room.on(RoomEvent.Disconnected, handleRoomDisconnected);

    // Check if already connected
    if (room.state === 'connected') {
      setIsConnected(true);
    }

    // Cleanup
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
      room.off(RoomEvent.Connected, handleRoomConnected);
      room.off(RoomEvent.Disconnected, handleRoomDisconnected);
    };
  }, [room]);

  return {
    transcripts,
    isConnected,
    addTranscript,
    sendTranscript,
    sendTranscriptToAgents,
    createTranscriptEntry,
    clearTranscripts,
    currentInputLanguage: inputLanguage
  };
}


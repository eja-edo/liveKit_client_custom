import { TranscriptEntry } from './types';

/**
 * Format timestamp to readable time string
 */
export function formatTimestamp(timestamp: number, locale: string = 'vi-VN'): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(locale, { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

/**
 * Format timestamp to include date if different from today
 */
export function formatTimestampWithDate(timestamp: number, locale: string = 'vi-VN'): string {
  const date = new Date(timestamp);
  const today = new Date();
  
  const isToday = date.toDateString() === today.toDateString();
  
  if (isToday) {
    return formatTimestamp(timestamp, locale);
  } else {
    return date.toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
}

/**
 * Group transcripts by participant and time window
 */
export function groupTranscriptsByParticipant(
  transcripts: TranscriptEntry[], 
  timeWindowMs: number = 5000
): Record<string, TranscriptEntry[]> {
  return transcripts.reduce((groups, transcript) => {
    const key = `${transcript.participantIdentity}-${Math.floor(transcript.timestamp / timeWindowMs)}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(transcript);
    return groups;
  }, {} as Record<string, TranscriptEntry[]>);
}

/**
 * Filter transcripts by search query
 */
export function filterTranscripts(
  transcripts: TranscriptEntry[], 
  query: string
): TranscriptEntry[] {
  if (!query.trim()) return transcripts;
  
  const lowerQuery = query.toLowerCase();
  return transcripts.filter(transcript => 
    transcript.participantName.toLowerCase().includes(lowerQuery) ||
    transcript.text.toLowerCase().includes(lowerQuery) ||
    transcript.participantIdentity.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filter transcripts by participant
 */
export function filterTranscriptsByParticipant(
  transcripts: TranscriptEntry[], 
  participantIdentity: string
): TranscriptEntry[] {
  return transcripts.filter(transcript => 
    transcript.participantIdentity === participantIdentity
  );
}

/**
 * Filter transcripts by time range
 */
export function filterTranscriptsByTimeRange(
  transcripts: TranscriptEntry[], 
  startTime: number, 
  endTime: number
): TranscriptEntry[] {
  return transcripts.filter(transcript => 
    transcript.timestamp >= startTime && transcript.timestamp <= endTime
  );
}

/**
 * Get unique participants from transcripts
 */
export function getUniqueParticipants(transcripts: TranscriptEntry[]): Array<{
  identity: string;
  name: string;
  count: number;
}> {
  const participantMap = new Map<string, { name: string; count: number }>();
  
  transcripts.forEach(transcript => {
    const existing = participantMap.get(transcript.participantIdentity);
    if (existing) {
      existing.count++;
    } else {
      participantMap.set(transcript.participantIdentity, {
        name: transcript.participantName,
        count: 1
      });
    }
  });
  
  return Array.from(participantMap.entries()).map(([identity, data]) => ({
    identity,
    name: data.name,
    count: data.count
  }));
}

/**
 * Sort transcripts by timestamp
 */
export function sortTranscriptsByTime(
  transcripts: TranscriptEntry[], 
  ascending: boolean = true
): TranscriptEntry[] {
  return [...transcripts].sort((a, b) => 
    ascending ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
  );
}

/**
 * Merge consecutive transcripts from same participant
 */
export function mergeConsecutiveTranscripts(
  transcripts: TranscriptEntry[], 
  maxGapMs: number = 2000
): TranscriptEntry[] {
  if (transcripts.length === 0) return [];
  
  const sorted = sortTranscriptsByTime(transcripts);
  const merged: TranscriptEntry[] = [];
  let current = { ...sorted[0] };
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Check if should merge with current
    if (
      next.participantIdentity === current.participantIdentity &&
      next.timestamp - current.timestamp <= maxGapMs &&
      current.isFinal && next.isFinal
    ) {
      // Merge text
      current.text += ' ' + next.text;
      current.timestamp = next.timestamp; // Use latest timestamp
    } else {
      // Push current and start new
      merged.push(current);
      current = { ...next };
    }
  }
  
  // Don't forget the last one
  merged.push(current);
  
  return merged;
}

/**
 * Export transcripts to text format
 */
export function exportTranscriptsToText(transcripts: TranscriptEntry[]): string {
  const sorted = sortTranscriptsByTime(transcripts);
  
  return sorted
    .filter(t => t.isFinal) // Only export final transcripts
    .map(transcript => {
      const time = formatTimestampWithDate(transcript.timestamp);
      return `[${time}] ${transcript.participantName}: ${transcript.text}`;
    })
    .join('\n');
}

/**
 * Export transcripts to JSON format
 */
export function exportTranscriptsToJSON(transcripts: TranscriptEntry[]): string {
  const sorted = sortTranscriptsByTime(transcripts);
  return JSON.stringify(sorted, null, 2);
}

/**
 * Calculate transcript statistics
 */
export function getTranscriptStats(transcripts: TranscriptEntry[]): {
  totalEntries: number;
  finalEntries: number;
  interimEntries: number;
  participants: number;
  timeSpan: number;
  averageWordsPerEntry: number;
} {
  const finalTranscripts = transcripts.filter(t => t.isFinal);
  const interimTranscripts = transcripts.filter(t => !t.isFinal);
  const participants = getUniqueParticipants(transcripts);
  
  const timestamps = transcripts.map(t => t.timestamp);
  const timeSpan = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  
  const totalWords = finalTranscripts.reduce((sum, t) => sum + t.text.split(' ').length, 0);
  const averageWordsPerEntry = finalTranscripts.length > 0 ? totalWords / finalTranscripts.length : 0;
  
  return {
    totalEntries: transcripts.length,
    finalEntries: finalTranscripts.length,
    interimEntries: interimTranscripts.length,
    participants: participants.length,
    timeSpan,
    averageWordsPerEntry: Math.round(averageWordsPerEntry * 100) / 100
  };
}

/**
 * Validate transcript entry
 */
export function validateTranscriptEntry(entry: Partial<TranscriptEntry>): entry is TranscriptEntry {
  return !!(
    entry.id &&
    entry.participantIdentity &&
    entry.participantName &&
    entry.text &&
    typeof entry.timestamp === 'number' &&
    typeof entry.isFinal === 'boolean'
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TranscriptEntry, INPUT_LANGUAGES } from './types';
import styles from '../styles/TranscriptPanel.module.css';

interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  isVisible: boolean;
  onToggle: () => void;
  className?: string;
  // Language props
  inputLanguage?: string;
  onInputLanguageChange?: (language: string) => void;
  enableLanguageSelector?: boolean;
}

export function TranscriptPanel({
  transcripts,
  isVisible,
  onToggle,
  className = '',
  inputLanguage = 'vi',
  onInputLanguageChange,
  enableLanguageSelector = true
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [selectedInputLanguage, setSelectedInputLanguage] = useState(inputLanguage);

  // Handle language change
  const handleLanguageChange = (languageCode: string) => {
    setSelectedInputLanguage(languageCode);
    onInputLanguageChange?.(languageCode);
    // Save to localStorage
    localStorage.setItem('transcript-input-language', languageCode);
  };

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('transcript-input-language');
    if (saved && INPUT_LANGUAGES.find(lang => lang.code === saved)) {
      setSelectedInputLanguage(saved);
      onInputLanguageChange?.(saved);
    }
  }, [onInputLanguageChange]);

  // Auto scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, autoScroll]);

  // Handle manual scroll to detect if user scrolled up
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setAutoScroll(isAtBottom);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  const filteredTranscripts = transcripts.filter(transcript => 
    filter === '' || 
    transcript.participantName.toLowerCase().includes(filter.toLowerCase()) ||
    transcript.text.toLowerCase().includes(filter.toLowerCase())
  );

  // Group legacy transcripts by participant and 5s window
  const groupedTranscripts = filteredTranscripts.reduce((groups, transcript) => {
    const key = `${transcript.participantIdentity}-${Math.floor(transcript.timestamp / 5000)}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(transcript);
    return groups;
  }, {} as Record<string, TranscriptEntry[]>);

  const currentLanguage = INPUT_LANGUAGES.find(lang => lang.code === selectedInputLanguage) || INPUT_LANGUAGES[0];

  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        className={styles.toggleButton}
        title="Hiển thị transcript"
      >
        📝 Transcript
      </button>
    );
  }

  return (
    <div className={`${styles.transcriptPanel} ${className}`}>
      <div className={styles.transcriptHeader}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Transcript</h3>
          <div className="flex items-center gap-2">
            {/* Language Input Selector */}
            {enableLanguageSelector && (
              <div className={styles.languageSelector}>
                <select
                  value={selectedInputLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className={styles.languageSelect}
                  title="Chọn ngôn ngữ đầu vào"
                >
                  {INPUT_LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`${styles.controlButton} ${autoScroll ? styles.active : ''}`}
              title={autoScroll ? 'Tắt cuộn tự động' : 'Bật cuộn tự động'}
            >
              {autoScroll ? '🔒' : '🔓'}
            </button>
            <button
              onClick={onToggle}
              className={styles.controlButton}
              title="Ẩn transcript"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Language indicator và filter */}
        <div className="mt-2 space-y-2">
          {enableLanguageSelector && (
            <div className={styles.languageIndicator}>
              <span className="text-xs text-gray-400">
                Ngôn ngữ đầu vào: {currentLanguage.flag} {currentLanguage.name}
              </span>
            </div>
          )}

          <input
            type="text"
            placeholder="Lọc theo người nói hoặc nội dung..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={styles.filterInput}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={styles.transcriptContent}
      >
        {Object.entries(groupedTranscripts).map(([key, group]) => {
          const firstEntry = group[0];
          return (
            <div key={key} className={styles.transcriptGroup}>
              <div className={styles.transcriptSpeaker}>
                <span className={styles.speakerName}>{firstEntry.participantName}</span>
                <div className="flex items-center gap-2">
                  {firstEntry.language && (
                    <span className={styles.languageBadge}>
                      {INPUT_LANGUAGES.find(lang => lang.code === firstEntry.language)?.flag || '🌐'}
                    </span>
                  )}
                  <span className={styles.timestamp}>{formatTimestamp(firstEntry.timestamp)}</span>
                </div>
              </div>
              <div className={styles.transcriptText}>
                {group.map((entry, index) => {
                  // If segments exist, render each with dim style when not completed
                  if (entry.segments && entry.segments.length > 0) {
                    return (
                      <span key={`${entry.id}-segwrap-${index}`}>
                        {entry.segments.map((seg, sidx) => (
                          <span
                            key={`${entry.id}-seg-${sidx}`}
                            className={`${styles.transcriptSegment} ${!seg.completed ? styles.interim : ''}`}
                          >
                            {seg.text}
                            {sidx < entry.segments!.length - 1 ? ' ' : ''}
                          </span>
                        ))}
                        {index < group.length - 1 ? ' ' : ''}
                      </span>
                    );
                  }
                  // Fallback to whole text
                  return (
                    <span
                      key={entry.id}
                      className={`${styles.transcriptSegment} ${!entry.isFinal ? styles.interim : ''}`}
                    >
                      {entry.text}
                      {index < group.length - 1 ? ' ' : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredTranscripts.length === 0 && (
          <div className={styles.emptyState}>
            <p className="text-gray-400 text-center py-8">
              {filter ? 'Không tìm thấy transcript phù hợp' : 'Chưa có transcript nào'}
            </p>
          </div>
        )}
      </div>

      <div className={styles.transcriptFooter}>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{filteredTranscripts.length} dòng transcript</span>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
              className={styles.scrollToBottomButton}
            >
              Cuộn xuống cuối ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

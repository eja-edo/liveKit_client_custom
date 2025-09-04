# Tính năng Transcript với Data Channel cho LiveKit Meet

## Tổng quan

Tính năng này thêm một màn hình transcript và data channel riêng biệt vào LiveKit Meet, cho phép:

- Hiển thị transcript real-time trong một panel riêng
- Gửi transcript data qua LiveKit data channel với topic riêng
- Agent có thể truy cập và nhận transcript data
- Hỗ trợ lọc và tìm kiếm transcript
- Giao diện responsive và dễ sử dụng

## Các thành phần chính

### 1. TranscriptPanel Component (`lib/TranscriptPanel.tsx`)

Component React hiển thị transcript với các tính năng:
- Cuộn tự động khi có transcript mới
- Lọc theo người nói hoặc nội dung
- Nhóm transcript theo người nói và thời gian
- Giao diện có thể ẩn/hiện
- Responsive design

### 2. useTranscriptDataChannel Hook (`lib/useTranscriptDataChannel.ts`)

Custom hook quản lý data channel cho transcript:
- Gửi/nhận transcript data qua LiveKit data channel
- Topic riêng: `'transcript'`
- Hỗ trợ gửi đến tất cả participants hoặc chỉ agents
- Xử lý reliable data transmission
- Tự động detect agents trong room

### 3. Transcript Types (`lib/types.ts`)

Định nghĩa các interface:
```typescript
interface TranscriptEntry {
  id: string;
  participantIdentity: string;
  participantName: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface TranscriptData {
  type: 'transcript';
  entry: TranscriptEntry;
}
```

### 4. Utility Functions (`lib/transcriptUtils.ts`)

Các hàm tiện ích:
- Format timestamp
- Group transcripts
- Filter và search
- Export transcript
- Validate data
- Statistics

### 5. Styling (`styles/TranscriptPanel.module.css`)

CSS modules với:
- Dark theme tương thích với LiveKit Meet
- Responsive design
- Smooth animations
- Accessibility support

## Cách sử dụng

### Trong ứng dụng

1. **Hiển thị transcript panel**: Click nút "📝 Transcript" ở góc phải màn hình
2. **Ẩn panel**: Click nút "✕" trong header của panel
3. **Lọc transcript**: Sử dụng ô tìm kiếm trong panel
4. **Cuộn tự động**: Toggle nút 🔒/🔓 để bật/tắt cuộn tự động
5. **Test transcript**: Trong development mode, có nút test để thêm transcript mẫu

### Cho Agent Development

Agents có thể nhận transcript data bằng cách:

```javascript
// Lắng nghe data channel với topic 'transcript'
room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  if (topic === 'transcript') {
    const decoder = new TextDecoder();
    const dataStr = decoder.decode(payload);
    const transcriptData = JSON.parse(dataStr);
    
    if (transcriptData.type === 'transcript') {
      const entry = transcriptData.entry;
      console.log('Received transcript:', entry.text);
      // Xử lý transcript data...
    }
  }
});
```

### Gửi transcript từ Agent

```javascript
// Tạo transcript entry
const transcriptEntry = {
  id: `agent-${Date.now()}`,
  participantIdentity: 'agent-id',
  participantName: 'AI Agent',
  text: 'Đây là phản hồi từ agent',
  timestamp: Date.now(),
  isFinal: true
};

// Gửi qua data channel
const transcriptData = {
  type: 'transcript',
  entry: transcriptEntry
};

const encoder = new TextEncoder();
const data = encoder.encode(JSON.stringify(transcriptData));

await room.localParticipant.publishData(data, {
  reliable: true,
  topic: 'transcript'
});
```

## Tích hợp

Tính năng đã được tích hợp vào:
- `app/custom/VideoConferenceClientImpl.tsx` - Custom room connection
- `app/rooms/[roomName]/PageClientImpl.tsx` - Standard room connection

## Agent Detection

Hook tự động detect agents dựa trên:
- Participant identity chứa 'agent'
- Participant metadata chứa 'agent'  
- Participant name chứa 'agent' (case-insensitive)

## Development

### Test trong Development Mode

Khi `NODE_ENV === 'development'`, sẽ có nút test để thêm transcript mẫu:
- Nút xanh dương ở góc phải dưới (Custom implementation)
- Nút xanh lá ở góc trái dưới (Room implementation)

### Customization

Có thể tùy chỉnh:
- Topic name trong `useTranscriptDataChannel.ts`
- Styling trong `TranscriptPanel.module.css`
- Agent detection logic trong hook
- Transcript grouping time window
- UI components và layout

## API Reference

### useTranscriptDataChannel

```typescript
const {
  transcripts,           // TranscriptEntry[] - Danh sách transcript
  isConnected,          // boolean - Trạng thái kết nối
  addTranscript,        // Function - Thêm transcript mới
  sendTranscript,       // Function - Gửi đến tất cả
  sendTranscriptToAgents, // Function - Gửi chỉ đến agents
  createTranscriptEntry, // Function - Tạo transcript entry
  clearTranscripts      // Function - Xóa tất cả transcript
} = useTranscriptDataChannel(room);
```

### TranscriptPanel Props

```typescript
interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  isVisible: boolean;
  onToggle: () => void;
  className?: string;
}
```

## Lưu ý

1. **Data Channel Reliability**: Sử dụng reliable transmission để đảm bảo transcript được gửi đầy đủ
2. **Performance**: Transcript được group theo thời gian để tối ưu hiển thị
3. **Memory**: Transcript chỉ lưu trong memory, không persist
4. **Security**: Transcript data không được encrypt riêng, dựa vào E2EE của room
5. **Scalability**: Phù hợp cho room nhỏ đến trung bình (< 50 participants)

## Troubleshooting

### Transcript không hiển thị
- Kiểm tra room đã connected
- Kiểm tra data channel topic đúng
- Xem console logs để debug

### Agent không nhận được transcript
- Kiểm tra agent detection logic
- Verify participant identity/metadata
- Kiểm tra data channel listener

### Performance issues
- Giảm transcript grouping time window
- Implement transcript pagination
- Clear old transcripts định kỳ

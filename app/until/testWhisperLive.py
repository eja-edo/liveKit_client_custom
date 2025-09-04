import asyncio
import json
import websockets
import threading
import time
import numpy as np
from livekit import agents, rtc
from dotenv import load_dotenv
import uuid
import wave
import os
from datetime import datetime

load_dotenv()

# Whisper Live Server configuration
WHISPER_HOST = "localhost"
WHISPER_PORT = 9090
LANGUAGE = "vi"
MODEL = "small"
USE_VAD = True

# Debug settings
DEBUG_SAVE_AUDIO = True  # Set to True to save audio files for debugging
DEBUG_AUDIO_DIR = "./debug_audio"  # Directory to save debug audio files
DEBUG_SAVE_ALL_PARTICIPANTS = True  # Set to False to save only specific participants
DEBUG_PARTICIPANT_FILTER = []  # List of participant IDs to record (empty = record all)
SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH = 2  # 16-bit audio
RECORDING_DURATION = 5.0  # seconds (set to 0 for unlimited recording)

# Audio processing settings (matching Whisper Live client)
CHUNK_SIZE = 4096  # bytes - same as original client

class AudioChunkBuffer:
    """Buffer to accumulate audio data into chunks like the original Whisper Live client"""

    def __init__(self, chunk_size: int = CHUNK_SIZE):
        self.chunk_size = chunk_size
        self.buffer = bytearray()

    def add_data(self, data: bytes) -> list:
        """Add data to buffer and return complete chunks"""
        self.buffer.extend(data)
        chunks = []

        # Extract complete chunks
        while len(self.buffer) >= self.chunk_size:
            chunk = bytes(self.buffer[:self.chunk_size])
            chunks.append(chunk)
            self.buffer = self.buffer[self.chunk_size:]

        return chunks

    def bytes_to_float_array(self, data: bytes) -> np.ndarray:
        """Convert bytes to float array like the original client"""
        # Convert bytes to int16 array, then to float32 normalized to [-1, 1]
        audio_array = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        return audio_array

    def get_remaining_data(self) -> bytes:
        """Get any remaining data in buffer"""
        if len(self.buffer) > 0:
            remaining = bytes(self.buffer)
            self.buffer = bytearray()
            return remaining
        return b''

class AudioRecorder:
    """Class to record and save audio data for debugging with rolling recording"""

    def __init__(self, participant_identity: str, debug_dir: str = DEBUG_AUDIO_DIR):
        self.participant_identity = participant_identity
        self.debug_dir = debug_dir
        self.audio_buffer = bytearray()  # Rolling buffer for current recording
        self.is_recording = False
        self.recording_start_time = None
        self.chunk_duration = RECORDING_DURATION
        self.chunk_counter = 0
        self.last_save_time = None

        # Check if we should record this participant
        self.should_record = self._should_record_participant()

        # Create debug directory if it doesn't exist
        if DEBUG_SAVE_AUDIO and self.should_record:
            os.makedirs(self.debug_dir, exist_ok=True)

    def _should_record_participant(self) -> bool:
        """Check if this participant should be recorded"""
        if not DEBUG_SAVE_AUDIO:
            return False

        if not DEBUG_SAVE_ALL_PARTICIPANTS:
            return self.participant_identity in DEBUG_PARTICIPANT_FILTER

        return True

    def start_recording(self):
        """Start continuous rolling recording"""
        if self.should_record:
            self.is_recording = True
            self.recording_start_time = datetime.now()
            self.last_save_time = time.time()
            self.audio_buffer = bytearray()
            self.chunk_counter = 0
            print(f"🎙️ Started continuous recording for {self.participant_identity} (saving every {self.chunk_duration}s)")

    def add_audio_data(self, audio_bytes: bytes):
        """Add audio data to the rolling buffer"""
        if self.should_record and self.is_recording:
            self.audio_buffer.extend(audio_bytes)

            # Check if it's time to save a chunk
            current_time = time.time()
            if current_time - self.last_save_time >= self.chunk_duration:
                self._save_current_chunk()
                self.last_save_time = current_time

    def _save_current_chunk(self):
        """Save current audio chunk to file"""
        if len(self.audio_buffer) > 0:
            self.chunk_counter += 1

            # Create filename with chunk number and timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{self.participant_identity}_chunk{self.chunk_counter:03d}_{timestamp}.wav"
            filepath = os.path.join(self.debug_dir, filename)

            try:
                # Convert float32 audio data back to int16 for WAV file
                audio_array = np.frombuffer(self.audio_buffer, dtype=np.float32)
                audio_int16 = (audio_array * 32767).astype(np.int16)

                with wave.open(filepath, 'wb') as wav_file:
                    wav_file.setnchannels(CHANNELS)
                    wav_file.setsampwidth(SAMPLE_WIDTH)
                    wav_file.setframerate(SAMPLE_RATE)
                    wav_file.writeframes(audio_int16.tobytes())

                duration = len(audio_int16) / SAMPLE_RATE
                print(f"💾 Saved audio chunk {self.chunk_counter}: {filepath} (duration: {duration:.1f}s)")

                # Clear buffer for next chunk
                self.audio_buffer = bytearray()

            except Exception as e:
                print(f"❌ Failed to save audio chunk for {self.participant_identity}: {e}")

    def stop_and_save_recording(self):
        """Stop recording and save final chunk if any"""
        if self.should_record and self.is_recording:
            self.is_recording = False

            # Save any remaining audio in buffer as final chunk
            if len(self.audio_buffer) > 0:
                self._save_current_chunk()

            total_chunks = self.chunk_counter
            total_duration = total_chunks * self.chunk_duration
            print(f"🏁 Finished recording for {self.participant_identity}: {total_chunks} chunks, ~{total_duration:.1f}s total")

    def get_stats(self):
        """Get recording statistics"""
        if self.is_recording:
            current_buffer_duration = len(self.audio_buffer) / (4 * SAMPLE_RATE)  # 4 bytes per float32 sample
            total_saved_duration = self.chunk_counter * self.chunk_duration
            return f"Recording: {self.chunk_counter} chunks saved, current buffer: {current_buffer_duration:.1f}s, total: ~{total_saved_duration:.1f}s"
        return "Not recording"

def set_debug_audio(enabled: bool, duration: float = 5.0, save_all: bool = True, participant_filter: list = None):
    """
    Utility function to easily configure audio debugging

    Args:
        enabled: Enable/disable audio recording
        duration: Recording duration in seconds (0 for unlimited)
        save_all: Save audio for all participants
        participant_filter: List of participant IDs to record (only used if save_all=False)
    """
    global DEBUG_SAVE_AUDIO, RECORDING_DURATION, DEBUG_SAVE_ALL_PARTICIPANTS, DEBUG_PARTICIPANT_FILTER

    DEBUG_SAVE_AUDIO = enabled
    RECORDING_DURATION = duration
    DEBUG_SAVE_ALL_PARTICIPANTS = save_all
    DEBUG_PARTICIPANT_FILTER = participant_filter or []

    status = "ENABLED" if enabled else "DISABLED"
    print(f"🔧 Audio Debug {status}")
    if enabled:
        print(f"   📁 Save directory: {DEBUG_AUDIO_DIR}")
        print(f"   ⏱️ Duration: {duration}s {'(unlimited)' if duration == 0 else ''}")
        print(f"   👥 Participants: {'All' if save_all else str(participant_filter)}")

class WhisperLiveClient:
    """
    Async Whisper Live client for LiveKit integration using websockets library
    """
    def __init__(self, host, port, lang=None, model="small", use_vad=True, 
                 transcription_callback=None, participant_identity=None):
        self.host = host
        self.port = port
        self.language = lang
        self.model = model
        self.use_vad = use_vad
        self.transcription_callback = transcription_callback
        self.participant_identity = participant_identity
        
        self.uid = str(uuid.uuid4())
        self.recording = False
        self.waiting = False
        self.server_error = False
        self.last_response_received = None
        self.disconnect_if_no_response_for = 15
        self.server_backend = None
        self.last_segment = None
        self.last_received_segment = None
        
        self.websocket = None
        self.connection_task = None
        self.receive_task = None
        self._stop_event = asyncio.Event()
        
    async def connect(self):
        """Establish WebSocket connection to Whisper Live server"""
        try:
            uri = f"ws://{self.host}:{self.port}"
            print(f"🔌 Connecting to Whisper Live server at {uri}")
            
            self.websocket = await websockets.connect(uri)
            print(f"✅ Connected to Whisper Live server for participant {self.participant_identity}")
            
            # Send initial configuration
            config = {
                "uid": self.uid,
                "language": self.language,
                "task": "transcribe",
                "model": self.model,
                "use_vad": self.use_vad,
                "send_last_n_segments": 10,
                "no_speech_thresh": 0.45,
                "clip_audio": False,
                "same_output_threshold": 10,
                "enable_translation": False,
                "target_language": "en",
            }
            
            await self.websocket.send(json.dumps(config))
            
            # Start receiving messages
            self.receive_task = asyncio.create_task(self._receive_messages())
            
            return True
            
        except Exception as e:
            print(f"❌ Failed to connect to Whisper Live server: {e}")
            return False
    
    async def _receive_messages(self):
        """Receive messages from Whisper Live server"""
        try:
            async for message in self.websocket:
                if self._stop_event.is_set():
                    break
                await self._handle_message(message)
                
        except websockets.exceptions.ConnectionClosed:
            print(f"🔌 WebSocket connection closed for participant {self.participant_identity}")
        except Exception as e:
            print(f"❌ Error receiving messages for participant {self.participant_identity}: {e}")
        finally:
            self.recording = False
    
    async def _handle_message(self, message):
        """Handle messages from Whisper Live server"""
        try:
            message_data = json.loads(message)
            
            if self.uid != message_data.get("uid"):
                return
            
            # Handle status messages
            if "status" in message_data:
                status = message_data["status"]
                if status == "WAIT":
                    self.waiting = True
                    print(f"⏳ Server is full. Wait time: {round(message_data.get('message', 0))} minutes.")
                elif status == "ERROR":
                    print(f"❌ Server error: {message_data.get('message')}")
                    self.server_error = True
                elif status == "WARNING":
                    print(f"⚠️ Server warning: {message_data.get('message')}")
                return
            
            # Handle disconnect message
            if message_data.get("message") == "DISCONNECT":
                print(f"🔌 Server disconnected participant {self.participant_identity}")
                self.recording = False
                return
            
            # Handle server ready message
            if message_data.get("message") == "SERVER_READY":
                self.last_response_received = time.time()
                self.recording = True
                self.server_backend = message_data.get("backend", "unknown")
                print(f"🚀 Whisper server ready with backend {self.server_backend}")
                return
            
            # Handle language detection
            if "language" in message_data:
                detected_lang = message_data.get("language")
                lang_prob = message_data.get("language_prob", 0)
                print(f"🌐 Detected language: {detected_lang} (prob: {lang_prob:.2f})")
                return
            
            # Handle transcription segments
            if "segments" in message_data:
                await self._process_segments(message_data["segments"])
                
        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse message from Whisper server: {e}")
        except Exception as e:
            print(f"❌ Error handling server message: {e}")
    
    async def _process_segments(self, segments):
        """Process transcription segments from Whisper Live"""
        if not segments:
            return
            
        text_parts = []
        for i, seg in enumerate(segments):
            text = seg.get("text", "").strip()
            if text and (not text_parts or text_parts[-1] != text):
                text_parts.append(text)
                
                # Track last segment
                if i == len(segments) - 1 and not seg.get("completed", False):
                    self.last_segment = seg
                elif seg.get("completed", False):
                    # This is a completed segment
                    pass
        
        # Update last response time
        if segments:
            if self.last_received_segment is None or self.last_received_segment != segments[-1].get("text"):
                self.last_response_received = time.time()
                self.last_received_segment = segments[-1].get("text")
        
        # Call transcription callback if provided
        if self.transcription_callback and text_parts:
            full_text = " ".join(text_parts)
            if full_text.strip():
                try:
                    await self.transcription_callback(full_text, segments)
                except Exception as e:
                    print(f"⚠️ Transcription callback error: {e}")
    
    async def send_audio(self, audio_data):
        """Send audio data to Whisper Live server"""
        if self.websocket and self.recording:
            try:
                await self.websocket.send(audio_data)
            except Exception as e:
                print(f"❌ Failed to send audio data: {e}")
    
    async def disconnect(self):
        """Close WebSocket connection"""
        try:
            self._stop_event.set()
            
            if self.receive_task:
                self.receive_task.cancel()
                try:
                    await self.receive_task
                except asyncio.CancelledError:
                    pass
            
            if self.websocket:
                await self.websocket.close()
                
        except Exception as e:
            print(f"⚠️ Error during disconnect: {e}")

async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()
    disconnected = asyncio.Event()
    
    # Dictionary to track active transcription clients
    active_clients = {}

    async def send_transcript_entry(text: str, participant_identity: str, participant_name: str = "Speaker", is_final: bool = True):
        """Send transcript entry via Data Channel"""
        try:
            transcript_entry = {
                "id": f"transcript-{int(time.time() * 1000)}",
                "participantIdentity": participant_identity,
                "participantName": participant_name,
                "text": text,
                "timestamp": int(time.time() * 1000),
                "isFinal": is_final
            }
            
            transcript_data = {
                "type": "transcript",
                "entry": transcript_entry
            }
            
            data = json.dumps(transcript_data).encode("utf-8")
            
            await ctx.room.local_participant.publish_data(
                data,
                reliable=True,
                topic="transcript"
            )
            
            print(f"📝 Transcript sent for {participant_identity}: {text[:50]}{'...' if len(text) > 50 else ''}")
            return True
            
        except Exception as e:
            print(f"❌ Error sending transcript: {e}")
            return False

    def create_transcription_callback(participant_identity: str, participant_name: str):
        """Create transcription callback for a specific participant"""
        
        async def transcription_callback(text: str, segments: list):
            """Handle transcription results from Whisper Live"""
            if not text or not text.strip():
                return
            
            # Determine if this is a final transcription
            is_final = False
            if segments:
                last_segment = segments[-1]
                is_final = last_segment.get("completed", False)
            
            # Send transcript to LiveKit room
            await send_transcript_entry(
                text=text.strip(),
                participant_identity=participant_identity,
                participant_name=participant_name,
                is_final=is_final
            )
        
        return transcription_callback

    async def manage_speaker_transcription(track: rtc.RemoteAudioTrack, participant: rtc.RemoteParticipant):
        """Manage transcription for a specific speaker using Whisper Live"""
        speaker_id = participant.identity
        speaker_name = participant.name or f"Speaker {speaker_id}"

        print(f"🎙️ Starting transcription for participant {speaker_id}")

        # Create audio recorder for debugging
        audio_recorder = AudioRecorder(speaker_id)

        # Create transcription callback
        callback = create_transcription_callback(speaker_id, speaker_name)

        # Create Whisper Live client
        whisper_client = WhisperLiveClient(
            host=WHISPER_HOST,
            port=WHISPER_PORT,
            lang=LANGUAGE,
            model=MODEL,
            use_vad=USE_VAD,
            transcription_callback=callback,
            participant_identity=speaker_id
        )
        
        # Connect to Whisper Live server
        if not await whisper_client.connect():
            print(f"❌ Failed to connect to Whisper Live for participant {speaker_id}")
            return
        
        # Store client reference
        active_clients[speaker_id] = whisper_client
        
        # Wait for server to be ready
        max_wait = 10  # seconds
        wait_time = 0
        while not whisper_client.recording and not whisper_client.server_error and not whisper_client.waiting:
            await asyncio.sleep(0.1)
            wait_time += 0.1
            if wait_time > max_wait:
                print(f"⏰ Timeout waiting for Whisper server for participant {speaker_id}")
                break
        
        if whisper_client.server_error or whisper_client.waiting:
            print(f"❌ Cannot start transcription for participant {speaker_id}")
            whisper_client.disconnect()
            active_clients.pop(speaker_id, None)
            audio_recorder.stop_and_save_recording()
            return

        print(f"🚀 Transcription ready for participant {speaker_id}")

        # Start recording audio for debugging
        audio_recorder.start_recording()

        # Create audio chunk buffer (like original Whisper Live client)
        chunk_buffer = AudioChunkBuffer(CHUNK_SIZE)

        # Statistics tracking
        frame_count = 0
        chunks_sent = 0
        last_stats_time = time.time()

        try:
            # Stream audio to Whisper Live
            stream = rtc.AudioStream.from_track(track=track, sample_rate=16000, num_channels=1)
            async for event in stream:
                if speaker_id not in active_clients:
                    break

                frame = event.frame
                frame_count += 1

                # Add raw frame data to chunk buffer
                raw_data = bytes(frame.data)  # Keep as int16 bytes
                chunks = chunk_buffer.add_data(raw_data)

                # Process each complete chunk
                for chunk_data in chunks:
                    # Convert to float array like original client
                    audio_array = chunk_buffer.bytes_to_float_array(chunk_data)
                    audio_bytes = audio_array.tobytes()

                    # Add to debug recording
                    audio_recorder.add_audio_data(audio_bytes)

                    # Send audio data to Whisper Live
                    await whisper_client.send_audio(audio_bytes)
                    chunks_sent += 1

                # Print periodic stats (every 10 seconds)
                current_time = time.time()
                if current_time - last_stats_time > 10:
                    duration = frame_count * 1024 / SAMPLE_RATE  # Assuming 1024 samples per frame
                    print(f"📈 {speaker_id}: {frame_count} frames, {chunks_sent} chunks sent, ~{duration:.1f}s audio processed")
                    if audio_recorder.should_record:
                        print(f"🔊 Audio recorder: {audio_recorder.get_stats()}")
                    last_stats_time = current_time

            # Send any remaining data in buffer
            remaining_data = chunk_buffer.get_remaining_data()
            if remaining_data:
                audio_array = chunk_buffer.bytes_to_float_array(remaining_data)
                audio_bytes = audio_array.tobytes()
                audio_recorder.add_audio_data(audio_bytes)
                await whisper_client.send_audio(audio_bytes)
                chunks_sent += 1
                print(f"📤 Sent final chunk for {speaker_id} ({len(remaining_data)} bytes)")

            print(f"⏹️ Audio stream ended for participant {speaker_id} (total chunks sent: {chunks_sent})")

        except Exception as e:
            print(f"❌ Error during audio streaming for participant {speaker_id}: {e}")
        
        finally:
            # Stop and save audio recording
            audio_recorder.stop_and_save_recording()

            # Clean up
            if speaker_id in active_clients:
                await whisper_client.disconnect()
                active_clients.pop(speaker_id, None)
                print(f"🧹 Cleaned up transcription for participant {speaker_id}")

    def on_track_subscribed(track: rtc.RemoteAudioTrack, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
        """Handle new audio track subscription"""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"🎵 New audio track from participant {participant.identity}")
            asyncio.create_task(manage_speaker_transcription(track, participant))

    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        """Handle participant disconnection"""
        speaker_id = participant.identity
        if speaker_id in active_clients:
            print(f"👋 Participant {speaker_id} disconnected, cleaning up transcription")
            asyncio.create_task(active_clients[speaker_id].disconnect())
            active_clients.pop(speaker_id, None)

    def on_disconnected():
        """Handle room disconnection"""
        print("🔌 Room disconnected, cleaning up all transcription clients")
        for client in active_clients.values():
            asyncio.create_task(client.disconnect())
        active_clients.clear()
        disconnected.set()

    # Set up event handlers
    ctx.room.on("track_subscribed", on_track_subscribed)
    ctx.room.on("participant_disconnected", on_participant_disconnected)
    ctx.room.on("disconnected", on_disconnected)
    
    # Set agent name
    await ctx.room.local_participant.set_name("Whisper Live Transcription Agent")
    
    # Send welcome message
    async def send_welcome_message():
        await asyncio.sleep(2)  # Wait for stable connection
        await send_transcript_entry(
            text="🤖 Whisper Live transcription agent is ready!",
            participant_identity="agent",
            participant_name="Transcription Agent",
            is_final=True
        )
    
    asyncio.create_task(send_welcome_message())
    
    print("🎯 Whisper Live Agent ready and waiting for participants...")
    await disconnected.wait()


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
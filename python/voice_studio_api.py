
"""FastAPI routes for ChoirMate Voice Studio."""

import base64
import io
import wave
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

try:
    from .voice_studio import extract_voices
    from .voice_audio import render_voice_audio
except ImportError:
    from voice_studio import extract_voices
    from voice_audio import render_voice_audio


router = APIRouter(prefix="/voice-studio", tags=["Voice Studio"])


class VoiceExtractionRequest(BaseModel):
    musicxml: str = Field(min_length=1)


class VoiceAudioRequest(BaseModel):
    musicxml: str = Field(min_length=1)
    selectedVoiceIds: Optional[List[str]] = None
    tempo: int = Field(default=88, ge=36, le=220)


@router.post("/voices")
def get_voices(req: VoiceExtractionRequest):
    """Extract available voices from MusicXML."""
    try:
        voices = extract_voices(req.musicxml)

        return {
            "success": True,
            "voiceCount": len(voices),
            "voices": voices,
        }

    except Exception:
        return {
            "success": False,
            "errorCode": "VOICE_EXTRACTION_FAILED",
            "error": "Could not extract voices from this MusicXML score.",
        }


@router.post("/audio")
def generate_voice_audio(req: VoiceAudioRequest):
    """Generate synchronized WAV audio for selected voices."""
    try:
        voices = extract_voices(req.musicxml)

        audio, duration = render_voice_audio(
            voices,
            selected_voice_ids=req.selectedVoiceIds,
            tempo=req.tempo,
        )

        with wave.open(io.BytesIO(audio), "rb") as wav:
            sample_rate = wav.getframerate()

        return {
            "success": True,
            "format": "wav",
            "mimeType": "audio/wav",
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "durationSeconds": duration,
            "sampleRate": sample_rate,
            "selectedVoiceIds": (
                req.selectedVoiceIds
                if req.selectedVoiceIds is not None
                else [voice["id"] for voice in voices]
            ),
        }

    except ValueError as exc:
        return {
            "success": False,
            "errorCode": "INVALID_VOICE_AUDIO_REQUEST",
            "error": str(exc),
        }

    except Exception:
        return {
            "success": False,
            "errorCode": "VOICE_AUDIO_FAILED",
            "error": "Could not generate Voice Studio audio.",
        }

## How to use mic in simulator

```
# First, list audio input devices
evenhub-simulator --list-audio-input-devices
# Start with a specific device ID
AUDIO_DEVICE="coreaudio:BlackHole2ch_UID" evenhub-simulator http://localhost:5173
```

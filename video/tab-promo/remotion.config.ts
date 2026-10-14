import { Config } from '@remotion/cli/config';

// Quality: lossless PNG frames (JPEG at q80 banded the blurred gradients),
// high-quality x264. Film grain in the comp dithers what's left.
Config.setVideoImageFormat('png');
// Audio-only renders (AUDIO_ONLY=1 … --codec=aac) reject video encoder settings.
if (!process.env.AUDIO_ONLY) {
  Config.setCrf(17);
  Config.setX264Preset('slow');
  Config.setPixelFormat('yuv420p');
}
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer('angle');
Config.setConcurrency(6);

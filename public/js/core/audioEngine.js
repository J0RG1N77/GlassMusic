export class AudioEngine {
  constructor(audioElement) {
    this.audio = audioElement;
  }
  play(url) {
    this.audio.src = url;
    return this.audio.play();
  }
  pause() {
    this.audio.pause();
  }
}

export function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--accent-color', settings.accentColor);
  root.style.setProperty('--glass-alpha', Number(settings.glassAlpha).toFixed(2));
  root.style.setProperty('--glass-blur', `${Number(settings.glassBlur)}px`);
  root.style.setProperty('--bg-base', settings.oledMode ? '#000000' : '#06070a');
}

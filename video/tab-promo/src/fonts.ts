// Load Tab's two typefaces before any frame renders (once per render tab).
import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

let loading: Promise<void> | null = null;
const loadFonts = () => {
  if (!loading) {
    const faces = [
      new FontFace('Manrope', `url(${staticFile('fonts/Manrope.woff2')}) format('woff2')`, { weight: '200 800' }),
      new FontFace('DM Sans', `url(${staticFile('fonts/DMSans.woff2')}) format('woff2')`, { weight: '100 1000' }),
    ];
    loading = Promise.all(faces.map((f) => f.load())).then((loaded) => {
      loaded.forEach((f) => document.fonts.add(f));
    });
  }
  return loading;
};

export const useFonts = () => {
  const [handle] = useState(() => delayRender('Loading Manrope + DM Sans', { timeoutInMilliseconds: 90000 }));
  useEffect(() => {
    loadFonts()
      .catch((err) => console.error('font load failed', err))
      .finally(() => continueRender(handle));
  }, [handle]);
};

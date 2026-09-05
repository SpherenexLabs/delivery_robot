const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

let loadPromise = null;

export const isGoogleMapsConfigured = () => Boolean(GOOGLE_MAPS_API_KEY);

export const loadGoogleMaps = () => {
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in .env.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    window.__initGoogleMaps = () => {
      delete window.__initGoogleMaps;
      resolve(window.google.maps);
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&loading=async&callback=__initGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loadPromise = null;
      delete window.__initGoogleMaps;
      reject(new Error('Failed to load the Google Maps script. Check the API key and network connection.'));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
};

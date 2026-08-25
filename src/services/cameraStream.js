const CAMERA_BRIDGE_URL = (import.meta.env.VITE_CAMERA_BRIDGE_URL || '').trim().replace(/\/$/, '');

const isLocalApp = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export const resolveCameraStreamUrl = (inputUrl) => {
  const cameraUrl = new URL(inputUrl.trim());

  if (!['http:', 'https:', 'rtsp:'].includes(cameraUrl.protocol)) {
    throw new Error('Enter a complete RTSP, HTTP, or HTTPS camera URL.');
  }

  const isLegacyMaizicUrl =
    cameraUrl.protocol === 'http:' &&
    cameraUrl.port === '8080' &&
    cameraUrl.pathname.toLowerCase() === '/video';
  const streamUrl = isLegacyMaizicUrl
    ? `rtsp://${cameraUrl.username}:${cameraUrl.password}@${cameraUrl.hostname}:554/stream1`
    : cameraUrl.toString();
  const streamProtocol = new URL(streamUrl).protocol;

  if (streamProtocol === 'rtsp:') {
    if (!CAMERA_BRIDGE_URL && !isLocalApp()) {
      throw new Error(
        'RTSP needs an HTTPS camera bridge in production. Set VITE_CAMERA_BRIDGE_URL in Vercel and redeploy.',
      );
    }

    return `${CAMERA_BRIDGE_URL}/api/ip-camera/stream?url=${encodeURIComponent(streamUrl)}`;
  }

  if (window.location.protocol === 'https:' && streamProtocol === 'http:') {
    throw new Error('An HTTPS deployment cannot open an HTTP camera stream. Use an HTTPS camera URL or bridge.');
  }

  return streamUrl;
};

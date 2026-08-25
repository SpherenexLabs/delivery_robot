import { useEffect, useRef, useState } from 'react';
import {
  activateServoForDelivery,
  saveRecord,
} from '../services/firebaseDatabase';
import { detectAndMatchFaces, loadFaceModels } from '../services/faceRecognition';

const makeAlertId = () => `ALT-${Date.now().toString(36).toUpperCase()}`;

export default function LiveMonitor({ assignments, isWaitingAtDestination = false, receivers }) {
  const [cameraSource, setCameraSource] = useState('webcam');
  const [ipCameraUrl, setIpCameraUrl] = useState('');
  const [ipStreamUrl, setIpStreamUrl] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [detections, setDetections] = useState([]);
  const [error, setError] = useState('');
  const [scanTime, setScanTime] = useState(null);
  const videoRef = useRef(null);
  const ipImageRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);
  const unknownFaceActiveRef = useRef(false);
  const matchedReceiverIdsRef = useRef(new Set());

  const stopMonitor = () => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (ipImageRef.current) {
      ipImageRef.current.removeAttribute('src');
    }

    setIpStreamUrl('');
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setIsActive(false);
    setDetections([]);
    setScanTime(null);
    unknownFaceActiveRef.current = false;
    matchedReceiverIdsRef.current = new Set();
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const scan = async () => {
      const video = videoRef.current;
      const ipImage = ipImageRef.current;
      const canvas = canvasRef.current;
      const source = cameraSource === 'ip' ? ipImage : video;
      const sourceReady =
        cameraSource === 'ip'
          ? Boolean(ipImage?.complete && ipImage.naturalWidth)
          : Boolean(video && video.readyState >= 2);

      if (!source || !canvas || !sourceReady || scanningRef.current) {
        return;
      }

      scanningRef.current = true;
      const scanStartedAt = performance.now();

      try {
        const results = await detectAndMatchFaces(source, receivers);
        const context = canvas.getContext('2d');
        canvas.width = cameraSource === 'ip' ? ipImage.naturalWidth : video.videoWidth;
        canvas.height = cameraSource === 'ip' ? ipImage.naturalHeight : video.videoHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 16px Segoe UI';
        context.textBaseline = 'top';

        results.forEach((result) => {
          const { x, y, width, height } = result.box;
          const color = result.matched ? '#62e6a7' : '#ff6b5f';
          const label = result.matched ? result.receiver.name : 'Unknown receiver';
          const labelWidth = context.measureText(label).width + 16;

          context.strokeStyle = color;
          context.lineWidth = 4;
          context.strokeRect(x, y, width, height);
          context.fillStyle = color;
          context.fillRect(x, Math.max(0, y - 28), labelWidth, 28);
          context.fillStyle = '#102027';
          context.fillText(label, x + 8, Math.max(2, y - 24));
        });

        const unknownDetected = results.some((result) => !result.matched);
        const arrivedMatchedReceiverIds = new Set(
          results
            .filter((result) => {
              if (!result.matched || !result.receiver?.id) {
                return false;
              }

              return isWaitingAtDestination || assignments.some(
                (assignment) =>
                  assignment.receiverId === result.receiver.id &&
                  assignment.status === 'arrived',
              );
            })
            .map((result) => result.receiver.id),
        );

        if (unknownDetected && !unknownFaceActiveRef.current) {
          unknownFaceActiveRef.current = true;
          const detectedAt = new Date();
          const alert = {
            id: makeAlertId(),
            type: 'unknown_person_detected',
            message: 'Unknown person detected by the robot camera.',
            resolved: false,
            createdAt: detectedAt.toLocaleString(),
            createdAtMs: detectedAt.getTime(),
          };

          saveRecord('alerts', alert).catch((alertError) => {
            if (isActive) {
              setError(`Unknown face alert failed: ${alertError.message}`);
            }
          });
        } else if (!unknownDetected) {
          unknownFaceActiveRef.current = false;
        }

        arrivedMatchedReceiverIds.forEach((receiverId) => {
          if (!matchedReceiverIdsRef.current.has(receiverId)) {
            activateServoForDelivery().catch((hardwareError) => {
              if (isActive) {
                setError(`Servo command failed: ${hardwareError.message}`);
              }
            });
          }
        });
        matchedReceiverIdsRef.current = arrivedMatchedReceiverIds;

        if (isActive) {
          setDetections(results);
          setScanTime(Math.round(performance.now() - scanStartedAt));
          setError('');
        }
      } catch (scanError) {
        if (isActive) {
          setError(scanError.message);
        }
      } finally {
        scanningRef.current = false;
      }
    };

    const interval = window.setInterval(scan, 300);
    scan();

    return () => window.clearInterval(interval);
  }, [assignments, cameraSource, isActive, isWaitingAtDestination, receivers]);

  const startWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser.');
      return;
    }

    setIsStarting(true);
    setError('');

    try {
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setIsActive(true);
    } catch {
      setError('Could not start the live camera. Allow camera permission and try again.');
      stopMonitor();
    } finally {
      setIsStarting(false);
    }
  };

  const connectIpCamera = async () => {
    const trimmedUrl = ipCameraUrl.trim();

    if (!trimmedUrl) {
      setError('Enter the IP camera stream URL.');
      return;
    }

    setIsStarting(true);
    setError('');

    try {
      const authenticatedUrl = new URL(trimmedUrl);

      if (!['http:', 'https:', 'rtsp:'].includes(authenticatedUrl.protocol)) {
        throw new Error('Enter a complete RTSP, HTTP, or HTTPS camera URL.');
      }

      const isLegacyMaizicUrl =
        authenticatedUrl.protocol === 'http:' &&
        authenticatedUrl.port === '8080' &&
        authenticatedUrl.pathname.toLowerCase() === '/video';
      const streamUrl = isLegacyMaizicUrl
        ? `rtsp://${authenticatedUrl.username}:${authenticatedUrl.password}@${authenticatedUrl.hostname}:554/stream1`
        : trimmedUrl;
      const streamProtocol = new URL(streamUrl).protocol;

      await loadFaceModels();
      setIpStreamUrl(
        streamProtocol === 'rtsp:'
          ? `/api/ip-camera/stream?url=${encodeURIComponent(streamUrl)}`
          : streamUrl,
      );
    } catch (modelError) {
      setError(modelError.message || 'Could not connect to the IP camera.');
      setIsStarting(false);
    }
  };

  const handleIpStreamLoaded = () => {
    setIsActive(true);
    setIsStarting(false);
    setError('');
  };

  const handleIpStreamError = () => {
    setIsActive(false);
    setIsStarting(false);
    setIpStreamUrl('');
    setError(
      'Could not open the camera stream. Check the RTSP URL, username, password, camera network, and stream path.',
    );
  };

  const startMonitor = () => {
    if (cameraSource === 'ip') {
      connectIpCamera();
      return;
    }

    startWebcam();
  };

  const changeCameraSource = (source) => {
    stopMonitor();
    setError('');
    setCameraSource(source);
  };

  const getAssignment = (receiverId) =>
    assignments.find((assignment) => assignment.receiverId === receiverId);

  const registeredCount = receivers.filter(
    (receiver) => receiver.faceDescriptors?.length || receiver.faceDescriptor?.length,
  ).length;

  return (
    <div className="live-monitor">
      <div className="camera-source-controls">
        <div className="camera-source-selector" role="group" aria-label="Camera source">
          <button
            className={cameraSource === 'webcam' ? 'active' : ''}
            disabled={isStarting}
            onClick={() => changeCameraSource('webcam')}
            type="button"
          >
            Webcam
          </button>
          <button
            className={cameraSource === 'ip' ? 'active' : ''}
            disabled={isStarting}
            onClick={() => changeCameraSource('ip')}
            type="button"
          >
            IP Camera
          </button>
        </div>
        {cameraSource === 'ip' && (
          <label className="ip-camera-field" htmlFor="ipCameraUrl">
            <span>IP Camera URL With Login</span>
            <input
              disabled={isActive || isStarting}
              id="ipCameraUrl"
              onChange={(event) => setIpCameraUrl(event.target.value)}
              placeholder="rtsp://username:password@192.168.1.100:554/stream1"
              type="url"
              value={ipCameraUrl}
            />
          </label>
        )}
      </div>

      <div className="monitor-toolbar">
        <div className="monitor-source">
          <span className={`status-dot ${isActive ? '' : 'offline'}`}></span>
          <div>
            <strong>
              {isActive
                ? `${cameraSource === 'ip' ? 'IP camera' : 'Webcam'} active`
                : `${cameraSource === 'ip' ? 'IP camera' : 'Webcam'} offline`}
            </strong>
            <span>
              {registeredCount} recognition-ready receivers
              {isActive && scanTime !== null ? ` - ${scanTime} ms inference` : ''}
            </span>
          </div>
        </div>
        {isActive ? (
          <button className="secondary-btn" onClick={stopMonitor} type="button">
            Stop Camera
          </button>
        ) : (
          <button className="submit-btn" disabled={isStarting} onClick={startMonitor} type="button">
            {isStarting
              ? cameraSource === 'ip'
                ? 'Connecting...'
                : 'Loading Recognition...'
              : cameraSource === 'ip'
                ? 'Connect IP Camera'
                : 'Start Webcam'}
          </button>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="monitor-layout">
        <div className={`monitor-feed ${isActive ? 'active' : ''}`}>
          {cameraSource === 'webcam' ? (
            <video aria-label="Live receiver authentication camera" autoPlay muted playsInline ref={videoRef}></video>
          ) : (
            ipStreamUrl ? (
              <img
                alt="IP camera live stream"
                crossOrigin="anonymous"
                onError={handleIpStreamError}
                onLoad={handleIpStreamLoaded}
                ref={ipImageRef}
                src={ipStreamUrl}
              />
            ) : null
          )}
          <canvas aria-hidden="true" ref={canvasRef}></canvas>
          {!isActive && <span>Live feed is off</span>}
        </div>

        <aside className="detection-panel">
          <h3>Live Identification</h3>
          {detections.length === 0 ? (
            <p className="empty-state compact">{isActive ? 'No face detected' : 'Waiting for camera'}</p>
          ) : (
            detections.map((detection, index) => {
              const assignment = detection.receiver
                ? getAssignment(detection.receiver.id)
                : null;

              return (
                <div className={`detection-result ${detection.matched ? 'matched' : 'unknown'}`} key={`${index}-${detection.receiver?.id || 'unknown'}`}>
                  {detection.receiver?.faceImage ? (
                    <img alt={`${detection.receiver.name} registered face`} src={detection.receiver.faceImage} />
                  ) : (
                    <div className="face-placeholder">Unknown</div>
                  )}
                  <div>
                    <strong>{detection.receiver?.name || 'Unknown receiver'}</strong>
                    <span>{detection.matched ? 'Face matched' : 'No registered match'}</span>
                    {assignment && <span>Delivery: {assignment.id}</span>}
                    {detection.distance !== null && (
                      <span>
                        Match confidence: {Math.max(0, Math.min(100, (1 - detection.distance) * 100)).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
